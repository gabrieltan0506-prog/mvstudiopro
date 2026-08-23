/**
 * 协调器行为。全部注入假实现，**不调用任何付费接口**。
 *
 * 这一层此前根本不存在：runner 与入库两端都写完了，中间没有生产调用点，
 * `MANHUA_NATIVE_DEEP_READ=1` 打开也不改变任何业务路径。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
  executeAndIngestNativeDeepReadEpisode,
  runNativeDeepReadBatch,
  validateNativeDeepReadBatchPlan,
  type NativeDeepReadBatchEpisode,
  type NativeDeepReadExecutionDeps,
} from "./manhuaNativeDeepReadExecution";

function makeResult(over: Record<string, unknown> = {}) {
  const beatGrid = Array.from({ length: 8 }, (_, i) => ({
    atSec: i,
    endSec: i + 1,
    conflictZh: "冲突推进",
    visualZh: `动作${i}`,
  }));
  return {
    beatGrid,
    segmentCount: 2,
    shotCount: beatGrid.length,
    failedSegmentCount: 0,
    droppedCount: 0,
    truncated: false,
    model: "qwen3.8-max",
    attemptedSegments: 2,
    usingPlanQuota: true,
    usage: { costCny: 0.5 },
    ...over,
  };
}

/**
 * 18 分钟一集必须拆段：fps=2 · max_frames=2000 → 单段完整覆盖上限 1000s，
 * 单段 0–1080s 模型看不完整（审阅点名的坏例子，现在被预检拦下）。
 */
const episode = {
  episodeIndex: 1,
  sourceUrl: "https://example.com/e1",
  durationSec: 1080,
  segments: [
    { startSec: 0, endSec: 540 },
    { startSec: 540, endSec: 1080 },
  ],
  resolveNodes: async () => ["https://cdn/1.mp4"],
};

let deps: NativeDeepReadExecutionDeps;

beforeEach(() => {
  deps = {
    isEnabled: vi.fn(() => true),
    run: vi.fn(async () => makeResult() as never),
    ingest: vi.fn(async (i: { episodeIndex: number }) => ({
      card: { id: `tpl_native_s_ep00${i.episodeIndex}` },
      gcsUri: `gs://b/ep${i.episodeIndex}.json`,
      objectName: `o/ep${i.episodeIndex}.json`,
      created: true,
    })) as never,
    listIngested: vi.fn(async () => new Set<number>()),
    acquireClaim: vi.fn(async () => ({
      claimUri: "gs://b/claim.json",
      objectName: "claim.json",
      runId: "r1",
      releaseAfterSuccess: async () => {},
    })),
  } as never;
});

const ep = (i: number, over: Partial<NativeDeepReadBatchEpisode> = {}) => ({
  ...episode,
  episodeIndex: i,
  ...over,
});

