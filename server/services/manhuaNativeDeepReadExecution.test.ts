/**
 * 协调器行为。全部注入假实现，**不调用任何付费接口**。
 *
 * 0826 换代：音轨由 Gemini 视觉调用直出，协调器不再有独立音频取证阶段；
 * 逐集执行（每段一次调用），单集失败停止后续集。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
  executeAndIngestNativeDeepReadEpisode,
  migrateMisplacedNativeDeepReadSegmentCaches,
  resolveNativeDeepReadCacheSourceDigest,
  runNativeDeepReadBatch,
  validateNativeDeepReadBatchPlan,
  type NativeDeepReadBatchEpisode,
  type NativeDeepReadExecutionDeps,
} from "./manhuaNativeDeepReadExecution";
import { nativeDeepReadSegmentCacheFingerprint } from "./manhuaNativeDeepReadRunner";
import {
  NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  type NativeDeepReadSegmentCacheEntry,
} from "./manhuaNativeDeepReadSegmentCache";

function makeResult(over: Record<string, unknown> = {}) {
  const beatGrid = Array.from({ length: 8 }, (_, i) => ({
    atSec: i,
    endSec: i + 1,
    conflictZh: "冲突推进",
    visualZh: `动作${i}`,
  }));
  return {
    beatGrid,
    subtitleTrack: [],
    resolvedAudioChunks: [],
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    segmentCount: 3,
    shotCount: beatGrid.length,
    failedSegmentCount: 0,
    droppedCount: 0,
    truncated: false,
    model: "gemini-3.1-pro-preview",
    attemptedSegments: 3,
    usingPlanQuota: false,
    usage: { inputTokens: 100, outputTokens: 20, costCny: 0.5 },
    audioInputTokens: 0,
    hasAudio: false,
    visualRoutes: ["vertex_gcs_video"],
    degradedFpsSegmentIndexes: [],
    ...over,
  };
}

/** 18 分钟一集按 300 秒切为四段；每段一次 Gemini 调用。 */
const episode = {
  episodeIndex: 1,
  sourceUrl: "https://example.com/e1",
  durationSec: 1080,
  segments: [
    { startSec: 0, endSec: 300 },
    { startSec: 300, endSec: 600 },
    { startSec: 600, endSec: 900 },
    { startSec: 900, endSec: 1080 },
  ],
  resolveNodes: async () => [{ url: "https://cdn/1.mp4" }],
};

let deps: NativeDeepReadExecutionDeps;

beforeEach(() => {
  deps = {
    isEnabled: vi.fn(() => true),
    run: vi.fn(async () => makeResult() as never),
    runBatch: vi.fn(async (input: { episodes: Array<{ episodeIndex: number; segments: unknown[] }> }) => ({
      episodes: input.episodes.map((episodeRow) => ({
        episodeIndex: episodeRow.episodeIndex,
        result: makeResult({
          attemptedSegments: episodeRow.segments.length,
          segmentCount: episodeRow.segments.length,
          batchRequestId: "11111111-1111-4111-8111-111111111111",
          batchEpisodeCount: 1,
        }),
      })),
      usage: { inputTokens: input.episodes.length * 100, outputTokens: input.episodes.length * 20, costCny: input.episodes.length * 0.5 },
      usingPlanQuota: false,
      model: "gemini-3.1-pro-preview",
      batchRequestId: "11111111-1111-4111-8111-111111111111",
    })) as never,
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
      releaseBeforePaidCall: async () => {},
      releaseAfterSuccess: async () => {},
    })),
    takeoverClaim: vi.fn(async () => ({
      claimUri: "gs://bucket/takeover.json",
      objectName: "takeover.json",
      runId: "takeover-run",
      releaseAfterSuccess: vi.fn(async () => undefined),
      releaseBeforePaidCall: vi.fn(async () => undefined),
    })),
    aggregateSeries: vi.fn(async () => ({
      card: { id: "tpl_series_s" },
      gcsUri: "gs://b/tpl_series_s.json",
      sourceEpisodeCount: 1,
      usage: { inputTokens: 10, outputTokens: 5, priceEquivalentCny: 0.1, receiptComplete: true },
    })) as never,
    clearSegmentCache: vi.fn(async () => undefined),
    migrateSegmentCaches: vi.fn(async () => ({
      migratedSegmentIndexes: [],
      sourceEpisodeIndexes: [],
    })) as never,
    statSourceVersion: vi.fn(async ({ gcsUri }: { gcsUri: string }) => ({
      bucket: "b",
      objectName: gcsUri.slice("gs://b/".length),
      generation: "1",
      etag: "etag-1",
    })) as never,
  } as never;
});

