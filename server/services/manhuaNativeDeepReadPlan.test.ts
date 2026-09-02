import { describe, expect, it, vi } from "vitest";
import type { DouyinListedEpisode } from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  assertNativeDeepReadPlanConfirmation,
  buildNativeDeepReadPlanPreview,
  computeNativeDeepReadPlanHash,
  describeNativeDeepReadSegmentPlanZh,
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
    fetchAwemeDetail: vi.fn(async () => ({
      mixId: "123456",
      mixNameZh: "测试剧",
      episodeIndex: 1,
    })),
    listMixEpisodes: vi.fn(async () => ({
      episodes: [episode(1), episode(2), episode(3)],
      mixNameZh: "测试剧",
      complete: true,
    })),
    refreshPlaybackUrls: vi.fn(async () => []),
    probeDurationSec: vi.fn(async () => 100.9),
    listIngestedEpisodes: vi.fn(async () => new Set<number>()),
    listClaimStates: vi.fn(async () => new Map()),
    resolveSeriesKey: vi.fn(async () => "series_real"),
    isExecutionEnabled: vi.fn(() => true),
    // 生产默认 90 秒退避；测试注入 0，避免既有用例被真实等待拖超时
    detailRetryDelayMs: 0,
    ...overrides,
  };
}

describe("原生精读计划", () => {
  it("1593.586 秒按 319 秒切成完整五片；317 秒仍保留第六片尾部", () => {
    expect(splitNativeDeepReadSegments(1593.586, 319)).toEqual([
      { startSec: 0, endSec: 319 },
      { startSec: 319, endSec: 638 },
      { startSec: 638, endSec: 957 },
      { startSec: 957, endSec: 1276 },
      { startSec: 1276, endSec: 1594 },
    ]);
    const shorter = splitNativeDeepReadSegments(1593.586, 317);
    expect(shorter).toHaveLength(6);
    expect(shorter.at(-1)).toEqual({ startSec: 1585, endSec: 1594 });
    expect(splitNativeDeepReadSegments(638, 319)).toHaveLength(2);
    expect(splitNativeDeepReadSegments(120, 319)).toEqual([{ startSec: 0, endSec: 120 }]);
  });

  it("非法长度和超过 32 片明确拒绝，不改变用户设置来凑片数", () => {
    expect(() => splitNativeDeepReadSegments(1594, 0)).toThrow("整数秒");
    expect(() => splitNativeDeepReadSegments(1594, 317.5)).toThrow("整数秒");
    expect(() => splitNativeDeepReadSegments(1594, 1)).toThrow("32 片");
  });

  it("自定义长度进入服务端计划和调用数，参数丢失会在最终确认前拒绝", async () => {
    const d = deps({ probeDurationSec: vi.fn(async () => 1593.586) });
    const plan = await buildNativeDeepReadPlanPreview({
      url: "https://www.douyin.com/collection/123456", limit: 1, segmentSeconds: 319,
    }, d);
    expect(plan.segmentSeconds).toBe(319);
    expect(plan.episodes[0]?.segments).toEqual(splitNativeDeepReadSegments(1593.586, 319));
    expect(plan.totalVisualCalls).toBe(5);
    expect(plan.totalModelCalls).toBe(6);
    expect(() => assertNativeDeepReadPlanConfirmation({ maxCalls: 200, segmentSeconds: 319 }, plan))
      .not.toThrow();
    expect(() => assertNativeDeepReadPlanConfirmation({ maxCalls: 200 }, plan))
      .toThrow("分片时长与任务参数不一致");
    const defaultPlan = await buildNativeDeepReadPlanPreview({
      url: "https://www.douyin.com/collection/123456", limit: 1,
    }, d);
    expect(defaultPlan.totalVisualCalls).toBe(6);
    expect(defaultPlan.planHash).not.toBe(plan.planHash);
  });

  it("281秒计划明确显示真实尾片，不能只显示分片数量", async () => {
    const d = deps({ probeDurationSec: vi.fn(async () => 1_404) });
    const plan = await buildNativeDeepReadPlanPreview({
      url: "https://www.douyin.com/collection/123456",
      limit: 1,
      segmentSeconds: 281,
      videoFps: 10,
    }, d);
    expect(plan.episodes[0]?.segments).toEqual([
      { startSec: 0, endSec: 281 },
      { startSec: 281, endSec: 562 },
      { startSec: 562, endSec: 843 },
      { startSec: 843, endSec: 1_124 },
      { startSec: 1_124, endSec: 1_404 },
    ]);
    expect(describeNativeDeepReadSegmentPlanZh(plan))
      .toBe("分片上限 281 秒 · 第 1 集 5 片（前 4 片各 281 秒，尾片 280 秒·10fps）");
  });

  it("非法自定义长度在访问来源之前拒绝", async () => {
    const d = deps();
    await expect(buildNativeDeepReadPlanPreview({
      url: "https://www.douyin.com/collection/123456", limit: 1, segmentSeconds: -1,
    }, d)).rejects.toThrow("整数秒");
    expect(d.listMixEpisodes).not.toHaveBeenCalled();
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });

  it("319秒/12fps进入计划，各片含尾片沿用12fps，改fps即改变确认码", async () => {
    const d = deps({ probeDurationSec: vi.fn(async () => 1593.586) });
    const input = { url: "https://www.douyin.com/collection/123456", limit: 1, segmentSeconds: 319 };
    const plan12 = await buildNativeDeepReadPlanPreview({ ...input, videoFps: 12 }, d);
    const plan10 = await buildNativeDeepReadPlanPreview({ ...input, videoFps: 10 }, d);
    expect(plan12.videoFps).toBe(12);
    expect(plan12.episodes[0]?.videoFps).toBe(12);
    expect(plan12.totalSegments).toBe(5);
    expect(plan12.planHash).not.toBe(plan10.planHash);
    expect(() => assertNativeDeepReadPlanConfirmation({ maxCalls: 200, segmentSeconds: 319, videoFps: 12 }, plan12)).not.toThrow();
    expect(() => assertNativeDeepReadPlanConfirmation({ maxCalls: 200, segmentSeconds: 319, videoFps: 10 }, plan12)).toThrow("fps 与任务参数不一致");
  });

  it("分段按五分钟连续覆盖，短集保持整集", () => {
    expect(splitNativeDeepReadSegments(90.9)).toEqual([{ startSec: 0, endSec: 91 }]);
    expect(splitNativeDeepReadSegments(1001.9)).toEqual([
      { startSec: 0, endSec: 300 },
      { startSec: 300, endSec: 600 },
      { startSec: 600, endSec: 900 },
      { startSec: 900, endSec: 1002 },
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
    expect(plan.totalSegments).toBe(4);
    expect(plan.totalVisualCalls).toBe(4);
    expect(plan.totalAudioChunks).toBe(0);
    expect(plan.totalModelCalls).toBe(5);
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
      listClaimStates: vi.fn(async () => new Map([[1, { createdAtIso: new Date().toISOString(), lastFailedAtIso: null }]])),
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

  it("带失败病历的占位自动让位：纳入执行并打 reclaim 标记，不再永远挡路（0826 用户拍板）", async () => {
    const d = deps({
      listClaimStates: vi.fn(async () => new Map([
        [1, { createdAtIso: new Date().toISOString(), lastFailedAtIso: new Date().toISOString() }],
      ])),
      listMixEpisodes: vi.fn(async () => ({
        episodes: [episode(1), episode(2), episode(3)],
        complete: true,
      })),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 2 },
      d,
    );
    expect(plan.pendingClaimEpisodeIndexes).toEqual([]);
    expect(plan.reclaimEpisodeIndexes).toEqual([1]);
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([1, 2]);
    expect(plan.episodes[0]!.reclaimFailedClaim).toBe(true);
    expect(plan.episodes[1]!.reclaimFailedClaim).toBeUndefined();
  });

  it("旧病历只有 lastErrorZh 也从最早集重跑，且 reclaim 状态进入确认码", async () => {
    const baseDeps = deps({
      listMixEpisodes: vi.fn(async () => ({
        episodes: [episode(1), episode(2)],
        complete: true,
      })),
    });
    const normal = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 1 },
      baseDeps,
    );
    const reclaim = await buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/123456", limit: 1 },
      deps({
        listMixEpisodes: baseDeps.listMixEpisodes,
        listClaimStates: vi.fn(async () => new Map([[
          1,
          { createdAtIso: "2026-08-26T00:00:00Z", lastErrorZh: "旧拒因", lastFailedAtIso: null },
        ]])),
      }),
    );
    expect(reclaim.episodes.map((row) => row.episodeIndex)).toEqual([1]);
    expect(reclaim.reclaimEpisodeIndexes).toEqual([1]);
    expect(reclaim.episodes[0]!.reclaimFailedClaim).toBe(true);
    expect(reclaim.planHash).not.toBe(normal.planHash);
  });

  it("前两集为残留占位时，面板要求十集会选取第3至12集", async () => {
    const d = deps({
      listClaimStates: vi.fn(async () => new Map([[1, { createdAtIso: new Date().toISOString(), lastFailedAtIso: null }], [2, { createdAtIso: new Date().toISOString(), lastFailedAtIso: null }]])),
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
      reclaimEpisodeIndexes: [],
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
      reclaimEpisodeIndexes: [],
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

  it("0826 回归：带 modal_id 的搜索页 URL 入口即规范化成 /video/ 单集形态再解析", async () => {
    const modalId = "7641538290936947889";
    const d = deps({
      listMixEpisodes: vi.fn(async () => ({
        episodes: [{ ...episode(1), url: `https://www.douyin.com/video/${modalId}` }],
        mixNameZh: "测试剧",
        complete: true,
      })),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      {
        url: `https://www.douyin.com/search/%E4%B8%87%E5%A6%96?modal_id=${modalId}&type=general`,
        limit: 2,
      },
      d,
    );
    // 规范化后走单集 → 详情 → mixId 的解析链，而不是被当成不可解析的搜索页
    expect(d.fetchAwemeDetail).toHaveBeenCalledWith(modalId);
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([1]);
    expect(plan.episodes[0]?.sourceUrl).toBe(`https://www.douyin.com/video/${modalId}`);
    expect(plan.episodes[0]?.recoverMisplacedSourceCache).toBe(true);
  });

  it("无 mix_info 的搜索页长视频按单一学习源发车，不要求用户手改 /video/", async () => {
    const modalId = "7662693395755765035";
    const playbackUrls = [
      "https://v.douyinvod.com/standalone-a.mp4",
      "https://v.douyinvod.com/standalone-b.mp4",
    ];
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "《咱家剑宗团宠小师妹》1-300集完整版",
        playbackUrl: playbackUrls[0],
        playbackUrls,
        access: "free" as const,
      })),
      listMixEpisodes: vi.fn(async () => {
        throw new Error("独立视频不应调用合集接口");
      }),
      probeDurationSec: vi.fn(async () => 2_211.682),
    });

    const plan = await buildNativeDeepReadPlanPreview(
      {
        url: `https://www.douyin.com/search/%E5%89%91%E5%AE%97?modal_id=${modalId}&type=general`,
        limit: 10,
      },
      d,
    );

    expect(d.fetchAwemeDetail).toHaveBeenCalledWith(modalId);
    expect(d.listMixEpisodes).not.toHaveBeenCalled();
    expect(d.resolveSeriesKey).toHaveBeenCalledWith({
      sourceIdentity: `https://www.douyin.com/video/${modalId}`,
      mixId: "",
      title: undefined,
      learnLlm: "gpt",
    });
    expect(plan.dramaNameZh).toContain("咱家剑宗团宠小师妹");
    expect(plan.episodes).toEqual([{
      episodeIndex: 1,
      sourceUrl: `https://www.douyin.com/video/${modalId}`,
      durationSec: 2_212,
      segmentSeconds: 300,
      videoFps: 12,
      segments: [
        { startSec: 0, endSec: 300 },
        { startSec: 300, endSec: 600 },
        { startSec: 600, endSec: 900 },
        { startSec: 900, endSec: 1_200 },
        { startSec: 1_200, endSec: 1_500 },
        { startSec: 1_500, endSec: 1_800 },
        { startSec: 1_800, endSec: 2_100 },
        { startSec: 2_100, endSec: 2_212 },
      ],
      recoverMisplacedSourceCache: true,
    }]);
    expect(plan.freeEpisodeCount).toBe(1);
    expect(plan.executableEpisodeCount).toBe(1);
    expect(plan.totalVisualCalls).toBe(8);
    expect(plan.totalModelCalls).toBe(9);
  });

  it("无 mix_info 的可读视频与合集一样尊重已入库状态，不重复付费", async () => {
    const modalId = "7660141869153651987";
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "百世轮回，凡人百世书",
        playbackUrl: "https://v.douyinvod.com/standalone.mp4",
        access: "free" as const,
      })),
      listMixEpisodes: vi.fn(async () => null),
      listIngestedEpisodes: vi.fn(async () => new Set([1])),
    });

    const plan = await buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${modalId}`, limit: 10 },
      d,
    );

    expect(plan.episodes).toEqual([]);
    expect(plan.alreadyIngestedEpisodeIndexes).toEqual([1]);
    expect(plan.totalModelCalls).toBe(0);
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });

  it("详情接口前两次 null、第三次返回正常时退避重试后计划成功", async () => {
    const modalId = "10001"; // 对应默认桩合集里第 1 集的视频 id
    let detailCalls = 0;
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => {
        detailCalls += 1;
        if (detailCalls < 3) return null;
        return { mixId: "123456", mixNameZh: "测试剧", episodeIndex: 1 };
      }),
    });

    const plan = await buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${modalId}`, limit: 1 },
      d,
    );

    expect(d.fetchAwemeDetail).toHaveBeenCalledTimes(3);
    expect(plan.dramaNameZh).toBe("测试剧");
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([1]);
  });

  it("详情接口三次全 null 时明确报「已间隔重试 2 次」，不再无限等", async () => {
    const modalId = "7660141869153651987";
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => null),
      listMixEpisodes: vi.fn(async () => {
        throw new Error("详情读不到时不应调用合集接口");
      }),
    });

    await expect(buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${modalId}`, limit: 1 },
      d,
    )).rejects.toThrow("已间隔重试 2 次");
    expect(d.fetchAwemeDetail).toHaveBeenCalledTimes(3);
  });

  it("同一单源 partial 只有原边界符合本次自定义长度时才续学", async () => {
    const modalId = "7660141869153651987";
    const stableUrl = `https://www.douyin.com/video/${modalId}`;
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "百世轮回，凡人百世书",
        playbackUrl: "https://v.douyinvod.com/standalone.mp4",
        access: "free" as const,
      })),
      probeDurationSec: vi.fn(async () => 100),
      listIngestedEpisodeRecords: vi.fn(async () => [{
        episodeIndex: 7,
        sourceUrl: `${stableUrl}?share_token=old`,
        complete: false,
        attemptedSegments: 2,
        completedSegmentIndexes: [0],
        durationSec: 100,
        segmentSpans: [
          { startSec: 0, endSec: 50 },
          { startSec: 50, endSec: 100 },
        ],
        videoFps: 10,
      }]),
      listClaimStates: vi.fn(async () => new Map([[
        7,
        {
          createdAtIso: "2026-08-31T00:00:00.000Z",
          lastErrorZh: "第2段失败，已保留第1段缓存",
          lastFailedAtIso: "2026-08-31T00:10:00.000Z",
          lastHeartbeatIso: null,
        },
      ]])),
    });

    const plan = await buildNativeDeepReadPlanPreview(
      { url: stableUrl, limit: 1, segmentSeconds: 50 },
      d,
    );

    expect(plan.episodes).toEqual([expect.objectContaining({
      episodeIndex: 7,
      sourceUrl: stableUrl,
      reclaimFailedClaim: true,
      recoverMisplacedSourceCache: true,
      resumeStoredSegmentPlan: true,
      durationSec: 100,
      segmentSeconds: 50,
      videoFps: 10,
      segments: [
        { startSec: 0, endSec: 50 },
        { startSec: 50, endSec: 100 },
      ],
    })]);
    expect(plan.alreadyIngestedEpisodeIndexes).toEqual([]);
    expect(plan.reclaimEpisodeIndexes).toEqual([7]);
    expect(d.probeDurationSec).toHaveBeenCalledTimes(1);
  });

  it("同源部分卡探测片长变化时关闭式停止，不按新边界重跑", async () => {
    const modalId = "7660141869153651987";
    const stableUrl = `https://www.douyin.com/video/${modalId}`;
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "百世轮回，凡人百世书",
        playbackUrl: "https://v.douyinvod.com/standalone.mp4",
        access: "free" as const,
      })),
      probeDurationSec: vi.fn(async () => 102),
      listIngestedEpisodeRecords: vi.fn(async () => [{
        episodeIndex: 7,
        sourceUrl: stableUrl,
        complete: false,
        attemptedSegments: 2,
        completedSegmentIndexes: [0],
        durationSec: 101,
        segmentSpans: [
          { startSec: 0, endSec: 50 },
          { startSec: 50, endSec: 101 },
        ],
        videoFps: 10,
      }]),
    });

    await expect(buildNativeDeepReadPlanPreview(
      { url: stableUrl, limit: 1 },
      d,
    )).rejects.toThrow(/疑似来源内容变化.*未发出模型请求/);
  });

  it("旧等分 partial 与当前自定义长度不一致时停止，不静默沿用旧边界", async () => {
    const modalId = "7660141869153651987";
    const stableUrl = `https://www.douyin.com/video/${modalId}`;
    const exactDuration = 1593.899675;
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "精确等分来源",
        playbackUrl: "https://v.douyinvod.com/exact.mp4",
        access: "free" as const,
      })),
      probeDurationSec: vi.fn(async () => exactDuration),
      listIngestedEpisodeRecords: vi.fn(async () => [{
        episodeIndex: 7,
        sourceUrl: stableUrl,
        complete: false,
        attemptedSegments: 2,
        completedSegmentIndexes: [0],
        durationSec: exactDuration,
        segmentSpans: [
          { startSec: 0, endSec: 796.9498375 },
          { startSec: 796.9498375, endSec: exactDuration },
        ],
        videoFps: 12,
      }]),
    });

    await expect(buildNativeDeepReadPlanPreview({
      url: stableUrl,
      limit: 1,
      segmentSeconds: 281,
    }, d)).rejects.toThrow("实际分片未按自定义 281s 计算");
  });

  it("同源部分卡的原分片数量不等于 attemptedSegments 时关闭式停止", async () => {
    const modalId = "7660141869153651987";
    const stableUrl = `https://www.douyin.com/video/${modalId}`;
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "百世轮回，凡人百世书",
        playbackUrl: "https://v.douyinvod.com/standalone.mp4",
        access: "free" as const,
      })),
      listIngestedEpisodeRecords: vi.fn(async () => [{
        episodeIndex: 7,
        sourceUrl: stableUrl,
        complete: false,
        attemptedSegments: 3,
        completedSegmentIndexes: [0],
        durationSec: 101,
        segmentSpans: [
          { startSec: 0, endSec: 50 },
          { startSec: 50, endSec: 101 },
        ],
        videoFps: 10,
      }]),
    });

    await expect(buildNativeDeepReadPlanPreview(
      { url: stableUrl, limit: 1 },
      d,
    )).rejects.toThrow("缺少完整原分片计划");
  });

  it("同名剧的另一条单源不会复用旧部分卡，而是安全追加到下一集号", async () => {
    const modalId = "7660141869153651987";
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "另一条同名单源",
        playbackUrl: "https://v.douyinvod.com/another.mp4",
        access: "free" as const,
      })),
      listIngestedEpisodeRecords: vi.fn(async () => [{
        episodeIndex: 7,
        sourceUrl: "https://www.douyin.com/video/7555555555555555555",
        complete: false,
      }]),
    });

    const plan = await buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${modalId}`, limit: 1 },
      d,
    );

    expect(plan.episodes).toEqual([expect.objectContaining({ episodeIndex: 8 })]);
    expect(plan.alreadyIngestedEpisodeIndexes).toEqual([]);
  });

  it("同一单源完整卡只跳过原集，不因临时 ep1 再建执行计划", async () => {
    const modalId = "7660141869153651987";
    const stableUrl = `https://www.douyin.com/video/${modalId}`;
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "已完整学习的单源",
        playbackUrl: "https://v.douyinvod.com/complete.mp4",
        access: "free" as const,
      })),
      listIngestedEpisodeRecords: vi.fn(async () => [{
        episodeIndex: 7,
        sourceUrl: stableUrl,
        complete: true,
      }]),
    });

    const plan = await buildNativeDeepReadPlanPreview(
      { url: stableUrl, limit: 1 },
      d,
    );

    expect(plan.episodes).toEqual([]);
    expect(plan.alreadyIngestedEpisodeIndexes).toEqual([7]);
    expect(plan.totalModelCalls).toBe(0);
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });

  it("无 mix_info 且没有可读媒体时关闭式停止，不建立空计划", async () => {
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({ titleZh: "只有标题没有媒体" })),
    });
    await expect(buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/search/demo?modal_id=7660141869153651987", limit: 1 },
      d,
    )).rejects.toThrow("没有官方合集，也没有可读取的媒体流");
    expect(d.listMixEpisodes).not.toHaveBeenCalled();
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });

  it("无 mix_info 且付费状态未知时不把媒体可读冒充免费", async () => {
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        titleZh: "媒体可读但免费状态未知",
        playbackUrl: "https://v.douyinvod.com/standalone-unknown.mp4",
        access: "unknown" as const,
      })),
    });
    await expect(buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/search/demo?modal_id=7660141869153651987", limit: 1 },
      d,
    )).rejects.toThrow("第1集缺少明确免费信号");
    expect(d.listMixEpisodes).not.toHaveBeenCalled();
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });

  it("不带 modal_id 的搜索页关闭式拒绝，不进入详情、合集或媒体探测", async () => {
    const d = deps();
    await expect(buildNativeDeepReadPlanPreview(
      {
        url: "https://www.douyin.com/search/%E4%B8%87%E5%A6%96%E5%9B%BE%E5%BD%95",
        limit: 1,
      },
      d,
    )).rejects.toThrow("没有 modal_id / 视频 id / 合集 id");
    expect(d.fetchAwemeDetail).not.toHaveBeenCalled();
    expect(d.listMixEpisodes).not.toHaveBeenCalled();
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });

  it("单集详情的 current_episode 决定真实集号，不按历史尝试数或前置集数重编号", async () => {
    const selectedId = "7641538290936947889";
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        mixId: "123456",
        mixNameZh: "测试剧",
        episodeIndex: 1,
      })),
      listMixEpisodes: vi.fn(async () => ({
        episodes: [
          { ...episode(1), url: `https://www.douyin.com/video/${selectedId}` },
          ...Array.from({ length: 11 }, (_, index) => episode(index + 2)),
        ],
        mixNameZh: "测试剧",
        complete: true,
      })),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${selectedId}`, limit: 1 },
      d,
    );
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([1]);
    expect(plan.episodes[0]?.recoverMisplacedSourceCache).toBe(true);
  });

  it("单集第一集的失败占位原集接管，不能把重跑改写成后续集号", async () => {
    const selectedId = "7641538290936947889";
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        mixId: "123456",
        mixNameZh: "测试剧",
        episodeIndex: 1,
      })),
      listMixEpisodes: vi.fn(async () => ({
        episodes: [
          { ...episode(1), url: `https://www.douyin.com/video/${selectedId}` },
          episode(2),
          episode(3),
        ],
        mixNameZh: "测试剧",
        complete: true,
      })),
      listClaimStates: vi.fn(async () => new Map([[
        1,
        {
          createdAtIso: "2026-08-26T00:00:00Z",
          lastErrorZh: "上轮失败",
          lastFailedAtIso: "2026-08-26T00:10:00Z",
          lastHeartbeatIso: null,
        },
      ]])),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${selectedId}`, limit: 1 },
      d,
    );
    expect(plan.episodes.map((row) => row.episodeIndex)).toEqual([1]);
    expect(plan.reclaimEpisodeIndexes).toEqual([1]);
    expect(plan.episodes[0]?.reclaimFailedClaim).toBe(true);
  });

  it("单集第一集的运行中占位明确阻塞，不越过它跳到第十集", async () => {
    const selectedId = "7641538290936947889";
    const d = deps({
      fetchAwemeDetail: vi.fn(async () => ({
        mixId: "123456",
        mixNameZh: "测试剧",
        episodeIndex: 1,
      })),
      listMixEpisodes: vi.fn(async () => ({
        episodes: [
          { ...episode(1), url: `https://www.douyin.com/video/${selectedId}` },
          ...Array.from({ length: 11 }, (_, index) => episode(index + 2)),
        ],
        mixNameZh: "测试剧",
        complete: true,
      })),
      listClaimStates: vi.fn(async () => new Map(
        Array.from({ length: 9 }, (_, index) => [
          index + 1,
          // 健康「仍在跑」占位：新鲜 createdAt，未到无心跳兜底 45 分钟，应继续阻塞
          { createdAtIso: new Date().toISOString(), lastFailedAtIso: null },
        ]),
      )),
    });
    await expect(buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${selectedId}`, limit: 1 },
      d,
    )).rejects.toThrow("第1集已有精读任务占位且无失败病历");
    expect(d.probeDurationSec).not.toHaveBeenCalled();
  });
});

describe("整支即全集（0901 treatAsStandalone）", () => {
  const modalId = "7676084324495543592";
  const detailWithMix = () => vi.fn(async () => ({
    titleZh: "剑宗团宠第二季全集",
    mixId: "7620830292130924553",
    mixNameZh: "剑宗团宠",
    playbackUrl: "https://v.douyinvod.com/full-season.mp4",
    access: "free" as const,
  }));

  it("勾选后忽略详情里的 mixId：不调合集展开，按独立长视频单集入计划", async () => {
    const listMix = vi.fn(async () => ({ episodes: [], complete: false }));
    const d = deps({
      fetchAwemeDetail: detailWithMix(),
      listMixEpisodes: listMix,
      probeDurationSec: vi.fn(async () => 1_594),
    });
    const plan = await buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${modalId}`, limit: 10, treatAsStandalone: true },
      d,
    );
    expect(listMix).not.toHaveBeenCalled();
    expect(plan.episodes).toHaveLength(1);
    expect(plan.episodes[0]!.episodeIndex).toBe(1);
  });

  it("不勾选时行为不变：仍走合集展开；被风控拦下的报错带原因与出路", async () => {
    const d = deps({
      fetchAwemeDetail: detailWithMix(),
      listMixEpisodes: vi.fn(async () => ({
        episodes: [],
        complete: false,
        riskControlBlockedZh: "抖音风控拦截（403）",
      })),
    });
    await expect(buildNativeDeepReadPlanPreview(
      { url: `https://www.douyin.com/video/${modalId}`, limit: 10 },
      d,
    )).rejects.toThrow(/风控拦截[\s\S]*整支即全集/);
  });

  it("勾选但链接没有视频 id 时关闭式拒绝", async () => {
    const d = deps({});
    await expect(buildNativeDeepReadPlanPreview(
      { url: "https://www.douyin.com/collection/7620830292130924553", limit: 10, treatAsStandalone: true },
      d,
    )).rejects.toThrow("整支即全集");
  });
});
