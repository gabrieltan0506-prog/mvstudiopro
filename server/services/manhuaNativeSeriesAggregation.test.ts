import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank.js";
import {
  MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
  MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
  aggregateNativeDeepReadSeries,
  buildNativeSeriesAggregationPayload,
  invokeNativeSeriesAggregationModel,
  __testBuildNativeSeriesCard,
  type NativeSeriesAggregationUsage,
} from "./manhuaNativeSeriesAggregation.js";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SERIES_KEY = "series_lock_test";
const EPISODE_OBJECT = `manhua-template-learn/proposals/tpl_native_${SERIES_KEY}_ep001.json`;
const EPISODE_2_OBJECT = `manhua-template-learn/proposals/tpl_native_${SERIES_KEY}_ep002.json`;
const LOCK_OBJECT = `manhua-template-learn/locks/native-series-${SERIES_KEY}.json`;

function episodeCard(episodeIndex = 1) {
  const suffix = String(episodeIndex).padStart(3, "0");
  return {
    id: `tpl_native_${SERIES_KEY}_ep${suffix}`,
    nameZh: `原生第${episodeIndex}集`,
    laneZh: "多维标签",
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    summaryZh: "逐集摘要",
    hook3sZh: "开场冲突",
    beatGrid: Array.from({ length: 6 }, (_, index) => ({
      atSec: index * 10,
      conflictZh: `冲突${index}`,
      visualZh: `动作${index}`,
    })),
    reusableZh: "可复用手法",
    genPromptHintZh: "生成要素",
    scenePoolHints: [],
    castShape: { leadDesireZh: "欲望", pressureZh: "压力" },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
    sourceRefs: [{ url: `https://example.com/ep${episodeIndex}`, fetchedAt: "2026-08-25" }],
    status: "proposed",
    provenance: {
      nativeVideoDeepRead: {
        model: "qwen3.8-max",
        attemptedSegments: 1,
        successSegments: 1,
        shotCount: 6,
        droppedCount: 0,
        truncated: false,
        costCny: 0,
      },
    },
  };
}

function aggregationRaw() {
  return {
    nameZh: "系列结构模板",
    summaryZh: "系列摘要",
    hook3sZh: "系列钩子",
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    storyStructure: {
      corePromiseZh: "核心承诺",
      conflictEngineZh: "冲突引擎",
      relationshipEngineZh: "关系引擎",
      episodeProgressionZh: ["逐集升级"],
      variationRulesZh: ["每集改变压力来源"],
    },
    beatGrid: Array.from({ length: 6 }, (_, index) => ({
      atSec: index * 20,
      conflictZh: `系列冲突${index}`,
      visualZh: `系列动作${index}`,
    })),
    reusableZh: "系列手法",
    genPromptHintZh: "系列生成要素",
    scenePoolHints: [],
    castShape: { leadDesireZh: "持续目标", pressureZh: "持续压力" },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
  };
}

describe("系列聚合输入保留完整证据", () => {
  it("不再按集数抽稀 beatGrid、字幕或音轨", () => {
    const card = episodeCard();
    card.beatGrid = Array.from({ length: 160 }, (_, index) => ({
      atSec: index,
      conflictZh: `冲突${index}`,
      visualZh: `动作${index}`,
    }));
    const withEvidence = {
      ...card,
      subtitleTrack: Array.from({ length: 80 }, (_, index) => ({ atSec: index, textZh: `字幕${index}` })),
      audioStory: {
        hasAudio: true,
        audioTrack: Array.from({ length: 60 }, (_, index) => ({
          fromSec: index,
          toSec: index + 1,
          emotionArcZh: `声音${index}`,
        })),
        audioBeatStructureZh: "声音结构",
        reusableAudioZh: "声音手法",
      },
    };
    const payload = JSON.parse(buildNativeSeriesAggregationPayload([
      withEvidence as unknown as ManhuaViralTemplateCard,
    ]));
    expect(payload.episodes[0].beatGrid).toHaveLength(160);
    expect(payload.episodes[0].subtitles).toHaveLength(80);
    expect(payload.episodes[0].audioTrack).toHaveLength(60);
    expect(payload.episodes[0].beatGrid.at(-1).visualZh).toBe("动作159");
  });

  it("系列卡来源覆盖全部分集，不只引用前 8 集", async () => {
    const cards = Array.from({ length: 12 }, (_, index) =>
      episodeCard(index + 1) as unknown as ManhuaViralTemplateCard);
    const raw = aggregationRaw();
    const usage: NativeSeriesAggregationUsage = {
      model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
      route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      priceEquivalentCny: 0,
      usingPlanQuota: false as const,
      receiptComplete: true,
    };
    const built = __testBuildNativeSeriesCard({
      seriesKey: "series_all_refs",
      raw,
      cards,
      snapshotSha256: "a".repeat(64),
      usage,
    });
    expect(built.sourceRefs).toHaveLength(12);
    expect(built.sourceRefs.at(-1)?.url).toContain("ep012");
  });
});

