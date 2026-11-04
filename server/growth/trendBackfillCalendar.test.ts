import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  mode: "auto" as "auto" | "live" | "backfill",
  collect: vi.fn(async () => ({ collections: {}, errors: {} })),
  merge: vi.fn(async () => ({ mergeStats: {}, collections: {} })),
  progress: vi.fn(async () => undefined),
  afterWait: undefined as (() => void) | undefined,
}));
vi.mock("./trendStore", () => ({
  readGrowthRuntimeControl: vi.fn(async () => ({ mode: mocks.mode })),
  readGrowthDebugSummary: vi.fn(async () => ({ platforms: {} })),
  readTrendRuntimeMeta: vi.fn(async () => ({ scheduler: {} })),
  mergeTrendCollectionsWithOptions: mocks.merge,
  updateTrendBackfillProgress: mocks.progress,
  reconcileTrendHistoryState: vi.fn(async () => undefined),
}));
vi.mock("./trendCollector", () => ({ collectTrendPlatforms: mocks.collect }));
vi.mock("./trendMailDigest", () => ({ notifyGrowthCollectionUpdate: vi.fn(async () => undefined) }));
vi.mock("./growthWorkloadPriority", () => ({ hasActiveGrowthInteractiveWorkload: vi.fn(async () => false), isGrowthInteractivePriorityAbortError: () => false }));
vi.mock("./platformCollectionLane", () => ({
  runInGrowthPlatformCollectionLane: async (_platform: string, _source: string, work: () => Promise<unknown>) => {
    mocks.afterWait?.();
    return work();
  },
}));
import { runGrowthTrendBackfillStep, stopGrowthTrendBackfillWorker } from "./trendBackfill";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.mode = "auto";
  mocks.afterWait = undefined;
  vi.clearAllMocks();
});
afterEach(() => {
  stopGrowthTrendBackfillWorker();
  vi.useRealTimers();
});
describe("回填真实入口的时段门禁（采集器替身，无外部调用）", () => {
  it.each(["2026-11-05T07:00:00+08:00", "2026-11-07T02:00:00+08:00", "2026-02-23T02:00:00+08:00"])("%s 不进入采集或入库", async date => {
    vi.setSystemTime(new Date(date));
    await runGrowthTrendBackfillStep();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.merge).not.toHaveBeenCalled();
  });
  it("工作日凌晨进入采集链", async () => {
    vi.setSystemTime(new Date("2026-11-05T02:00:00+08:00"));
    await runGrowthTrendBackfillStep();
    expect(mocks.collect).toHaveBeenCalled();
  });
  it("等待锁跨过7点后不能开始采集", async () => {
    vi.setSystemTime(new Date("2026-11-05T06:59:59+08:00"));
    mocks.afterWait = () => vi.setSystemTime(new Date("2026-11-05T07:00:00+08:00"));
    await runGrowthTrendBackfillStep();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.merge).not.toHaveBeenCalled();
  });
  it("夜间持久化live模式禁止旁路回填", async () => {
    mocks.mode = "live";
    vi.setSystemTime(new Date("2026-11-05T02:00:00+08:00"));
    await runGrowthTrendBackfillStep();
    expect(mocks.collect).not.toHaveBeenCalled();
  });
});