describe("段缓存来源身份", () => {
  it("GCS 同一路径 generation 变化时摘要变化", async () => {
    const first = await resolveNativeDeepReadCacheSourceDigest({
      sourceRef: "gs://b/video.mp4",
      statSourceVersion: vi.fn(async () => ({
        bucket: "b", objectName: "video.mp4", generation: "10", etag: "e10",
      })) as never,
    });
    const second = await resolveNativeDeepReadCacheSourceDigest({
      sourceRef: "gs://b/video.mp4",
      statSourceVersion: vi.fn(async () => ({
        bucket: "b", objectName: "video.mp4", generation: "11", etag: "e11",
      })) as never,
    });
    expect(first).not.toBe(second);
  });

  it("同一抖音 aweme 的搜索与视频链接共用摘要", async () => {
    const stat = vi.fn() as never;
    const fromSearch = await resolveNativeDeepReadCacheSourceDigest({
      sourceRef: "https://www.douyin.com/search/demo?modal_id=7641538290936947889&type=general",
      statSourceVersion: stat,
    });
    const fromVideo = await resolveNativeDeepReadCacheSourceDigest({
      sourceRef: "https://www.douyin.com/video/7641538290936947889?foo=bar",
      statSourceVersion: stat,
    });
    expect(fromSearch).toBe(fromVideo);
  });

  it("把同一视频误写在 ep010 的已付费段安全复制为 ep001，不覆盖目标也不重调模型", async () => {
    const sourceDigest = "d".repeat(64);
    const segments = [{ startSec: 0, endSec: 10 }];
    const raw = {
      shots: [{
        startSec: 0, endSec: 10, unitTypeZh: "剪辑镜头",
        shotSizeZh: "近景", angleZh: "平视", compositionZh: "角色居中",
        cameraMoveZh: "固定机位", blockingZh: "角色原地站立",
        bodyActionZh: "躯干微微前倾", limbPropActionZh: "双手自然垂落",
        microExpressionZh: "眉心收紧", gazeBreathZh: "视线抬起，呼吸转稳",
        relationshipReactionZh: "回应画外角色后重新站稳", lightingZh: "冷调顶光",
        actionZh: "人物抬眼回应", transitionInZh: "硬切",
        evidenceRole: "story",
      }],
      subtitles: [],
      audioResolution: [],
      beatStructureZh: "压迫后回应",
      moodArcZh: "克制转坚定",
      classification: {
        emotionTagsZh: ["压迫渐强"],
        narrativeFeatureTagsZh: ["信息递进"],
        performanceTagsZh: ["克制爆发"],
        audiovisualTagsZh: ["冷暖对撞"],
        audienceExperienceTagsZh: ["持续紧张"],
      },
      reusableZh: "先压后抬",
      genPromptHintZh: "近景反应",
    };
    const alias: NativeDeepReadSegmentCacheEntry = {
      schemaVersion: NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
      fingerprint: nativeDeepReadSegmentCacheFingerprint({
        sourceDigest,
        episodeIndex: 10,
        episodeDurationSec: 10,
        segment: segments[0]!,
        segmentIndex: 0,
        segmentCount: 1,
        hasAudio: false,
      }),
      sourceDigest,
      seriesKey: "s1",
      episodeIndex: 10,
      segmentIndex: 0,
      startSec: 0,
      endSec: 10,
      hasAudio: false,
      requestedFps: 10,
      visualRoute: "vertex_gcs_video",
      degraded: false,
      raw,
      paidUsage: {
        inputTokens: 100,
        outputTokens: 20,
        audioInputTokens: 0,
        reasoningTokens: 5,
        costCny: 0.5,
      },
      savedAtIso: "2026-08-27T00:00:00.000Z",
    };
    const createTarget = vi.fn(async (_entry: NativeDeepReadSegmentCacheEntry) => "created" as const);

    const result = await migrateMisplacedNativeDeepReadSegmentCaches({
      seriesKey: "s1",
      episodeIndex: 1,
      durationSec: 10,
      segments,
      sourceDigest,
    }, {
      listAliases: vi.fn(async () => [{ entry: alias, generation: "10", objectName: "ep010" }]),
      listClaimStates: vi.fn(async () => new Map()),
      readTarget: vi.fn(async () => null),
      createTarget,
    });

    expect(result).toEqual({ migratedSegmentIndexes: [0], sourceEpisodeIndexes: [10] });
    const migrated = createTarget.mock.calls[0]![0];
    expect(migrated.episodeIndex).toBe(1);
    expect(migrated.raw).toEqual(raw);
    expect(migrated.paidUsage).toEqual(alias.paidUsage);
    expect(migrated.fingerprint).not.toBe(alias.fingerprint);
  });

  it("ep010 同源错位缓存仍有健康 claim 时，ep001 关闭式阻塞且零模型调用", async () => {
    const sourceDigest = "d".repeat(64);
    const segment = { startSec: 0, endSec: 10 };
    const alias: NativeDeepReadSegmentCacheEntry = {
      schemaVersion: NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
      fingerprint: nativeDeepReadSegmentCacheFingerprint({
        sourceDigest,
        episodeIndex: 10,
        episodeDurationSec: 10,
        segment,
        segmentIndex: 0,
        segmentCount: 1,
        hasAudio: false,
      }),
      sourceDigest,
      seriesKey: "s1",
      episodeIndex: 10,
      segmentIndex: 0,
      startSec: 0,
      endSec: 10,
      hasAudio: false,
      requestedFps: 10,
      visualRoute: "vertex_gcs_video",
      degraded: false,
      raw: {},
      paidUsage: {
        inputTokens: 100,
        outputTokens: 20,
        audioInputTokens: 0,
        reasoningTokens: 5,
        costCny: 0.5,
      },
      savedAtIso: "2026-08-27T00:00:00.000Z",
    };
    const createTarget = vi.fn();
    deps.migrateSegmentCaches = vi.fn((input) =>
      migrateMisplacedNativeDeepReadSegmentCaches(input, {
        listAliases: vi.fn(async () => [{ entry: alias, generation: "10", objectName: "ep010" }]),
        listClaimStates: vi.fn(async () => new Map([[10, {
          episodeIndex: 10,
          generation: "7",
          createdAtIso: "2026-08-27T00:00:00.000Z",
          lastErrorZh: null,
          lastFailedAtIso: null,
        }]])),
        readTarget: vi.fn(async () => null),
        createTarget,
      })) as never;

    const result = await runNativeDeepReadBatch({
      seriesKey: "s1",
      episodes: [{
        episodeIndex: 1,
        sourceUrl: "https://www.douyin.com/video/7641538290936947889",
        durationSec: 10,
        segments: [segment],
        resolveNodes: async () => [],
        recoverMisplacedSourceCache: true,
      }],
    }, deps);

    expect(result.outcomes).toContainEqual(expect.objectContaining({
      episodeIndex: 1,
      status: "failed",
      errorZh: expect.stringMatching(/第10集仍有健康任务占位/),
    }));
    expect(createTarget).not.toHaveBeenCalled();
    expect(deps.runBatch).not.toHaveBeenCalled();
  });
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
    expect(deps.runBatch).not.toHaveBeenCalled();
    expect(deps.listIngested).not.toHaveBeenCalled();
  });

  it("非法集号零调用拒绝", async () => {
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(0)] }, deps),
    ).rejects.toThrow("1–999");
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("单段超过五分钟要求拆段", () => {
    expect(() =>
      validateNativeDeepReadBatchPlan([
        ep(1, { durationSec: 1200, segments: [{ startSec: 0, endSec: 1080 }] }),
      ]),
    ).toThrow("请拆段");
    expect(NATIVE_DEEP_READ_MAX_SEGMENT_SEC).toBe(300);
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

  it("每段一次调用：视觉调用数=分片数，音频调用恒为 0", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      ep(i + 1, {
        durationSec: 1200,
        segments: Array.from({ length: 6 }, (_, k) => ({
          startSec: k * 200,
          endSec: (k + 1) * 200,
        })),
      }),
    );
    const plan = validateNativeDeepReadBatchPlan(many);
    expect(plan.totalEpisodes).toBe(20);
    expect(plan.totalSegments).toBe(120);
    expect(plan.totalVisualCalls).toBe(120);
    expect(plan.totalAudioChunks).toBe(0);
    expect(plan.totalModelCalls).toBe(plan.totalVisualCalls + 1);
  });

  it("上限由调用方指定，不写死 20", () => {
    const five = [1, 2, 3, 4, 5].map((i) => ep(i));
    expect(() => validateNativeDeepReadBatchPlan(five, { maxEpisodes: 3 })).toThrow("超过上限 3 集");
    expect(validateNativeDeepReadBatchPlan(five, { maxEpisodes: 50 }).totalEpisodes).toBe(5);
  });

  it("同一份清单确认码稳定，改一个字段就变 —— 真跑靠它绑定干跑那份计划", () => {
    const a = validateNativeDeepReadBatchPlan([ep(1)], { seriesKey: "series_a" }).planHash;
    expect(validateNativeDeepReadBatchPlan([ep(1)], { seriesKey: "series_a" }).planHash).toBe(a);
    expect(
      validateNativeDeepReadBatchPlan(
        [ep(1, { sourceUrl: "https://example.com/e9" })],
        { seriesKey: "series_a" },
      ).planHash,
    ).not.toBe(a);
    expect(
      validateNativeDeepReadBatchPlan(
        [ep(1, { segments: [
          { startSec: 0, endSec: 299 },
          { startSec: 299, endSec: 599 },
          { startSec: 599, endSec: 899 },
          { startSec: 899, endSec: 1080 },
        ] })],
        { seriesKey: "series_a" },
      ).planHash,
    ).not.toBe(a);
    expect(
      validateNativeDeepReadBatchPlan([ep(1)], { seriesKey: "series_b" }).planHash,
    ).not.toBe(a);
  });
});

