/**
 * 协调器行为。全部注入假实现，**不调用任何付费接口**。
 *
 * 这一层此前根本不存在：runner 与入库两端都写完了，中间没有生产调用点，
 * `MANHUA_NATIVE_DEEP_READ=1` 打开也不改变任何业务路径。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeAndIngestNativeDeepReadEpisode,
  runNativeDeepReadBatch,
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

const episode = {
  episodeIndex: 1,
  sourceUrl: "https://example.com/e1",
  durationSec: 1080,
  segments: [{ startSec: 0, endSec: 1080 }],
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
  } as never;
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