describe("批次预检：在任何模型动作之前", () => {
  it("清单重复同一集直接拒 —— 实测原先会真的跑两次、付两次钱", async () => {
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(1)] }, deps),
    ).rejects.toThrow("重复第1集");
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.listIngested).not.toHaveBeenCalled();
  });

  it("非法集号零调用拒绝", async () => {
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(0)] }, deps),
    ).rejects.toThrow("1–999");
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("单段超过 max_frames/fps 覆盖上限要求拆段（模型看不完整）", () => {
    expect(() =>
      validateNativeDeepReadBatchPlan([
        ep(1, { durationSec: 1200, segments: [{ startSec: 0, endSec: 1080 }] }),
      ]),
    ).toThrow("请拆段");
    expect(NATIVE_DEEP_READ_MAX_SEGMENT_SEC).toBe(1000);
  });

  it("切片超出片长拒绝", () => {
    expect(() =>
      validateNativeDeepReadBatchPlan([
        ep(1, { durationSec: 100, segments: [{ startSec: 0, endSec: 900 }] }),
      ]),
    ).toThrow("超出片长");
  });

  it("非 HTTPS 来源拒绝", () => {
    expect(() =>
      validateNativeDeepReadBatchPlan([ep(1, { sourceUrl: "http://x/e1" })]),
    ).toThrow("HTTPS");
  });

  it("计费单位是 segment 不是集：20 集各 6 段 = 120 次", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ep(i + 1, {
        durationSec: 1200,
        segments: Array.from({ length: 6 }, (_, k) => ({
          startSec: k * 100,
          endSec: k * 100 + 90,
        })),
      }),
    );
    const plan = validateNativeDeepReadBatchPlan(many);
    expect(plan.totalEpisodes).toBe(20);
    expect(plan.totalSegments).toBe(120);
  });

  it("上限由调用方指定，不写死 20", () => {
    const five = [1, 2, 3, 4, 5].map((i) => ep(i));
    expect(() => validateNativeDeepReadBatchPlan(five, { maxEpisodes: 3 })).toThrow("超过上限 3 集");
    expect(validateNativeDeepReadBatchPlan(five, { maxEpisodes: 50 }).totalEpisodes).toBe(5);
  });

  it("同一份清单确认码稳定，改一个字段就变 —— 真跑靠它绑定干跑那份计划", () => {
    const a = validateNativeDeepReadBatchPlan([ep(1)], { seriesKey: "series_a" }).planHash;
    expect(validateNativeDeepReadBatchPlan([ep(1)], { seriesKey: "series_a" }).planHash).toBe(a);
    // 改任一入参确认码就变：干跑确认过的计划改了字段，真跑必须重新确认
    expect(
      validateNativeDeepReadBatchPlan(
        [ep(1, { sourceUrl: "https://example.com/e9" })],
        { seriesKey: "series_a" },
      ).planHash,
    ).not.toBe(a);
    expect(
      validateNativeDeepReadBatchPlan(
        [ep(1, { segments: [{ startSec: 0, endSec: 500 }] })],
        { seriesKey: "series_a" },
      ).planHash,
    ).not.toBe(a);
    expect(
      validateNativeDeepReadBatchPlan([ep(1)], { seriesKey: "series_b" }).planHash,
    ).not.toBe(a);
  });
});

describe("并发与计费", () => {
  it("占位在 runner 之前 —— 抢不到就停手，不是跑完才发现重复", async () => {
    deps.acquireClaim = vi.fn(async () => {
      throw new Error("第1集已有精读任务占位；禁止自动重跑");
    });
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(deps.run).not.toHaveBeenCalled();
    expect(r.failedCount).toBe(1);
    expect(r.outcomes[0]!.errorZh).toContain("占位");
  });

  it("两个批次跑同一集，只有一个抢到占位，模型总共只调一次", async () => {
    let held = false;
    const claim = vi.fn(async () => {
      if (held) throw new Error("已有精读任务占位");
      held = true;
      return { claimUri: "gs://b/c", objectName: "c", runId: "r", releaseAfterSuccess: async () => {} };
    });
    const shared = { ...deps, acquireClaim: claim } as NativeDeepReadExecutionDeps;
    const [a, b] = await Promise.all([
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, shared),
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, shared),
    ]);
    expect(shared.run).toHaveBeenCalledTimes(1);
    expect(a.ingestedCount + b.ingestedCount).toBe(1);
    expect(a.failedCount + b.failedCount).toBe(1);
  });

  it("门禁拒收也要记成本 —— 钱已经花了，只统计成功卡会算漏", async () => {
    deps.run = vi.fn(async () => makeResult({ segmentCount: 0, beatGrid: [], usage: { costCny: 2.5 } }) as never);
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(r.failedCount).toBe(1);
    expect(r.totalCostCny).toBeCloseTo(2.5);
  });

  it("模型已返回后入库写入异常也要保留成本与占位", async () => {
    const release = vi.fn(async () => undefined);
    deps.acquireClaim = vi.fn(async () => ({
      claimUri: "gs://b/c",
      objectName: "c",
      runId: "r",
      releaseAfterSuccess: release,
    }));
    deps.ingest = vi.fn(async () => { throw new Error("入库暂时不可用"); }) as never;
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(r.failedCount).toBe(1);
    expect(r.totalCostCny).toBeCloseTo(0.5);
    expect(release).not.toHaveBeenCalled();
  });

  it("成功集汇总实际成本与耗时", async () => {
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(2)] }, deps);
    expect(r.ingestedCount).toBe(2);
    expect(r.totalCostCny).toBeCloseTo(1.0);
    expect(r.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.plan.totalSegments).toBe(4);
  });
});

