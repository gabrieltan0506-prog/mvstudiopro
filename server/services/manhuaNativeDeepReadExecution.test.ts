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
import { noAudioManhuaNativeAnalysis } from "../../shared/manhuaNativeAudioAnalysis";

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
    audioAnalysis: noAudioManhuaNativeAnalysis(1080),
    segmentCount: 3,
    shotCount: beatGrid.length,
    failedSegmentCount: 0,
    droppedCount: 0,
    truncated: false,
    model: "qwen3.8-max",
    attemptedSegments: 3,
    usingPlanQuota: true,
    usage: { costCny: 0.5 },
    ...over,
  };
}

/**
 * 18 分钟一集按 360 秒切为三段；同一集的多个片段仍可进入同一多视频请求。
 */
const episode = {
  episodeIndex: 1,
  sourceUrl: "https://example.com/e1",
  durationSec: 1080,
  segments: [
    { startSec: 0, endSec: 360 },
    { startSec: 360, endSec: 720 },
    { startSec: 720, endSec: 1080 },
  ],
  resolveNodes: async () => [{ url: "https://cdn/1.mp4" }],
};

let deps: NativeDeepReadExecutionDeps;

beforeEach(() => {
  const emptyAudio = noAudioManhuaNativeAnalysis(1080);
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
          batchEpisodeCount: input.episodes.length,
        }),
      })),
      usage: { inputTokens: input.episodes.length * 100, outputTokens: input.episodes.length * 20, costCny: input.episodes.length * 0.5 },
      usingPlanQuota: true,
      model: "qwen3.8-max",
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
    collectAudioEvidence: vi.fn(async () => ({
      hasAudio: false,
      durationSec: 1080,
      chunks: [],
      usage: emptyAudio.usage,
    })) as never,
    finalizeAudio: vi.fn(async () => emptyAudio) as never,
    aggregateSeries: vi.fn(async () => ({
      card: { id: "tpl_series_s" },
      gcsUri: "gs://b/tpl_series_s.json",
      sourceEpisodeCount: 1,
      usage: { inputTokens: 10, outputTokens: 5, priceEquivalentCny: 0.1, receiptComplete: true },
    })) as never,
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
    expect(deps.runBatch).not.toHaveBeenCalled();
    expect(deps.listIngested).not.toHaveBeenCalled();
  });

  it("非法集号零调用拒绝", async () => {
    await expect(
      runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(0)] }, deps),
    ).rejects.toThrow("1–999");
    expect(deps.runBatch).not.toHaveBeenCalled();
  });

  it("单段超过六分钟要求拆段（保持至少5fps的时间密度）", () => {
    expect(() =>
      validateNativeDeepReadBatchPlan([
        ep(1, { durationSec: 1200, segments: [{ startSec: 0, endSec: 1080 }] }),
      ]),
    ).toThrow("请拆段");
    expect(NATIVE_DEEP_READ_MAX_SEGMENT_SEC).toBe(360);
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

  it("片段数不冒充请求数：20 集各 6 段按预算动态装箱", () => {
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
    expect(plan.totalVisualCalls).toBeGreaterThan(1);
    expect(plan.totalModelCalls).toBe(plan.totalVisualCalls + plan.totalAudioChunks * 2 + 1);
  });

  it("十集短片可合一包，十集长片会按预算自动拆包", () => {
    const short = Array.from({ length: 10 }, (_, index) => ep(index + 1, {
      durationSec: 90,
      segments: [{ startSec: 0, endSec: 90 }],
    }));
    const long = Array.from({ length: 10 }, (_, index) => ep(index + 1, {
      durationSec: 1080,
      segments: [
        { startSec: 0, endSec: 360 },
        { startSec: 360, endSec: 720 },
        { startSec: 720, endSec: 1080 },
      ],
    }));
    expect(validateNativeDeepReadBatchPlan(short).totalVisualCalls).toBe(1);
    expect(validateNativeDeepReadBatchPlan(long).totalVisualCalls).toBeGreaterThan(1);
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
        [ep(1, { segments: [
          { startSec: 0, endSec: 359 },
          { startSec: 359, endSec: 719 },
          { startSec: 719, endSec: 1079 },
          { startSec: 1079, endSec: 1080 },
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
  it("占位在 runner 之前 —— 抢不到就停手，不是跑完才发现重复", async () => {
    deps.acquireClaim = vi.fn(async () => {
      throw new Error("第1集已有精读任务占位；禁止自动重跑");
    });
    await expect(runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps))
      .rejects.toThrow("占位");
    expect(deps.runBatch).not.toHaveBeenCalled();
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
          usage: { costCny: 2.5 },
        }),
      }],
      usage: { inputTokens: 0, outputTokens: 0, costCny: 2.5 },
      model: "qwen3.8-max",
      batchRequestId: "11111111-1111-4111-8111-111111111111",
    })) as never;
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
      releaseBeforePaidCall: vi.fn(async () => undefined),
      releaseAfterSuccess: release,
    }));
    deps.ingest = vi.fn(async () => { throw new Error("入库暂时不可用"); }) as never;
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1)] }, deps);
    expect(r.failedCount).toBe(1);
    expect(r.totalCostCny).toBeCloseTo(0.5);
    expect(release).not.toHaveBeenCalled();
  });

  it("模型开始前的零成本故障只释放未付费占位", async () => {
    const releases = new Map<number, ReturnType<typeof vi.fn>>();
    deps.acquireClaim = vi.fn(async (_seriesKey: string, episodeIndex: number) => {
      const releaseBeforePaidCall = vi.fn(async () => undefined);
      releases.set(episodeIndex, releaseBeforePaidCall);
      return {
        claimUri: `gs://b/c${episodeIndex}`,
        objectName: `c${episodeIndex}`,
        runId: "r",
        releaseBeforePaidCall,
        releaseAfterSuccess: vi.fn(async () => undefined),
      };
    }) as never;
    deps.collectAudioEvidence = vi.fn(async () => {
      throw new Error("媒体准备未完成");
    }) as never;

    const result = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(2)] }, deps);

    expect(result.failedCount).toBe(2);
    expect(result.totalCostCny).toBe(0);
    expect(releases.get(1)).toHaveBeenCalledTimes(1);
    expect(releases.get(2)).toHaveBeenCalledTimes(1);
  });

  it("一集收到付费 started 后失败，只保留该集占位并释放未触碰集", async () => {
    const releases = new Map<number, ReturnType<typeof vi.fn>>();
    deps.acquireClaim = vi.fn(async (_seriesKey: string, episodeIndex: number) => {
      const releaseBeforePaidCall = vi.fn(async () => undefined);
      releases.set(episodeIndex, releaseBeforePaidCall);
      return {
        claimUri: `gs://b/c${episodeIndex}`,
        objectName: `c${episodeIndex}`,
        runId: "r",
        releaseBeforePaidCall,
        releaseAfterSuccess: vi.fn(async () => undefined),
      };
    }) as never;
    deps.collectAudioEvidence = vi.fn(async (input) => {
      await input.onModelReceipt?.({
        stage: "audio_model",
        status: "started",
        chunkIndex: 0,
        variant: "mono_16k",
      });
      throw Object.assign(new Error("声音结构未返回"), {
        nativeAudioUsage: {
          model: "gemini-3.6-flash×2",
          inputTokens: 30,
          audioInputTokens: 20,
          outputTokens: 4,
          costCny: 0.2,
          geminiCalls: 1,
          receiptComplete: false,
        },
      });
    }) as never;

    const result = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(2)] }, deps);

    expect(result.outcomes.find((row) => row.episodeIndex === 1)?.usage).toMatchObject({
      audioInputTokens: 30,
      audioOutputTokens: 4,
      audioCostCny: 0.2,
      receiptComplete: false,
    });
    expect(releases.get(1)).not.toHaveBeenCalled();
    expect(releases.get(2)).toHaveBeenCalledTimes(1);
  });

  it("成功集汇总实际成本与耗时", async () => {
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: [ep(1), ep(2)] }, deps);
    expect(r.ingestedCount).toBe(2);
    expect(r.totalCostCny).toBeCloseTo(1.0);
    expect(r.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(r.plan.totalSegments).toBe(6);
    expect(deps.runBatch).toHaveBeenCalledTimes(1);
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

  it("每次模型调用都逐笔回传 started/completed，包含双音轨、视觉与系列整理", async () => {
    const checkpoints: Array<{ stage: string; status: string; variant?: string }> = [];
    const baseRunBatch = deps.runBatch;
    deps.collectAudioEvidence = vi.fn(async (input) => {
      for (const variant of ["mono_16k", "stereo_32k"] as const) {
        await input.onModelReceipt?.({
          stage: "audio_model",
          status: "started",
          chunkIndex: 0,
          variant,
        });
        await input.onModelReceipt?.({
          stage: "audio_model",
          status: "completed",
          chunkIndex: 0,
          variant,
          inputTokens: 10,
          audioInputTokens: 8,
          outputTokens: 2,
        });
      }
      return {
        hasAudio: false,
        durationSec: 1080,
        chunks: [],
        usage: noAudioManhuaNativeAnalysis(1080).usage,
      };
    }) as never;
    deps.runBatch = vi.fn(async (input) => {
      await input.onModelReceipt?.({
        stage: "visual_model",
        status: "started",
        batchRequestId: "11111111-1111-4111-8111-111111111111",
        episodeIndexes: [1],
        videoCount: 3,
      });
      const result = await baseRunBatch(input as never);
      await input.onModelReceipt?.({
        stage: "visual_model",
        status: "completed",
        batchRequestId: "11111111-1111-4111-8111-111111111111",
        episodeIndexes: [1],
        videoCount: 3,
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
    expect(checkpoints.map(({ stage, status, variant }) => `${stage}:${variant || "-"}:${status}`)).toEqual([
      "audio_model:mono_16k:started",
      "audio_model:mono_16k:completed",
      "audio_model:stereo_32k:started",
      "audio_model:stereo_32k:completed",
      "visual_model:-:started",
      "visual_model:-:completed",
      "series_aggregation_model:-:started",
      "series_aggregation_model:-:completed",
    ]);
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

  it("同包一集门禁失败不覆盖其他已经取得的结构", async () => {
    deps.runBatch = vi.fn(async (input: { episodes: Array<{ episodeIndex: number; segments: unknown[] }> }) => ({
      episodes: input.episodes.map((episodeRow) => ({
        episodeIndex: episodeRow.episodeIndex,
        result: episodeRow.episodeIndex === 2
          ? makeResult({ segmentCount: 0, failedSegmentCount: 3, beatGrid: [], shotCount: 0 })
          : makeResult(),
      })),
      usage: { inputTokens: 300, outputTokens: 60, costCny: 1.5 },
      model: "qwen3.8-max",
      batchRequestId: "11111111-1111-4111-8111-111111111111",
    })) as never;
    const r = await runNativeDeepReadBatch({ seriesKey: "s", episodes: three }, deps);
    expect(r.ingestedCount).toBe(2);
    expect(r.failedCount).toBe(1);
    expect(r.outcomes.find((o) => o.episodeIndex === 2)?.status).toBe("failed");
  });

  it("整包已返回后即使收到中止也保存已付费结构，但不再做系列聚合", async () => {
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
    expect(r.ingestedCount).toBe(3);
    expect(r.totalCostCny).toBeCloseTo(1.5);
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
