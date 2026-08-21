import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: () => getDb() }));
vi.mock("../services/platformImageChineseStaging.js", () => ({
  omitChineseStagingFromJobOutput: (o: unknown) => o,
}));
vi.mock("../services/drProSecondaryStaging.js", () => ({
  deleteDrProSecondaryStagingByJobId: async () => {},
}));

import {
  claimNextPostProdJob,
  claimNextQueuedJobExcluding,
  MAIN_QUEUE_EXCLUDED_TYPES,
  markManhuaLearnJobSucceededWithRetry,
  recoverInterruptedManhuaTemplateLearnJobsOnStartup,
} from "./repository";

const QUEUED_ROW = {
  id: "job-1",
  userId: "u1",
  type: "video",
  provider: "seedance",
  status: "queued",
  input: {},
  output: null,
  error: null,
  attempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** rowsAffected：每次 update...returning 影响的行数，按调用顺序取 */
function fakeDb(rowsAffected: number[]) {
  let updateCall = 0;
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => [QUEUED_ROW],
  };
  return {
    select: () => selectChain,
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const n = rowsAffected[updateCall] ?? 0;
            updateCall += 1;
            return n > 0 ? [{ id: QUEUED_ROW.id }] : [];
          },
        }),
      }),
    }),
  };
}

describe("queued 任务抢占", () => {
  beforeEach(() => getDb.mockReset());

  it("抢到（影响 1 行）时返回任务", async () => {
    const db = fakeDb([1]);
    getDb.mockResolvedValue(db);
    const job = await claimNextQueuedJobExcluding([]);
    expect(job?.id).toBe("job-1");
  });

  /**
   * 两个 worker 同时 select 到同一条，第二个的条件 UPDATE 一行没改。
   * 旧代码不看这个就往下 getJobById，同一个视频任务会被执行两遍，钱烧两次。
   */
  it("被别人抢走（影响 0 行）时返回 null，而不是照样开跑", async () => {
    const db = fakeDb([0]);
    getDb.mockResolvedValue(db);
    expect(await claimNextQueuedJobExcluding([])).toBeNull();
  });
});

describe("漫剧学习启动恢复", () => {
  beforeEach(() => getDb.mockReset());

  it("把重启前的运行任务重新排队，并保留已取消任务的终止状态", async () => {
    const returning = vi.fn().mockResolvedValue([
      { id: "learn-running", status: "queued" },
      { id: "learn-cancelled", status: "failed" },
    ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    getDb.mockResolvedValue({ update: vi.fn(() => ({ set })) });

    await expect(recoverInterruptedManhuaTemplateLearnJobsOnStartup()).resolves.toEqual({
      requeued: 1,
      cancelled: 1,
      completed: 0,
      exhausted: 0,
    });
    expect(set).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
  });

  it("部署切在 done payload 与 status 之间时直接收敛成功，不重新排队", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: "learn-done",
        status: "succeeded",
        error: null,
        output: { analysisStage: "manhua_learn_done" },
      },
      {
        id: "learn-exhausted",
        status: "failed",
        error: "任务在服务重启前已达重试上限；已落盘内容保留，可手动续学",
        output: null,
      },
    ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    getDb.mockResolvedValue({ update: vi.fn(() => ({ set })) });

    await expect(recoverInterruptedManhuaTemplateLearnJobsOnStartup()).resolves.toEqual({
      requeued: 0,
      cancelled: 0,
      completed: 1,
      exhausted: 1,
    });
  });

  it("数据库不可用时明确失败，不伪装成已恢复", async () => {
    getDb.mockResolvedValue(null);
    await expect(recoverInterruptedManhuaTemplateLearnJobsOnStartup()).rejects.toThrow(
      "cannot recover manhua learn jobs",
    );
  });
});

describe("漫剧学习终态落库", () => {
  beforeEach(() => getDb.mockReset());

  it("只重试同一份终态写入，不重跑学习链", async () => {
    let writes = 0;
    const selectChain = {
      from: () => selectChain,
      where: () => selectChain,
      limit: async () => [{ ...QUEUED_ROW, input: { action: "manhua_template_learn" } }],
    };
    const db = {
      select: () => selectChain,
      update: () => ({
        set: () => ({
          where: async () => {
            writes += 1;
            if (writes < 3) throw new Error("neon transient");
          },
        }),
      }),
    };
    getDb.mockResolvedValue(db);

    await expect(
      markManhuaLearnJobSucceededWithRetry(
        "learn-terminal",
        { analysisStage: "manhua_learn_done", learnedCount: 6 },
        "manhua-template-learn",
        { attempts: 4, delayMs: 0 },
      ),
    ).resolves.toBe(true);
    expect(writes).toBe(3);
  });

  it("达到终态写入重试上限后明确返回 false", async () => {
    let writes = 0;
    getDb.mockResolvedValue({
      update: () => ({
        set: () => ({
          where: async () => {
            writes += 1;
            throw new Error("neon unavailable");
          },
        }),
      }),
    });

    await expect(
      markManhuaLearnJobSucceededWithRetry(
        "learn-terminal-fail",
        { analysisStage: "manhua_learn_done" },
        undefined,
        { attempts: 2, delayMs: 0 },
      ),
    ).resolves.toBe(false);
    expect(writes).toBe(2);
  });
});