describe("单集执行", () => {
  it("开关没开一律不跑 —— 防误触发付费调用的第一道闸", async () => {
    deps.isEnabled = vi.fn(() => false);
    await expect(
      executeAndIngestNativeDeepReadEpisode({ ...episode, seriesKey: "s" }, deps),
    ).rejects.toThrow("开关未开启");
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("跑成功后必经门禁并入库一次", async () => {
    const out = await executeAndIngestNativeDeepReadEpisode({ ...episode, seriesKey: "s" }, deps);
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.ingest).toHaveBeenCalledTimes(1);
    expect(out.gcsUri).toBe("gs://b/ep1.json");
  });

  it("门禁不过不写 GCS —— 空卡比没有卡更浪费审批人时间", async () => {
    deps.run = vi.fn(async () => makeResult({ segmentCount: 0, beatGrid: [] }) as never);
    await expect(
      executeAndIngestNativeDeepReadEpisode({ ...episode, seriesKey: "s" }, deps),
    ).rejects.toThrow("未通过入库门禁");
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it("已中止时连 runner 都不调", async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      executeAndIngestNativeDeepReadEpisode(
        { ...episode, seriesKey: "s", abortSignal: c.signal },
        deps,
      ),
    ).rejects.toThrow("已停止");
    expect(deps.run).not.toHaveBeenCalled();
  });
});

describe("批量发车", () => {
  const three = [1, 2, 3].map((i) => ({ ...episode, episodeIndex: i }));

  it("已入库的集直接跳过，不调 runner —— 重跑不重烧", async () => {
    deps.listIngested = vi.fn(async () => new Set([1, 2]));
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(r.skippedCount).toBe(2);
    expect(r.ingestedCount).toBe(1);
    expect(deps.run).toHaveBeenCalledTimes(1);
  });

  it("第二次执行从断点继续：第一次入库的集第二次全跳过", async () => {
    const first = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(first.ingestedCount).toBe(3);
    deps.listIngested = vi.fn(async () => new Set([1, 2, 3]));
    (deps.run as ReturnType<typeof vi.fn>).mockClear();
    const second = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(second.skippedCount).toBe(3);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("单集失败不拖垮整批 —— 前面已付费入库的集要留着", async () => {
    let n = 0;
    deps.run = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("native_deep_read_http_500");
      return makeResult() as never;
    });
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(r.ingestedCount).toBe(2);
    expect(r.failedCount).toBe(1);
    expect(r.outcomes.find((o) => o.episodeIndex === 2)?.status).toBe("failed");
  });

  it("中止后不再跑下一集，且不把中止记成「这集失败了」", async () => {
    const c = new AbortController();
    deps.run = vi.fn(async () => {
      c.abort();
      return makeResult() as never;
    });
    const r = await runNativeDeepReadBatch(
      { seriesKey: "s", episodes: three, abortSignal: c.signal },
      deps,
    );
    expect(r.aborted).toBe(true);
    expect(r.failedCount).toBe(0);
    expect(r.totalCostCny).toBeCloseTo(0.5);
    expect(r.outcomes[0]).toMatchObject({ status: "aborted", costCny: 0.5 });
    expect(deps.run).toHaveBeenCalledTimes(1);
  });

  it("列已入库集失败时整批停手 —— 把未知当没跑过就是重烧一遍", async () => {
    deps.listIngested = vi.fn(async () => {
      throw new Error("无法核对已入库集，已停止续跑");
    });
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps),
    ).rejects.toThrow("停止续跑");
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("开关关着时整批拒绝", async () => {
    deps.isEnabled = vi.fn(() => false);
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps),
    ).rejects.toThrow("开关未开启");
    expect(deps.listIngested).not.toHaveBeenCalled();
  });
});
