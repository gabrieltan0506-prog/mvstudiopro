import { describe, expect, it, vi } from "vitest";
import type { DouyinListedEpisode } from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  assertNativeDeepReadPlanConfirmation,
  buildNativeDeepReadPlanPreview,
  computeNativeDeepReadPlanHash,
  probeNativeDeepReadDurationSec,
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
  it("分段按六分钟连续覆盖，短集保持整集", () => {
    expect(splitNativeDeepReadSegments(90.9)).toEqual([{ startSec: 0, endSec: 91 }]);
    expect(splitNativeDeepReadSegments(1001.9)).toEqual([
      { startSec: 0, endSec: 360 },
      { startSec: 360, endSec: 720 },
      { startSec: 720, endSec: 1002 },
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
    expect(plan.totalSegments).toBe(3);
    expect(plan.totalVisualCalls).toBe(1);
    expect(plan.totalModelCalls).toBe(4);
    expect(plan.executableEpisodeCount).toBe(1);
    expect(d.probeDurationSec).toHaveBeenCalledTimes(1);
  });

  it("首个 CDN 节点失败后切换同集备用节点，不提前判整集失败", async () => {
    const first = "https://v.douyinvod.com/first.mp4";
    const second = "https://v.douyinvod.com/second.mp4";
    const d = deps({
      listMixEpisodes: vi.fn(async () => ({
        episodes: [{ ...episode(1), playbackUrl: first, playbackUrls: [first, second] }],
        complete: true,
      })),
      probeDurationSec: vi.fn(async (url) => {
        if (url === first) throw new Error(`Command failed: ffprobe ${url}`);
        return 126;
      }),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 1 },
      d,
    );
    expect(plan.episodes[0]?.durationSec).toBe(126);
    expect(d.probeDurationSec).toHaveBeenNthCalledWith(1, first, undefined);
    expect(d.probeDurationSec).toHaveBeenNthCalledWith(2, second, undefined);
    expect(d.refreshPlaybackUrls).not.toHaveBeenCalled();
  });

  it("列表节点全失败后只刷新一次，并使用未尝试的新地址", async () => {
    const stale = "https://v.douyinvod.com/stale.mp4";
    const fresh = "https://v.douyinvod.com/fresh.mp4";
    const d = deps({
      listMixEpisodes: vi.fn(async () => ({
        episodes: [{ ...episode(1), playbackUrl: stale, playbackUrls: [stale] }],
        complete: true,
      })),
      refreshPlaybackUrls: vi.fn(async () => [stale, fresh]),
      probeDurationSec: vi.fn(async (url) => {
        if (url === stale) throw new Error("节点失效");
        return 88;
      }),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 1 },
      d,
    );
    expect(plan.episodes[0]?.durationSec).toBe(88);
    expect(d.refreshPlaybackUrls).toHaveBeenCalledTimes(1);
    expect(d.probeDurationSec).toHaveBeenCalledTimes(2);
  });

  it("所有节点失败时关闭式停止，面板错误不包含签名地址或原始命令", async () => {
    const secretUrl = "https://v.douyinvod.com/private.mp4?signature=secret";
    const d = deps({
      listMixEpisodes: vi.fn(async () => ({
        episodes: [{ ...episode(1), playbackUrl: secretUrl, playbackUrls: [secretUrl] }],
        complete: true,
      })),
      refreshPlaybackUrls: vi.fn(async () => []),
      probeDurationSec: vi.fn(async () => {
        throw new Error(`Command failed: ffprobe ${secretUrl}`);
      }),
    });
    const promise = buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 1 },
      d,
    );
    await expect(promise).rejects.toThrow("所有媒体节点暂不可读");
    await expect(promise).rejects.not.toThrow("signature=secret");
    await expect(promise).rejects.not.toThrow("Command failed");
  });

  it("客户端中止后不刷新、不继续尝试下一节点", async () => {
    const controller = new AbortController();
    const d = deps({
      listMixEpisodes: vi.fn(async () => ({
        episodes: [{
          ...episode(1),
          playbackUrls: [
            "https://v.douyinvod.com/first.mp4",
            "https://v.douyinvod.com/second.mp4",
          ],
        }],
        complete: true,
      })),
      probeDurationSec: vi.fn(async () => {
        controller.abort(new Error("用户已离开计划页面"));
        throw new Error("子进程已停止");
      }),
    });
    await expect(buildNativeDeepReadPlanPreview(
      {
        url: "https://www.douyin.com/collection/123456",
        limit: 1,
        abortSignal: controller.signal,
      },
      d,
    )).rejects.toThrow("用户已离开计划页面");
    expect(d.probeDurationSec).toHaveBeenCalledTimes(1);
    expect(d.refreshPlaybackUrls).not.toHaveBeenCalled();
  });

  it("ffprobe 执行失败时收敛错误，且中止原因原样贯通", async () => {
    const url = "https://v.douyinvod.com/private.mp4?signature=secret";
    await expect(probeNativeDeepReadDurationSec(
      url,
      undefined,
      vi.fn(async () => {
        throw new Error(`Command failed: ffprobe ${url}`);
      }),
    )).rejects.toThrow("播放节点探测失败");

    const controller = new AbortController();
    controller.abort(new Error("计划生成已停止"));
    await expect(probeNativeDeepReadDurationSec(
      url,
      controller.signal,
      vi.fn(async () => ({ stdout: "{}" })),
    )).rejects.toThrow("计划生成已停止");
  });

  it("占位集保持隔离且不挤占本轮新增集数", async () => {
    const d = deps({
      listClaimedEpisodes: vi.fn(async () => new Set([1])),
      listMixEpisodes: vi.fn(async () => ({
        episodes: [episode(1), episode(2), episode(3), episode(4)],
        complete: true,
      })),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 2 },
      d,
    );
    expect(plan.pendingClaimEpisodeIndexes).toEqual([1]);
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([2, 3]);
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: plan.planHash,
      maxCalls: plan.totalModelCalls,
      seriesKey: plan.seriesKey,
    }, plan)).not.toThrow();
    expect(d.probeDurationSec).toHaveBeenCalledTimes(2);
  });

  it("前两集为残留占位时，面板要求十集会选取第3至12集", async () => {
    const d = deps({
      listClaimedEpisodes: vi.fn(async () => new Set([1, 2])),
      listMixEpisodes: vi.fn(async () => ({
        episodes: Array.from({ length: 12 }, (_, index) => episode(index + 1)),
        complete: true,
      })),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 10 },
      d,
    );
    expect(plan.pendingClaimEpisodeIndexes).toEqual([1, 2]);
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(plan.executableEpisodeCount).toBe(10);
    expect(plan.totalSegments).toBe(10);
    expect(d.probeDurationSec).toHaveBeenCalledTimes(10);
  });

  it("确认门只拒绝执行清单与占位重叠，不因清单外隔离项拒绝整批", () => {
    const base: NativeDeepReadPlanPreview = {
      planHash: "1234567890abcdef",
      seriesKey: "s1",
      episodes: [{
        episodeIndex: 3,
        sourceUrl: "https://www.douyin.com/video/10003",
        durationSec: 100,
        segments: [{ startSec: 0, endSec: 100 }],
      }],
      totalSegments: 1,
      totalVisualCalls: 1,
      totalAudioChunks: 1,
      totalModelCalls: 4,
      totalDurationSec: 100,
      freeEpisodeCount: 3,
      unknownAccessEpisodeIndexes: [],
      alreadyIngestedEpisodeIndexes: [],
      pendingClaimEpisodeIndexes: [1, 2],
      executableEpisodeCount: 1,
      executionEnabled: true,
    };
    const confirmation = {
      planHash: base.planHash,
      maxCalls: base.totalModelCalls,
      seriesKey: base.seriesKey,
    };
    expect(() => assertNativeDeepReadPlanConfirmation(confirmation, base)).not.toThrow();
    expect(() => assertNativeDeepReadPlanConfirmation(confirmation, {
      ...base,
      episodes: [{ ...base.episodes[0]!, episodeIndex: 2 }],
    })).toThrow("执行清单与第2集待核对占位重叠");
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
      totalVisualCalls: 1,
      totalAudioChunks: 1,
      totalModelCalls: 4,
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
      maxCalls: 4,
      seriesKey: "s1",
    }, base)).not.toThrow();
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: "ffffffffffffffff",
      maxCalls: 4,
      seriesKey: "s1",
    }, base)).toThrow("计划已变化");
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: base.planHash,
      maxCalls: 4,
      seriesKey: "s1",
    }, { ...base, executionEnabled: false })).toThrow("能力未开启");
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: base.planHash,
      maxCalls: 201,
      seriesKey: "s1",
    }, { ...base, totalModelCalls: 201 })).toThrow("超过单任务上限");
    expect(() => assertNativeDeepReadPlanConfirmation({
      planHash: base.planHash,
      maxCalls: 200,
      seriesKey: "s1",
    }, { ...base, totalModelCalls: 200 })).not.toThrow();
    expect(() => assertNativeDeepReadPlanConfirmation({ maxCalls: 4 }, base)).not.toThrow();
    expect(() => assertNativeDeepReadPlanConfirmation({ maxCalls: 0 }, base))
      .toThrow("超过任务预算");
  });
});