describe("并发与计费", () => {
  it("分集入库后先清段缓存，再释放成功 claim", async () => {
    const order: string[] = [];
    deps.clearSegmentCache = vi.fn(async () => { order.push("clear-cache"); });
    deps.acquireClaim = vi.fn(async () => ({
      claimUri: "gs://b/c",
      objectName: "c",
      runId: "r",
      releaseBeforePaidCall: vi.fn(async () => undefined),
      releaseAfterSuccess: vi.fn(async () => { order.push("release-claim"); }),
    }));
    const result = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(result.ingestedCount).toBe(1);
    expect(order).toEqual(["clear-cache", "release-claim"]);
  });

  it("占位在 runner 之前 —— 抢不到就停手，不是跑完才发现重复", async () => {
    deps.acquireClaim = vi.fn(async () => {
      throw new Error("第1集已有精读任务占位；禁止自动重跑");
    });
    await expect(runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps))
      .rejects.toThrow("占位");
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("已开始付费的失败当场释放 claim；下一轮立即可重跑（钱账由段缓存守，0826 七条第5条）", async () => {
    let held = false;
    let paidAttempt = 0;
    deps.acquireClaim = vi.fn(async () => {
      if (held) throw new Error("第1集已有精读任务占位；禁止自动重跑");
      held = true;
      return {
        claimUri: "gs://b/c",
        objectName: "c",
        runId: "r",
        releaseBeforePaidCall: vi.fn(async () => { held = false; }),
        releaseAfterSuccess: vi.fn(async () => { held = false; }),
      };
    });
    const success = deps.runBatch;
    deps.runBatch = vi.fn(async (input: Parameters<NativeDeepReadExecutionDeps["runBatch"]>[0]) => {
      paidAttempt += 1;
      if (paidAttempt === 1) {
        await input.onModelReceipt?.({ status: "started" } as never);
        throw new Error("模型返回待核对");
      }
      return success(input as never) as never;
    }) as never;

    const first = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(first.failedCount).toBe(1);
    // 失败即释放：不再留僵尸占位挡路
    expect(held).toBe(false);
    // 下一轮无需人工核销即可重跑；已成段由缓存兜底不重买
    const second = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(second.ingestedCount).toBe(1);
    expect(deps.runBatch).toHaveBeenCalledTimes(2);
  });

  it("两个批次跑同一集，只有一个抢到占位，模型总共只调一次", async () => {
    let held = false;
    const claim = vi.fn(async () => {
      if (held) throw new Error("已有精读任务占位");
      held = true;
      return {
        claimUri: "gs://b/c",
        objectName: "c",
        runId: "r",
        releaseBeforePaidCall: async () => {},
        releaseAfterSuccess: async () => {},
      };
    });
    const shared = { ...deps, acquireClaim: claim } as NativeDeepReadExecutionDeps;
    const settled = await Promise.allSettled([
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, shared),
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, shared),
    ]);
    expect(shared.runBatch).toHaveBeenCalledTimes(1);
    expect(settled.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((row) => row.status === "rejected")).toHaveLength(1);
  });

  it("门禁拒收也要记成本 —— 钱已经花了，只统计成功卡会算漏", async () => {
    deps.runBatch = vi.fn(async () => ({
      episodes: [{
        episodeIndex: 1,
        result: makeResult({
          segmentCount: 0,
          failedSegmentCount: 3,
          beatGrid: [],
          shotCount: 0,
          usage: { inputTokens: 0, outputTokens: 0, costCny: 2.5 },
        }),
      }],
      usage: { inputTokens: 0, outputTokens: 0, costCny: 2.5 },
      model: "gemini-3.1-pro-preview",
      batchRequestId: "11111111-1111-4111-8111-111111111111",
    })) as never;
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(r.failedCount).toBe(1);
    expect(r.totalCostCny).toBeCloseTo(2.5);
  });

  it("模型已返回后入库写入异常：成本照记，占位当场释放（段缓存已保住产出）", async () => {
    const release = vi.fn(async () => undefined);
    deps.acquireClaim = vi.fn(async () => ({
      claimUri: "gs://b/c",
      objectName: "c",
      runId: "r",
      releaseBeforePaidCall: vi.fn(async () => undefined),
      releaseAfterSuccess: release,
    }));
    deps.ingest = vi.fn(async () => { throw new Error("入库暂时不可用"); }) as never;
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(r.failedCount).toBe(1);
    expect(r.totalCostCny).toBeCloseTo(0.5);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("模型开始前的零成本故障释放全部占位并停止后续集", async () => {
    const releasedTotal = new Map<number, () => number>();
    deps.acquireClaim = vi.fn(async (_seriesKey: string, episodeIndex: number) => {
      const releaseBeforePaidCall = vi.fn(async () => undefined);
      const releaseAfterSuccess = vi.fn(async () => undefined);
      releasedTotal.set(
        episodeIndex,
        () => releaseBeforePaidCall.mock.calls.length + releaseAfterSuccess.mock.calls.length,
      );
      return {
        claimUri: `gs://b/c${episodeIndex}`,
        objectName: `c${episodeIndex}`,
        runId: "r",
        releaseBeforePaidCall,
        releaseAfterSuccess,
      };
    }) as never;
    deps.runBatch = vi.fn(async () => {
      throw new Error("媒体准备未完成");
    }) as never;

    const result = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(2)] }, deps);

    // 第 1 集失败即停止后续请求；两集占位全部释放（失败也不留僵尸）
    expect(result.failedCount).toBe(1);
    expect(result.totalCostCny).toBe(0);
    expect(releasedTotal.get(1)!()).toBe(1);
    expect(releasedTotal.get(2)!()).toBe(1);
  });

  it("一集收到付费 started 后失败：成本照记，本集与未触碰集占位全部释放", async () => {
    const releases = new Map<number, ReturnType<typeof vi.fn>>();
    const afterReleases = new Map<number, ReturnType<typeof vi.fn>>();
    deps.acquireClaim = vi.fn(async (_seriesKey: string, episodeIndex: number) => {
      const releaseBeforePaidCall = vi.fn(async () => undefined);
      const releaseAfterSuccess = vi.fn(async () => undefined);
      releases.set(episodeIndex, releaseBeforePaidCall);
      afterReleases.set(episodeIndex, releaseAfterSuccess);
      return {
        claimUri: `gs://b/c${episodeIndex}`,
        objectName: `c${episodeIndex}`,
        runId: "r",
        releaseBeforePaidCall,
        releaseAfterSuccess,
      };
    }) as never;
    deps.runBatch = vi.fn(async (input: {
      onModelReceipt?: (receipt: Record<string, unknown>) => Promise<void> | void;
    }) => {
      await input.onModelReceipt?.({
        stage: "visual_model",
        status: "started",
        route: "vertex_gcs_video",
        episodeIndexes: [1],
        chunkIndex: 0,
        videoCount: 1,
      });
      throw Object.assign(new Error("视觉精读未完成"), {
        nativeDeepReadCostCny: 0.2,
        nativeDeepReadUsage: {
          inputTokens: 30,
          outputTokens: 4,
          costCny: 0.2,
          usingPlanQuota: false,
          receiptComplete: true,
        },
      });
    }) as never;

    const result = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(2)] }, deps);

    expect(result.outcomes.find((row) => row.episodeIndex === 1)?.usage).toMatchObject({
      visualInputTokens: 30,
      visualOutputTokens: 4,
      visualPriceEquivalentCny: 0.2,
    });
    expect(result.outcomes.find((row) => row.episodeIndex === 1)?.costCny).toBeCloseTo(0.2);
    // 失败集经 releaseAfterSuccess 路当场释放（不再保留僵尸占位）
    expect(afterReleases.get(1)).toHaveBeenCalledTimes(1);
    expect(releases.get(2)).toHaveBeenCalledTimes(1);
  });

  it("成功集汇总实际成本与耗时（逐集各发一次 runner 调用）", async () => {
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(2)] }, deps);
    expect(r.ingestedCount).toBe(2);
    expect(r.totalCostCny).toBeCloseTo(1.0);
    expect(r.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.plan.totalSegments).toBe(8);
    expect(deps.runBatch).toHaveBeenCalledTimes(2);
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
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDurationSec: 1080,
        segments: episode.segments,
      }),
    );
    expect(deps.ingest).toHaveBeenCalledTimes(1);
    expect(out.gcsUri).toBe("gs://b/ep1.json");
    expect(out.usage.model).toBe("gemini-3.1-pro-preview");
    expect(out.usage.usingPlanQuota).toBe(false);
    // 双计防线：音轨已含在视觉调用里，独立音频通道恒为 0
    expect(out.usage.audioCostCny).toBe(0);
    expect(out.usage.audioInputTokens).toBe(0);
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

  it("每次模型调用都逐笔回传 started/completed（视觉 + 系列整理；无独立音频阶段）", async () => {
    const checkpoints: Array<{ stage: string; status: string }> = [];
    const baseRunBatch = deps.runBatch;
    deps.runBatch = vi.fn(async (input) => {
      await input.onModelReceipt?.({
        stage: "visual_model",
        status: "started",
        route: "vertex_gcs_video",
        batchRequestId: "11111111-1111-4111-8111-111111111111",
        episodeIndexes: [1],
        chunkIndex: 0,
        videoCount: 1,
      });
      const result = await baseRunBatch(input as never);
      await input.onModelReceipt?.({
        stage: "visual_model",
        status: "completed",
        route: "vertex_gcs_video",
        batchRequestId: "11111111-1111-4111-8111-111111111111",
        episodeIndexes: [1],
        chunkIndex: 0,
        videoCount: 1,
        inputTokens: 100,
        outputTokens: 20,
      });
      return result;
    }) as never;
    deps.aggregateSeries = vi.fn(async (input) => {
      await input.onModelReceipt?.({ stage: "series_aggregation_model", status: "started" });
      await input.onModelReceipt?.({
        stage: "series_aggregation_model",
        status: "completed",
        inputTokens: 10,
        outputTokens: 5,
      });
      return {
        card: { id: "tpl_series_s" },
        gcsUri: "gs://b/tpl_series_s.json",
        sourceEpisodeCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, priceEquivalentCny: 0.1, receiptComplete: true },
      };
    }) as never;

    const result = await runNativeDeepReadBatch({
      seriesKey: "s",
      episodes: [three[0]!],
      onModelCheckpoint: (checkpoint) => { checkpoints.push(checkpoint); },
    }, deps);

    expect(result.ingestedCount).toBe(1);
    expect(checkpoints.map(({ stage, status }) => `${stage}:${status}`)).toEqual([
      "visual_model:started",
      "visual_model:completed",
      "series_aggregation_model:started",
      "series_aggregation_model:completed",
    ]);
  });

  it("后续分片失败时保留已写入的 1/4 部分卡，缓存不清并把失败留给下次续学", async () => {
    const progress: Array<{ status: string; completedSegments?: number; totalSegments?: number }> = [];
    deps.runBatch = vi.fn(async (input: {
      onSegmentSnapshotCommitted?: (snapshot: unknown) => Promise<void> | void;
      onModelReceipt?: (receipt: unknown) => Promise<void> | void;
    }) => {
      await input.onModelReceipt?.({
        stage: "visual_model",
        status: "started",
        route: "vertex_gcs_video",
        batchRequestId: "11111111-1111-4111-8111-111111111111",
        episodeIndexes: [1],
        chunkIndex: 0,
        videoCount: 1,
      });
      await input.onSegmentSnapshotCommitted?.({
        episodeIndex: 1,
        completedSegmentIndexes: [0],
        learnedThroughSec: 300,
        result: makeResult({
          segmentCount: 1,
          failedSegmentCount: 3,
          attemptedSegments: 4,
          completedSegmentIndexes: [0],
          sourceDigest: "a".repeat(64),
          segmentSnapshotSha256: "b".repeat(64),
          assemblyComplete: false,
        }),
      });
      throw new Error("第2段读取失败");
    }) as never;

    const result = await runNativeDeepReadBatch({
      seriesKey: "s",
      episodes: [three[0]!],
      onProgress: (row) => { progress.push(row); },
    }, deps);

    expect(result).toMatchObject({ ingestedCount: 0, failedCount: 1 });
    expect(deps.ingest).toHaveBeenCalledTimes(1);
    expect(deps.ingest).toHaveBeenCalledWith(expect.objectContaining({
      seriesKey: "s",
      episodeIndex: 1,
      result: expect.objectContaining({
        segmentCount: 1,
        attemptedSegments: 4,
        completedSegmentIndexes: [0],
        assemblyComplete: false,
      }),
    }));
    expect(progress).toContainEqual(expect.objectContaining({
      status: "partial",
      completedSegments: 1,
      totalSegments: 4,
    }));
    expect(progress).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(deps.clearSegmentCache).not.toHaveBeenCalled();
    expect(deps.aggregateSeries).not.toHaveBeenCalled();
  });

  it("已入库的集直接跳过，不调 runner —— 重跑不重烧", async () => {
    deps.listIngested = vi.fn(async () => new Set([1, 2]));
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(r.skippedCount).toBe(2);
    expect(r.ingestedCount).toBe(1);
    expect(deps.runBatch).toHaveBeenCalledTimes(1);
  });

  it("第二次执行从断点继续：第一次入库的集第二次全跳过", async () => {
    const first = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(first.ingestedCount).toBe(3);
    deps.listIngested = vi.fn(async () => new Set([1, 2, 3]));
    (deps.runBatch as ReturnType<typeof vi.fn>).mockClear();
    const second = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(second.skippedCount).toBe(3);
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("系列整理失败不推翻已入库分集，重跑全 skipped 时仍可恢复整理", async () => {
    const aggregationError = Object.assign(new Error("系列结构整理暂时未完成"), {
      nativeSeriesAggregationUsage: {
        model: "z-ai/glm-5.3",
        route: "openrouter_text",
        inputTokens: 40,
        outputTokens: 6,
        costUsd: 0.002,
        priceEquivalentCny: 0.0144,
        usingPlanQuota: false,
        receiptComplete: true,
      },
    });
    deps.aggregateSeries = vi.fn()
      .mockRejectedValueOnce(aggregationError)
      .mockResolvedValueOnce({
        card: { id: "tpl_series_s" },
        gcsUri: "gs://b/tpl_series_s.json",
        sourceEpisodeCount: 3,
        usage: {
          model: "z-ai/glm-5.3",
          route: "openrouter_text",
          inputTokens: 20,
          outputTokens: 5,
          costUsd: 0.001,
          priceEquivalentCny: 0.0072,
          usingPlanQuota: false,
          receiptComplete: true,
        },
      }) as never;

    const first = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(first.ingestedCount).toBe(3);
    expect(first.failedCount).toBe(0);
    expect(first.seriesAggregationErrorZh).toContain("暂时未完成");
    expect(first.seriesAggregationUsage).toMatchObject({ inputTokens: 40, costUsd: 0.002 });

    deps.listIngested = vi.fn(async () => new Set([1, 2, 3]));
    (deps.runBatch as ReturnType<typeof vi.fn>).mockClear();
    const second = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(second.skippedCount).toBe(3);
    expect(second.seriesAggregation?.gcsUri).toBe("gs://b/tpl_series_s.json");
    expect(deps.runBatch).not.toHaveBeenCalled();
    expect(deps.aggregateSeries).toHaveBeenCalledTimes(2);
  });

  it("进度写入失败只告警，不把已入库结果重复改成失败", async () => {
    const result = await runNativeDeepReadBatch({
      seriesKey: "s",
      episodes: [three[0]!],
      onProgress: async () => {
        throw new Error("进度暂存不可用");
      },
    }, deps);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ episodeIndex: 1, status: "ingested" });
    expect(result.failedCount).toBe(0);
    expect(deps.ingest).toHaveBeenCalledTimes(1);
  });

  it("一集门禁失败停止后续集，已入库的集不受影响", async () => {
    deps.runBatch = vi.fn(async (input: { episodes: Array<{ episodeIndex: number; segments: unknown[] }> }) => ({
      episodes: input.episodes.map((episodeRow) => ({
        episodeIndex: episodeRow.episodeIndex,
        result: episodeRow.episodeIndex === 2
          ? makeResult({ segmentCount: 0, failedSegmentCount: 3, beatGrid: [], shotCount: 0 })
          : makeResult(),
      })),
      usage: { inputTokens: 100, outputTokens: 20, costCny: 0.5 },
      model: "gemini-3.1-pro-preview",
      batchRequestId: "11111111-1111-4111-8111-111111111111",
    })) as never;
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    // 第 1 集入库；第 2 集门禁失败即停止，第 3 集不再发请求（占位已释放）
    expect(r.ingestedCount).toBe(1);
    expect(r.failedCount).toBe(1);
    expect(r.outcomes.find((o) => o.episodeIndex === 2)?.status).toBe("failed");
    expect(r.outcomes.find((o) => o.episodeIndex === 3)).toBeUndefined();
    expect(deps.runBatch).toHaveBeenCalledTimes(2);
  });

  it("首集模型返回后收到中止：已付费结构照常入库，后续集停跑且不做系列聚合", async () => {
    const c = new AbortController();
    const original = deps.runBatch;
    deps.runBatch = vi.fn(async (input) => {
      c.abort();
      return original(input as never) as never;
    });
    const r = await runNativeDeepReadBatch(
      { seriesKey: "s", episodes: three, abortSignal: c.signal },
      deps,
    );
    expect(r.aborted).toBe(true);
    expect(r.failedCount).toBe(0);
    expect(r.ingestedCount).toBe(1);
    expect(r.totalCostCny).toBeCloseTo(0.5);
    expect(deps.runBatch).toHaveBeenCalledTimes(1);
    expect(deps.aggregateSeries).not.toHaveBeenCalled();
  });

  it("列已入库集失败时整批停手 —— 把未知当没跑过就是重烧一遍", async () => {
    deps.listIngested = vi.fn(async () => {
      throw new Error("无法核对已入库集，已停止续跑");
    });
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps),
    ).rejects.toThrow("停止续跑");
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("开关关着时整批拒绝", async () => {
    deps.isEnabled = vi.fn(() => false);
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps),
    ).rejects.toThrow("开关未开启");
    expect(deps.listIngested).not.toHaveBeenCalled();
  });
});