function aggregationDeps(options: {
  loseLockAfterInvoke?: boolean;
  addEpisodeAfterInvoke?: boolean;
  replaceEpisodeAfterInvoke?: boolean;
  modelFailureUsage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
  };
  aggregationResult?: ReturnType<typeof aggregationRaw>;
  episodeResult?: ReturnType<typeof episodeCard>;
} = {}) {
  const order: string[] = [];
  let lockBody: Buffer = Buffer.from("{}");
  let lockLost = false;
  let modelInvoked = false;
  const upload = vi.fn(async ({ objectName }: { objectName: string }) => ({
    gcsUri: `gs://test-bucket/${objectName}`,
    bucket: "test-bucket",
    objectName,
  }));
  const deps = {
    listNames: vi.fn(async () => {
      order.push("list-episodes");
      return modelInvoked && options.addEpisodeAfterInvoke
        ? [EPISODE_OBJECT, EPISODE_2_OBJECT]
        : [EPISODE_OBJECT];
    }),
    downloadVersioned: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
      if (gcsUri.endsWith(LOCK_OBJECT)) {
        order.push("read-lock");
        return lockLost
          ? {
              buffer: Buffer.from(JSON.stringify({
                token: "new-owner",
                expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
              })),
              generation: "lock-generation-2",
            }
          : { buffer: lockBody, generation: "lock-generation-1" };
      }
      order.push("download-episode");
      return {
        buffer: Buffer.from(JSON.stringify(options.episodeResult || episodeCard())),
        generation: modelInvoked && options.replaceEpisodeAfterInvoke
          ? "episode-generation-2"
          : "episode-generation-1",
      };
    }),
    download: vi.fn(async () => {
      throw new Error("gcs_download_failed:404");
    }),
    upload,
    create: vi.fn(async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
      if (objectName === LOCK_OBJECT) {
        order.push("create-lock");
        lockBody = buffer;
      } else {
        order.push("create-history");
      }
      return { created: true };
    }),
    remove: vi.fn(async () => undefined),
    invoke: vi.fn(async () => {
      order.push("invoke-model");
      modelInvoked = true;
      if (options.modelFailureUsage) {
        const error = new Error("系列聚合输出触顶") as Error & {
          aggregateGatewayUsage?: {
            inputTokens: number;
            outputTokens: number;
            reasoningTokens: number;
            costUsd: number;
          };
        };
        error.aggregateGatewayUsage = options.modelFailureUsage;
        throw error;
      }
      if (options.loseLockAfterInvoke) lockLost = true;
      return {
        raw: options.aggregationResult || aggregationRaw(),
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 25,
        costUsd: 0.01,
      };
    }),
  };
  return { deps, order, upload };
}

const EVOLINK_ENDPOINT = "https://api.evolink.ai/v1/chat/completions";

