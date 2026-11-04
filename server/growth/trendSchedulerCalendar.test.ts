import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  collect: vi.fn(async () => { throw new Error("测试入口已到达，禁止外部调用"); }),
  afterWait: undefined as (() => void) | undefined,
  backfill: vi.fn(async () => undefined),
}));
vi.mock("./trendCollector", () => ({ collectPlatformTrends: mocks.collect }));
vi.mock("./trendStore", () => ({
  readGrowthRuntimeControl: vi.fn(async () => ({ mode: "auto", burst: "manual", burstPlatforms: ["douyin", "bilibili", "xiaohongshu"] })),
  readTrendSchedulerState: vi.fn(async () => ({})),
  updateTrendSchedulerState: vi.fn(async () => undefined),
  resetTrendRuntimeForDeploy: vi.fn(async () => undefined),
  ensureGrowthStoreSplitGzipLayout: vi.fn(async () => undefined),
  warmTrendShortlistIndexes: vi.fn(async () => undefined),
  reconcileTrendHistoryState: vi.fn(async () => undefined),
  bootstrapTrendHistoryFromColdStore: vi.fn(async () => undefined),
  mergeTrendCollections: vi.fn(), mergeTrendCollectionsWithOptions: vi.fn(),
}));
vi.mock("./trendBackfill", () => ({
  bootstrapGrowthTrendBackfillWorker: mocks.backfill,
  bootstrapGrowthTrendLiveBackfillWorker: vi.fn(async () => undefined),
  stopGrowthTrendBackfillWorker: vi.fn(), stopGrowthTrendLiveBackfillWorker: vi.fn(),
}));
vi.mock("./trendMailDigest", () => ({ notifyGrowthCollectionUpdate: vi.fn(async () => undefined) }));
vi.mock("./douyinCredentialHealth", () => ({ maybeCheckDouyinCredentialHealth: vi.fn(async () => undefined) }));
vi.mock("./growthWorkloadPriority", () => ({ hasActiveGrowthInteractiveWorkload: vi.fn(async () => false), isGrowthInteractivePriorityAbortError: () => false }));
vi.mock("./platformCollectionLane", () => ({
  runInGrowthPlatformCollectionLane: async (_platform: string, _source: string, work: () => Promise<unknown>) => {
    mocks.afterWait?.(); return work();
  },
}));
import { bootstrapGrowthTrendScheduler, stopGrowthTrendScheduler } from "./trendScheduler";
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.afterWait = undefined; });
afterEach(() => { stopGrowthTrendScheduler(); vi.clearAllTimers(); vi.useRealTimers(); });
describe("live调度实际入口的日历门禁（无外部采集）", () => {
  it("工作日凌晨不进入live采集器", async () => {
    vi.setSystemTime(new Date("2026-11-05T02:00:00+08:00"));
    await bootstrapGrowthTrendScheduler();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("等待锁跨过午夜后不进入live采集器", async () => {
    vi.setSystemTime(new Date("2026-11-04T23:00:00+08:00"));
    mocks.afterWait = () => vi.setSystemTime(new Date("2026-11-05T00:00:00+08:00"));
    await bootstrapGrowthTrendScheduler();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("周末凌晨能够进入live采集器", async () => {
    vi.setSystemTime(new Date("2026-11-07T02:00:00+08:00"));
    await bootstrapGrowthTrendScheduler();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(mocks.collect).toHaveBeenCalled();
    expect(mocks.backfill).not.toHaveBeenCalled();
  });
});