describe("失败占位自动让位（0826 用户拍板）", () => {
  it("计划标记 reclaimFailedClaim 的集走原子接管，不走普通抢占", async () => {
    await runNativeDeepReadBatch({
      seriesKey: "s1",
      episodes: [{
        episodeIndex: 1,
        sourceUrl: "https://www.douyin.com/video/1",
        durationSec: 60,
        segments: [{ startSec: 0, endSec: 60 }],
        resolveNodes: async () => [],
        reclaimFailedClaim: true,
        recoverMisplacedSourceCache: true,
      }],
    }, deps);
    expect(deps.takeoverClaim).toHaveBeenCalledTimes(1);
    expect(deps.acquireClaim).not.toHaveBeenCalled();
    expect(deps.migrateSegmentCaches).toHaveBeenCalledWith(expect.objectContaining({
      seriesKey: "s1",
      episodeIndex: 1,
    }));
  });

  it("单集入口同样按 reclaim 标记接管，不旁路回普通抢占", async () => {
    await executeAndIngestNativeDeepReadEpisode({
      seriesKey: "s1",
      episodeIndex: 1,
      sourceUrl: "https://www.douyin.com/video/1",
      durationSec: 60,
      segments: [{ startSec: 0, endSec: 60 }],
      resolveNodes: async () => [],
      reclaimFailedClaim: true,
    }, deps);
    expect(deps.takeoverClaim).toHaveBeenCalledTimes(1);
    expect(deps.acquireClaim).not.toHaveBeenCalled();
  });
});