describe("原生精读系列结构化 · GLM-5.3 两档（0829 改线：EvoLink 主档→OpenRouter 兜底）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("共用网关发出 GLM 锁定请求体，并携回 input/output/reasoning/cost", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "qwen-must-not-be-used");
    vi.stubEnv("EVOLINK_API_KEY", "evolink-glm-is-primary");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ok: true }) } }],
        usage: {
          prompt_tokens: 321,
          completion_tokens: 45,
          completion_tokens_details: { reasoning_tokens: 17 },
          cost: 0.0123,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    expect(MANHUA_NATIVE_SERIES_AGGREGATION_MODEL).toBe("glm-5.3→z-ai/glm-5.3");
    expect(MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE).toBe("openrouter_text");
    await expect(invokeNativeSeriesAggregationModel(JSON.stringify({ episodes: [] })))
      .resolves.toEqual({
        raw: { ok: true },
        // 0830 审查 P1-2：返回体带出实际交卷的网关与模型，回执才记得了真值
        gateway: "evolink_glm",
        model: "glm-5.3",
        inputTokens: 321,
        outputTokens: 45,
        reasoningTokens: 17,
        costUsd: 0.0123,
        provider: undefined,
        providerRequestId: undefined,
        finishReason: "stop",
      });
    // 主档已改 EvoLink GLM-5.3 直连（0829 用户拍板）
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(EVOLINK_ENDPOINT);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toMatchObject({
      model: "glm-5.3",
      response_format: { type: "json_object" },
      reasoning_effort: "max",      // EvoLink 用顶层字符串，不是嵌套 reasoning:{effort}
      max_tokens: 131_072,
      temperature: 0.8,             // 链级默认，不发＝落到供应商默认 1.0
    });
    expect(body.messages).toHaveLength(2);
    expect(body).not.toHaveProperty("enable_thinking");
    expect(body).not.toHaveProperty("reasoning");   // OpenRouter 专属形态，别抄过来
    expect(body).not.toHaveProperty("provider");    // OpenRouter 专属键
    expect(body).not.toHaveProperty("top_p");
  });

  it("OpenRouter 失败时不静默调用新加坡 Qwen 或 EvoLink", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "qwen-is-configured");
    vi.stubEnv("EVOLINK_API_KEY", "evolink-is-configured");
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      new Response("temporary upstream failure", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeNativeSeriesAggregationModel("{}"))
      .rejects.toThrow(/GLM-5\.3 两档\(EvoLink→OpenRouter\)全部失败/);
    // 两档 GLM 都试过就停：绝不静默滑到 Qwen（新加坡套餐档 / EvoLink Qwen 档）
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(EVOLINK_ENDPOINT);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(OPENROUTER_ENDPOINT);
  });

  it("严格要求 finish_reason=stop，截断、缺失结束原因与坏 JSON 均保留真实 usage", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    // 只配 OpenRouter 一档，用量断言才对应单发（EvoLink 档跳过为未配置）
    vi.stubEnv("EVOLINK_API_KEY", "");
    const responses = [
      {
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
        usage: {
          prompt_tokens: 800,
          completion_tokens: 131_072,
          completion_tokens_details: { reasoning_tokens: 120_000 },
          cost: 0.42,
        },
      },
      {
        choices: [{ message: { content: "{}" } }],
        usage: {
          prompt_tokens: 600,
          completion_tokens: 90,
          completion_tokens_details: { reasoning_tokens: 30 },
          cost: 0.04,
        },
      },
      {
        choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
        usage: {
          prompt_tokens: 500,
          completion_tokens: 80,
          completion_tokens_details: { reasoning_tokens: 20 },
          cost: 0.03,
        },
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(responses.shift()), { status: 200 })));

    // 失败路径下取不到实际交卷身份，如实退回链路标签，不假装知道（P1-2 同批）
    const fallbackIdentity = { gateway: "openrouter", model: "glm-5.3→z-ai/glm-5.3" };
    for (const expected of [
      { ...fallbackIdentity, inputTokens: 800, outputTokens: 131_072, reasoningTokens: 120_000, costUsd: 0.42 },
      { ...fallbackIdentity, inputTokens: 600, outputTokens: 90, reasoningTokens: 30, costUsd: 0.04 },
      { ...fallbackIdentity, inputTokens: 500, outputTokens: 80, reasoningTokens: 20, costUsd: 0.03 },
    ]) {
      try {
        await invokeNativeSeriesAggregationModel("{}");
        throw new Error("预期请求被关闭式拒绝");
      } catch (error) {
        expect((error as Error & { aggregateGatewayUsage?: unknown }).aggregateGatewayUsage)
          .toEqual(expected);
      }
    }
  });

  it("GLM 两档密钥都缺时即使 Qwen 套餐档已配置也不发外呼", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("EVOLINK_API_KEY", "");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "qwen-is-configured");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeNativeSeriesAggregationModel("{}"))
      .rejects.toThrow(/openrouter=skipped_not_configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("系列聚合快照与提交 fencing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("系列模型结果必须原始带齐 classification 五键", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const raw = aggregationRaw();
    delete (raw.classification as Record<string, unknown>).audiovisualTagsZh;
    const { deps } = aggregationDeps({ aggregationResult: raw });
    await expect(aggregateNativeDeepReadSeries({
      seriesKey: SERIES_KEY,
    }, deps as never)).rejects.toThrow("classification 必须显式包含五个数组字段");
  });

  it("系列聚合输入分集卡原始缺 classification 键时停止，不让 parser 补键", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const episode = episodeCard();
    delete (episode.classification as Record<string, unknown>).audiovisualTagsZh;
    const { deps } = aggregationDeps({ episodeResult: episode });
    await expect(aggregateNativeDeepReadSeries({
      seriesKey: SERIES_KEY,
    }, deps as never)).rejects.toThrow("分集卡结构、身份或多维标签无效");
  });

  it("系列模型五键齐全且仅两个维度非空时放行", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const raw = aggregationRaw();
    raw.classification = {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: [],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: [],
      audienceExperienceTagsZh: [],
    };
    const { deps } = aggregationDeps({ aggregationResult: raw });
    await expect(aggregateNativeDeepReadSeries({
      seriesKey: SERIES_KEY,
    }, deps as never)).resolves.toMatchObject({ reused: false, sourceEpisodeCount: 1 });
  });

  it("系列模型五键齐全但仅一个维度非空时拒收", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const raw = aggregationRaw();
    raw.classification = {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: [],
      performanceTagsZh: [],
      audiovisualTagsZh: [],
      audienceExperienceTagsZh: [],
    };
    const { deps } = aggregationDeps({ aggregationResult: raw });
    await expect(aggregateNativeDeepReadSeries({
      seriesKey: SERIES_KEY,
    }, deps as never)).rejects.toThrow("至少需要两个有效分类维度");
  });

  it("先完成 GCS→Fly 快照，再取得系列锁，慢快照不占用完整租期", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const { deps, order, upload } = aggregationDeps();
    const receipts: Array<Record<string, unknown>> = [];
    await expect(aggregateNativeDeepReadSeries({
      seriesKey: SERIES_KEY,
      onModelReceipt: (receipt) => { receipts.push(receipt); },
    }, deps as never)).resolves.toMatchObject({
      reused: false,
      sourceEpisodeCount: 1,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 25,
        costUsd: 0.01,
      },
    });
    expect(order.indexOf("download-episode")).toBeLessThan(order.indexOf("create-lock"));
    expect(order).toEqual(expect.arrayContaining([
      "download-episode",
      "create-lock",
      "invoke-model",
      "create-history",
    ]));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(receipts.at(-1)).toMatchObject({
      stage: "series_aggregation_model",
      status: "completed",
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 25,
      costUsd: 0.01,
    });
    expect(Number(receipts.at(-1)?.priceEquivalentCny)).toBeCloseTo(0.072, 10);
  });

  it("1/4 部分分集卡只供单集审批，不进入付费系列聚合", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const { deps, upload } = aggregationDeps();
    const partial = episodeCard();
    partial.provenance.nativeVideoDeepRead = {
      ...partial.provenance.nativeVideoDeepRead,
      attemptedSegments: 4,
      successSegments: 1,
      completedSegmentIndexes: [0],
      assemblyComplete: false,
      sourceDigest: "a".repeat(64),
      snapshotSha256: "b".repeat(64),
    } as never;
    deps.downloadVersioned.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => {
      if (gcsUri.endsWith(LOCK_OBJECT)) {
        return { buffer: Buffer.from("{}"), generation: "lock-generation-1" };
      }
      return { buffer: Buffer.from(JSON.stringify(partial)), generation: "episode-generation-1" };
    });

    await expect(aggregateNativeDeepReadSeries({ seriesKey: SERIES_KEY }, deps as never))
      .rejects.toThrow(/分集卡结构、身份或多维标签无效/);
    expect(deps.invoke).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("模型返回后若锁已被接管，旧任务不得覆盖系列提案", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const { deps, upload } = aggregationDeps({ loseLockAfterInvoke: true });
    await expect(aggregateNativeDeepReadSeries({ seriesKey: SERIES_KEY }, deps as never))
      .rejects.toThrow(/旧任务禁止覆盖新结果/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("付费模型失败时的回执保留已发生的 token 用量", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const usage = {
      inputTokens: 800,
      outputTokens: 131_072,
      reasoningTokens: 120_000,
      costUsd: 0.42,
    };
    const receipts: Array<Record<string, unknown>> = [];
    const { deps } = aggregationDeps({ modelFailureUsage: usage });
    await expect(aggregateNativeDeepReadSeries({
      seriesKey: SERIES_KEY,
      onModelReceipt: (receipt) => { receipts.push(receipt); },
    }, deps as never)).rejects.toThrow("系列聚合输出触顶");
    expect(receipts.at(-1)).toMatchObject({
      stage: "series_aggregation_model",
      status: "failed",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      costUsd: usage.costUsd,
      priceEquivalentCny: 3.024,
    });
  });

  it("模型运行期间新增分集时，旧全量快照不得覆盖系列提案", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const { deps, upload } = aggregationDeps({ addEpisodeAfterInvoke: true });
    await expect(aggregateNativeDeepReadSeries({ seriesKey: SERIES_KEY }, deps as never))
      .rejects.toThrow(/旧快照禁止提交/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("模型运行期间同名分集 generation 换版时，旧快照不得覆盖系列提案", async () => {
    vi.stubEnv("GCS_BUCKET_NAME", "test-bucket");
    const { deps, upload } = aggregationDeps({ replaceEpisodeAfterInvoke: true });
    await expect(aggregateNativeDeepReadSeries({ seriesKey: SERIES_KEY }, deps as never))
      .rejects.toThrow(/已换版，旧快照禁止提交/);
    expect(upload).not.toHaveBeenCalled();
  });
});
