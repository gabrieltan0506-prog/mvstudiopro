import { describe, expect, it, vi } from "vitest";
import type { DouyinListedEpisode } from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  assertNativeDeepReadPlanConfirmation,
  buildNativeDeepReadPlanPreview,
  computeNativeDeepReadPlanHash,
  selectFreeEpisodesUpToPaywall,
  splitNativeDeepReadSegments,
  type NativeDeepReadPlanDeps,
  type NativeDeepReadPlanPreview,
} from "./manhuaNativeDeepReadPlan.js";

const episode = (
  index: number,
  access: DouyinListedEpisode["access"] = "free",
): DouyinListedEpisode => ({
  index,
  access,
  title: `第${index}集`,
  url: `https://www.douyin.com/video/${10_000 + index}`,
  playbackUrl: `https://v.douyinvod.com/e${index}.mp4`,
});

function deps(overrides: Partial<NativeDeepReadPlanDeps> = {}): NativeDeepReadPlanDeps {
  return {
    fetchAwemeDetail: vi.fn(async () => ({ mixId: "123456", mixNameZh: "测试剧" })),
    listMixEpisodes: vi.fn(async () => ({
      episodes: [episode(1), episode(2), episode(3)],
      mixNameZh: "测试剧",
      complete: true,
    })),
    refreshPlaybackUrls: vi.fn(async () => []),
    probeDurationSec: vi.fn(async () => 100.9),
    listIngestedEpisodes: vi.fn(async () => new Set<number>()),
    listClaimedEpisodes: vi.fn(async () => new Set<number>()),
    resolveSeriesKey: vi.fn(async () => "series_real"),
    isExecutionEnabled: vi.fn(() => true),
    ...overrides,
  };
}

describe("原生精读计划", () => {
  it("分段与生产同用 floor，且均分避免极短尾段", () => {
    expect(splitNativeDeepReadSegments(1000.9)).toEqual([{ startSec: 0, endSec: 1000 }]);
    expect(splitNativeDeepReadSegments(1001.9)).toEqual([
      { startSec: 0, endSec: 501 },
      { startSec: 501, endSec: 1001 },
    ]);
  });

  it("unknown 不写进免费执行计划，付费边界仍独立记录", () => {
    const selected = selectFreeEpisodesUpToPaywall([
      episode(1, "free"),
      { ...episode(2), access: undefined },
      episode(3, "paid_locked"),
    ]);
    expect(selected.free.map((row) => row.index)).toEqual([1]);
    expect(selected.unknownAccessEpisodeIndexes).toEqual([2]);
    expect(selected.paywallStartEpisodeIndex).toBe(3);
  });

  it("继续学习取接下来未入库的 N 集，模型次数只算真正执行集", async () => {
    const d = deps({
      listIngestedEpisodes: vi.fn(async () => new Set([1, 2])),
      probeDurationSec: vi.fn(async () => 1001.9),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 1 },
      d,
    );
    expect(plan.seriesKey).toBe("series_real");
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([3]);
    expect(plan.alreadyIngestedEpisodeIndexes).toEqual([1, 2]);
    expect(plan.totalSegments).toBe(2);
    expect(plan.executableEpisodeCount).toBe(1);
    expect(d.probeDurationSec).toHaveBeenCalledTimes(1);
  });

  it("占位集不进入执行清单，并作为阻断信号返回", async () => {
    const d = deps({
      listClaimedEpisodes: vi.fn(async () => new Set([1])),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 2 },
      d,
    );
    expect(plan.pendingClaimEpisodeIndexes).toEqual([1]);
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([2]);
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: plan.planHash,
      maxCalls: plan.totalSegments,
      seriesKey: plan.seriesKey,
    }, plan)).toThrow("待核对占位");
  });

  it("合集未拉全时关闭式拒绝", async () => {
    await expect(buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 2 },
      deps({
        listMixEpisodes: vi.fn(async () => ({
          episodes: [episode(1)],
          complete: false,
        })),
      }),
    )).rejects.toThrow("未拉到底");
  });

  it("第一集缺少明确免费信号时不探时长、不出计划", async () => {
    const d = deps({
      listMixEpisodes: vi.fn(async () => ({
        episodes: [{ ...episode(1), access: undefined }, episode(2, "free")],
        complete: true,
      })),
    });
    await expect(buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 2 },
      d,
    )).rejects.toThrow("unknown 不能作为免费集执行");
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });

  it("确认码绑定真实来源与执行取整口径，不被无关小数抖动误伤", () => {
    const episodes = [{
      episodeIndex: 1,
      sourceUrl: "https://www.douyin.com/video/10001",
      durationSec: 100,
      segments: [{ startSec: 0, endSec: 100 }],
    }];
    const hash = computeNativeDeepReadPlanHash("s1", episodes);
    expect(computeNativeDeepReadPlanHash("s1", [...episodes])).toBe(hash);
    expect(computeNativeDeepReadPlanHash("s1", [{ ...episodes[0]!, durationSec: 101 }])).not.toBe(hash);
    expect(computeNativeDeepReadPlanHash("s1", [{ ...episodes[0]!, durationSec: 100.9 }])).toBe(hash);
    expect(computeNativeDeepReadPlanHash("s1", [{
      ...episodes[0]!,
      sourceUrl: "https://www.douyin.com/video/99999",
    }])).not.toBe(hash);
    expect(computeNativeDeepReadPlanHash("s1", [{
      ...episodes[0]!,
      sourceUrl: "https://www.douyin.com/video/10001?share_token=rotated",
    }])).toBe(hash);
  });

  it("worker 终门拒绝开关关闭、确认码漂移与超调用上限", () => {
    const base: NativeDeepReadPlanPreview = {
      planHash: "1234567890abcdef",
      seriesKey: "s1",
      episodes: [{
        episodeIndex: 1,
        sourceUrl: "https://www.douyin.com/video/10001",
        durationSec: 100,
        segments: [{ startSec: 0, endSec: 100 }],
      }],
      totalSegments: 1,
      totalDurationSec: 100,
      freeEpisodeCount: 1,
      unknownAccessEpisodeIndexes: [],
      alreadyIngestedEpisodeIndexes: [],
      pendingClaimEpisodeIndexes: [],
      executableEpisodeCount: 1,
      executionEnabled: true,
    };
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: base.planHash,
      maxCalls: 1,
      seriesKey: "s1",
    }, base)).not.toThrow();
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: "ffffffffffffffff",
      maxCalls: 1,
      seriesKey: "s1",
    }, base)).toThrow("计划已变化");
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: base.planHash,
      maxCalls: 1,
      seriesKey: "s1",
    }, { ...base, executionEnabled: false })).toThrow("能力未开启");
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: base.planHash,
      maxCalls: 41,
      seriesKey: "s1",
    }, { ...base, totalSegments: 41 })).toThrow("超过单任务上限");
  });
});