describe("post_prod 独立任务通道", () => {
  beforeEach(() => getDb.mockReset());

  it("普通任务通道排除 post_prod(与 pdf_export 同列)", () => {
    expect(MAIN_QUEUE_EXCLUDED_TYPES).toContain("post_prod");
    expect(MAIN_QUEUE_EXCLUDED_TYPES).toContain("pdf_export");
  });

  it("claimNextPostProdJob 用同一套条件 UPDATE 抢占,抢到返回任务", async () => {
    const db = fakeDb([1]);
    getDb.mockResolvedValue(db);
    const job = await claimNextPostProdJob();
    expect(job?.id).toBe("job-1");
  });

  it("被别的实例抢走(影响 0 行)返回 null,不重复执行同一条后期任务", async () => {
    const db = fakeDb([0]);
    getDb.mockResolvedValue(db);
    expect(await claimNextPostProdJob()).toBeNull();
  });
});

describe("markJobSucceededWithRetry:只重试状态写入", () => {
  beforeEach(() => getDb.mockReset());

  it("前两次状态写入未完成、第三次完成;媒体处理不在本函数内不会重跑", async () => {
    let updateAttempts = 0;
    getDb.mockImplementation(async () => ({
      select: () => {
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: async () => [],
        };
        return chain;
      },
      update: () => ({
        set: () => ({
          where: async () => {
            updateAttempts += 1;
            // 前两次:写入未完成;第三次成功
            if (updateAttempts < 3) throw new Error("db transient");
          },
        }),
      }),
    }));

    const { markJobSucceededWithRetry } = await import("./repository");
    await expect(
      markJobSucceededWithRetry("pp-1", { gcsUri: "gs://bucket-a/post-prod/7/x.mp4" }, "ffmpeg-post-prod", {
        attempts: 4,
        delayMs: 0,
      }),
    ).resolves.toBe(true);
    expect(updateAttempts).toBe(3);
  });

  it("达到重试次数仍未写入时返回 false(runner 会保留 failed 任务记录)", async () => {
    getDb.mockResolvedValue(null);
    const { markJobSucceededWithRetry } = await import("./repository");
    await expect(
      markJobSucceededWithRetry("pp-2", { gcsUri: "gs://bucket-a/post-prod/7/y.mp4" }, undefined, {
        attempts: 2,
        delayMs: 0,
      }),
    ).resolves.toBe(false);
  });
});

describe("listPostProdJobsForUser:服务端为任务记录主来源", () => {
  beforeEach(() => getDb.mockReset());

  it("按当前用户 + post_prod 条件查询,input/output 解析成对象", async () => {
    const whereArgs: unknown[] = [];
    const chain = {
      from: () => chain,
      where: (cond: unknown) => {
        whereArgs.push(cond);
        return chain;
      },
      orderBy: () => chain,
      limit: async () => [
        {
          ...QUEUED_ROW,
          id: "pp-1",
          type: "post_prod",
          status: "succeeded",
          input: JSON.stringify({ action: "concat", params: {} }),
          output: JSON.stringify({ gcsUri: "gs://bucket-a/post-prod/7/x.mp4" }),
        },
      ],
    };
    getDb.mockResolvedValue({ select: () => chain });

    const { listPostProdJobsForUser } = await import("./repository");
    const rows = await listPostProdJobsForUser("7", 30);
    expect(whereArgs).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect((rows[0].input as { action?: string }).action).toBe("concat");
    expect((rows[0].output as { gcsUri?: string }).gcsUri).toBe("gs://bucket-a/post-prod/7/x.mp4");
  });

  it("数据库不可用返回空列表(前端缓存仍可显示)", async () => {
    getDb.mockResolvedValue(null);
    const { listPostProdJobsForUser } = await import("./repository");
    await expect(listPostProdJobsForUser("7")).resolves.toEqual([]);
  });
});
