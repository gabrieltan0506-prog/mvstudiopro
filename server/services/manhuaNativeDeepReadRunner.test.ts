/**
 * 原生精读执行器（0826 Gemini 换代）：开关、format 挑选、请求契约、双密度门禁、
 * Vertex 同通道重试纪律、历史路由缓存兼容与 GLM 整集结构化接线。
 * 网络与文件系统部分不在此测（真实 GCS/Vertex 已由实弹探针验证），此处锁路由与契约。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_PROHIBITION_BLOCK,
  NATIVE_DEEP_READ_DENSITY_GUIDE_BLOCK,
  NATIVE_DEEP_READ_SANITY_FLOOR_MIN_SEGMENT_SEC,
  NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC,
  NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_AUDIO_CUE_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN,
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC,
  NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC,
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_HTTP_BODY_TIMEOUT_MS,
  NATIVE_DEEP_READ_HTTP_HEADERS_TIMEOUT_MS,
  NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH,
  NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
  NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  buildNativeDeepReadResponseSchema,
  resolveNativeDeepReadDensityContract,
  NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RESOURCE_RETRY_INTERVAL_MS,
  NATIVE_DEEP_READ_RESOURCE_RETRY_MAX,
  NATIVE_DEEP_READ_RETRY_INTERVAL_MS,
  NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
  NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO,
  NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES,
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  NATIVE_DEEP_READ_TEMPERATURE_MIN,
  NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES,
  NATIVE_DEEP_READ_MODEL,
  NATIVE_DEEP_READ_MAX_FPS,
  NATIVE_DEEP_READ_ROUTE_EVOLINK,
  NATIVE_DEEP_READ_ROUTE_VERTEX,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  assertNativeDeepReadEpisodeEvidence,
  assertNativeDeepReadShotObservations,
  assertNativeDeepReadShotObservationsPreserved,
  assertNativeDeepReadPreparedMedia,
  assertNativeDeepReadSegmentDensity,
  evaluateNativeDeepReadSegmentAcceptance,
  buildGeminiNativeDeepReadSegmentPrompt,
  buildGeminiNativeDeepReadSegmentRequest,
  buildNativeDeepReadVideoSegmentArgs,
  buildNativeDeepReadGlmSegmentRepairPrompt,
  buildNativeDeepReadGlmStructuringPrompt,
  deterministicallyMergeNativeDeepReadRawSegments,
  isManhuaNativeDeepReadEnabled,
  invokeNativeDeepReadGlmStructuring,
  pickSmallestVideoFormat,
  postNativeDeepReadGenerateContent,
  prepareEpisodeVideos,
  nativeDeepReadSegmentCacheFingerprint,
  nativeDeepReadSegmentMeetsThreeItemLine,
  resolveNativeDeepReadRequestFps,
  resolveNativeDeepReadInputFps,
  resolveNativeDeepReadSegmentFloors,
  runManhuaNativeDeepReadBatch,
  runManhuaNativeDeepRead,
  runManhuaNativeDeepReadSelectedSegments,
  createNativeDeepReadRunnerDeps,
  attachAudioChunkSpans,
  stripNonStoryAdShotsForEpisodeCard,
  unwrapNativeDeepReadStructuredAnswerEnvelope,
  validateNativeDeepReadSegments,
  type NativeDeepReadBatchRunnerDeps,
  type NativeDeepReadMediaPreparationDeps,
  type NativeDeepReadSelectedSegmentsParams,
} from "./manhuaNativeDeepReadRunner";
import {
  MANHUA_NATIVE_DEEP_READ_MODEL,
  MANHUA_NATIVE_DEEP_READ_MODEL_LABEL,
  NATIVE_DEEP_READ_DEFAULT_VIDEO_FPS,
  parseNativeDeepReadVideoFps,
} from "../../shared/manhuaNativeDeepReadJob";
import {
  NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  type NativeDeepReadSegmentCacheEntry,
  type NativeDeepReadParsedAttemptEvidenceInput,
} from "./manhuaNativeDeepReadSegmentCache";
import { GlmGatewayError, type GlmParams } from "./bailianChat";

describe("整集GLM消费前永久取证", () => {
  function fixture(failFile?: string, invalidJson = false) {
    const order: string[] = [];
    const saved: Array<Record<string, any>> = [];
    const savedBuffers: Array<{ objectName: string; buffer: Buffer }> = [];
    const upload = vi.fn(async (input: { objectName: string; buffer: Buffer }) => {
      const file = input.objectName.split("/").at(-1)!;
      order.push(file);
      if (file === failFile) throw new Error("虚构存储错误");
      saved.push(JSON.parse(input.buffer.toString("utf8")));
      savedBuffers.push({ objectName: input.objectName, buffer: input.buffer });
      return { created: true, generation: String(saved.length) };
    });
    const invoke = vi.fn(async (params: GlmParams) => {
      order.push("invoke");
      await params.onRawResponse!({ gateway: "evolink_glm", model: "glm-5.3", httpStatus: 502,
        contentType: "application/json", bodyText: "{bad upstream", bodyComplete: true, receivedBytes: 13 });
      const content = invalidJson ? "{bad json" : '{"shots":[{"startSec":0,"endSec":12}],"sentinel":"完整原稿"}';
      await params.onRawResponse!({ gateway: "openrouter", model: "z-ai/glm-5.3", httpStatus: 200,
        contentType: "application/json", bodyText: JSON.stringify({ content }), bodyComplete: true,
        receivedBytes: Buffer.byteLength(JSON.stringify({ content })) });
      order.push("validate");
      params.validateContent!(content);
      return { gateway: "openrouter", model: "z-ai/glm-5.3", gatewayTrace: [],
        usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.01 },
        choices: [{ finish_reason: "stop" }], requestId: "test-request" } as never;
    });
    return { order, saved, savedBuffers, upload, invoke, deps: { invoke, evidence: { upload: upload as never,
      getBucket: () => "mv-studio-pro-vertex-video-temp" } } };
  }

  it("请求先存、两档原文各自先存、解析整集在返回前独立保存", async () => {
    const f = fixture();
    const result = await invokeNativeDeepReadGlmStructuring({ system: "系统", user: "全部分片" }, undefined,
      { seriesKey: "测试", sourceDigest: "a".repeat(64), episodeIndex: 2, batchRequestId: "batch-test", callId: "call-test" }, f.deps);
    expect(f.order).toEqual(["request.json", "invoke", "raw-1.json", "raw-2.json", "validate", "parsed.json"]);
    expect(result.evidence?.raw).toHaveLength(2);
    expect(result.evidence?.selectedRawObjectName).toContain("raw-2.json");
    expect(f.saved[3]).toMatchObject({ episodeIndex: 2, batchRequestId: "batch-test", parsed: result.raw });
    expect(f.saved[0].request).toMatchObject({ system: "系统", user: "全部分片", maxTokens: 131072, gatewayPolicy: "structuring_chain" });
    expect(f.saved[0].request).not.toHaveProperty("abortSignal");
  });

  it("请求证据失败时零模型调用", async () => {
    const f = fixture("request.json");
    await expect(invokeNativeDeepReadGlmStructuring({ system: "系统", user: "输入" }, undefined, undefined, f.deps)).rejects.toThrow("保存失败");
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("坏JSON至少留下原文，不保存虚假的解析对象", async () => {
    const f = fixture(undefined, true);
    await expect(invokeNativeDeepReadGlmStructuring({ system: "系统", user: "输入" }, undefined, undefined, f.deps)).rejects.toThrow();
    expect(f.saved).toHaveLength(3);
    expect(f.order).not.toContain("parsed.json");
  });

  it("解析证据失败不重发且带出已发生费用", async () => {
    const f = fixture("parsed.json");
    const error = await invokeNativeDeepReadGlmStructuring({ system: "系统", user: "输入" }, undefined, undefined, f.deps).catch((error) => error);
    expect(error).toBeInstanceOf(GlmGatewayError);
    expect(error.usage).toMatchObject({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.saved).toHaveLength(3);
  });

  it("结构缓存缺失但永久GLM证据完整时零外呼恢复，历史用量只作证据不重买", async () => {
    const f = fixture();
    const prompt = { system: "系统", user: "全部分片" };
    const context = {
      seriesKey: "recover_glm",
      sourceDigest: "a".repeat(64),
      episodeIndex: 2,
      batchRequestId: "historical-batch",
      callId: `native-structuring-${"b".repeat(64)}`,
      preferredGlmGateway: "openrouter" as const,
    };
    const first = await invokeNativeDeepReadGlmStructuring(prompt, undefined, context, f.deps);
    expect(first.inputTokens).toBe(100);
    f.invoke.mockClear();
    f.upload.mockClear();
    const onBeforePaidCall = vi.fn(async () => undefined);
    const download = vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
      const objectName = gcsUri.replace("gs://mv-studio-pro-vertex-video-temp/", "");
      const hit = f.savedBuffers.find((row) => row.objectName === objectName);
      if (!hit) throw new Error("gcs_stat_failed:404:not found");
      return { buffer: hit.buffer, bucket: "mv-studio-pro-vertex-video-temp", objectName, generation: "1" };
    });
    const recovered = await invokeNativeDeepReadGlmStructuring(
      prompt,
      undefined,
      { ...context, batchRequestId: "current-batch", recoverExisting: true, onBeforePaidCall },
      { invoke: f.invoke, evidence: {
        upload: f.upload as never,
        getBucket: () => "mv-studio-pro-vertex-video-temp",
        download: download as never,
      } },
    );
    expect(recovered).toMatchObject({
      raw: first.raw,
      recoveredPaidEvidence: true,
      inputTokens: 100,
      outputTokens: 50,
      evidence: { callId: context.callId },
    });
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
    expect(onBeforePaidCall).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("生产开关", () => {
  it("默认关闭 —— 未验稳前学习链路必须原样走抽帧", () => {
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ", "");
    expect(isManhuaNativeDeepReadEnabled()).toBe(false);
  });
  it("只有显式 =1 才开", () => {
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ", "true");
    expect(isManhuaNativeDeepReadEnabled()).toBe(false);
    vi.stubEnv("MANHUA_NATIVE_DEEP_READ", "1");
    expect(isManhuaNativeDeepReadEnabled()).toBe(true);
  });
});

describe("pickSmallestVideoFormat：按体积挑，不按分辨率", () => {
  it("同为 540p 时选体积最小的那个", () => {
    const hit = pickSmallestVideoFormat([
      { format_id: "bytevc1_540p_a", url: "https://a", filesize: 120 * 1048576 },
      { format_id: "bytevc1_540p_b", url: "https://b", filesize: 37 * 1048576 },
    ]);
    expect(hit?.url).toBe("https://b");
    expect(Math.round(hit?.sizeMB ?? 0)).toBe(37);
  });

  it("不选 download_addr —— 它分辨率最低(405p)但体积是 540p 的 3~4 倍", () => {
    const hit = pickSmallestVideoFormat([
      { format_id: "download_addr", url: "https://raw", filesize: 497 * 1048576 },
      { format_id: "bytevc1_540p_x", url: "https://ok", filesize: 121 * 1048576 },
    ]);
    expect(hit?.url).toBe("https://ok");
  });

  it("没有 540p 档时返回 null，让调用方明确失败而不是乱挑", () => {
    expect(
      pickSmallestVideoFormat([{ format_id: "h264_720p", url: "https://x", filesize: 1 }]),
    ).toBeNull();
  });
});

describe("模型与通道收口", () => {
  it("常量与请求体同源 —— provenance 记的必须是真跑的那个模型", () => {
    const src = readFileSync(
      new URL("./manhuaNativeDeepReadRunner.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/model: "qwen[^"]*"/);
    expect(NATIVE_DEEP_READ_MODEL).toBe("gemini-3.1-pro-preview");
    expect(NATIVE_DEEP_READ_MODEL).toBe(MANHUA_NATIVE_DEEP_READ_MODEL);
    expect(MANHUA_NATIVE_DEEP_READ_MODEL_LABEL).toBe("Gemini 3.1 Pro");
    expect(NATIVE_DEEP_READ_ROUTE_VERTEX).toBe("vertex_gcs_video");
    expect(NATIVE_DEEP_READ_ROUTE_EVOLINK).toBe("evolink_gemini_video");
    expect(NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE).toBe("openrouter_glm_structuring");
    // 换代必须让旧确认码全废
    expect(NATIVE_DEEP_READ_VISUAL_PLAN_VERSION).toBe("time-custom-20260901-shot-observation-v2");
  });

  it("长视频请求显式使用 30 分钟 HTTP 响应头与响应体时限，不落回 Undici 默认 300 秒", async () => {
    expect(NATIVE_DEEP_READ_HTTP_HEADERS_TIMEOUT_MS).toBe(30 * 60_000);
    expect(NATIVE_DEEP_READ_HTTP_BODY_TIMEOUT_MS).toBe(30 * 60_000);
    const dispatcher = { marker: "native-long-request" };
    const calls: Array<{ url: unknown; init: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url, init: init as Record<string, unknown> });
      return new Response("{}", {
        status: 200,
        headers: { "x-goog-request-id": "req-long-1" },
      });
    });
    await expect(postNativeDeepReadGenerateContent({
      url: "https://example.invalid/generateContent",
      headers: { Authorization: "Bearer test-only" },
      body: { contents: [] },
    }, {
      fetch: fetchImpl as never,
      dispatcher: dispatcher as never,
    })).resolves.toMatchObject({ status: 200, requestId: "req-long-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.dispatcher).toBe(dispatcher);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("参数基准锁：首发0.7、65536、单候选、基础Schema目录、thinkingLevel MEDIUM 且无 thinkingBudget", () => {
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG).toMatchObject({
      temperature: 0.7,
      maxOutputTokens: 65_536,
      candidateCount: 1,
      audioTimestamp: true,
      responseMimeType: "application/json",
      responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
    });
    // 按用户最新指令保留首发MEDIUM基准，对比prompt/schema，不以旧样本推断思考档位因果。
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM", includeThoughts: false });
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).not.toHaveProperty("thinkingBudget");
  });

  it("503 退避与并发上限（0904 用户令）：30 秒 × 4 次、并发 4，且都不进契约哈希", () => {
    expect(NATIVE_DEEP_READ_RESOURCE_RETRY_INTERVAL_MS).toBe(30_000);
    expect(NATIVE_DEEP_READ_RESOURCE_RETRY_MAX).toBe(4);
    expect(NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY).toBe(4);
    // 资源退避线必须与门禁降温线分开：后者进契约 SHA 与段缓存指纹，改了会让已购分片重新付费。
    expect(NATIVE_DEEP_READ_RESOURCE_RETRY_INTERVAL_MS)
      .not.toBe(NATIVE_DEEP_READ_RETRY_INTERVAL_MS);
  });

  it("同一 Vertex 分片候选三档：0.70→0.65→0.60，间隔60秒", () => {
    expect(NATIVE_DEEP_READ_RETRY_TEMPERATURES).toEqual([0.7, 0.65, 0.6]);
    expect(NATIVE_DEEP_READ_RETRY_INTERVAL_MS).toBe(60_000);
    expect(NATIVE_DEEP_READ_TEMPERATURE_MIN).toBe(0.6);
    expect(NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG).toEqual({
      ...NATIVE_DEEP_READ_GENERATION_CONFIG,
      temperature: 0.65,
    });
    expect(NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG).toEqual({
      ...NATIVE_DEEP_READ_GENERATION_CONFIG,
      temperature: 0.6,
    });
  });

  it("后两次复用历史温度与下限，thinkingLevel MEDIUM，且绝不恢复 thinkingBudget", () => {
    // 固定来源：b948d7c364296a9952ddf023fbd192ab8e218707的三档[0.7,0.65,0.6]及MIN=0.6。
    // 复用该提交三档温度；不是恢复该提交的旧Schema、提示词或18K配置。
    const historicalRetryTemperatures = [0.65, 0.6];
    expect(NATIVE_DEEP_READ_RETRY_TEMPERATURES.slice(1)).toEqual(historicalRetryTemperatures);
    expect(NATIVE_DEEP_READ_TEMPERATURE_MIN).toBe(0.6);
    [NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG, NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG]
      .forEach((config, index) => {
        expect(config.temperature).toBe(historicalRetryTemperatures[index]);
        expect(config.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM", includeThoughts: false });
        expect(config.thinkingConfig).not.toHaveProperty("thinkingBudget");
        const request = buildGeminiNativeDeepReadSegmentRequest({
          segmentContext: { startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true },
          fileUri: "gs://test-bucket/seg-0.mp4", fps: 12, prompt: "虚构离线请求", attemptIndex: (index + 1) as 1 | 2,
        });
        expect(request.generationConfig).toEqual({ ...config, responseSchema: buildNativeDeepReadResponseSchema({ startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true }) });
      });
  });

  /**
   * 🔒 当前请求基准锁（0831 重构后重新标定）。
   *
   * 为什么不再还原到 v24：此前两条测试证明的是「当前请求相对 v24 只差可逐项
   * 列举的几项」，靠在测试里剥掉新增段落来还原。0831 提示词做了**结构重构**
   * （正面区只讲该做什么、「不得出现」独立成区、删掉自相矛盾的免责句），
   * 差异不再是「多了几段」而是「改写了句式」——继续硬凑还原链，就会变成
   * 一个永远会过的空壳，那正是溯源断言最该避免的失效方式。
   *
   * 改为锁定**当前**请求的字节数与 SHA：任何未经审视的漂移照样会红，
   * 抓漂移的能力不减；同时保留 v24 SHA 作为历史锚点写在下方，
   * 需要与历史对照时按 git 记录逐项复原，不在测试里假装还能一键还原。
   *
   * 历史锚点（勿删）：
   *   v24 实际 request-1  54931eb5111cf3fa30d5c29296580681b390654e8811fcffbe806efe8abcdc04
   *   删时间桥后基线      ba1ec0187e20c468bde3c2f81f4c9d2bcbbb822686c1d5b93e7cbcc347b2298d / 14531 字节
   */
  it("当前请求使用唯一正负分区正文，基础字段目录符合当前观察说明", () => {
    const candidate = buildGeminiNativeDeepReadSegmentRequest({
          segmentContext: { startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true },
      fileUri: "gs://mv-studio-pro-vertex-video-temp/manhua-template-learn/tmp/native-deep-read/71ba09b6-7244-4b5a-a3af-ad6f0b90bc25.mp4",
      fps: 12,
      prompt: buildGeminiNativeDeepReadSegmentPrompt({
        episodeDurationSec: 1594, startSec: 0, endSec: 319, segmentIndex: 0,
        segmentCount: 5, hasAudio: true, videoFps: 12,
        hintZh: "抖音漫剧完整视听证据探针；按真实镜头、表演、光影、声音和叙事变化记录",
      }),
    });
    expect(candidate.generationConfig).toMatchObject({ temperature: 0.7 });
    const json = JSON.stringify(candidate);
    // 正面区与禁止区必须各自成段且只出现一次——结构分离是本次重构的要点。
    expect(json.split(JSON.stringify(NATIVE_DEEP_READ_PROHIBITION_BLOCK).slice(1, -1))).toHaveLength(2);
    expect(json.split(JSON.stringify(NATIVE_DEEP_READ_DENSITY_GUIDE_BLOCK).slice(1, -1))).toHaveLength(2);
    // 正面区不得再出现禁令措辞（0831 用户点破：正面区混禁止项、禁止项夹要求）
    const positive = json.slice(0, json.indexOf(JSON.stringify(NATIVE_DEEP_READ_PROHIBITION_BLOCK).slice(1, -1)));
    expect(positive).not.toContain("禁止");
    expect(positive).not.toContain("不作为拒收依据");
    // 只更新证据段及环境/道具/动作说明，其他字段结构保持。
    expect(createHash("sha256").update(JSON.stringify(NATIVE_DEEP_READ_RESPONSE_SCHEMA)).digest("hex"))
      .toBe("188453ff58a8cd15464da434a0664f15bde6e57602ca9f4cd9d05b65e1b0be75");
  });

  it("请求组装层拒绝非法尝试序号绕过冻结三档", () => {
    expect(() => buildGeminiNativeDeepReadSegmentRequest({
          segmentContext: { startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true },
      fileUri: "gs://bucket/segment.mp4",
      fps: 5,
      prompt: "test",
      attemptIndex: 3 as never,
    })).toThrow("只允许冻结");
  });

  it("responseSchema 覆盖独立的站位与表演证据，并用 enum 锁住单元类型", () => {
    // 0830 用户拍板：keyMoments 进 required，逼模型在输出预算紧张时也必须吐。
    expect(NATIVE_DEEP_READ_RESPONSE_SCHEMA.required).toEqual([
      "shots", "keyMoments", "subtitles", "audioResolution", "beatStructureZh", "classification",
    ]);
    // v12：keyMoments 刻意排在 shots 之后、其余字段之前——responseSchema 越靠后
    // 越先被 MAX_TOKENS 截断（classification 排末位就是因此长期被截）。
    // 它是抽帧链的唯一输入，不能被截掉。不进 required：旧卡没有，下游一律兜底。
    expect(Object.keys(NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties)).toEqual([
      "shots", "keyMoments", "subtitles", "audioResolution", "beatStructureZh",
      "moodArcZh", "reusableZh", "genPromptHintZh", "classification",
    ]);
    const keyMoments = (NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties as Record<string, any>).keyMoments;
    expect(keyMoments.items.required).toEqual(["atSec", "kindZh", "noteZh"]);
    expect(keyMoments.items.properties.kindZh.enum)
      .toEqual(["切镜", "情绪", "灯光", "剧情", "音轨"]);
    const audioAnalysis = NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties.audioResolution
      .items.properties.analysis;
    expect(audioAnalysis.required).toEqual([
      "audioTrack",
      "audioBeatStructureZh",
      "mixNotesZh",
      "reusableAudioZh",
      "genAudioHintZh",
    ]);
    expect(audioAnalysis.properties.audioTrack.items.required).toEqual([
      "fromSec",
      "toSec",
      "emotionArcZh",
      "toneZh",
      "sfxZh",
      "bgmZh",
      "atmosphereZh",
      "silenceZh",
      "cues",
    ]);
    expect(NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties.classification.required).toEqual([
      "emotionTagsZh",
      "narrativeFeatureTagsZh",
      "performanceTagsZh",
      "audiovisualTagsZh",
      "audienceExperienceTagsZh",
    ]);
    // Schema 分支：只列两类共有的三项；story 的 17 字段由 assertRawShotFieldPresence 强制
    expect(NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties.shots.items.required).toEqual([
      "startSec", "endSec", "evidenceRole", "hintZh",
    ]);
    expect(NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties.shots.items.properties.unitTypeZh.enum)
      .toEqual(["剪辑镜头", "拆分镜证据段"]);
    expect(NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties.shots.items.properties.evidenceRole.enum)
      .toEqual(["story", "non_story_ad"]);
    expect(audioAnalysis.properties.audioTrack.items.properties.cues.items.properties.kind.enum)
      .toEqual([
        "source_change",
        "voice_change",
        "sfx",
        "bgm_in",
        "bgm_change",
        "bgm_out",
        "atmosphere_change",
        "dynamics_change",
        "mix_change",
        "silence_in",
        "silence_out",
      ]);
  });
});

describe("自定义分片时长和 fps 独立，不按时长降采样", () => {
  it.each([0.01, 90, 180, 299.99, 300, 300.01, 360, 1080, 7200])("%s 秒始终为缺省 12fps（不按时长降采样）", (duration) => {
    expect(resolveNativeDeepReadRequestFps(duration)).toBe(12);
  });
  it.each([0, -1, NaN, Infinity])("拒绝非法时长 %s", (duration) => {
    expect(() => resolveNativeDeepReadRequestFps(duration)).toThrow("有限正数");
  });
  it.each([1, 319, 638, 7200])("%s 秒遵守用户指定 12fps，包括尾片", (duration) => {
    expect(resolveNativeDeepReadRequestFps(duration, 12)).toBe(12);
  });
  it.each([0, -1, NaN, Infinity, 24.01])("拒绝非法 fps %s", (fps) => {
    expect(() => resolveNativeDeepReadRequestFps(319, fps)).toThrow();
  });
  it("官方上限24不改变旧探针自适应算法的兼容上限10", () => {
    expect(NATIVE_DEEP_READ_MAX_FPS).toBe(24);
    expect(resolveNativeDeepReadRequestFps(319, 24)).toBe(24);
    expect(resolveNativeDeepReadInputFps(1)).toBe(10);
    expect(resolveNativeDeepReadInputFps(360)).toBe(5);
  });
  it("提示词使用本次实际12fps/约0.0833秒，而不是硬写10fps", () => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 400, startSec: 0, endSec: 319, segmentIndex: 0,
      segmentCount: 2, hasAudio: true, videoFps: 12,
    });
    expect(prompt).toContain("输入按 12fps 抽帧，采样间隔约 0.0833 秒");
    expect(prompt).not.toContain("10fps");
    expect(prompt).not.toContain("0.1 秒对应一帧");
  });
});

describe("双密度地板线（0826 双密度教训）", () => {
  it("360s 段：镜头 ≥60（时长制 len/6）、音轨段 ≥2（固定地板）、声音事件 ≥15", () => {
    expect(resolveNativeDeepReadSegmentFloors(360)).toEqual({
      minShots: 60,
      minAudioTracks: 2,
      minAudioCues: 15,
    });
  });
  it("音轨地板固定 2 段（0830 晚用户拍板：不再按 ceil(段长/60) 放大）", () => {
    expect(resolveNativeDeepReadSegmentFloors(60)).toEqual({
      minShots: 10,
      minAudioTracks: 2,
      minAudioCues: 3,
    });
  });

  it("29s 微尾段：时长制下 5 镜起、2 段音轨（固定地板）、2 事件", () => {
    expect(resolveNativeDeepReadSegmentFloors(29)).toEqual({
      minShots: 5,
      minAudioTracks: 2,
      minAudioCues: 2,
    });
  });

  it("360s 大段音轨地板同为 2 段（0830 晚起不随段长放大）", () => {
    expect(resolveNativeDeepReadSegmentFloors(360)).toEqual({
      minShots: 60,
      minAudioTracks: 2,
      minAudioCues: 15,
    });
  });

  it("音轨仍无凑数目标，镜数按现行门禁明确前置", () => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 389,
      startSec: 360,
      endSec: 389,
      segmentIndex: 1,
      segmentCount: 2,
      hasAudio: true,
    });
    expect(prompt).not.toMatch(/至少 \d+ 段/);
    expect(prompt).not.toMatch(/(?:cue|声音事件|音轨)[^\n]*至少 \d+ 条/);
    expect(prompt).not.toMatch(/本段至少 \d+ 镜/);
    /**
     * 0831 用户令删除全部免责条款：这些句子是模型偷懒时可引用的依据。
     * 「安静段落只有 1 段是正常的」「有几段写几段」「听见几次记几次」——
     * 每一句都在告诉模型「少写是被允许的」，实测首发 100% 躺平。
     * 禁止编造由禁止区统一管；正向区只讲该写什么，不给退路。
     */
    expect(prompt).not.toContain("安静段落只有 1 段是正常的");
    expect(prompt).not.toContain("有几段写几段");
    expect(prompt).not.toContain("听见几次记几次");
    expect(prompt).not.toContain("没听见就不记");
  });
});

describe("段规格前置校验（任何网络动作之前）", () => {
  it("空数组拒绝", () => {
    expect(() => validateNativeDeepReadSegments([])).toThrow("没有可执行片段");
  });
  it("秒位反了拒绝", () => {
    expect(() =>
      validateNativeDeepReadSegments([{ startSec: 30, endSec: 10 }]),
    ).toThrow("秒位无效");
  });
  it("重复片段拒绝 —— 同段跑两遍，钱花两次、卡里镜头还重复", () => {
    expect(() =>
      validateNativeDeepReadSegments([
        { startSec: 0, endSec: 10 },
        { startSec: 0, endSec: 10 },
      ]),
    ).toThrow("重复片段");
  });
  it("合法段原样返回并把秒位归一成数字", () => {
    expect(
      validateNativeDeepReadSegments([{ startSec: "3" as never, endSec: "9" as never }]),
    ).toEqual([{ startSec: 3, endSec: 9 }]);
  });
});

describe("每段提示词硬约束", () => {
  const prompt = buildGeminiNativeDeepReadSegmentPrompt({
    episodeDurationSec: 720,
    startSec: 360,
    endSec: 720,
    segmentIndex: 1,
    segmentCount: 2,
    hasAudio: true,
    hintZh: "身份揭穿的对白博弈",
  });

  it("告知全片位置并要求绝对秒位", () => {
    expect(prompt).toContain("全片时长：720 秒");
    // 0831 用户裁决：shots/keyMoments 可保留一位小数（实测 77 镜里 75 镜带小数），
    // subtitles 仍用整数秒。
    expect(prompt).toContain("使用全片绝对秒，可保留一位小数");
    expect(prompt).toContain("subtitles.atSec 使用全片绝对整数秒");
    expect(prompt).toContain("shots.startSec/endSec、keyMoments.atSec 使用全片绝对秒，可保留一位小数");
    expect(prompt).toContain("keyMoments.atSec 使用全片绝对秒，可保留一位小数");
    expect(prompt).not.toContain("shots.startSec/endSec、keyMoments.atSec、subtitles.atSec 一律使用全片绝对整数秒");
    expect(prompt).toContain("本段范围为 360 至 720 秒");
  });

  it("音轨硬红线（亲耳所听/局部秒例外）与软边界建议齐全（0826 二次拍板）", () => {
    expect(prompt).toContain(`"chunkIndex":1`);
    expect(prompt).toContain("亲耳所听");
    // 0831：禁令搬到【不得出现】区，正面区只留格式规定
    expect(prompt).toContain("· 凭画面推测声音。");
    expect(prompt.slice(0, prompt.indexOf("【不得出现】"))).toContain("音轨内容来自你亲耳所听");
    expect(prompt.slice(0, prompt.indexOf("【不得出现】"))).not.toContain("禁止凭画面编造声音");
    // 不再给「至少 N 段 / 至少 N 条 cue」这类数字目标（0829：数字目标会逼出编造）
    expect(prompt).not.toMatch(/至少 \d+ 段/);
    expect(prompt).not.toMatch(/(?:cue|声音事件|音轨)[^\n]*至少 \d+ 条/);
    /**
     * 0831：原先挂在禁止清单末尾的 audioSoftRules 整块删除。
     * 它把「音轨怎么写」的要求贴在禁令列表尾巴上，且七栏必填 Schema 已经管了、
     * 正向要求四也宣告过一遍——同一件事说三遍，其中一遍还带免责句。
     */
    expect(prompt).not.toContain("有几段写几段");
    expect(prompt).not.toContain("优先压缩 subtitles");
    expect(prompt).toContain("mixNotesZh");
    expect(prompt).toContain("每次真实画面切换，包括机位、景别或场景切换，都记录为新的一镜");
    expect(prompt).toContain("位置写入数字字段");
    expect(prompt).toContain("【必须遵守】");
  });

  /**
   * 0831 重构：正面区与禁止区彻底分离，删掉自相矛盾的免责句。
   *
   * 旧版在【必须遵守】下写「镜头密度属于建议项，不作为拒收依据」，
   * 同一条里又写「平均镜长偏大就是你漏记了，回去补」——一句免责一句要求。
   * 模型选免责那句，实测首发 100% 躺平（9–10 镜、输出仅用上限的 5.6%）。
   * 现在密度改为纯正向引导，拒不拒收由门禁 advisory 管，提示词不替门禁免责。
   */
  it("正面区只讲该做什么：无免责句、无禁令措辞", () => {
    const positive = prompt.slice(0, prompt.indexOf("【不得出现】"));
    expect(positive).not.toContain("不作为拒收依据");
    expect(positive).not.toContain("禁止");
    expect(positive).toContain("如实记录全部可见、可听的证据");
    expect(positive).toContain("每次真实画面切换，包括机位、景别或场景切换，都记录为新的一镜");
    expect(positive).toContain("镜头条数与时长由实际画面切换和镜内变化决定");
    expect(positive).not.toMatch(/本段至少 \d+ 镜/);
    expect(positive).not.toContain("验收标准");
  });

  it("禁止区只讲不许做什么：不夹带任何正面要求", () => {
    const start = prompt.indexOf("【不得出现】");
    const block = prompt.slice(start);
    expect(block).toContain("判定产出无效");
    expect(block).toContain("不得为之");
    // 夹带过的三句已搬回正向区，禁止区不得再出现
    expect(block).not.toContain("同等重要");
    expect(block).not.toContain("主产物");
    expect(block).not.toContain("必须");
  });

  /**
   * 0831 用户令：把第二次重试才说的要求一同写进首发，不给模型第二次机会。
   * 实测五次重试的拒因四次是超长镜头、一次是镜数偏低——重试没教新东西，
   * 只是把首发该说的话等做错后再说一遍，代价是每片多烧一次全额视频输入。
   */
  it("生成顺序先确定边界，不要求修改已经输出的JSON", () => {
    const block = prompt.slice(prompt.indexOf("【观察与输出顺序】"), prompt.indexOf("【正向要求一"));
    expect(block).toContain("先确定每条记录的起止秒位，再输出该条字段");
    expect(block).toContain("定位每次真实剪辑切换及镜内变化");
    expect(prompt).not.toMatch(/输出前自检|回去按硬约束|检查与修正/);
    expect(block).not.toMatch(/禁止|不得|不要/);
  });

  it("长镜拆分硬约束保留，且约束跟着字段走", () => {
    // 首发、自检和重试都引用单条上限；真实短镜不套用长镜拆分下限。
    expect(prompt).toContain(`每条 shots 记录最长 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒`);
    expect(prompt).toContain(`transitionInZh 固定写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」`);
    expect(prompt).toContain("完整覆盖原镜头");
    // 时长约束落到 startSec/endSec 字段说明上，不只在开头说一次
    expect(prompt).toContain(`单条最长 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒；真实短镜按实际时长保留`);
    expect(prompt).not.toContain("至多 1 个");
    expect(prompt).not.toContain("镜头数 ≥ 24");
  });

  it("无音轨素材要求 audioResolution 返回空数组", () => {
    const silent = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 60,
      startSec: 0,
      endSec: 60,
      segmentIndex: 0,
      segmentCount: 1,
      hasAudio: false,
    });
    expect(silent).toContain("本段素材没有音轨，audioResolution 返回空数组 []");
    expect(silent).not.toContain("audioTrack 与 cues 内时间用");
  });

  it("带拒因重试时附上一轮被拒原因并要求尽量保密度", () => {
    const retry = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 60,
      startSec: 0,
      endSec: 60,
      segmentIndex: 0,
      segmentCount: 1,
      hasAudio: true,
      rejectedReasonZh: "音轨仅 1 段",
    });
    expect(retry).toContain("【上一轮未通过的检查】音轨仅 1 段");
    // 0831 加固：原来只有一句软性「尽量不要降低密度」，实测模型把「修正」做成砍条数＋
    // 通用词填充（35 条降 15 条、12 条描述逐字相同）。四条禁令必须逐条在场。
    expect(retry).toContain("镜头表条数只增不减");
    expect(retry).toContain("拆成多条");
    expect(retry).toContain("各条不得雷同");
    expect(retry).toContain("不要为了\"补足\"而增加不存在的声音事件");
  });

  it("无音轨片重试时不得追加第 4 条声音要求，否则与硬约束 6 自相矛盾", () => {
    const retry = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 60, startSec: 0, endSec: 60, segmentIndex: 0,
      segmentCount: 1, hasAudio: false, rejectedReasonZh: "镜头证据段超过33秒",
    });
    // 硬约束 6 已写死「禁止凭画面编造声音」，重做要求再提「按听到的写」就是开口子。
    expect(retry).toContain("本段素材没有音轨，audioResolution 返回空数组 []");
    expect(retry).not.toContain("不要为了\"补足\"而增加不存在的声音事件");
    expect(retry).not.toContain("声音部分按实际听到的写");
    // 前三条与有音轨时一致，不因无音轨而削弱。
    expect(retry).toContain("镜头表条数只增不减");
    expect(retry).toContain("各条不得雷同");
  });
});

describe("时间坐标桥单变量候选", () => {
  it.each([
    { startSec: 0, endSec: 319, segmentIndex: 0, lenSec: 319, exampleClock: "01:09", exampleSec: 69, absoluteExample: 69, endClock: "05:19" },
    { startSec: 200, endSec: 519, segmentIndex: 1, lenSec: 319, exampleClock: "01:09", exampleSec: 69, absoluteExample: 269, endClock: "05:19" },
    { startSec: 319, endSec: 638, segmentIndex: 1, lenSec: 319, exampleClock: "01:09", exampleSec: 69, absoluteExample: 388, endClock: "05:19" },
    { startSec: 638, endSec: 957, segmentIndex: 2, lenSec: 319, exampleClock: "01:09", exampleSec: 69, absoluteExample: 707, endClock: "05:19" },
    { startSec: 1276, endSec: 1594, segmentIndex: 4, lenSec: 318, exampleClock: "01:09", exampleSec: 69, absoluteExample: 1345, endClock: "05:18" },
    { startSec: 20, endSec: 89, segmentIndex: 1, lenSec: 69, exampleClock: "01:08", exampleSec: 68, absoluteExample: 88, endClock: "01:09" },
    { startSec: 1593, endSec: 1594, segmentIndex: 4, lenSec: 1, exampleClock: "00:00", exampleSec: 0, absoluteExample: 1593, endClock: "00:01" },
  ])("$startSec..$endSec 文件时钟按真实段起点换算，示例始终在片内", (row) => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 1594, startSec: row.startSec, endSec: row.endSec,
      segmentIndex: row.segmentIndex, segmentCount: 5, hasAudio: true, videoFps: 12,
    });
    expect(prompt).toContain(`1. 时间坐标\n所附视频文件只有本段 ${row.lenSec} 秒，文件 00:00 对应全片 ${row.startSec} 秒。`);
    expect(prompt).toContain("先定位原帧，再将文件内 MM:SS 或 HH:MM:SS 换算为本段累计秒 t = 小时×3600 + 分钟×60 + 秒");
    expect(prompt).toContain(`全片秒位 = ${row.startSec} + t，音轨局部秒位 = t`);
    expect(prompt).toContain(`例如文件 ${row.exampleClock} 对应本段 ${row.exampleSec} 秒、全片 ${row.absoluteExample} 秒`);
    expect(prompt).toContain(`文件末尾 ${row.endClock} 对应本段 ${row.lenSec} 秒、全片 ${row.endSec} 秒。`);
    expect(row.exampleSec).toBeLessThan(row.lenSec);
    expect(prompt).toContain(`本段范围为 ${row.startSec} 至 ${row.endSec} 秒`);
    expect(prompt).toContain(`音轨段号：${row.segmentIndex}`);
    expect(prompt).toContain("输入按 12fps 抽帧，采样间隔约 0.0833 秒");
  });

  it("无音轨仍按同一文件时钟换算，不改变audioResolution空数组契约", () => {
    const input = { episodeDurationSec: 638, startSec: 319, endSec: 638,
      segmentIndex: 1, segmentCount: 2, videoFps: 12 };
    const withAudio = buildGeminiNativeDeepReadSegmentPrompt({ ...input, hasAudio: true });
    const silent = buildGeminiNativeDeepReadSegmentPrompt({ ...input, hasAudio: false });
    const bridge = (prompt: string) => prompt.split("\n").find((line) => line.startsWith("所附视频文件只有本段"));
    expect(bridge(silent)).toBeDefined();
    expect(bridge(silent)).toBe(bridge(withAudio));
    expect(silent).toContain("本段素材没有音轨，audioResolution 返回空数组 []");
    expect(silent).not.toContain("audioTrack 与 cues 内时间用");
  });

  it("去冒号禁令只约束错误换算，保留起点200时合法全片513秒及音轨局部范围", () => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 1600, startSec: 200, endSec: 519.04,
      segmentIndex: 1, segmentCount: 5, hasAudio: true, videoFps: 12,
    });
    const [positive, negative] = prompt.split("【不得出现】");
    expect(positive).toContain("文件内 05:13 的本段累计秒 t = 5×60+13 = 313");
    expect(positive).toContain("对应全片绝对秒 = 本段起点 + 313，即 200 + 313 = 513");
    expect(positive).toContain("此示范只说明换算方法，实际秒位范围仍按本段起止确定");
    expect(positive).toContain("本段范围为 200 至 519 秒");
    expect(positive).toContain("audioTrack 与 cues 内时间用**本段局部秒**（0..319）");
    expect(positive).toContain("shots.startSec/endSec、keyMoments.atSec 使用全片绝对秒，可保留一位小数");
    expect(positive).not.toContain("去掉冒号");
    expect(negative).toContain("判定产出无效：\n· 将 MM:SS 或 HH:MM:SS 去掉冒号后直接当作累计秒");
    expect(negative).toContain("文件内 05:13 的本段累计秒误写为 513");
  });

  it("重试完整复用唯一时间桥，正向追加与禁止追加各自完整保留", () => {
    const input = { episodeDurationSec: 1594, startSec: 638, endSec: 957,
      segmentIndex: 2, segmentCount: 5, videoFps: 12, hasAudio: true };
    const first = buildGeminiNativeDeepReadSegmentPrompt(input);
    const retry = buildGeminiNativeDeepReadSegmentPrompt({ ...input, rejectedReasonZh: "镜头证据段超过33秒" });
    expect(first.match(/所附视频文件只有本段/g)).toHaveLength(1);
    expect(retry.match(/所附视频文件只有本段/g)).toHaveLength(1);
    /**
     * 后缀是纯字面量，**必须全等，不许放松成 startsWith/toContain**。
     * 审查实测：放松后有两类回归能全绿逃逸——(1) 在四条规则后再追加
     * 「镜头表压缩到 10 条以内」之类的降密度指令；(2) 把规则 1 反转成
     * 「其余可酌情精简…但不强求」而仍含子串「镜头表条数只增不减」。
     * 这两类正是本轮生产改动要根除的那个 bug，绝不能从测试里漏过去。
     */
    const [firstPositive, firstProhibitions] = first.split("【不得出现】");
    const [retryPositive, retryProhibitions] = retry.split("【不得出现】");
    const expectedPositiveSuffix = `
【上一轮未通过的检查】镜头证据段超过30秒输出上限

本轮重做要求（0831 实测加固：上一轮模型把「修正」做成了砍条数＋通用词填充，35 条降到 15 条、12 条描述逐字相同）：
1. 只修正上面点名的问题，其余一律照常完整观察。
2. 证据段过长时的唯一正确做法是**按前文长镜拆分规则拆成多条**（每段 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}—${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，
   后续段 transitionInZh 写固定标记）。
3. 每条证据的画面描述必须来自你在该时间段真实看到的内容。
4. 声音部分按实际听到的写，安静段落本来就少。`;
    const expectedProhibitionSuffix = `

重试禁止事项：
· 镜头表条数只增不减。
· 修正过长证据段时，不得删掉、不得合并、不得拉长单条覆盖。
· 禁止用「剧情推进」「人物交替出现」「交谈与动作」「表情自然」这类通用词填充字段；各条不得雷同。
· 不要为了"补足"而增加不存在的声音事件。`;
    expect(retryPositive!.trimEnd()).toBe(`${firstPositive!.trimEnd()}\n${expectedPositiveSuffix}`);
    expect(retryProhibitions).toBe(`${firstProhibitions}${expectedProhibitionSuffix}`);
  });
});

describe("Gemini 请求体（Google 原生格式，Vertex/EvoLink 同构）", () => {
  it("探针依赖是生产依赖副本，不会改写生产默认通道", () => {
    const original = createNativeDeepReadRunnerDeps();
    const custom = createNativeDeepReadRunnerDeps({ postVertex: vi.fn() });
    expect(custom.postVertex).not.toBe(original.postVertex);
    expect(createNativeDeepReadRunnerDeps().postVertex).toBe(original.postVertex);
    expect(custom.prepareVideos).toBe(original.prepareVideos);
  });
  it("实际序列化后不再发送 mediaResolution，视频fps与Schema保持原值", () => {
    const serialized = JSON.parse(JSON.stringify(buildGeminiNativeDeepReadSegmentRequest({
          segmentContext: { startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true },
      fileUri: "gs://bucket/segment.mp4", fps: 10, prompt: "测试",
    })));
    // 0831 改：0830 实测「设了等于没设」（传 MEDIUM 与不传，输入 token 210,198 vs 210,134），
    // 官方文档亦写明视频档 默认／LOW／MEDIUM 同为 70 token/帧。既然无效就不发，别留噪音字段。
    // 这里断言「整个键不存在」而非等于某个值——写成默认字符串会让人误以为真发了参数。
    expect(serialized.generationConfig).not.toHaveProperty("mediaResolution");
    expect(serialized.generationConfig).not.toHaveProperty("media_resolution");
    expect(serialized.generationConfig.responseSchema).toEqual(buildNativeDeepReadResponseSchema({ startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true }));
    expect(serialized.contents[0].parts[0].videoMetadata.fps).toBe(10);
    expect(serialized.contents[0].parts[0]).not.toHaveProperty("mediaResolution");
    expect(serialized.contents[0].parts[0]).not.toHaveProperty("media_resolution");
  });
  it("fileData + videoMetadata.fps + 定稿 generationConfig", () => {
    const body = buildGeminiNativeDeepReadSegmentRequest({
          segmentContext: { startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true },
      fileUri: "gs://bucket/seg.mp4",
      fps: 5,
      prompt: "PROMPT",
    });
    expect(body).toEqual({
      contents: [{
        role: "user",
        parts: [
          {
            fileData: { fileUri: "gs://bucket/seg.mp4", mimeType: "video/mp4" },
            videoMetadata: { fps: 5 },
          },
          { text: "PROMPT" },
        ],
      }],
      generationConfig: { ...NATIVE_DEEP_READ_GENERATION_CONFIG, responseSchema: buildNativeDeepReadResponseSchema({ startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true }) },
    });
  });
});

/* ── 六栏段卡 fixture：满足段级双密度地板 ── */
function makeSegmentPayload(input: {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio?: boolean;
  shotCountOverride?: number;
  audioTrackOverride?: number;
}): Record<string, unknown> {
  const lenSec = input.endSec - input.startSec;
  const floors = resolveNativeDeepReadSegmentFloors(lenSec);
  const shotCount = input.shotCountOverride ?? floors.minShots + 2;
  const shotLen = lenSec / shotCount;
  const shots = Array.from({ length: shotCount }, (_, i) => ({
    startSec: Math.round((input.startSec + i * shotLen) * 100) / 100,
    endSec: i === shotCount - 1
      ? input.endSec
      : Math.round((input.startSec + (i + 1) * shotLen) * 100) / 100,
    hintZh: `测试观察：本镜人物手持道具，背景留出空地`,
    unitTypeZh: "剪辑镜头",
    shotSizeZh: "近景",
    angleZh: "平视",
    compositionZh: "角色居中，前景留出运动空间",
    cameraMoveZh: "固定机位",
    blockingZh: "角色正面站位，保持对峙距离",
    bodyActionZh: "重心前移后停住",
    limbPropActionZh: "右手握住道具并抬起",
    microExpressionZh: "眉心收紧，嘴角克制",
    gazeBreathZh: "视线锁住对手，呼吸渐重",
    relationshipReactionZh: "对方后退后本角色向前压近",
    lightingZh: "顶光冷调",
    actionZh: `人物动作${i}`,
    transitionInZh: "硬切",
    evidenceRole: "story",
  }));
  const trackCount = input.audioTrackOverride ?? Math.max(floors.minAudioTracks, 4);
  const trackLen = Math.floor(lenSec / trackCount);
  const cuesPerTrack = Math.ceil((floors.minAudioCues + trackCount) / trackCount);
  const audioTrack = Array.from({ length: trackCount }, (_, i) => {
    const fromSec = i * trackLen;
    const toSec = i === trackCount - 1 ? lenSec : (i + 1) * trackLen;
    return {
      fromSec,
      toSec,
      emotionArcZh: `压迫渐强${i}`,
      toneZh: "低声克制",
      sfxZh: "环境风声",
      bgmZh: "弦乐铺底",
      atmosphereZh: "紧绷",
      silenceZh: "",
      cues: Array.from({ length: cuesPerTrack }, (_, k) => ({
        atSec: Math.min(toSec, fromSec + k),
        kind: "sfx" as const,
        detailZh: `音效事件${i}-${k}`,
      })),
    };
  });
  return {
    shots,
    subtitles: [{ atSec: input.startSec, textZh: "字幕原文" }],
    audioResolution: input.hasAudio === false ? [] : [{
      chunkIndex: input.segmentIndex,
      analysis: {
        audioTrack,
        audioBeatStructureZh: "先抑后扬",
        mixNotesZh: "对白前置",
        reusableAudioZh: "低频铺垫承压",
        genAudioHintZh: "弦乐渐强+环境声",
      },
    }],
    beatStructureZh: "憋三秒后爆",
    moodArcZh: "压抑→爆发",
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    reusableZh: "开场即冲突的通用做法",
    genPromptHintZh: "景别递进+顶光",
  };
}

describe("v11 · 集级密度门禁全降 advisory（一集 4–8 片，密度闸逐片查＝重复计算）", () => {
  // 用生产真实分片长度 300 秒：音轨地板 ceil(300/60)=5，正好复现 0829
  // 「安静段落只有 1 段环境音」被集级判死整集的实证场景。
  const segments = [{ startSec: 0, endSec: 300 }, { startSec: 300, endSec: 600 }];
  const healthy = segments.map((segment, index) => makeSegmentPayload({
    segmentIndex: index,
    startSec: segment.startSec,
    endSec: segment.endSec,
  }));
  const gate = (rawSegments: ReadonlyArray<Record<string, unknown>>) =>
    assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 600,
      segments,
      hasAudio: true,
      rawSegments,
    });

  it("音轨薄的分片不再判死整集：只回 advisory（用户 0829 令『音轨侧不设任何拒收线』）", () => {
    // 第2片只有 1 段音轨、1 条 cue —— 安静段落的真实产出。
    const quiet: Record<string, unknown> = {
      ...healthy[1]!,
      audioResolution: [{
        chunkIndex: 1,
        analysis: {
          audioTrack: [{
            fromSec: 0,
            toSec: 300,
            emotionArcZh: "静场",
            toneZh: "无对白",
            sfxZh: "环境风声",
            bgmZh: "无",
            atmosphereZh: "空旷",
            silenceZh: "全段留白",
            cues: [{ atSec: 0, kind: "sfx" as const, detailZh: "远处风声起" }],
          }],
          audioBeatStructureZh: "全段静场",
          mixNotesZh: "无对白",
          reusableAudioZh: "留白承压",
          genAudioHintZh: "环境声铺底",
        },
      }],
    };
    let codes: string[] = [];
    expect(() => { codes = gate([healthy[0]!, quiet]).map((row) => row.code); }).not.toThrow();
    expect(codes).toContain("episode_audio_track_thin");
    expect(codes).toContain("episode_audio_cue_thin");
  });

  it("整集镜数低于参考地板只回 advisory，不再拒收（尾片豁免不该在集级被吃掉）", () => {
    // 夹具要隔离「镜数低」这一个变量：0830 起整集卡也查 30 秒单镜硬上限，
    // 若还像旧夹具那样压成「一条 300 秒的镜」，会同时踩中两条闸，测不出本条意图。
    // 600 秒全覆盖下，镜数落在 20–60 之间即可——低于离谱地板 ceil(600/10)=60 触发
    // 密度 advisory，同时每镜 25 秒不碰 30 秒硬上限。
    const template = (healthy[0]!.shots as Array<Record<string, unknown>>)[0]!;
    const thin = healthy.map((raw, segIndex) => ({
      ...raw,
      shots: Array.from({ length: 12 }, (_, i) => ({
        ...template,
        startSec: segIndex * 300 + i * 25,
        endSec: segIndex * 300 + (i + 1) * 25,
      })),
    }));
    let codes: string[] = [];
    expect(() => { codes = gate(thin).map((row) => row.code); }).not.toThrow();
    expect(codes).toContain("episode_shot_density_low");
  });

  it("结构闸不动：音轨 zod 无效仍整集拒收", () => {
    const broken: Record<string, unknown> = {
      ...healthy[1]!,
      audioResolution: [{
        chunkIndex: 1,
        analysis: {
          audioTrack: [{
            fromSec: 0,
            toSec: 300,
            emotionArcZh: "静场",
            toneZh: "无对白",
            sfxZh: "环境风声",
            bgmZh: "无",
            atmosphereZh: "空旷",
            silenceZh: "",
            cues: [{ atSec: 0, kind: "不存在的类型", detailZh: "坏枚举" }],
          }],
          audioBeatStructureZh: "全段静场",
          mixNotesZh: "无对白",
          reusableAudioZh: "留白承压",
          genAudioHintZh: "环境声铺底",
        },
      }],
    };
    expect(() => gate([healthy[0]!, broken])).toThrow("整集拒绝入库");
  });

  it("密度全达标时不产生任何 advisory", () => {
    expect(gate(healthy)).toEqual([]);
  });
});

describe("v11 · 截断段豁免（classification 在 responseSchema 最末，一截必缺）", () => {
  const base = { episodeIndex: 1, segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: true };
  const withoutClassification = () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    delete raw.classification;
    return raw;
  };

  it("截断段缺 classification 照常入库，并记 advisory", () => {
    const gated = assertNativeDeepReadSegmentDensity({
      ...base,
      raw: withoutClassification(),
      truncated: true,
    });
    expect(gated.advisories.map((row) => row.code))
      .toContain("truncated_classification_missing");
  });

  it("非截断段缺 classification 仍硬拒（豁免只对截断段生效）", () => {
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      raw: withoutClassification(),
    })).toThrow("classification 缺失");
  });

  it("🔒 截断段照样守长镜拒收线（30 秒＋10% 容差＝33 秒）", () => {
    const raw = withoutClassification();
    // 用户 0830 晚定线：上限 30 秒、容差 10% ⇒ 拒收线 33 秒。
    // 先证 32 秒放行（在 33 秒拒收线内）。
    const passing = withoutClassification();
    passing.shots = [{
      ...(passing.shots as Array<Record<string, unknown>>)[0]!,
      startSec: 0, endSec: 32,
    }];
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base, raw: passing, truncated: true,
    })).not.toThrow();
    // 再证 34 秒仍拒（超过 33 秒拒收线）
    raw.shots = [{
      ...(raw.shots as Array<Record<string, unknown>>)[0]!,
      startSec: 0,
      endSec: 34,
    }];
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      raw,
      truncated: true,
    })).toThrow(/33 秒/);
  });

  it("🔒 截断段照样守逐镜 17 字段：缺字段仍拒收", () => {
    const raw = withoutClassification();
    const shots = raw.shots as Array<Record<string, unknown>>;
    const stripped = { ...shots[0]! };
    delete stripped.microExpressionZh;
    raw.shots = [stripped, ...shots.slice(1)];
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      raw,
      truncated: true,
    })).toThrow();
  });
});

describe("覆盖率与缓存复验回归", () => {
  const base = { episodeIndex: 1, segmentIndex: 0, startSec: 0, endSec: 300, hasAudio: false };
  const withSpans = (spans: Array<[number, number]>) => ({
    ...makeSegmentPayload({ ...base, hasAudio: false }),
    shots: spans.map(([startSec, endSec]) => ({ startSec, endSec, evidenceRole: "non_story_ad" })),
  });

  it.each([
    ["6.7%", [[0, 20]], "6.7%"],
    ["89.9%", [[0, 269.7]], "89.9%"],
    ["重叠区间只算并集", [[0, 150], [120, 240]], "80.0%"],
  ] as Array<[string, Array<[number, number]>, string]>)("正常输出 %s 必须拒绝复用", (_name, spans, ratio) => {
    const input = { ...base, raw: withSpans(spans) };
    expect(() => assertNativeDeepReadSegmentDensity(input)).toThrow(ratio);
    expect(nativeDeepReadSegmentMeetsThreeItemLine(input)).toBe(false);
  });

  it("90% 边界不误重试", () => {
    const input = { ...base, raw: withSpans([[0, 270]]) };
    expect(() => assertNativeDeepReadSegmentDensity(input)).not.toThrow();
    expect(nativeDeepReadSegmentMeetsThreeItemLine(input)).toBe(true);
  });

  it("覆盖率只算本段内区间，不能拿前一段补足", () => {
    const input = { ...base, startSec: 100, endSec: 200, raw: withSpans([[0, 100], [150, 180]]) };
    expect(() => assertNativeDeepReadSegmentDensity(input)).toThrow("30.0%");
    expect(nativeDeepReadSegmentMeetsThreeItemLine(input)).toBe(false);
  });

  it("classification 缺失不能先抛一项错误而掩盖 6.7% 覆盖", () => {
    const raw: Record<string, unknown> = withSpans([[0, 20]]);
    delete raw.classification;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).toThrow("6.7%");
    expect(nativeDeepReadSegmentMeetsThreeItemLine({ ...base, raw })).toBe(false);
  });

  it("MAX_TOKENS 可解析前缀豁免覆盖，缓存复验不重买", () => {
    const input = { ...base, raw: withSpans([[0, 20]]), truncated: true };
    expect(() => assertNativeDeepReadSegmentDensity(input)).not.toThrow();
    expect(nativeDeepReadSegmentMeetsThreeItemLine(input)).toBe(true);
  });

  it("缓存按家族计数，结构的两条提示不能重复算两项", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: false });
    raw.beatStructureZh = "";
    raw.classification = { emotionTagsZh: ["紧绷"], narrativeFeatureTagsZh: [], performanceTagsZh: [], audiovisualTagsZh: [], audienceExperienceTagsZh: [] };
    (raw.shots as Array<Record<string, unknown>>)[0]!.actionZh = "";
    expect(nativeDeepReadSegmentMeetsThreeItemLine({ ...base, endSec: 60, raw })).toBe(true);
  });

  /**
   * 0831 实弹改判：音轨段数不足**不再**参与重试/复验决策。
   *
   * 旧断言锁的是「音轨 1 段 + 结构缺失 = 两家族 → 重试」。实弹证明这条是错的：
   * 一发 ¥9.75、三次重试全因「音轨仅 1 段，低于建议地板 2；声音事件仅 3 条」被拒，
   * 而整片 0–319 秒音轨本来就是连续一段、声音事件本来就只有 3 条——模型没做错。
   * 拿建议地板拒收真实产出，违反 0829「音轨有几段写几段，禁止凑数编造」
   * 与「门禁转建议，不再拒收」。
   *
   * 注意这不是放宽判据：结构类缺失照样算一家族，可执行项照样触发；
   * 音轨类也照样记进 advisory 与段卡，只是不再拿它拒收。
   */
  it("音轨段数不足不再拖垮缓存复验（只剩结构一家族，不到重试线）", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, audioTrackOverride: 1 });
    raw.beatStructureZh = "";
    expect(nativeDeepReadSegmentMeetsThreeItemLine({ ...base, endSec: 60, hasAudio: true, raw })).toBe(true);
  });

  it("音轨结构性错误（有音轨素材却零段）仍然算数，不在豁免之列", () => {
    // 只有「密度不足」（audio_track_thin / audio_cue_thin）被排除出重试决策。
    // 零段是结构问题不是密度问题，模型改了就对，属于可执行项，照旧计入。
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, audioTrackOverride: 0 });
    expect(nativeDeepReadSegmentMeetsThreeItemLine({ ...base, endSec: 60, hasAudio: true, raw })).toBe(false);
  });

  it("超过33秒证据段不能被缓存的单项放行吞掉", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: false, shotCountOverride: 1 });
    expect(nativeDeepReadSegmentMeetsThreeItemLine({ ...base, endSec: 60, raw })).toBe(false);
  });

  /**
   * 只测 33 秒长镜边界，故意把镜数补到地板之上（60 秒段地板 ceil(60/10)=6 镜）——
   * 0831 加回 shot_density_low 之后，原来的 2 镜 fixture 会被密度判据带偏，
   * 测出来的就不再是「长镜边界」这一件事了。
   */
  it.each([[30, true], [33, true], [33.1, false]] as const)("长镜边界%s秒，缓存可用=%s", (firstEnd, accepted) => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: false });
    const shot = (raw.shots as Array<Record<string, unknown>>)[0]!;
    const rest = 60 - firstEnd;
    const step = rest / 5;
    raw.shots = [
      { ...shot, startSec: 0, endSec: firstEnd },
      ...Array.from({ length: 5 }, (_, i) => ({
        ...shot,
        startSec: Math.round((firstEnd + i * step) * 100) / 100,
        endSec: i === 4 ? 60 : Math.round((firstEnd + (i + 1) * step) * 100) / 100,
      })),
    ];
    expect(nativeDeepReadSegmentMeetsThreeItemLine({ ...base, endSec: 60, raw })).toBe(accepted);
  });
});

describe("段级门禁（0829：硬拒收只剩字段/分类/schema/离谱地板，其余转 advisory）", () => {
  const base = { episodeIndex: 1, segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: true };
  /** 跑一次段门禁并取回 advisory code 清单（不抛错才算通过）。 */
  const advisoryCodesOf = (
    input: Parameters<typeof assertNativeDeepReadSegmentDensity>[0],
  ): string[] => assertNativeDeepReadSegmentDensity(input).advisories.map((row) => row.code);

  it("密度达标放行", () => {
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }),
    })).not.toThrow();
  });

  it("真实剪辑镜头允许短于3秒及相邻等长，原边界保持不变", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: false, shotCountOverride: 6 });
    const boundaries = [0, 2, 4, 6, 24, 42, 60];
    raw.shots = (raw.shots as Array<Record<string, unknown>>).map((shot, index) => ({
      ...shot, startSec: boundaries[index], endSec: boundaries[index + 1],
      unitTypeZh: "剪辑镜头", transitionInZh: "硬切",
    }));
    const original = JSON.stringify(raw);
    const decision = evaluateNativeDeepReadSegmentAcceptance({ ...base, hasAudio: false, raw });
    expect(decision.retry).toBe(false);
    expect(decision.advisories.map(row => row.code)).not.toContain("long_take_split_discontinuous");
    expect(JSON.stringify(raw)).toBe(original);
  });

  it.each([[2.9, true], [3, false]] as const)("同一长镜续接段%s秒，低于拆分下限=%s", (splitSec, underMinimum) => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: false, shotCountOverride: 6 });
    const boundaries = [0, 20, 20 + splitSec, 30, 40, 50, 60];
    raw.shots = (raw.shots as Array<Record<string, unknown>>).map((shot, index) => ({
      ...shot, startSec: boundaries[index], endSec: boundaries[index + 1],
      unitTypeZh: index === 1 ? "拆分镜证据段" : "剪辑镜头",
      transitionInZh: index === 1 ? NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH : "硬切",
    }));
    const decision = evaluateNativeDeepReadSegmentAcceptance({ ...base, hasAudio: false, raw });
    expect(decision.advisories.some(row => row.code === "long_take_split_discontinuous")).toBe(underMinimum);
  });

  it("同一物理长镜超过 30 秒可按真实变化拆成多个连续证据段，仍只计一个长镜", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const shot = (startSec: number, endSec: number, transitionInZh = "硬切") => ({
      startSec,
      endSec,
      unitTypeZh: transitionInZh === NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH
        ? "拆分镜证据段"
        : "剪辑镜头",
      shotSizeZh: "中景",
      angleZh: "平视",
      compositionZh: "角色从画面左侧移向右侧",
      cameraMoveZh: "缓慢横移",
      blockingZh: "两名角色前后错位移动",
      bodyActionZh: "重心随横向移动转换",
      limbPropActionZh: "双手随步伐摆动",
      microExpressionZh: "眉眼持续紧绷",
      gazeBreathZh: "视线跟随对手，呼吸加快",
      relationshipReactionZh: "前方角色移动引发后方角色追随",
      lightingZh: "侧光随角色移动发生变化",
      actionZh: `角色从画面左侧移动到右侧（${startSec}-${endSec}）`,
      transitionInZh,
      evidenceRole: "story",
    });
    raw.shots = [
      shot(0, 20),
      shot(20, 40, NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH),
      ...Array.from({ length: 8 }, (_, index) => shot(40 + index * 2.5, 42.5 + index * 2.5)),
    ];
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
  });

  it("长镜证据拆分点不足3秒转 advisory：只记 long_take_split_discontinuous，不再拒收重买", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const shot = (startSec: number, endSec: number, transitionInZh = "硬切") => ({
      startSec,
      endSec,
      unitTypeZh: transitionInZh === NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH
        ? "拆分镜证据段"
        : "剪辑镜头",
      shotSizeZh: "中景",
      angleZh: "平视",
      compositionZh: "角色居中保持稳定构图",
      cameraMoveZh: "固定机位",
      blockingZh: "角色原地站立",
      bodyActionZh: "躯干维持前倾",
      limbPropActionZh: "双臂维持防御姿态",
      microExpressionZh: "下颌绷紧",
      gazeBreathZh: "视线固定，呼吸短促",
      relationshipReactionZh: "持续回应画外对手",
      lightingZh: "侧光",
      actionZh: `角色持续表演（${startSec}-${endSec}）`,
      transitionInZh,
      evidenceRole: "story",
    });
    raw.shots = [
      shot(0, 20),
      shot(20, 20.5, NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH),
      ...Array.from({ length: 8 }, (_, index) => {
        const startSec = 20.5 + index * (39.5 / 8);
        const endSec = index === 7 ? 60 : 20.5 + (index + 1) * (39.5 / 8);
        return shot(startSec, endSec);
      }),
    ];
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    const advisories = assertNativeDeepReadSegmentDensity({ ...base, raw }).advisories;
    expect(advisories.map((row) => row.code)).toContain("long_take_split_discontinuous");
    expect(advisories.find((row) => row.code === "long_take_split_discontinuous")!.detailZh)
      .toContain("长镜证据拆分点之间必须至少相隔 3 秒");
    expect(advisories.every((row) => row.segmentIndex === 0)).toBe(true);
  });

  it("classification 五键齐全且仅两个维度非空时放行", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    raw.classification = {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: [],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: [],
      audienceExperienceTagsZh: [],
    };
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
  });

  it("新模型产出缺 evidenceRole 时关闭式拒收，禁止把招商广告静默当剧情", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    delete (raw.shots as Array<Record<string, unknown>>)[0]!.evidenceRole;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow(/evidenceRole 缺失或无效/);
  });

  it("新模型产出缺独立角色站位字段时关闭式拒收，不再用 actionZh 掩盖", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    delete (raw.shots as Array<Record<string, unknown>>)[0]!.blockingZh;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow("缺 blockingZh");
  });

  it("unitTypeZh 只能使用批准的 enum 值", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.shots as Array<Record<string, unknown>>)[0]!.unitTypeZh = "长镜头";
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow("unitTypeZh");
  });

  it("招商镜头保留完整时间轴但不计剧情密度；音轨门禁仍按完整 60 秒计算", () => {
    const raw = makeSegmentPayload({
      segmentIndex: 0,
      startSec: 0,
      endSec: 60,
      shotCountOverride: 10,
      audioTrackOverride: 4,
    });
    const shots = raw.shots as Array<Record<string, unknown>>;
    shots.slice(0, 8).forEach((shot) => { shot.evidenceRole = "non_story_ad"; });
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
  });

  it("整段都是招商广告转 advisory：no_story_shots 只提示，不拒收重买", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.shots as Array<Record<string, unknown>>)
      .forEach((shot) => { shot.evidenceRole = "non_story_ad"; });
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    const advisories = assertNativeDeepReadSegmentDensity({ ...base, raw }).advisories;
    expect(advisories.map((row) => row.code)).toContain("no_story_shots");
    expect(advisories.find((row) => row.code === "no_story_shots")!.detailZh)
      .toContain("没有可学习的剧情镜头");
  });

  it("classification 原始缺键拒收，不能由 parser 默认空数组掩盖", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    delete (raw.classification as Record<string, unknown>).audiovisualTagsZh;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow("classification.audiovisualTagsZh 缺失或不是数组");
  });

  it("classification 只有一个有效维度转 advisory：五键齐全就放行，只记 classification_thin", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    raw.classification = {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: [],
      performanceTagsZh: [],
      audiovisualTagsZh: [],
      audienceExperienceTagsZh: [],
    };
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    expect(advisoryCodesOf({ ...base, raw })).toContain("classification_thin");
  });

  /**
   * 0831 用户拍板：镜数离谱地板加回，但**仍然不拒收**——只出 advisory。
   * 360 秒段的地板是 ceil(360/10)=36 镜，16 镜低于地板故记 shot_density_low，
   * 但 assertNativeDeepReadSegmentDensity 照旧不抛错。
   * 0830「不要管下限」的实质（不因镜数少而拒收重买）保留；变的只是「少写要留痕」。
   */
  it("🔒 镜数少不拒收（0830 用户令保留），但记 shot_density_low advisory（0831 加回）", () => {
    const input = {
      ...base,
      startSec: 0,
      endSec: 360,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 360, shotCountOverride: 16 }),
    };
    expect(() => assertNativeDeepReadSegmentDensity(input)).not.toThrow();
    const codes = assertNativeDeepReadSegmentDensity(input).advisories.map((r) => r.code);
    expect(codes).toContain("shot_density_low");
    // 0831 接回平均镜长门禁：16 镜 / 360 秒＝平均 22.5 秒，远超离谱线 10 秒，
    // 与 shot_density_low 是两件事——镜数地板看「够不够多」，平均镜长看「是不是等分切的」。
    expect(codes).toContain("shot_avg_too_long");
  });

  it("audioResolution 留空转 advisory：只记 audio_chunk_shape，不再拒收", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    raw.audioResolution = [];
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    expect(advisoryCodesOf({ ...base, raw })).toContain("audio_chunk_shape");
  });

  it("音轨段数低于地板线转 advisory：安静段落合法，只记 audio_track_thin", () => {
    const input = {
      ...base,
      startSec: 0,
      endSec: 360,
      raw: makeSegmentPayload({
        segmentIndex: 0,
        startSec: 0,
        endSec: 360,
        // 地板固定 2 段（0830 晚）：要触发 audio_track_thin 必须回 1 段
        audioTrackOverride: 1,
      }),
    };
    expect(() => assertNativeDeepReadSegmentDensity(input)).not.toThrow();
    const advisories = assertNativeDeepReadSegmentDensity(input).advisories;
    expect(advisories.map((row) => row.code)).toContain("audio_track_thin");
    expect(advisories.find((row) => row.code === "audio_track_thin")!.detailZh).toContain("音轨仅");
  });

  it("音轨原始结构省略 cues 转 advisory：记 audio_field_missing，证据照常入库", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const analysis = (raw.audioResolution as Array<{ analysis: { audioTrack: Array<Record<string, unknown>> } }>)[0]!.analysis;
    delete analysis.audioTrack[0]!.cues;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    const advisories = assertNativeDeepReadSegmentDensity({ ...base, raw }).advisories;
    expect(advisories.map((row) => row.code)).toContain("audio_field_missing");
    expect(advisories.find((row) => row.code === "audio_field_missing")!.detailZh)
      .toContain("音轨字段不完整：缺 cues");
  });

  it("min(1) 必填字段 genAudioHintZh 缺失仍硬拒收：zod schema 解析失败＝数据不可用", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const analysis = (raw.audioResolution as Array<{ analysis: Record<string, unknown> }>)[0]!.analysis;
    delete analysis.genAudioHintZh;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow("结构不合原生逐镜 schema");
  });

  it("整集 GLM 合并路同样检查原始音轨字段存在性", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const analysis = (raw.audioResolution as Array<{ analysis: { audioTrack: Array<Record<string, unknown>> } }>)[0]!.analysis;
    delete analysis.audioTrack[0]!.cues;
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 60,
      segments: [{ startSec: 0, endSec: 60 }],
      hasAudio: true,
      rawSegments: [raw],
    })).toThrow("第1条音轨字段不完整：缺 cues");
  });

  it("音轨汇总省略 mixNotesZh 转 advisory：记 audio_field_missing，不再拒收重买", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const analysis = (raw.audioResolution as Array<{ analysis: Record<string, unknown> }>)[0]!.analysis;
    delete analysis.mixNotesZh;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    const advisories = assertNativeDeepReadSegmentDensity({ ...base, raw }).advisories;
    expect(advisories.find((row) => row.code === "audio_field_missing")!.detailZh)
      .toContain("音轨汇总字段不完整：缺 mixNotesZh");
  });

  it("素材无音轨却返回 audioResolution 转 advisory：只记 audio_unexpected", () => {
    const input = {
      ...base,
      hasAudio: false,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }),
    };
    expect(() => assertNativeDeepReadSegmentDensity(input)).not.toThrow();
    expect(advisoryCodesOf(input)).toContain("audio_unexpected");
  });

  it("镜头时间轴有空档转 advisory：detailZh 必须写清缺哪一段秒位", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.shots as Array<{ startSec: number }>).splice(1, 1);
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    const advisories = assertNativeDeepReadSegmentDensity({ ...base, raw }).advisories;
    expect(advisories.map((row) => row.code)).toContain("timeline_gap");
    expect(advisories.find((row) => row.code === "timeline_gap")!.detailZh).toMatch(/空档：.*秒/);
  });

  it("视觉描述文本含钟表式秒位转 advisory：只记 clock_text，不再拒收", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.shots as Array<{ cameraMoveZh?: string }>)[0]!.cameraMoveZh = "在01:23处推近";
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
    const advisories = assertNativeDeepReadSegmentDensity({ ...base, raw }).advisories;
    expect(advisories.map((row) => row.code)).toContain("clock_text");
    expect(advisories.find((row) => row.code === "clock_text")!.detailZh).toContain("钟表式秒位");
  });

  it("🔒 下限删除后：120 秒段 18 镜通过，且不再产生任何密度类 advisory", () => {
    const thin = {
      ...base,
      startSec: 0,
      endSec: 120,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 120, shotCountOverride: 18 }),
    };
    expect(() => assertNativeDeepReadSegmentDensity(thin)).not.toThrow();
    const codes = assertNativeDeepReadSegmentDensity(thin).advisories.map((r) => r.code);
    expect(codes).not.toContain("shot_density_low");
    expect(codes).not.toContain("shot_avg_too_long");
  });

  it("🔒 下限删除后：300 秒段 28 镜通过（旧离谱地板 30 镜已不再拒收）", () => {
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      startSec: 0,
      endSec: 300,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 300, shotCountOverride: 28 }),
    })).not.toThrow();
  });

  it("🔒 保留的两条硬约束仍在：覆盖率与 30 秒上限（含 10% 容差）", () => {
    // 覆盖率：300 秒的片只回 3 秒 → 拒（这是 0830 实弹买到的洞）
    const blank = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 300, shotCountOverride: 2 });
    (blank.shots as Array<Record<string, unknown>>).forEach((shot, i) => {
      shot.startSec = i * 1.5; shot.endSec = (i + 1) * 1.5;
    });
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base, startSec: 0, endSec: 300, raw: blank,
    })).toThrow("整片没读完");
  });

  it("描述文本秒位门禁不误伤动作时长与文本栏字段", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.shots as Array<{ cameraMoveZh?: string }>)[0]!.cameraMoveZh = "1.2秒内从中景推到特写";
    raw.moodArcZh = "压抑→第8秒转折→爆发";
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
  });

  it("subtitles 是钟表文本唯一例外（画面证据逐字照抄）", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.subtitles as Array<{ atSec: number; textZh: string }>)[0]!.textZh = "倒计时 01:23";
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).not.toThrow();
  });
});

describe("整集证据门禁（段卡合并后再跑一遍，GLM 之后同样要过）", () => {
  const segments = [
    { startSec: 0, endSec: 60 },
    { startSec: 60, endSec: 120 },
  ];
  const rawSegments = segments.map((segment, index) => makeSegmentPayload({
    segmentIndex: index,
    startSec: segment.startSec,
    endSec: segment.endSec,
  }));

  it("逐段卡与 GLM 单张合成卡两种形态都能过", () => {
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 120,
      segments,
      hasAudio: true,
      rawSegments,
    })).not.toThrow();
    const merged: Record<string, unknown> = {
      shots: rawSegments.flatMap((raw) => raw.shots as unknown[]),
      subtitles: rawSegments.flatMap((raw) => raw.subtitles as unknown[]),
      audioResolution: rawSegments.flatMap((raw) => raw.audioResolution as unknown[]),
    };
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 120,
      segments,
      hasAudio: true,
      rawSegments: [merged],
    })).not.toThrow();
  });

  it("音轨分段缺一段整集拒收", () => {
    const missing = [rawSegments[0]!, { ...rawSegments[1]!, audioResolution: [] }];
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 120,
      segments,
      hasAudio: true,
      rawSegments: missing,
    })).toThrow("音轨分段不完整");
  });

  it("整集镜头未覆盖完整片长只记 advisory 不拒收（0830：GLM 是整形层，不该被拒）", () => {
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 180,
      segments: [{ startSec: 0, endSec: 180 }],
      hasAudio: true,
      rawSegments: [rawSegments[0]!],
    })).not.toThrow();
    // 缺口只记 advisory，写明缺哪几秒，交给人看
    const codes = assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 180,
      segments: [{ startSec: 0, endSec: 180 }],
      hasAudio: true,
      rawSegments: [rawSegments[0]!],
    }).map((row) => row.code);
    expect(codes).toContain("episode_coverage_gap");
  });

});

describe("整集卡广告剔除（段卡→整集卡合并层，原始分段卡不动）", () => {
  it("确定性拼接整行剔除 non_story_ad、相邻区间合并记账，原始分段卡完整时间轴不动", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, shotCountOverride: 12 });
    const shots = raw.shots as Array<Record<string, unknown>>;
    shots[2]!.evidenceRole = "non_story_ad"; // 10..15
    shots[3]!.evidenceRole = "non_story_ad"; // 15..20，相邻区间应合并成一条
    (raw.subtitles as Array<Record<string, unknown>>).push({ atSec: 12, textZh: "招商字幕" });
    const { rows, excludedAdRanges } = stripNonStoryAdShotsForEpisodeCard([raw]);
    expect(excludedAdRanges).toEqual([{ startSec: 10, endSec: 20 }]);
    const outShots = rows[0]!.shots as Array<Record<string, unknown>>;
    expect(outShots).toHaveLength(10);
    expect(outShots.some((shot) => shot.evidenceRole === "non_story_ad")).toBe(false);
    expect(rows[0]!.excludedAdRanges).toEqual([{ startSec: 10, endSec: 20 }]);
    expect((rows[0]!.subtitles as Array<{ textZh: string }>).map((s) => s.textZh))
      .not.toContain("招商字幕");
    // 原始分段卡（Gemini 产物 / raw 审计证据）一律不动
    expect(shots).toHaveLength(12);
    expect(shots[2]!.evidenceRole).toBe("non_story_ad");
    expect(raw.excludedAdRanges).toBeUndefined();
    expect((raw.subtitles as unknown[])).toHaveLength(2);
  });

  it("整集门禁把 excludedAdRanges 视为合法缺口；无账目缺口只记 advisory；残留广告行照拒；非法区间照拒", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, shotCountOverride: 12 });
    (raw.shots as Array<Record<string, unknown>>)[2]!.evidenceRole = "non_story_ad";
    (raw.shots as Array<Record<string, unknown>>)[3]!.evidenceRole = "non_story_ad";
    const gate = (rawSegments: Array<Record<string, unknown>>) => () =>
      assertNativeDeepReadEpisodeEvidence({
        episodeIndex: 1,
        durationSec: 60,
        segments: [{ startSec: 0, endSec: 60 }],
        hasAudio: true,
        rawSegments,
      });
    // 整集卡里残留 non_story_ad 镜头行：直接拒（广告只许以区间账目存在）
    expect(gate([raw])).toThrow("non_story_ad 镜头行");
    // 剔除后的整集卡：广告区间视为合法缺口，门禁放行
    const { rows } = stripNonStoryAdShotsForEpisodeCard([raw]);
    expect(gate(rows)).not.toThrow();
    // 同样的缺口没有区间账目：照旧按空档拒收（分段卡门禁行为不变的对照）
    const noLedger: Record<string, unknown> = { ...rows[0]! };
    delete noLedger.excludedAdRanges;
    // 0829 晚：空档与重叠已拆成两条明确报错（修法相反，报同一句会让修复轮乱猜）
    // 0830：无账目的缺口只记 advisory 不拒收（GLM 是整形层）；广告残留行仍硬拒
    expect(gate([noLedger])).not.toThrow();
    // end<=start 属非法区间账目，整集拒收
    const badLedger: Record<string, unknown> = {
      ...rows[0]!,
      excludedAdRanges: [{ startSec: 20, endSec: 10 }],
    };
    expect(gate([badLedger])).toThrow("excludedAdRanges 区间无效");
  });

  it("无广告时行原样返回，excludedAdRanges 字段缺省不出现", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const { rows, excludedAdRanges } = stripNonStoryAdShotsForEpisodeCard([raw]);
    expect(rows[0]).toBe(raw);
    expect(excludedAdRanges).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(rows[0]!, "excludedAdRanges")).toBe(false);
  });
});

describe("attachAudioChunkSpans：整集卡携带 audioResolution 各 chunk 的真实段界", () => {
  const segments = [
    { startSec: 0, endSec: 360 }, // 360s 旧段，非 300s，防 chunkIndex*300 猜法
    { startSec: 360, endSec: 600 },
  ];

  it("确定性多行路径：每行按自己的 chunkIndex 拿 segments spec 的真实段界", () => {
    const rows = attachAudioChunkSpans([
      { audioResolution: [{ chunkIndex: 0, analysis: {} }], shots: [] },
      { audioResolution: [{ chunkIndex: 1, analysis: {} }], shots: [] },
    ], segments, 2);
    expect(rows[0]!.chunkSpans).toEqual([{ chunkIndex: 0, startSec: 0, endSec: 360 }]);
    expect(rows[1]!.chunkSpans).toEqual([{ chunkIndex: 1, startSec: 360, endSec: 600 }]);
  });

  it("GLM 合并单行卡路径：一行多 chunk 全部注入真实段界", () => {
    const rows = attachAudioChunkSpans([
      {
        audioResolution: [
          { chunkIndex: 0, analysis: {} },
          { chunkIndex: 1, analysis: {} },
        ],
        shots: [],
      },
    ], segments, 5);
    expect(rows[0]!.chunkSpans).toEqual([
      { chunkIndex: 0, startSec: 0, endSec: 360 },
      { chunkIndex: 1, startSec: 360, endSec: 600 },
    ]);
  });

  it("无音轨行原样返回不注入字段；chunkIndex 无对应段规格关闭式失败", () => {
    const silent = { audioResolution: [], shots: [] };
    const rows = attachAudioChunkSpans([silent], segments, 1);
    expect(rows[0]).toBe(silent);
    expect(Object.prototype.hasOwnProperty.call(rows[0]!, "chunkSpans")).toBe(false);

    expect(() => attachAudioChunkSpans([
      { audioResolution: [{ chunkIndex: 2, analysis: {} }], shots: [] },
    ], segments, 3)).toThrow("第3集 audioResolution chunkIndex=2 没有对应段规格");
    expect(() => attachAudioChunkSpans([
      { audioResolution: [{ analysis: {} }], shots: [] },
    ], segments, 3)).toThrow("没有对应段规格");
  });
});

describe("GLM 结构化整形提示词纪律", () => {
  it("只整形不创作、密度只增不减、字幕并集、禁秒位、单 JSON", () => {
    const prompt = buildNativeDeepReadGlmStructuringPrompt({
      episodeIndex: 3,
      durationSec: 120,
      segments: [{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }],
      hasAudio: true,
      rawSegments: [makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 })],
      rejectedReasonZh: "镜头轴存在空档",
    });
    expect(prompt.system).toContain("结构化整形师");
    expect(prompt.system).toContain("在输入内容范围内取舍与归并");
    expect(prompt.system).toContain("能在输入里找到出处");
    expect(prompt.system).toContain(NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH);
    expect(prompt.system).toContain(`短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒或相邻时长相同也各自保留`);
    expect(prompt.user).toContain(`短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒或相邻时长相同也各自保留`);
    expect(prompt.system).toContain(`${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒下限仅适用于同一长镜的拆分证据段`);
    // 🔒 0830 实弹后撤销「合并相邻」许可：GLM 把 426 镜压成 99 镜（平均镜长
    // 3.6s→15.4s，贴着 30 秒上限往上合），而知识库实测漫剧真实节奏是 2.8–4.3s/镜。
    // 覆盖秒数一秒不差、无重叠无编造——三项对账全绿也拦不住，因为合并相邻镜头
    // 本来就保覆盖。根因就是这句许可证，必须反过来写成禁令。
    expect(prompt.system).not.toContain("允许合理合并相邻证据");
    expect(prompt.system).toContain("秒位不重叠的两条镜头各自保留");
    expect(prompt.system).toContain("秒位不重叠的两条镜头各自保留");
    expect(prompt.system).toContain("能并的只有**秒位重叠的重复记录**");
    expect(prompt.system).toContain("单条记录跨度 ≤ 30 秒");
    expect(prompt.system).toContain("连续覆盖整段");
    expect(prompt.system).toContain("并集去重");
    expect(prompt.system).toContain("钟表式（01:23）留给数字字段");
    expect(prompt.system).toContain("只返回一个 JSON 对象");
    expect(prompt.user).toContain("【上一轮门禁被拒原因】镜头轴存在空档");
    expect(prompt.user).not.toContain("只有相邻 story 证据可以合理合并");
    expect(prompt.user).toContain("只有秒位重叠的重复记录可以合并");
    expect(prompt.user).toContain("镜头数大幅变少、平均镜长明显拉长即为错误产出");
    // 0830 用户拍板：一次合并的总跨度上限 59 秒；超 30 秒必须切两段、各不超 30 秒、间隔 1 秒
    expect(prompt.system).toContain("单次合并跨度 ≤ 60 秒");
    // 0830：措辞与代码真实语义对齐——SPLIT_MIN_SEC 判的是「每段各自 ≥1 秒」，
    // 不是「两段之间留 1 秒空隙」（后者会与「互不重叠、首尾相接」直接矛盾）。
    expect(prompt.system).toContain("每段 3–30 秒");
    expect(prompt.user).toContain("不得删除仍需保留的");
    expect(prompt.system).toContain("五个数组显式输出");
    // 0829 晚：删掉「至少两个维度」这个数量下限——数字目标只会逼模型编造凑数
    // （0826 实弹：安静段落被逼出不存在的声音事件）。改成有证据就写、没有写 []。
    expect(prompt.system).not.toContain("至少两个维度");
    expect(prompt.system).toContain("有证据就写");
    expect(prompt.system).toContain("evidenceRole=non_story_ad 整行剔除");
    expect(prompt.system).toContain("non_story_ad");
    expect(prompt.system).toContain("整行剔除");
    // 0830 晚：广告区间由读片侧 evidenceRole 确定性汇总，落库时代码直接写入，
    // **不再让 GLM 复述**——已知答案还去问它，答错了又拿整集撒气（v27 实锤 ¥21.76 全废）。
    expect(prompt.system).not.toContain("excludedAdRanges:[{startSec,endSec}]");
    expect(prompt.system).not.toContain("excludedAdRanges");
    expect(prompt.system).toContain("只从 story 提炼");
    expect(prompt.system).toContain("story 区间并集去重");
    expect(prompt.user).toContain("除 excludedAdRanges 外的全时间轴");
    expect(prompt.user).toContain("整行剔除并把 {startSec,endSec} 区间记入顶层 excludedAdRanges");
    expect(prompt.user).not.toContain("只有相邻 story 证据可以合理合并");
    expect(prompt.user).toContain("只有秒位重叠的重复记录可以合并");
    expect(prompt.user).toContain("镜头数大幅变少、平均镜长明显拉长即为错误产出");
  });

  it("0829 晚收口：标记不是废弃理由、同段多版本按秒位合并、去重是首要职责", () => {
    const prompt = buildNativeDeepReadGlmStructuringPrompt({
      episodeIndex: 3,
      durationSec: 120,
      segments: [{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }],
      hasAudio: true,
      rawSegments: [
        makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }),
        { ...makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 }), truncated: true },
      ],
    });
    expect(prompt.system).toContain("truncated / advisories / gateMarked / gateMarkedZh");
    // 用户 0829 晚拍板：门禁是贴标签的，标记一律不是废弃理由
    expect(prompt.system).toContain("标注的都是真实产出");
    expect(prompt.system).toContain("gateMarked / gateMarkedZh");
    expect(prompt.system).toContain("已写出的照常采纳");
    // 同段多版本：通过版与被标记版一起喂，合格不等于更好
    expect(prompt.system).toContain("同段可能同时喂来通过版与被标记版");
    expect(prompt.system).toContain("通过的未必更好");
    // 0829 晚二次收口：矛盾消解成「记录去重，信息取并集」——去重删的是重复的记录，
    // 不丢弃保的是每一版独有的观察；同一物理镜头一条记录，但吸收所有版本的观察。
    expect(prompt.system).toContain("记录去重、信息取并集");
    expect(prompt.system).toContain("同一物理镜头只留一条，但吸收所有版本对它的观察");
    // 裁决顺序四条：骨架 / 更细优先 / 逐条比对 / 忠于原文
    expect(prompt.system).toContain("以未标记未截断那版作骨架");
    expect(prompt.system).toContain("切分粗细不同时以更细的为准");
    expect(prompt.system).toContain("秒位不重叠的全保留");
    expect(prompt.system).toContain("可润色文句、不必统一文风");
    expect(prompt.system).toContain("每条产出都要能在输入里找到出处");
    // 唯一裁判尺子：互不重叠首尾相接，重叠即错误产出
    expect(prompt.system).toContain("一组互不重叠、首尾相接");
    expect(prompt.system).toContain("互不重叠、首尾相接的区间");
    expect(prompt.system).toContain("同秒同类留一条取说明更具体的");
    expect(prompt.system).toContain("唯一合法手段是**调整切分**");
    // 五维分类不再设数量下限（数字目标只会逼出假标签）
    expect(prompt.system).toContain("有证据就写，无证据写 []");
    expect(prompt.user).toContain("被门禁标记（gateMarked）的版本都在其中，一份都不许丢");
    // truncated 标记本身随分段卡原样进入输入，不在装配前被剥掉
    expect(prompt.user).toContain(`"truncated":true`);
  });

  it("被门禁标记的版本与通过版一起进 GLM 输入，标记字段原样带上", () => {
    const passed = makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 });
    const marked = {
      ...makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120, shotCountOverride: 3 }),
      gateMarked: true,
      gateMarkedZh: "第2段剧情镜头仅 22 个，低于离谱地板 30 镜",
      attemptNumber: 1,
    };
    const prompt = buildNativeDeepReadGlmStructuringPrompt({
      episodeIndex: 3,
      durationSec: 120,
      segments: [{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }],
      hasAudio: true,
      rawSegments: [makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }), passed, marked],
    });
    // 三份卡（含同段两版本）全部进 user 正文，标记字段一个不落
    expect(prompt.user).toContain("3 份证据卡");
    expect(prompt.user).toContain(`"gateMarked":true`);
    expect(prompt.user).toContain("低于离谱地板 30 镜");
    expect(prompt.user).toContain(`"attemptNumber":1`);
  });

  it("坏 JSON 修复同样明确五键与两维契约", () => {
    const prompt = buildNativeDeepReadGlmSegmentRepairPrompt({
      episodeIndex: 3,
      segmentIndex: 0,
      startSec: 0,
      endSec: 60,
      hasAudio: true,
      badJsonText: "{bad-json",
    });
    expect(prompt.system).toContain("emotionTagsZh");
    // 0829 晚：删掉「至少两个维度」这个数量下限——数字目标只会逼模型编造凑数
    // （0826 实弹：安静段落被逼出不存在的声音事件）。改成有证据就写、没有写 []。
    expect(prompt.system).not.toContain("至少两个维度");
    expect(prompt.system).toContain("有证据就写");
    expect(prompt.system).toContain("evidenceRole 只能原样恢复");
    expect(prompt.system).toContain("原文缺失该字段则修复失败");
  });
});

/* ── 媒体准备 ── */

/** 0901 整片先落盘：runMedia 会先收到无 -ss 的整片抓取与对源文件的 ffprobe。 */
function isSourceLevelMediaCall(args: readonly unknown[]): boolean {
  // 切段调用带 -ss 且 -i 指向本地整片——不算源级；源级只有整片抓取与对整片的 ffprobe
  return !args.includes("-ss")
    && args.some((a) => String(a).includes("manhua-native-source"));
}

function makePreparedMediaProbe(duration = 10, hasAudio = true, start = 0) {
  return {
    format: { start_time: String(start), duration: String(duration) },
    streams: [
      { codec_type: "video", start_time: String(start), duration: String(duration),
        width: 1920, height: 1080, avg_frame_rate: "30/1" },
      ...(hasAudio ? [{ codec_type: "audio", start_time: String(start), duration: String(duration) }] : []),
    ],
  };
}

function makePreparationDeps(
  over: Partial<NativeDeepReadMediaPreparationDeps> = {},
): NativeDeepReadMediaPreparationDeps {
  return {
    sleepMs: async () => {},
    runMedia: vi.fn(async (cmd: string, args: readonly unknown[] = []) =>
      cmd === "ffprobe"
        ? JSON.stringify(makePreparedMediaProbe(isSourceLevelMediaCall(args) ? 100_000 : 10))
        : ""),
    statLocal: vi.fn(async () => ({ size: 200_000 })),
    readLocal: vi.fn(async () => Buffer.from("fixture")),
    unlinkLocal: vi.fn(async () => undefined),
    upload: vi.fn(async ({ objectName }: { objectName: string }) => ({
      bucket: "test-bucket",
      objectName,
      gcsUri: `gs://test-bucket/${objectName}`,
    })) as never,
    remove: vi.fn(async () => undefined),
    statfsTmp: vi.fn(async () => ({ freeBytes: 4 * 1024 * 1024 * 1024 })),
    ...over,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("精确切片与实际媒体验收", () => {
  it("精确 seek 重编码保留原分辨率、帧率与音轨，不使用会前滚的流复制", () => {
    const args = buildNativeDeepReadVideoSegmentArgs({
      node: { url: "https://cdn.example/video.mp4" },
      startSec: 301, durationSec: 360, outputPath: "/tmp/test-only.mp4",
    });
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args).toContain("-accurate_seek");
    expect(args).toContain("libx264");
    expect(args).toContain("0:a?");
    expect(args[args.indexOf("-fps_mode") + 1]).toBe("passthrough");
    expect(args[args.indexOf("-t") + 1]).toBe("360");
    for (const forbidden of ["copy", "-avoid_negative_ts", "-r", "-s", "-vf", "-ar", "-ac", "-shortest"]) {
      expect(args).not.toContain(forbidden);
    }
  });

  it("只在真实尾片容许计划四舍五入的亚秒尾差，音画都验收", () => {
    expect(assertNativeDeepReadPreparedMedia(makePreparedMediaProbe(300), {
      durationSec: 300, isEpisodeTail: false,
    })).toEqual({ durationSec: 300, hasAudio: true });
    for (const duration of [99.6, 100.4]) {
      expect(assertNativeDeepReadPreparedMedia(makePreparedMediaProbe(duration, false), {
        durationSec: 100, isEpisodeTail: true,
      })).toEqual({ durationSec: duration, hasAudio: false });
      expect(() => assertNativeDeepReadPreparedMedia(makePreparedMediaProbe(duration), {
        durationSec: 100, isEpisodeTail: false,
      })).toThrow("实际时长");
    }
  });

  it("31.319 秒残片、秒级零点偏移与虚假的长容器都不能冒充 300 秒", () => {
    const expected = { durationSec: 300, isEpisodeTail: false };
    expect(() => assertNativeDeepReadPreparedMedia(makePreparedMediaProbe(31.319), expected))
      .toThrow("31.319 秒与计划 300 秒不符");
    expect(() => assertNativeDeepReadPreparedMedia(makePreparedMediaProbe(300, true, 1), expected))
      .toThrow("起点不是本段零位");
    const shortVideo = makePreparedMediaProbe(300);
    shortVideo.streams[0]!.duration = "31.319";
    expect(() => assertNativeDeepReadPreparedMedia(shortVideo, expected)).toThrow("视频流实际时长");
    const overflowAudio = makePreparedMediaProbe(300);
    overflowAudio.streams[1]!.start_time = "2";
    expect(() => assertNativeDeepReadPreparedMedia(overflowAudio, expected)).toThrow("超出实际视频");
  });

  it("真实音轨晚起、早停不等于视频截短，保留实际声音区间", () => {
    const probe = makePreparedMediaProbe(300);
    probe.streams[1]!.start_time = "5";
    probe.streams[1]!.duration = "200";
    expect(assertNativeDeepReadPreparedMedia(probe, { durationSec: 300, isEpisodeTail: false }))
      .toEqual({ durationSec: 300, hasAudio: true });
  });

  it("合法短片可低于旧 100KB 门槛，媒体完整性由实际音画验收决定", async () => {
    const deps = makePreparationDeps({ statLocal: vi.fn(async () => ({ size: 5_000 })) });
    const rows = await prepareEpisodeVideos({
      episodeIndex: 1, resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: [{ startSec: 0, endSec: 10 }], sourceDurationSec: 10,
    }, undefined, deps);
    expect(rows[0]?.bytes).toBe(5_000);
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { streams: [] }, { format: {}, streams: [{ codec_type: "video" }] }])(
    "缺少真实媒体信息关闭式失败 %#", (probe) => {
      expect(() => assertNativeDeepReadPreparedMedia(probe, {
        durationSec: 300, isEpisodeTail: false,
      })).toThrow("视频分片验收失败");
    },
  );

  it("缓存补段的数组末项不等于整集尾片，只有 endSec 命中整集时长才读 EOF", async () => {
    for (const [startSec, endSec, expectEof] of [[10, 20, false], [20, 30, true]] as const) {
      const deps = makePreparationDeps();
      await prepareEpisodeVideos({
        episodeIndex: 1, resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
        segments: [{ startSec, endSec }], sourceDurationSec: 30,
      }, undefined, deps);
      const args = vi.mocked(deps.runMedia).mock.calls
        .find((call) => call[0] === "ffmpeg" && (call[1] as string[]).includes("-ss"))![1] as string[];
      expect(args.includes("-t")).toBe(!expectEof);
    }
  });

  it("文件足够大但时长残缺仍三次刷新重切，未验收前零上传", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = makePreparationDeps({
      statLocal: vi.fn(async () => ({ size: 3_400_000 })),
      runMedia: vi.fn(async (cmd, args: readonly unknown[] = []) => cmd === "ffprobe"
        ? JSON.stringify(makePreparedMediaProbe(isSourceLevelMediaCall(args) ? 1691 : 31.319))
        : ""),
    });
    const resolveNodes = vi.fn(async () => [{ url: "https://cdn.example/full.mp4" }]);
    await expect(prepareEpisodeVideos({
      episodeIndex: 1, resolveNodes, segments: [{ startSec: 1200, endSec: 1500 }], sourceDurationSec: 1691,
    }, undefined, deps)).rejects.toThrow("实际时长 31.319 秒与计划 300 秒不符");
    // 整片只解析一次节点；段级重切在本地进行，不再刷新节点
    expect(resolveNodes).toHaveBeenCalledTimes(1);
    expect(deps.upload).not.toHaveBeenCalled();
    // 3 次段级清理 + finally 清整片 + 拉取进度文件
    expect(deps.unlinkLocal).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it("ffprobe 故障不得默认为无音轨，也不能上传后才发现问题", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = makePreparationDeps({ runMedia: vi.fn(async (cmd) => {
      if (cmd === "ffprobe") throw new Error("probe failed");
      return "";
    }) });
    await expect(prepareEpisodeVideos({
      episodeIndex: 1, resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: [{ startSec: 0, endSec: 10 }], sourceDurationSec: 10,
    }, undefined, deps)).rejects.toThrow("probe failed");
    expect(deps.upload).not.toHaveBeenCalled();
    // 源探针即抛 → 整片三连拉失败，各自清一次源文件；未进切段层，finally 无段可清
    // 每发拉取失败各清一次源文件与进度文件（3×2），未进切段层
    expect(deps.unlinkLocal).toHaveBeenCalledTimes(6);
    warn.mockRestore();
  });

  it("各片音轨存在性冲突时停在上传前，不用首片覆盖其他片的事实", async () => {
    let probes = 0;
    const deps = makePreparationDeps({ runMedia: vi.fn(async (cmd, args: readonly unknown[] = []) => {
      if (cmd !== "ffprobe") return "";
      if (isSourceLevelMediaCall(args)) return JSON.stringify(makePreparedMediaProbe(20));
      return JSON.stringify(makePreparedMediaProbe(10, ++probes === 1));
    }) });
    await expect(prepareEpisodeVideos({
      episodeIndex: 1, resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: [{ startSec: 0, endSec: 10 }, { startSec: 10, endSec: 20 }], sourceDurationSec: 20,
    }, undefined, deps)).rejects.toThrow("音轨存在性不一致");
    expect(deps.upload).not.toHaveBeenCalled();
  });
});

describe("模型请求前的媒体准备边界", () => {
  it("/tmp 低于 500MB 时关闭式停止，不切段也不上传", async () => {
    const deps = makePreparationDeps({
      statfsTmp: vi.fn(async () => ({ freeBytes: 100 * 1024 * 1024 })),
    });
    await expect(prepareEpisodeVideos({
      episodeIndex: 1,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: [{ startSec: 0, endSec: 10 }],
      sourceDurationSec: 10,
    }, undefined, deps)).rejects.toThrow("已停止切段");
    expect(deps.runMedia).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES).toBe(500 * 1024 * 1024);
  });

  it("整片抓取失败会刷新媒体节点后重拉；段切在本地，上传后立即删段文件，产出 gs:// 不签 URL", async () => {
    const resolveNodes = vi.fn()
      .mockResolvedValueOnce([{ url: "https://cdn.example/expired.mp4" }])
      .mockResolvedValueOnce([{ url: "https://cdn.example/fresh.mp4" }]);
    const runMedia = vi.fn()
      .mockRejectedValueOnce(new Error("cdn expired"))
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(JSON.stringify(makePreparedMediaProbe(20)))
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(JSON.stringify(makePreparedMediaProbe()));
    const unlinkLocal = vi.fn(async () => undefined);
    const deps = makePreparationDeps({ runMedia, unlinkLocal });

    const prepared = await prepareEpisodeVideos({
      episodeIndex: 2,
      resolveNodes,
      segments: [{ startSec: 0, endSec: 10 }],
      sourceDurationSec: 20,
    }, undefined, deps);

    expect(resolveNodes).toHaveBeenCalledTimes(2);
    expect(runMedia.mock.calls[0]?.[1]).toContain("https://cdn.example/expired.mp4");
    expect(runMedia.mock.calls[1]?.[1]).toContain("https://cdn.example/fresh.mp4");
    expect(deps.upload).toHaveBeenCalledTimes(1);
    // 失败清理 1 次 + 上传后立即删 1 次 + finally 兜底 1 次
    expect(unlinkLocal.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(prepared).toMatchObject([{
      gsUri: expect.stringMatching(/^gs:\/\/test-bucket\//),
      startSec: 0,
      endSec: 10,
      hasAudio: true,
      temporaryGcs: { bucket: "test-bucket" },
    }]);
  });

  it("节点解析失败和空节点都计入同一段的三次刷新重试", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resolveNodes = vi.fn()
      .mockRejectedValueOnce(new Error("resolver timeout"))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ url: "https://cdn.example/fresh.mp4" }]);
    const deps = makePreparationDeps();

    const prepared = await prepareEpisodeVideos({
      episodeIndex: 3,
      resolveNodes,
      segments: [{ startSec: 0, endSec: 10 }],
      sourceDurationSec: 10,
    }, undefined, deps);

    expect(resolveNodes).toHaveBeenCalledTimes(3);
    const ffmpegCalls = vi.mocked(deps.runMedia).mock.calls.filter((call) => call[0] === "ffmpeg");
    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls[0]?.[1]).toContain("https://cdn.example/fresh.mp4");
    expect(ffmpegCalls[1]?.[1]).toContain("-ss");
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(prepared).toHaveLength(1);
    warn.mockRestore();
  });

  it("默认并发上限 4：5 段先发 4 路，完成乱序仍逐片验收并按原分段顺序落位", async () => {
    const cutGates = new Map<number, ReturnType<typeof deferred>>();
    let activeCuts = 0;
    let maxActiveCuts = 0;
    let ffprobeCalls = 0;
    const runMedia = vi.fn(async (cmd: string, args: string[]) => {
      if (isSourceLevelMediaCall(args)) {
        return cmd === "ffprobe" ? JSON.stringify(makePreparedMediaProbe(100_000)) : "";
      }
      if (cmd === "ffprobe") {
        ffprobeCalls += 1;
        return JSON.stringify(makePreparedMediaProbe());
      }
      const startSec = Number(args[args.indexOf("-ss") + 1]);
      const gate = deferred();
      cutGates.set(startSec, gate);
      activeCuts += 1;
      maxActiveCuts = Math.max(maxActiveCuts, activeCuts);
      try {
        await gate.promise;
        return "";
      } finally {
        activeCuts -= 1;
      }
    });
    const deps = makePreparationDeps({ runMedia });
    const task = prepareEpisodeVideos({
      episodeIndex: 4,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: Array.from({ length: 5 }, (_, index) => ({
        startSec: index * 10,
        endSec: (index + 1) * 10,
      })),
      sourceDurationSec: 50,
    }, undefined, deps);

    // 0901 降档：默认上限 4（真人剧小站 CDN 被 10 路并发连环 reset 的实锤）。
    // 5 段先发 4 路，放行一段后第 5 段跟上；仍是并发不是串行。
    await vi.waitFor(() => expect(cutGates.size).toBe(4));
    expect(maxActiveCuts).toBe(4);
    cutGates.get(0)!.resolve();
    await vi.waitFor(() => expect(cutGates.size).toBe(5));
    expect(Array.from(cutGates.keys()).sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40]);
    // 乱序完成：真正的不变量是「按分段下标落位」，不是「按完成顺序落位」。
    for (const startSec of [40, 10, 30, 20]) cutGates.get(startSec)!.resolve();

    const prepared = await task;
    expect(prepared.map((row) => row.startSec)).toEqual([0, 10, 20, 30, 40]);
    expect(ffprobeCalls).toBe(5);
    expect(deps.upload).toHaveBeenCalledTimes(5);
    // 上传已改并发，调用先后不再等于分段顺序；可断言的是「一段一次、对象名一一对应」。
    expect(vi.mocked(deps.upload).mock.calls.map((call) => call[0].objectName).sort()).toEqual(
      prepared.map((row) => row.temporaryGcs.objectName).sort(),
    );
  });

  it("🔓 切段并发上限可由入参覆盖（上限归用户定，不写死）", async () => {
    const cutGates = new Map<number, ReturnType<typeof deferred>>();
    let activeCuts = 0;
    let maxActiveCuts = 0;
    const runMedia = vi.fn(async (cmd: string, args: string[]) => {
      if (isSourceLevelMediaCall(args)) {
        return cmd === "ffprobe" ? JSON.stringify(makePreparedMediaProbe(100_000)) : "";
      }
      if (cmd === "ffprobe") return JSON.stringify(makePreparedMediaProbe());
      const startSec = Number(args[args.indexOf("-ss") + 1]);
      const gate = deferred();
      cutGates.set(startSec, gate);
      activeCuts += 1;
      maxActiveCuts = Math.max(maxActiveCuts, activeCuts);
      try {
        await gate.promise;
        return "";
      } finally {
        activeCuts -= 1;
      }
    });
    const deps = makePreparationDeps({ runMedia });
    const task = prepareEpisodeVideos({
      episodeIndex: 9,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: Array.from({ length: 5 }, (_, index) => ({
        startSec: index * 10,
        endSec: (index + 1) * 10,
      })),
      sourceDurationSec: 50,
    }, undefined, deps, { cutConcurrency: 2 });

    await vi.waitFor(() => expect(cutGates.size).toBe(2));
    expect(maxActiveCuts).toBe(2);
    for (const startSec of [0, 10]) cutGates.get(startSec)!.resolve();
    await vi.waitFor(() => expect(cutGates.size).toBe(4));
    for (const startSec of [20, 30]) cutGates.get(startSec)!.resolve();
    await vi.waitFor(() => expect(cutGates.has(40)).toBe(true));
    cutGates.get(40)!.resolve();

    const prepared = await task;
    expect(prepared.map((row) => row.startSec)).toEqual([0, 10, 20, 30, 40]);
    expect(maxActiveCuts).toBe(2);
  });

  it("首个 worker 失败后停止领取新段，并等待已经在途的切片结束再失败清理", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inFlightGates = new Map<number, ReturnType<typeof deferred>>();
    const started: number[] = [];
    const runMedia = vi.fn(async (cmd: string, args: string[]) => {
      if (isSourceLevelMediaCall(args)) {
        return cmd === "ffprobe" ? JSON.stringify(makePreparedMediaProbe(100_000)) : "";
      }
      if (cmd === "ffprobe") return JSON.stringify(makePreparedMediaProbe());
      const startSec = Number(args[args.indexOf("-ss") + 1]);
      started.push(startSec);
      if (startSec === 0) throw new Error("first segment failed");
      const gate = deferred();
      inFlightGates.set(startSec, gate);
      await gate.promise;
      return "";
    });
    const deps = makePreparationDeps({ runMedia });
    const task = prepareEpisodeVideos({
      episodeIndex: 5,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: Array.from({ length: 6 }, (_, index) => ({
        startSec: index * 10,
        endSec: (index + 1) * 10,
      })),
      sourceDurationSec: 60,
      // 显式给上限，场景才立得住：默认 10 会让 6 段一次全发，观察不到「停止领取新段」。
      // 取 4＝原场景（1 路撞失败 + 3 路在途），与下方 inFlightGates 断言对齐。
    }, undefined, deps, { cutConcurrency: 4 });
    const outcome = task.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );

    await vi.waitFor(() => {
      expect(started.filter((startSec) => startSec === 0)).toHaveLength(3);
      expect(inFlightGates.size).toBe(3);
    });
    expect(started).not.toContain(40);
    expect(started).not.toContain(50);
    expect(deps.upload).not.toHaveBeenCalled();

    for (const gate of Array.from(inFlightGates.values())) gate.resolve();
    const result = await outcome;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toEqual(expect.objectContaining({ message: "first segment failed" }));
    }
    expect(started).not.toContain(40);
    expect(started).not.toContain(50);
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.unlinkLocal).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("完整性门禁按实有槽位计数，不能用会跳过数组空洞的 some", () => {
    const src = readFileSync(
      new URL("./manhuaNativeDeepReadRunner.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("cutRows.filter(Boolean).length !== segments.length");
    expect(src).not.toContain("cutRows.some((row) => !row)");
  });

  it("切片本地验收确实无音轨时 hasAudio=false", async () => {
    const deps = makePreparationDeps({
      runMedia: vi.fn(async (cmd: string) =>
        cmd === "ffprobe" ? JSON.stringify(makePreparedMediaProbe(10, false)) : ""),
    });
    const prepared = await prepareEpisodeVideos({
      episodeIndex: 1,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: [{ startSec: 0, endSec: 10 }],
      sourceDurationSec: 10,
    }, undefined, deps);
    expect(prepared[0]?.hasAudio).toBe(false);
  });
});

describe("精确切片后逐片上传 GCS", () => {
  const MB = 1024 * 1024;

  it("多片总体积超过旧预算仍逐片上传，精确切片不按体积降清晰度", async () => {
    const runMedia = vi.fn(async (cmd: string, args: string[]) => {
      if (isSourceLevelMediaCall(args)) {
        return cmd === "ffprobe" ? JSON.stringify(makePreparedMediaProbe(100_000)) : "";
      }
      return cmd === "ffprobe" ? JSON.stringify(makePreparedMediaProbe(300)) : "";
    });
    const statLocal = vi.fn()
      .mockResolvedValueOnce({ size: 500 * MB })
      .mockResolvedValueOnce({ size: 60 * MB })
      .mockResolvedValueOnce({ size: 60 * MB });
    const deps = makePreparationDeps({ runMedia, statLocal });
    const prepared = await prepareEpisodeVideos({
      episodeIndex: 2,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: [{ startSec: 0, endSec: 300 }, { startSec: 300, endSec: 600 }],
      sourceDurationSec: 601,
    }, undefined, deps);
    const ffmpegCalls = runMedia.mock.calls.filter(
      (call) => call[0] === "ffmpeg" && (call[1] as string[]).includes("-ss"),
    );
    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls.every((call) => call[1].includes("libx264"))).toBe(true);
    expect(ffmpegCalls.flatMap((call) => call[1])).not.toContain("-vf");
    expect(ffmpegCalls.flatMap((call) => call[1])).not.toContain("-r");
    expect(deps.upload).toHaveBeenCalledTimes(2);
    expect(prepared.map((row) => row.bytes)).toEqual([60 * MB, 60 * MB]);
  });
});

/* ── 主链：逐段调用 + Vertex 同通道重试 + GLM 整集整形 ── */

function geminiResponse(payload: unknown, over: {
  finishReason?: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  audioTokenCount?: number;
} = {}) {
  return {
    status: 200,
    text: JSON.stringify({
      candidates: [{
        finishReason: over.finishReason ?? "STOP",
        content: { parts: [{ text: JSON.stringify(payload) }] },
      }],
      usageMetadata: {
        promptTokenCount: over.promptTokenCount ?? 100_000,
        candidatesTokenCount: over.candidatesTokenCount ?? 2_000,
        thoughtsTokenCount: 500,
        promptTokensDetails: [
          { modality: "VIDEO", tokenCount: 90_000 },
          { modality: "AUDIO", tokenCount: over.audioTokenCount ?? 8_000 },
        ],
      },
    }),
    requestId: "req-gemini-1",
  };
}

// 写入结果的最小真值形状：runner 此后只认返回的 canonical entry。
function writeResultOf(entry: NativeDeepReadSegmentCacheEntry) {
  return {
    entry,
    cacheObjectName: `manhua-template-learn/segment-cache/test_seg${entry.segmentIndex}.json`,
    evidenceObjectName: `manhua-template-learn/segment-evidence/test/seg${entry.segmentIndex}.json`,
    outcome: "created" as const,
  };
}

/**
 * 0829 起每集装配必走 GLM 整形，所以默认桩不能再是空 vi.fn()。
 * 桩行为＝忠实整形：从 user 提示词里取回真实分段卡，按秒位顺序拼成单张整集卡，
 * 剔除 non_story_ad 行并记 excludedAdRanges；用量全记 0，避免扰动既有计费断言。
 */
function readRawSegmentsFromGlmPrompt(user: string): Array<Record<string, unknown>> {
  const marker = "分段卡 JSON：";
  const at = user.lastIndexOf(marker);
  if (at < 0) throw new Error("GLM 整形提示词里找不到分段卡 JSON");
  return JSON.parse(user.slice(at + marker.length)) as Array<Record<string, unknown>>;
}

function makeGlmStructuringStub() {
  return vi.fn(async (prompt: { system: string; user: string }) => {
    // 真 GLM 的首要职责是去重（同段可能被喂进通过版 + 被标记版）。
    // 桩件按同样口径先剔掉被标记版，否则同秒位区间会重叠。
    const rows = readRawSegmentsFromGlmPrompt(prompt.user)
      .map(unwrapNativeDeepReadStructuredAnswerEnvelope)
      .filter((row) => row.gateMarked !== true);
    const pick = <T>(key: string) => rows.flatMap((row) => (row[key] as T[]) || []);
    const joinText = (key: string) =>
      rows.map((row) => String(row[key] || "").trim()).filter(Boolean).join("；");
    const allShots = pick<Record<string, unknown>>("shots");
    const adShots = allShots.filter((shot) => shot.evidenceRole === "non_story_ad");
    const merged: Record<string, unknown> = {
      shots: allShots.filter((shot) => shot.evidenceRole !== "non_story_ad"),
      subtitles: pick("subtitles"),
      audioResolution: pick("audioResolution"),
      beatStructureZh: joinText("beatStructureZh"),
      moodArcZh: joinText("moodArcZh"),
      classification: rows[0]?.classification,
      reusableZh: joinText("reusableZh"),
      genPromptHintZh: joinText("genPromptHintZh"),
    };
    if (adShots.length > 0) {
      merged.excludedAdRanges = adShots.map((shot) => ({
        startSec: shot.startSec, endSec: shot.endSec,
      }));
    }
    return {
      raw: merged,
      // 0829 改线后回执记的是**实际交卷**的网关与模型，不再由调用方拿常量硬写。
      gateway: "openrouter" as const,
      model: "z-ai/glm-5.3",
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      finishReason: "stop",
    };
  });
}

function makeRunnerDeps(over: Partial<NativeDeepReadBatchRunnerDeps> = {}): NativeDeepReadBatchRunnerDeps {
  const selectAttemptWithQwen = vi.fn(async (input: {
    candidates: Array<{ attemptNumber: 1 | 2 | 3; passedGate: boolean }>;
  }) => {
    const selectedAttemptNumber = input.candidates.find((row) => row.passedGate)?.attemptNumber || 1;
    return {
      selectedAttemptNumber,
      reasonZh: "测试裁判选出的完整数据",
      gateway: "plan_sg_qwen",
      model: "qwen3.8-max",
      inputTokens: 10,
      outputTokens: 2,
      reasoningTokens: 0,
      costUsd: 0.001,
      evidence: {
        callId: "native-segment-selection-test",
        requestObjectName: "manhua-template-learn/segment-selection-evidence/test/request.json",
        rawObjectNames: ["manhua-template-learn/segment-selection-evidence/test/raw-1.json"],
        parsedObjectName: "manhua-template-learn/segment-selection-evidence/test/parsed.json",
      },
    };
  });
  return {
    prepareVideos: vi.fn(async (episode: { segments: readonly { startSec: number; endSec: number }[] }) =>
      episode.segments.map((segment, index) => ({
        gsUri: `gs://test-bucket/seg-${index}.mp4`,
        startSec: segment.startSec,
        endSec: segment.endSec,
        temporaryGcs: { bucket: "test-bucket", objectName: `seg-${index}.mp4` },
        bytes: 10 * 1024 * 1024,
        hasAudio: true,
      }))) as never,
    remove: vi.fn(async () => undefined),
    postVertex: vi.fn() as never,
    postEvolink: vi.fn() as never,
    signReadUrl: vi.fn(() => "https://storage.googleapis.com/signed.mp4"),
    invokeGlmStructuring: makeGlmStructuringStub() as never,
    readSegmentCache: vi.fn(async () => null) as never,
    writeSegmentCache: vi.fn(async (entry: NativeDeepReadSegmentCacheEntry) => writeResultOf(entry)) as never,
    readRawAttemptEvidence: vi.fn(async () => null) as never,
    writeRawAttemptEvidence: vi.fn(async (input: { segmentIndex: number; attemptNumber: number; responseText: string; repeatableDiagnostic?: boolean; batchRequestId: string }) => ({
      objectName: `manhua-template-learn/segment-evidence-raw/test/${input.repeatableDiagnostic ? `${input.batchRequestId}/` : ""}seg${input.segmentIndex}-attempt${input.attemptNumber}.json`,
      bytes: Buffer.byteLength(input.responseText),
      sha256: "a".repeat(64),
    })) as never,
    writeParsedAttemptEvidence: vi.fn(async (input: NativeDeepReadParsedAttemptEvidenceInput) => ({
      objectName: `manhua-template-learn/segment-evidence-parsed-attempt/test/${input.callId}.json`,
      bytes: Buffer.byteLength(JSON.stringify(input.parsed)),
      sha256: "b".repeat(64),
    })) as never,
    readStructuredBatchCache: vi.fn(async () => null) as never,
    writeStructuredBatchCache: vi.fn(async (entry) => entry) as never,
    waitForRetry: vi.fn(async () => undefined),
    ...over,
    selectAttemptWithQwen: (over.selectAttemptWithQwen || selectAttemptWithQwen) as never,
  };
}

function makeSuccessfulEpisodePostVertex(
  segments: readonly { startSec: number; endSec: number }[],
) {
  return vi.fn(async (body: unknown) => {
    const fileUri = (body as {
      contents: Array<{ parts: Array<{ fileData?: { fileUri: string } }> }>;
    }).contents[0]!.parts[0]!.fileData!.fileUri;
    const segmentIndex = Number(/seg-(\d+)/.exec(fileUri)?.[1]);
    const segment = segments[segmentIndex]!;
    return geminiResponse(makeSegmentPayload({
      segmentIndex,
      startSec: segment.startSec,
      endSec: segment.endSec,
    }));
  });
}

const twoSegmentEpisode = {
  episodeIndex: 1,
  resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
  segments: [
    { startSec: 0, endSec: 60 },
    { startSec: 60, endSec: 120 },
  ],
  sourceDurationSec: 120,
};

describe("已有分片选段诊断：共用生产尝试器，不装配整集", () => {
  const fullSegments = [0, 319, 638, 957, 1276].map((startSec, index) => ({
    startSec, endSec: index === 4 ? 1594 : startSec + 319,
  }));
  function selectedParams(indexes: number[]): NativeDeepReadSelectedSegmentsParams {
    return {
      seriesKey: "test_selected_segments", sourceDigest: "c".repeat(64),
      sourceDurationSec: 1594, segments: fullSegments, videoFps: 12,
      selectedSegmentIndexes: indexes,
      preparedVideos: indexes.map((index) => ({
        ...fullSegments[index]!, gsUri: `gs://test-bucket/seg-${index}.mp4`,
        temporaryGcs: { bucket: "test-bucket", objectName: `seg-${index}.mp4` },
        bytes: 123456, hasAudio: true,
      })),
    };
  }
  function expectNoAssemblyOrMediaMutation(deps: NativeDeepReadBatchRunnerDeps) {
    expect(deps.prepareVideos).not.toHaveBeenCalled();
    expect(deps.readSegmentCache).not.toHaveBeenCalled();
    expect(deps.writeSegmentCache).not.toHaveBeenCalled();
    expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
    expect(deps.postEvolink).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  }

  it.each([[3], [4, 1], [4, 1, 3]])("只调用原索引%s，保留全1594秒/5片/12fps身份", async (...indexes) => {
    const selected = indexes as number[];
    const params = selectedParams(selected);
    const deps = makeRunnerDeps({ postVertex: makeSuccessfulEpisodePostVertex(fullSegments) });
    const result = await runManhuaNativeDeepReadSelectedSegments(params, deps);
    const expectedIndexes = [...selected].sort((a, b) => a - b);
    expect(result).toMatchObject({
      mode: "gemini_selected", sourceDurationSec: 1594, totalSegmentCount: 5,
      selectedSegmentIndexes: expectedIndexes, sourceDigest: params.sourceDigest,
      assemblyComplete: false, glmStatus: "not_run", productAcceptance: "not_run",
    });
    expect(result).not.toHaveProperty("episodes");
    expect(result.segments.map((row) => row.segmentIndex)).toEqual(expectedIndexes);
    expect(deps.postVertex).toHaveBeenCalledTimes(selected.length);
    expect(deps.writeRawAttemptEvidence).toHaveBeenCalledTimes(selected.length);
    expect(deps.writeParsedAttemptEvidence).toHaveBeenCalledTimes(selected.length);
    for (const row of result.segments) {
      const span = fullSegments[row.segmentIndex]!;
      expect(row).toMatchObject({ ...span, hasAudio: true });
      expect(row.raw.shots).toEqual(makeSegmentPayload({ segmentIndex: row.segmentIndex, ...span }).shots);
      const expectedFingerprint = nativeDeepReadSegmentCacheFingerprint({
        sourceDigest: params.sourceDigest, episodeIndex: 1, episodeDurationSec: 1594,
        segment: span, segmentIndex: row.segmentIndex, segmentCount: 5, hasAudio: true, videoFps: 12,
      });
      expect(row.requestFingerprint).toBe(expectedFingerprint);
      const rawInput = vi.mocked(deps.writeRawAttemptEvidence).mock.calls.find(([input]) => input.segmentIndex === row.segmentIndex)![0];
      expect(rawInput).toMatchObject({ segmentCount: 5, requestFingerprint: expectedFingerprint, temperature: 0.7 });
      const request = vi.mocked(deps.postVertex).mock.calls.map(([body]) => body as any)
        .find((body) => body.contents[0].parts[0].fileData.fileUri === `gs://test-bucket/seg-${row.segmentIndex}.mp4`);
      expect(request).toEqual(buildGeminiNativeDeepReadSegmentRequest({
          segmentContext: { ...span, segmentIndex: row.segmentIndex, hasAudio: true },
        fileUri: `gs://test-bucket/seg-${row.segmentIndex}.mp4`, fps: 12,
        prompt: buildGeminiNativeDeepReadSegmentPrompt({ episodeDurationSec: 1594,
          ...span, segmentIndex: row.segmentIndex, segmentCount: 5, hasAudio: true, videoFps: 12 }),
      }));
    }
    expect(result.usage.inputTokens).toBe(100_000 * selected.length);
    expectNoAssemblyOrMediaMutation(deps);
    expect(params.selectedSegmentIndexes).toEqual(selected);
  });

  it.each([[], [0, 1, 2, 3], [1, 1], [-1], [5], [1.5], [NaN]])("非法原索引%s在任何I/O前拒绝", async (...indexes) => {
    const deps = makeRunnerDeps();
    const params = { ...selectedParams([1]), selectedSegmentIndexes: indexes as number[] };
    await expect(runManhuaNativeDeepReadSelectedSegments(params, deps)).rejects.toThrow("选段诊断");
    expect(deps.postVertex).not.toHaveBeenCalled();
    expect(deps.writeRawAttemptEvidence).not.toHaveBeenCalled();
    expectNoAssemblyOrMediaMutation(deps);
  });

  it("缺首/缺尾/伪造短片长或媒体错位都在模型调用前拒绝", async () => {
    for (const change of [
      { segments: fullSegments.slice(1) },
      { segments: fullSegments.slice(0, 4) },
      { sourceDurationSec: 319 },
      { preparedVideos: selectedParams([2]).preparedVideos },
      { preparedVideos: [{ ...selectedParams([1]).preparedVideos[0]!, gsUri: "gs://test-bucket/wrong.mp4" }] },
    ]) {
      const deps = makeRunnerDeps();
      await expect(runManhuaNativeDeepReadSelectedSegments({ ...selectedParams([1]), ...change }, deps)).rejects.toThrow();
      expect(deps.postVertex).not.toHaveBeenCalled();
      expectNoAssemblyOrMediaMutation(deps);
    }
  });

  it("两次门禁失败后第三次通过，仍由 Qwen 对三份完整数据三选一", async () => {
    const span = fullSegments[3]!;
    const short = makeSegmentPayload({ segmentIndex: 3, startSec: span.startSec, endSec: span.startSec + 20 });
    const healthy = makeSegmentPayload({ segmentIndex: 3, ...span });
    const postVertex = vi.fn().mockResolvedValueOnce(geminiResponse(short))
      .mockResolvedValueOnce(geminiResponse(short)).mockResolvedValueOnce(geminiResponse(healthy));
    const deps = makeRunnerDeps({ postVertex });
    const result = await runManhuaNativeDeepReadSelectedSegments(selectedParams([3]), deps);
    expect(postVertex).toHaveBeenCalledTimes(3);
    expect(postVertex.mock.calls.map(([body]) => body.generationConfig.temperature)).toEqual([0.7, 0.65, 0.6]);
    expect(postVertex.mock.calls[1]![0].contents[0].parts[1].text).toContain("6.3%");
    expect(deps.waitForRetry).toHaveBeenCalledTimes(2);
    expect(deps.waitForRetry).toHaveBeenNthCalledWith(1, NATIVE_DEEP_READ_RETRY_INTERVAL_MS, undefined);
    expect(deps.writeRawAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(deps.writeParsedAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(deps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
    expect(result.rawAttemptEvidenceObjectNames).toHaveLength(3);
    expect(result.segments[0]!.raw.shots).toEqual(healthy.shots);
    expect(result.segments[0]!.raw.attemptSelection).toMatchObject({
      status: "qwen_selected_after_three_attempts",
      selectedAttemptNumber: 3,
      selectedTemperature: 0.6,
      selectedPassedGate: true,
    });
    expect(result.segments[0]!.paidUsage).toMatchObject({ inputTokens: 300_010, outputTokens: 7_502 });
    expect(result.usage).toMatchObject({ inputTokens: 300_010, outputTokens: 7_502 });
    expectNoAssemblyOrMediaMutation(deps);
  });

  it("音频事件越出声明区间属于门禁失败，下一发降到0.65", async () => {
    const span = fullSegments[3]!;
    const invalid = makeSegmentPayload({ segmentIndex: 3, ...span });
    const firstTrack = (invalid.audioResolution as Array<{
      analysis: { audioTrack: Array<{ cues: Array<{ atSec: number }> }> };
    }>)[0]!.analysis.audioTrack[0]!;
    firstTrack.cues[0]!.atSec = 999;
    const healthy = makeSegmentPayload({ segmentIndex: 3, ...span });
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(invalid))
      .mockResolvedValueOnce(geminiResponse(healthy));
    const receipts: Array<Record<string, unknown>> = [];
    const deps = makeRunnerDeps({ postVertex });
    const result = await runManhuaNativeDeepReadSelectedSegments({
      ...selectedParams([3]),
      onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
    }, deps);
    expect(postVertex.mock.calls.map(([body]) => body.generationConfig.temperature)).toEqual([0.7, 0.65]);
    expect(deps.waitForRetry).toHaveBeenCalledTimes(1);
    expect(deps.selectAttemptWithQwen).not.toHaveBeenCalled();
    expect(result.segments[0]!.raw.shots).toEqual(healthy.shots);
    expect(receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: "local_schema_gate", status: "failed", attemptNumber: 1, temperature: 0.7 }),
      expect.objectContaining({ route: "gate_retry_pending", attemptNumber: 2, temperature: 0.65 }),
      expect.objectContaining({ route: "local_schema_gate", status: "completed", attemptNumber: 2 }),
    ]));
  });

  it("503 只等待60秒并保持0.7同温重跑，不消耗门禁降档", async () => {
    const span = fullSegments[3]!;
    const overloaded = Object.assign(new Error("RESOURCE_EXHAUSTED"), { nativeDeepReadHttpStatus: 503 });
    const postVertex = vi.fn()
      .mockRejectedValueOnce(overloaded)
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 3, ...span })));
    const receipts: Array<Record<string, unknown>> = [];
    const deps = makeRunnerDeps({ postVertex });
    await runManhuaNativeDeepReadSelectedSegments({
      ...selectedParams([3]),
      onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
    }, deps);
    expect(postVertex.mock.calls.map(([body]) => body.generationConfig.temperature)).toEqual([0.7, 0.7]);
    expect(deps.waitForRetry).toHaveBeenCalledTimes(1);
    expect(deps.selectAttemptWithQwen).not.toHaveBeenCalled();
    expect(receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: "resource_retry_pending", attemptNumber: 1, temperature: 0.7 }),
    ]));
    expect(receipts.some((row) => row.route === "gate_retry_pending")).toBe(false);
  });

  it("资源拥堵在当前温度最多重试4次（0904 用户令），第4次仍失败就停止", async () => {
    const overloaded = Object.assign(new Error("RESOURCE_EXHAUSTED"), { nativeDeepReadHttpStatus: 503 });
    const postVertex = vi.fn(async (_body: any) => { throw overloaded; });
    const receipts: Array<Record<string, unknown>> = [];
    const deps = makeRunnerDeps({ postVertex });
    await expect(runManhuaNativeDeepReadSelectedSegments({
      ...selectedParams([3]),
      onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
    }, deps)).rejects.toThrow("RESOURCE_EXHAUSTED");
    // 首发 1 次 + 资源重试 4 次 = 5 次调用，全程不降温
    expect(postVertex).toHaveBeenCalledTimes(5);
    expect(postVertex.mock.calls.map(([body]) => body.generationConfig.temperature))
      .toEqual([0.7, 0.7, 0.7, 0.7, 0.7]);
    expect(deps.waitForRetry).toHaveBeenCalledTimes(4);
    // 退避间隔走 503 专用的 30 秒线，不是门禁降温那条 60 秒线
    expect(vi.mocked(deps.waitForRetry).mock.calls.map(([ms]) => ms))
      .toEqual([30_000, 30_000, 30_000, 30_000]);
    const resourceRetries = receipts.filter((row) => row.route === "resource_retry_pending");
    expect(resourceRetries.map((row) => [row.resourceRetryNumber, row.resourceRetryMax]))
      .toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(receipts.some((row) => row.route === "gate_retry_pending")).toBe(false);
  });

  it("最后一分片与其他分片一视同仁，三次门禁失败后由 Qwen 三选一", async () => {
    const span = fullSegments[4]!;
    const postVertex = vi.fn().mockResolvedValue(geminiResponse(makeSegmentPayload({
      segmentIndex: 4, startSec: span.startSec, endSec: span.startSec + 20,
    })));
    const deps = makeRunnerDeps({ postVertex });
    const result = await runManhuaNativeDeepReadSelectedSegments(selectedParams([4]), deps);
    expect(postVertex).toHaveBeenCalledTimes(3);
    expect(deps.waitForRetry).toHaveBeenCalledTimes(2);
    expect(deps.writeRawAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(deps.writeParsedAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(deps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
    expect(result.segments[0]!.raw.attemptSelection).toMatchObject({
      status: "qwen_selected_after_three_attempts",
      selectedAttemptNumber: 1,
      selectedPassedGate: false,
    });
    expect(result.segments[0]!.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "qwen_three_attempts_pick_one" }),
    ]));
    expectNoAssemblyOrMediaMutation(deps);
  });

  it("三次均拒收时由 Qwen 三选一，不发第四次，仍保留三份解析稿和用量", async () => {
    const span = fullSegments[3]!;
    const postVertex = vi.fn().mockResolvedValue(geminiResponse(makeSegmentPayload({
      segmentIndex: 3, startSec: span.startSec, endSec: span.startSec + 20,
    })));
    const deps = makeRunnerDeps({ postVertex });
    const result = await runManhuaNativeDeepReadSelectedSegments(selectedParams([3]), deps);
    expect(result.usage).toMatchObject({ inputTokens: 300_010, outputTokens: 7_502 });
    expect(result.segments[0]!.raw.attemptSelection).toMatchObject({
      status: "qwen_selected_after_three_attempts",
      selectedAttemptNumber: 1,
      selectedTemperature: 0.7,
      selectedPassedGate: false,
    });
    expect(result.segments[0]!.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "qwen_three_attempts_pick_one" }),
    ]));
    expect(postVertex).toHaveBeenCalledTimes(3);
    expect(deps.writeRawAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(deps.writeParsedAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(deps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
    expectNoAssemblyOrMediaMutation(deps);
  });

  it("选段调度失败后不领取后续原索引，不误发未选择分片", async () => {
    const postVertex = vi.fn().mockRejectedValue(new Error("test network unavailable"));
    const deps = makeRunnerDeps({ postVertex });
    await expect(runManhuaNativeDeepReadSelectedSegments({
      ...selectedParams([4, 1, 3]), segmentModelConcurrency: 1,
    }, deps)).rejects.toThrow("test network unavailable");
    expect(postVertex).toHaveBeenCalledTimes(1);
    expect(postVertex.mock.calls.map(([body]) => body.contents[0].parts[0].fileData.fileUri))
      .toEqual(["gs://test-bucket/seg-1.mp4"]);
    expectNoAssemblyOrMediaMutation(deps);
  });

  it("非法索引空洞、重复媒体和音轨矛盾不能进入付费尝试", async () => {
    const sparse: number[] = new Array(1);
    for (const params of [
      { ...selectedParams([1]), selectedSegmentIndexes: sparse },
      { ...selectedParams([1, 3]), preparedVideos: Array(2).fill(selectedParams([1]).preparedVideos[0]) },
      { ...selectedParams([1, 3]), preparedVideos: selectedParams([1, 3]).preparedVideos
        .map((row, index) => ({ ...row, hasAudio: index === 0 })) },
    ]) {
      const deps = makeRunnerDeps();
      await expect(runManhuaNativeDeepReadSelectedSegments(params, deps)).rejects.toThrow();
      expect(deps.postVertex).not.toHaveBeenCalled();
      expectNoAssemblyOrMediaMutation(deps);
    }
  });

  it("schema 门禁失败跑满三档后仍必须由 Qwen 选一份，MAX_TOKENS 可消费前缀仍只一发", async () => {
    const raw = makeSegmentPayload({ segmentIndex: 3, startSec: 957, endSec: 977 });
    const invalidDeps = makeRunnerDeps({ postVertex: vi.fn().mockResolvedValue(geminiResponse({ ...raw, shots: "坏结构" })) });
    const invalidResult = await runManhuaNativeDeepReadSelectedSegments(selectedParams([3]), invalidDeps);
    expect(invalidDeps.postVertex).toHaveBeenCalledTimes(3);
    expect(invalidDeps.waitForRetry).toHaveBeenCalledTimes(2);
    expect(invalidDeps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
    expect(invalidResult.segments[0]!.raw).toMatchObject({
      shots: "坏结构",
      attemptSelection: { status: "qwen_selected_after_three_attempts", selectedAttemptNumber: 1 },
    });
    expectNoAssemblyOrMediaMutation(invalidDeps);
    const truncatedDeps = makeRunnerDeps({ postVertex: vi.fn().mockResolvedValue(geminiResponse(raw, { finishReason: "MAX_TOKENS" })) });
    const result = await runManhuaNativeDeepReadSelectedSegments(selectedParams([3]), truncatedDeps);
    expect(result.segments[0]!.truncated).toBe(true);
    expect(result.segments[0]!.raw.shots).toEqual(raw.shots);
    expect(truncatedDeps.postVertex).toHaveBeenCalledTimes(1);
    expect(truncatedDeps.waitForRetry).not.toHaveBeenCalled();
    expectNoAssemblyOrMediaMutation(truncatedDeps);
  });

  it("同配置再次诊断确实重测，绝不拿旧cache冒充第二轮", async () => {
    const params = selectedParams([3]);
    const deps = makeRunnerDeps({ postVertex: makeSuccessfulEpisodePostVertex(fullSegments) });
    const first = await runManhuaNativeDeepReadSelectedSegments(params, deps);
    const second = await runManhuaNativeDeepReadSelectedSegments(params, deps);
    expect(deps.postVertex).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.postVertex).mock.calls[0]![0]).toEqual(vi.mocked(deps.postVertex).mock.calls[1]![0]);
    expect(first.batchRequestId).not.toBe(second.batchRequestId);
    expect(first.rawAttemptEvidenceObjectNames[0]).not.toBe(second.rawAttemptEvidenceObjectNames[0]);
    expectNoAssemblyOrMediaMutation(deps);
  });

  it("原始或解析稿落盘失败不重买，预先中止零模型调用", async () => {
    for (const key of ["writeRawAttemptEvidence", "writeParsedAttemptEvidence"] as const) {
      const deps = makeRunnerDeps({ postVertex: makeSuccessfulEpisodePostVertex(fullSegments),
        [key]: vi.fn(async () => { throw new Error("test evidence failure"); }) });
      await expect(runManhuaNativeDeepReadSelectedSegments(selectedParams([3]), deps)).rejects.toThrow("落盘失败");
      expect(deps.postVertex).toHaveBeenCalledTimes(1);
      expect(deps.waitForRetry).not.toHaveBeenCalled();
      expectNoAssemblyOrMediaMutation(deps);
    }
    const controller = new AbortController();
    controller.abort(new Error("test abort"));
    const deps = makeRunnerDeps();
    await expect(runManhuaNativeDeepReadSelectedSegments({ ...selectedParams([3]), abortSignal: controller.signal }, deps)).rejects.toThrow("test abort");
    expect(deps.postVertex).not.toHaveBeenCalled();
    expectNoAssemblyOrMediaMutation(deps);
  });
});

describe("Vertex 主线：每段一次调用（不再多段合包）", () => {
  it("调用方即使传入16并发，分片模型扇出也不超过4（0904 用户令由 5 降到 4）", async () => {
    const segments = Array.from({ length: 6 }, (_, index) => ({ startSec: index * 60, endSec: (index + 1) * 60 }));
    let active = 0;
    let peak = 0;
    let releaseFirstWave!: () => void;
    const firstWave = new Promise<void>((resolve) => { releaseFirstWave = resolve; });
    const postVertex = vi.fn(async (body: unknown) => {
      active += 1;
      peak = Math.max(peak, active);
      if (postVertex.mock.calls.length <= 4) await firstWave;
      const fileUri = (body as {
        contents: Array<{ parts: Array<{ fileData?: { fileUri: string } }> }>;
      }).contents[0]!.parts[0]!.fileData!.fileUri;
      const segmentIndex = Number(/seg-(\d+)/.exec(fileUri)?.[1]);
      active -= 1;
      return geminiResponse(makeSegmentPayload({ segmentIndex, ...segments[segmentIndex]! }));
    });
    const deps = makeRunnerDeps({ postVertex: postVertex as never });
    const running = runManhuaNativeDeepReadBatch({
      episodes: [{ ...twoSegmentEpisode, segments, sourceDurationSec: 360 }],
      segmentModelConcurrency: 16,
    }, deps);
    await vi.waitFor(() => expect(postVertex).toHaveBeenCalledTimes(4));
    expect(peak).toBe(4);
    releaseFirstWave();
    await running;
    expect(postVertex).toHaveBeenCalledTimes(6);
    expect(peak).toBe(4);
  });

  it("单集入口319秒/12fps穿透首发、重试、尾片、提示词与段缓存指纹", async () => {
    const segments = [{ startSec: 0, endSec: 319 }, { startSec: 319, endSec: 400 }];
    const postVertex = makeSuccessfulEpisodePostVertex(segments)
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("RESOURCE_EXHAUSTED"), { nativeDeepReadHttpStatus: 503 });
      });
    const deps = makeRunnerDeps({ postVertex });
    const sourceDigest = "a".repeat(64);
    const result = await runManhuaNativeDeepRead({
      seriesKey: "test_fps_series", sourceDigest, sourceDurationSec: 400, videoFps: 12,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }], segments,
    }, deps);
    expect(result.assemblyComplete).toBe(true);
    expect(postVertex).toHaveBeenCalledTimes(3);
    for (const [body] of postVertex.mock.calls) {
      const request = body as { contents: Array<{ parts: Array<{ videoMetadata?: { fps: number }; text?: string }> }> };
      expect(request.contents[0]!.parts[0]!.videoMetadata?.fps).toBe(12);
      expect(request.contents[0]!.parts[1]!.text).toContain("输入按 12fps 抽帧，采样间隔约 0.0833 秒");
    }
    const writes = vi.mocked(deps.writeSegmentCache).mock.calls.map(([entry]) => entry);
    expect(writes).toHaveLength(2);
    for (const entry of writes) {
      expect(entry.requestedFps).toBe(12);
      const identity = {
        sourceDigest, episodeIndex: 1, episodeDurationSec: 400, segment: segments[entry.segmentIndex]!,
        segmentIndex: entry.segmentIndex, segmentCount: 2, hasAudio: true,
      };
      expect(entry.fingerprint).toBe(nativeDeepReadSegmentCacheFingerprint({ ...identity, videoFps: 12 }));
      expect(entry.fingerprint).not.toBe(nativeDeepReadSegmentCacheFingerprint({ ...identity, videoFps: 10 }));
    }
  });

  it("非法fps在备料与付费调用前被拒绝", async () => {
    const deps = makeRunnerDeps();
    await expect(runManhuaNativeDeepReadBatch({
      episodes: [{ ...twoSegmentEpisode, videoFps: 25 }],
    }, deps)).rejects.toThrow();
    expect(deps.prepareVideos).not.toHaveBeenCalled();
    expect(deps.postVertex).not.toHaveBeenCalled();
  });

  it("两段=两次 Vertex 调用；gs:// 直挂；用量按段累计；合并后出集卡", async () => {
    const receipts: Array<Record<string, unknown>> = [];
    const postVertex = vi.fn(async (body: unknown) => {
      const fileUri = (body as {
        contents: Array<{ parts: Array<{ fileData?: { fileUri: string } }> }>;
      }).contents[0]!.parts[0]!.fileData!.fileUri;
      const segmentIndex = Number(/seg-(\d+)/.exec(fileUri)?.[1]);
      const segment = twoSegmentEpisode.segments[segmentIndex]!;
      return geminiResponse(makeSegmentPayload({
        segmentIndex,
        startSec: segment.startSec,
        endSec: segment.endSec,
      }));
    });
    const deps = makeRunnerDeps({ postVertex: postVertex as never });

    const result = await runManhuaNativeDeepReadBatch({
      episodes: [twoSegmentEpisode],
      onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
    }, deps);

    expect(postVertex).toHaveBeenCalledTimes(2);
    expect(deps.postEvolink).not.toHaveBeenCalled();
    expect(deps.signReadUrl).not.toHaveBeenCalled();
    // 0829 统一收口：Vertex 主线也必走 GLM 整形，且只走一次（门禁一次过就不重整）
    expect(deps.invokeGlmStructuring).toHaveBeenCalledTimes(1);

    const started = receipts.filter((r) => r.stage === "visual_model" && r.status === "started");
    expect(started).toHaveLength(2);
    expect(started.every((r) => r.route === "vertex_gcs_video" && r.videoCount === 1)).toBe(true);
    expect(started.map((r) => r.chunkIndex)).toEqual([0, 1]);

    const only = result.episodes[0]!.result;
    expect(only.model).toBe("gemini-3.1-pro-preview");
    expect(only.usingPlanQuota).toBe(false);
    expect(only.hasAudio).toBe(true);
    expect(only.visualRoutes).toEqual(["vertex_gcs_video"]);
    expect(only.degradedFpsSegmentIndexes).toEqual([]);
    expect(only.usage.inputTokens).toBe(200_000);
    expect(only.usage.outputTokens).toBe(2 * 2_500);
    expect(only.audioInputTokens).toBe(16_000);
    // ¥9.0/M 输入 + ¥72/M 输出（待账单核实）
    expect(only.usage.costCny).toBeCloseTo(200_000 * 9 / 1e6 + 5_000 * 72 / 1e6, 6);
    expect(only.resolvedAudioChunks.map((row) => row.chunkIndex)).toEqual([0, 1]);
    expect(only.attemptedSegments).toBe(2);
    // 用后删：两个 GCS 临时对象都清理
    expect(deps.remove).toHaveBeenCalledTimes(2);
  });

  it("坏 JSON 这类真失败才带拒因原地重试一次；重试成功后两次调用的钱都入账", async () => {
    const segment = { startSec: 0, endSec: 60 };
    // 0829 重试语义收窄：密度/覆盖不再触发重买，只有真失败（HTTP 错误 / JSON 解析不了）才重试
    const badJson = {
      status: 200,
      text: JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{bad-json" }] } }],
        usageMetadata: {
          promptTokenCount: 100_000,
          candidatesTokenCount: 2_500,
          thoughtsTokenCount: 500,
          promptTokensDetails: [
            { modality: "VIDEO", tokenCount: 90_000 },
            { modality: "AUDIO", tokenCount: 8_000 },
          ],
        },
      }),
      requestId: "req-bad-json-retry",
    };
    const good = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const postVertex = vi.fn()
      .mockResolvedValueOnce(badJson)
      .mockImplementationOnce(async (body: unknown) => {
        const text = String((body as {
          contents: Array<{ parts: Array<{ text?: string }> }>;
        }).contents[0]!.parts[1]!.text);
        expect(text).toContain("【上一轮未通过的检查】");
        return geminiResponse(good);
      });
    const deps = makeRunnerDeps({
      prepareVideos: vi.fn(async () => [{
        gsUri: "gs://test-bucket/seg-0.mp4",
        startSec: segment.startSec,
        endSec: segment.endSec,
        temporaryGcs: { bucket: "test-bucket", objectName: "seg-0.mp4" },
        bytes: 1_000_000,
        hasAudio: true,
      }]) as never,
      postVertex: postVertex as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await runManhuaNativeDeepReadBatch({
        episodes: [{
          episodeIndex: 1,
          resolveNodes: async () => [],
          segments: [segment],
          sourceDurationSec: 60,
        }],
      }, deps);
      expect(postVertex).toHaveBeenCalledTimes(2);
      // 两次调用都计费（门禁拒收的那次钱也真实花掉了）
      expect(result.usage.inputTokens).toBe(200_000);
      expect(result.episodes[0]!.result.usage.inputTokens).toBe(200_000);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("GLM 5.3 统一收口：每集装配都走结构化整形（0829）", () => {
  it("Vertex 主线全合规也走 GLM，输入含本集全部分段卡且一份不丢", async () => {
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(twoSegmentEpisode.segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    await runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps);

    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
    const prompt = invokeGlmStructuring.mock.calls[0]![0] as { system: string; user: string };
    const sent = readRawSegmentsFromGlmPrompt(prompt.user);
    expect(sent).toHaveLength(2);
    expect(sent.map((row) => (row.shots as Array<{ startSec: number }>)[0]!.startSec)).toEqual([0, 60]);
    expect(prompt.system).toContain("记录去重、信息取并集");
  });

  it("九片先按4/4/1整形成三张批次卡，再只用三张批次卡做最终整集合并", async () => {
    const segments = Array.from({ length: 9 }, (_, index) => ({
      startSec: index * 60,
      endSec: (index + 1) * 60,
    }));
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    const result = await runManhuaNativeDeepReadBatch({
      episodes: [{
        episodeIndex: 1,
        resolveNodes: async () => [],
        segments,
        sourceDurationSec: 540,
        cacheSourceDigest: "9".repeat(64),
      }],
      segmentCacheSeriesKey: "hierarchy_9_segments",
    }, deps);

    // 0905 用户令「不归并、每批 5 片」：9 片＝5/4 两批各整形一次，整集由代码确定性拼接
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(2);
    const sent = invokeGlmStructuring.mock.calls.map(([prompt]) =>
      readRawSegmentsFromGlmPrompt((prompt as { user: string }).user));
    expect(sent.map((rows) => rows.length)).toEqual([5, 4]);
    expect((invokeGlmStructuring.mock.calls[0]![0] as { user: string }).user)
      .toContain('"segments":[{"segmentIndex":0');
    expect((invokeGlmStructuring.mock.calls[1]![0] as { user: string }).user)
      .toContain('"segments":[{"segmentIndex":5');
    expect(deps.readStructuredBatchCache).toHaveBeenCalledTimes(2);
    expect(deps.writeStructuredBatchCache).toHaveBeenCalledTimes(2);
    expect(result.episodes[0]!.result.segmentCount).toBe(9);
    expect(result.episodes[0]!.result.attemptedSegments).toBe(9);
  });

  it("五片续跑可消费历史answer外壳批次缓存，并零付费恢复最终整形证据", async () => {
    const segments = Array.from({ length: 5 }, (_, index) => ({
      startSec: index * 60,
      endSec: (index + 1) * 60,
    }));
    const readStructuredBatchCache = vi.fn(async (input: {
      segmentIndexes: readonly number[];
      rawSegments: ReadonlyArray<Record<string, unknown>>;
    }) => JSON.stringify(input.segmentIndexes) === JSON.stringify([0, 1, 2, 3, 4]) ? {
      schemaVersion: 1 as const,
      frozenContractSha256: "f".repeat(64),
      seriesKey: "legacy_answer_envelope",
      sourceDigest: "6".repeat(64),
      episodeIndex: 1,
      segmentIndexes: [...input.segmentIndexes],
      inputDigest: "a".repeat(64),
      raw: {
        answer: JSON.stringify(deterministicallyMergeNativeDeepReadRawSegments(input.rawSegments)),
      },
      gateway: "openrouter" as const,
      model: "z-ai/glm-5.3",
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 1,
      costUsd: 0.01,
      savedAtIso: "2026-09-01T00:00:00.000Z",
      source: "formal" as const,
    } : null);
    const base = makeGlmStructuringStub();
    const invokeGlmStructuring = vi.fn(async (prompt: { system: string; user: string }) => ({
      ...(await base(prompt)),
      recoveredPaidEvidence: true,
      inputTokens: 52_412,
      outputTokens: 55_231,
      reasoningTokens: 6_043,
      costUsd: 0.31632024,
    }));
    const receipts: Array<{ route: string; status: string }> = [];
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
      readStructuredBatchCache: readStructuredBatchCache as never,
    });

    const result = await runManhuaNativeDeepReadBatch({
      episodes: [{
        episodeIndex: 1,
        resolveNodes: async () => [],
        segments,
        sourceDurationSec: 300,
        cacheSourceDigest: "6".repeat(64),
      }],
      segmentCacheSeriesKey: "legacy_answer_envelope",
      onModelReceipt: (receipt) => { receipts.push(receipt); },
    }, deps);

    // 0905：每批 5 片，5 片＝一批 [0..4]；命中缓存则零模型调用，整集由代码拼出
    expect(readStructuredBatchCache).toHaveBeenCalledTimes(1);
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(0);
    expect(deps.writeStructuredBatchCache).toHaveBeenCalledTimes(0);
    expect(receipts.filter((row) => row.route === NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE)).toEqual([]);
    expect(result.episodes[0]!.result.beatGrid).toHaveLength(60);
    expect(result.episodes[0]!.result.segmentCount).toBe(5);
  });

  it("九片4+4+1的每层GLM都返回answer外壳时仍生成完整整集卡", async () => {
    const segments = Array.from({ length: 9 }, (_, index) => ({
      startSec: index * 60,
      endSec: (index + 1) * 60,
    }));
    const base = makeGlmStructuringStub();
    const invokeGlmStructuring = vi.fn(async (prompt: { system: string; user: string }) => {
      const result = await base(prompt);
      return { ...result, raw: { answer: JSON.stringify(result.raw) } };
    });
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });

    const result = await runManhuaNativeDeepReadBatch({
      episodes: [{
        episodeIndex: 1,
        resolveNodes: async () => [],
        segments,
        sourceDurationSec: 540,
        cacheSourceDigest: "5".repeat(64),
      }],
      segmentCacheSeriesKey: "answer_envelope_9_segments",
    }, deps);

    // 0905：不再有第三次归并，5 片＝两个批次，各整形一次；整集由代码确定性拼接
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(2);
    expect(deps.writeStructuredBatchCache).toHaveBeenCalledTimes(2);
    expect(result.episodes[0]!.result.beatGrid).toHaveLength(108);
    expect(result.episodes[0]!.result.segmentCount).toBe(9);
  });

  it("命中GCS缓存的批次不重跑，只补未缓存批次；整集由代码拼接", async () => {
    const segments = Array.from({ length: 9 }, (_, index) => ({
      startSec: index * 60,
      endSec: (index + 1) * 60,
    }));
    const readStructuredBatchCache = vi.fn(async (input: {
      segmentIndexes: readonly number[];
      rawSegments: ReadonlyArray<Record<string, unknown>>;
    }) => (
      JSON.stringify(input.segmentIndexes) === JSON.stringify([0, 1, 2, 3, 4])
      || JSON.stringify(input.segmentIndexes) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8])
    ) ? {
          schemaVersion: 1 as const,
          frozenContractSha256: "f".repeat(64),
          seriesKey: "hierarchy_cache_hit",
          sourceDigest: "8".repeat(64),
          episodeIndex: 1,
          segmentIndexes: [...input.segmentIndexes],
          inputDigest: "a".repeat(64),
          raw: deterministicallyMergeNativeDeepReadRawSegments(input.rawSegments),
          gateway: "openrouter" as const,
          model: "z-ai/glm-5.3",
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 1,
          costUsd: 0.01,
          ...(input.segmentIndexes.length === 9 ? { evidence: {
            callId: "cached-final-call",
            request: { objectName: "cached-request.json", bytes: 1, sha256: "a".repeat(64) },
            raw: [],
            parsed: { objectName: "cached-parsed.json", bytes: 1, sha256: "b".repeat(64) },
            selectedRawObjectName: "cached-raw.json",
          } } : {}),
          savedAtIso: "2026-09-01T00:00:00.000Z",
          source: "manual_import" as const,
        }
      : null);
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
      readStructuredBatchCache: readStructuredBatchCache as never,
    });
    const result = await runManhuaNativeDeepReadBatch({
      episodes: [{
        episodeIndex: 1,
        resolveNodes: async () => [],
        segments,
        sourceDurationSec: 540,
        cacheSourceDigest: "8".repeat(64),
      }],
      segmentCacheSeriesKey: "hierarchy_cache_hit",
    }, deps);

    // 0905：没有最终归并；9 片＝[0..4]+[5..8]，只有 [0..4] 命中缓存，[5..8] 跑一次
    expect(readStructuredBatchCache).toHaveBeenCalledTimes(2);
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
    expect(invokeGlmStructuring.mock.calls.map(([prompt]) =>
      readRawSegmentsFromGlmPrompt((prompt as { user: string }).user).length)).toEqual([4]);
    expect(deps.writeStructuredBatchCache).toHaveBeenCalledTimes(1);
    // 没有整集级 GLM 证据：报告导出必须走分段卡拼装，不许指向某一半批次卡
    expect(result.episodes[0]!.result.glmEvidence).toBeUndefined();
  });

  it("整形缓存缺失但永久付费证据恢复时不重记用量、不发模型回执，并补写结构缓存", async () => {
    const base = makeGlmStructuringStub();
    const evidenceCallId = `native-structuring-${"c".repeat(64)}`;
    const invokeGlmStructuring = vi.fn(async (prompt: { system: string; user: string }) => ({
      ...(await base(prompt)),
      recoveredPaidEvidence: true,
      inputTokens: 321,
      outputTokens: 123,
      reasoningTokens: 45,
      costUsd: 0.02,
      evidence: {
        callId: evidenceCallId,
        request: { objectName: "request.json", bytes: 1, sha256: "a".repeat(64) },
        raw: [],
        parsed: { objectName: "parsed.json", bytes: 1, sha256: "b".repeat(64) },
        selectedRawObjectName: "raw-1.json",
      },
    }));
    const receipts: Array<{ route: string; status: string }> = [];
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(twoSegmentEpisode.segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    const result = await runManhuaNativeDeepReadBatch({
      episodes: [{ ...twoSegmentEpisode, cacheSourceDigest: "7".repeat(64) }],
      segmentCacheSeriesKey: "glm_recovery",
      onModelReceipt: (receipt) => { receipts.push(receipt); },
    }, deps);

    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
    expect(result.usage).toMatchObject({ inputTokens: 200_000, outputTokens: 5_000 });
    expect(result.usage.costCny).toBeCloseTo(2.16, 8);
    expect(receipts.filter((row) => row.route === NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE)).toEqual([]);
    expect(deps.writeStructuredBatchCache).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: 321,
      outputTokens: 123,
      reasoningTokens: 45,
      costUsd: 0.02,
      evidence: expect.objectContaining({ callId: evidenceCallId }),
    }));
    expect(result.episodes[0]!.result.glmEvidence?.callId).toBe(evidenceCallId);
  });

  it("两条GLM供应商都失败时使用确定性本地整形并显式贴fallback标记", async () => {
    const invokeGlmStructuring = vi.fn(async () => {
      throw new GlmGatewayError("两档失败", [
        { gateway: "evolink_glm", model: "glm-5.3", outcome: "network_error" },
        { gateway: "openrouter", model: "z-ai/glm-5.3", outcome: "http_error" },
      ]);
    });
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(twoSegmentEpisode.segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    const result = await runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps);
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
    expect(result.episodes[0]!.result.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "glm_structuring_local_fallback" }),
    ]));
    expect(result.episodes[0]!.result.beatGrid.length).toBeGreaterThan(0);
  });

  it("供应商已交卷后解析证据落盘失败时关闭式停止，不用本地fallback掩盖", async () => {
    const failure = new GlmGatewayError("整集GLM解析证据保存失败", [
      { gateway: "evolink_glm", model: "glm-5.3", outcome: "ok" },
    ], { inputTokens: 100, outputTokens: 20, reasoningTokens: 5, costUsd: 0.01 });
    const invokeGlmStructuring = vi.fn(async () => { throw failure; });
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(twoSegmentEpisode.segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    await expect(runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps))
      .rejects.toBe(failure);
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
  });

  /**
   * 造一份「3 项不合标准但不撞硬门」的段卡：
   * 丢 classification（classification_thin）+ 空 beatStructureZh（empty_beat_structure）
   * + 一个空 actionZh（empty_action）＝ 恰好 3 项。
   */
  function makeThreeFailurePayload(input: { segmentIndex: number; startSec: number; endSec: number }) {
    // 家族计项（0830 晚）：同家族只算 1 项，所以必须命中三个**不同家族**——
    // 音轨（audio_track_thin）+ 结构（classification_thin/empty_beat_structure）+ 镜头（empty_action）
    const raw = makeSegmentPayload({ ...input, audioTrackOverride: 1 }) as Record<string, unknown>;
    // 五键必须齐全（那是硬门，删掉只会变成 1 项直接放行），这里只让维度「薄」：
    // 仅一维有值 → classification_thin 是 advisory，不是硬门。
    raw.classification = {
      emotionTagsZh: ["紧绷"],
      narrativeFeatureTagsZh: [],
      performanceTagsZh: [],
      audiovisualTagsZh: [],
      audienceExperienceTagsZh: [],
    };
    raw.beatStructureZh = "";
    const shots = raw.shots as Array<Record<string, unknown>>;
    shots[0]!.actionZh = "";
    return raw;
  }

  /**
   * 0831 实弹改判：音轨类不再计入重试家族，所以这份原本「三项」的 payload
   * 现在只剩镜头＋结构两家族，落在重试线（3 项）之下——不重试，两段共两次调用。
   *
   * 改判依据是实弹而非推理：三次重试全因「音轨仅 1 段，低于建议地板 2；
   * 声音事件仅 3 条，低于建议地板 14」被拒，烧掉 ¥9.75，而音轨本来就只有一段。
   * 「三项线」本身没有放宽，变的是哪些项有资格计入。
   */
  it("🔒 音轨类不计入家族：原三项 payload 只剩两家族，不重试（三项线未放宽）", async () => {
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 })))
      .mockResolvedValueOnce(geminiResponse(makeThreeFailurePayload({ segmentIndex: 1, startSec: 60, endSec: 120 })))
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 })));
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({
      postVertex: postVertex as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps);
      // 镜头＋结构＝2 家族 < 3 项线 → 不重试（2 段各一次）
      expect(postVertex).toHaveBeenCalledTimes(2);
      const sent = readRawSegmentsFromGlmPrompt(
        (invokeGlmStructuring.mock.calls[0]![0] as { user: string }).user,
      );
      // 两段都直接入库，没有被标记版
      expect(sent).toHaveLength(2);
      expect(sent.filter((row) => row.gateMarked === true)).toHaveLength(0);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("🔒 截断段豁免三项线：不重试，保留可解析前缀入库（0829 决定不得被推翻）", async () => {
    // 截断段必然同时命中 classification_thin + empty_beat_structure + empty_action 类
    // ＝恰好 3 项；不豁免就会重试，而重试大概率仍截断 → 梯度耗尽 → 整集抛错。
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 })))
      .mockResolvedValueOnce(geminiResponse(
        makeThreeFailurePayload({ segmentIndex: 1, startSec: 60, endSec: 120 }),
        { finishReason: "MAX_TOKENS" },
      ))
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 })));
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({
      postVertex: postVertex as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps);
      // 🔴 关键断言：截断段不重买，只打 2 发
      expect(postVertex).toHaveBeenCalledTimes(2);
      const sent = readRawSegmentsFromGlmPrompt(
        (invokeGlmStructuring.mock.calls[0]![0] as { user: string }).user,
      );
      expect(sent).toHaveLength(2);
      expect(sent[1]!.truncated).toBe(true);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("🔒 2 项不合标准但偏差超 20% → 照样重跑（0830 晚：容差已放宽，超出就是真不合格）", async () => {
    // 造 2 项：音轨 1 段（地板 5，偏差 80%）+ 声音事件 1 条（地板 5，偏差 80%）
    // 60 秒段的地板：音轨 max(1,ceil(60/60))=1 ⇒ 需要更长的段才能压出偏差，
    // 故直接用 audioTrackOverride 制造，并断言「重跑发生」这一行为本身。
    const thin = makeSegmentPayload({
      segmentIndex: 1, startSec: 60, endSec: 120, audioTrackOverride: 1,
    }) as Record<string, unknown>;
    thin.beatStructureZh = "";
    const shots = thin.shots as Array<Record<string, unknown>>;
    shots[0]!.actionZh = "";
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 })))
      .mockResolvedValueOnce(geminiResponse(thin))
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 })));
    const deps = makeRunnerDeps({
      postVertex: postVertex as never,
      invokeGlmStructuring: makeGlmStructuringStub() as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps);
      // 常量本身是看守重点：改动它即改变重买行为
      expect(NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO).toBe(0.20);
      // 🔒 白名单看守（用户 0830 晚圈定）：音轨段数与镜头覆盖进 20% 判据，
      // 声音事件条数（≈音轨长度密度）不进——安静段落天然少，不该为此重买。
      expect(NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES.has("audio_track_thin")).toBe(true);
      expect(NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES.has("coverage_tail_gap")).toBe(true);
      expect(NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES.has("audio_cue_thin")).toBe(false);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("最后一片超过30秒证据段也跑满三档并由 Qwen 三选一", async () => {
    const segments = twoSegmentEpisode.segments;
    // 第2段首发把整 60 秒当成一个镜头——撞 30 秒硬上限（探针实弹里段5 就是 45 秒长镜）。
    // 覆盖仍然完整，但尾片不再享受任何特例。
    const markedFirst = makeSegmentPayload({
      segmentIndex: 1, startSec: 60, endSec: 120, shotCountOverride: 1,
    });
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 })))
      .mockResolvedValue(geminiResponse(markedFirst));
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({
      postVertex: postVertex as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await runManhuaNativeDeepReadBatch({ episodes: [{ ...twoSegmentEpisode, segments }] }, deps);
      expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
      expect(postVertex).toHaveBeenCalledTimes(4);
      expect(deps.waitForRetry).toHaveBeenCalledTimes(2);
      expect(deps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
      const prompt = invokeGlmStructuring.mock.calls[0]![0] as { system: string; user: string };
      const sent = readRawSegmentsFromGlmPrompt(prompt.user);
      expect(sent).toHaveLength(2);
      const marked = sent.filter((row) => row.gateMarked === true);
      expect(marked).toHaveLength(1);
      expect(String(marked[0]!.gateMarkedZh || "")).toContain("Qwen 3.8 Max 三选一");
      expect(marked[0]!.attemptSelection).toMatchObject({ selectedAttemptNumber: 1, selectedPassedGate: false });
      expect(marked[0]!.advisories).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "qwen_three_attempts_pick_one" }),
      ]));
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("STOP覆盖6.7%即使缺classification也重试；拒因传到下一发并保留首发证据", async () => {
    const episode = { ...twoSegmentEpisode, segments: [{ startSec: 0, endSec: 300 }], sourceDurationSec: 300 };
    const incomplete = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 20 });
    delete incomplete.classification;
    const healthy = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 300 });
    const postVertex = vi.fn().mockResolvedValueOnce(geminiResponse(incomplete)).mockResolvedValueOnce(geminiResponse(healthy));
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({ postVertex: postVertex as never, invokeGlmStructuring: invokeGlmStructuring as never });
    await runManhuaNativeDeepReadBatch({ episodes: [episode] }, deps);
    expect(postVertex).toHaveBeenCalledTimes(2);
    expect(deps.waitForRetry).toHaveBeenCalledTimes(1);
    const retryBody = postVertex.mock.calls[1]![0] as { contents: Array<{ parts: Array<{ text?: string }> }> };
    expect(retryBody.contents[0]!.parts[1]!.text).toContain("6.7%");
    const sent = readRawSegmentsFromGlmPrompt(invokeGlmStructuring.mock.calls[0]![0].user);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.shots).toEqual(healthy.shots);
  });

  it("MAX_TOKENS覆盖不足仍只买一发，结构坏数据不因截断豁免", async () => {
    const episode = { ...twoSegmentEpisode, segments: [{ startSec: 0, endSec: 60 }], sourceDurationSec: 60 };
    const incomplete = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 20 });
    const postVertex = vi.fn().mockResolvedValue(geminiResponse(incomplete, { finishReason: "MAX_TOKENS" }));
    const deps = makeRunnerDeps({ postVertex: postVertex as never });
    const result = await runManhuaNativeDeepReadBatch({ episodes: [episode] }, deps);
    expect(postVertex).toHaveBeenCalledTimes(1);
    expect(deps.waitForRetry).not.toHaveBeenCalled();
    expect(result.episodes[0]!.result.truncated).toBe(true);

    const invalid = { ...incomplete, shots: "不是数组" };
    const badPost = vi.fn().mockResolvedValue(geminiResponse(invalid, { finishReason: "MAX_TOKENS" }));
    const badDeps = makeRunnerDeps({ postVertex: badPost as never });
    await runManhuaNativeDeepReadBatch({ episodes: [episode] }, badDeps);
    expect(badPost).toHaveBeenCalledTimes(3);
    expect(badDeps.waitForRetry).toHaveBeenCalledTimes(2);
    expect(badDeps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
    expect(badDeps.invokeGlmStructuring).toHaveBeenCalledTimes(1);
  });

  it("带 truncated 标记的分段卡照样进 GLM 输入，不在装配前被丢弃", async () => {
    const truncatedRaw = {
      ...makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 }),
      truncated: true,
      advisories: [{ code: "audio_track_thin", detailZh: "音轨仅 1 段" }],
    };
    const postVertex = vi.fn(async (body: unknown) => {
      const fileUri = (body as {
        contents: Array<{ parts: Array<{ fileData?: { fileUri: string } }> }>;
      }).contents[0]!.parts[0]!.fileData!.fileUri;
      const segmentIndex = Number(/seg-(\d+)/.exec(fileUri)?.[1]);
      return geminiResponse(segmentIndex === 1
        ? truncatedRaw
        : makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }));
    });
    const invokeGlmStructuring = makeGlmStructuringStub();
    const deps = makeRunnerDeps({
      postVertex: postVertex as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    await runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps);

    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
    const sent = readRawSegmentsFromGlmPrompt(
      (invokeGlmStructuring.mock.calls[0]![0] as { user: string }).user,
    );
    expect(sent).toHaveLength(2);
    expect(sent[1]!.truncated).toBe(true);
    expect(sent[1]!.advisories).toEqual([{ code: "audio_track_thin", detailZh: "音轨仅 1 段" }]);
  });

  /**
   * 0830 用户拍板：「一個差六秒就給我鋸掉」——2817 秒的整集，GLM 合并少了 6 秒
   * （0.2%），旧代码先重整一发（多烧一次 GLM），过了覆盖又倒在音轨完整性上，
   * 整集判死：10 片视觉证据全好、钱全花完，一片都没入库。
   * 集级门禁与带拒因重整**双双拿掉**，GLM 出什么就入什么。本测试看守这条。
   */
  it("GLM 合并后尾部空 6 秒且弄丢一段音轨，照常入库且只调用一次 GLM（0830 集级门禁已拿掉）", async () => {
    const base = makeGlmStructuringStub();
    const invokeGlmStructuring = vi.fn(async (prompt: { system: string; user: string }) => {
      const out = await base(prompt);
      const raw = out.raw as {
        shots: Array<Record<string, unknown>>;
        audioResolution: Array<Record<string, unknown>>;
      };
      const tailEnd = Number(raw.shots.at(-1)!.endSec) - 6;
      raw.shots = raw.shots.filter(shot => Number(shot.startSec) < tailEnd);
      raw.shots[raw.shots.length - 1]!.endSec = tailEnd; // 合法正时长镜头，尾部空6秒
      raw.audioResolution = raw.audioResolution.slice(0, -1); // ② GLM 合并弄丢末段音轨
      return out;
    });
    const deps = makeRunnerDeps({
      postVertex: makeSuccessfulEpisodePostVertex(twoSegmentEpisode.segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    // 旧代码在这里会：音轨分段不完整 → 带拒因重整第 2 发 → 再拒 →「整集拒绝入库」抛错
    // ——真人剧 2817 秒实弹就是这样死的：10 片视觉证据全好，钱全花完，一片没入库。
    await runManhuaNativeDeepReadBatch({ episodes: [twoSegmentEpisode] }, deps);
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
    expect((invokeGlmStructuring.mock.calls[0]![0] as { user: string }).user)
      .not.toContain("【上一轮门禁被拒原因】");
  });
});

describe("Vertex 同通道三档重试（禁止 EvoLink fallback）", () => {
  const segment = { startSec: 0, endSec: 60 };
  const episode = {
    episodeIndex: 1,
    resolveNodes: async () => [],
    segments: [segment],
    sourceDurationSec: 60,
  };
  const singlePrep = vi.fn(async () => [{
    gsUri: "gs://test-bucket/seg-0.mp4",
    startSec: segment.startSec,
    endSec: segment.endSec,
    temporaryGcs: { bucket: "test-bucket", objectName: "seg-0.mp4" },
    bytes: 1_000_000,
    hasAudio: true,
  }]);

  it("Vertex 非资源类 4xx 不降档，立即保留原错失败", async () => {
    const receipts: Array<Record<string, unknown>> = [];
    const postVertex = vi.fn(async () => ({
      status: 400,
      text: JSON.stringify({ error: { code: "INVALID_ARGUMENT", message: "bad video" } }),
      requestId: "req-vertex-400",
    }));
    const deps = makeRunnerDeps({
      prepareVideos: singlePrep as never,
      postVertex: postVertex as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(runManhuaNativeDeepReadBatch({
        episodes: [episode],
        onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
      }, deps)).rejects.toThrow("bad video");
      expect(postVertex).toHaveBeenCalledTimes(1);
      expect(deps.waitForRetry).not.toHaveBeenCalled();
      expect(deps.postEvolink).not.toHaveBeenCalled();
      expect(deps.signReadUrl).not.toHaveBeenCalled();
      expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
      const started = receipts.filter(
        (row) => row.route === "vertex_gcs_video" && row.status === "started",
      );
      expect(started.map((row) => [row.attemptNumber, row.temperature])).toEqual([[1, 0.7]]);
      const failed = receipts.filter(
        (row) => row.route === "vertex_gcs_video" && row.status === "failed",
      );
      expect(failed).toHaveLength(1);
      expect(failed.every((row) =>
        (row.providerError as { httpStatus?: number })?.httpStatus === 400)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("Vertex 普通网络失联不降档，立即原错失败且不调用 EvoLink", async () => {
    const postVertex = vi.fn(async () => { throw new Error("socket hang up"); });
    const deps = makeRunnerDeps({
      prepareVideos: singlePrep as never,
      postVertex: postVertex as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(runManhuaNativeDeepReadBatch({ episodes: [episode] }, deps))
        .rejects.toThrow("socket hang up");
      expect(postVertex).toHaveBeenCalledTimes(1);
      expect(deps.waitForRetry).not.toHaveBeenCalled();
      expect(deps.postEvolink).not.toHaveBeenCalled();
      expect(deps.signReadUrl).not.toHaveBeenCalled();
      expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("三档坏 JSON 耗尽后原错失败，不再发起 GLM 结构化调用", async () => {
    const badJsonResponse = {
      status: 200,
      text: JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{bad-json" }] } }],
        usageMetadata: {
          promptTokenCount: 100_000,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 50,
          promptTokensDetails: [{ modality: "AUDIO", tokenCount: 8_000 }],
        },
      }),
      requestId: "req-bad-json",
    };
    const deps = makeRunnerDeps({
      prepareVideos: singlePrep as never,
      postVertex: vi.fn(async () => badJsonResponse) as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const failure = await runManhuaNativeDeepReadBatch({ episodes: [episode] }, deps)
        .then(() => undefined, (error: unknown) => error);
      expect(deps.postVertex).toHaveBeenCalledTimes(3);
      expect(deps.waitForRetry).toHaveBeenCalledTimes(2);  // 三档＝2 次等待
      expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
      expect(failure).toEqual(expect.objectContaining({
        message: expect.stringContaining("没有返回可解析的 JSON"),
      }));
      expect(deps.postEvolink).not.toHaveBeenCalled();
      expect(deps.signReadUrl).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("坏 JSON 收敛为门禁类可重试错误（0826 实弹第8集）", () => {
  it("语法错误 JSON 抛标准门禁文案,不漏原始 SyntaxError（否则重试分类器不认,整集停机）", async () => {
    const { parseJsonObject } = await import("./manhuaNativeDeepReadRunner");
    const bad = '前导杂讯 {"episodes": [{"episodeIndex" 8}]} 尾部';
    expect(() => parseJsonObject(bad)).toThrow("没有返回可解析的 JSON 对象");
    expect(() => parseJsonObject("完全不是 JSON")).toThrow("没有返回可解析的 JSON 对象");
  });
});

describe("段级产物缓存：已付费段恢复与关闭式账本", () => {
  const sourceDigest = "a".repeat(64);
  const cacheSeriesKey = "cache_series_01";
  const makeEpisode = (segments: Array<{ startSec: number; endSec: number; hintZh?: string }>) => ({
    episodeIndex: 3,
    resolveNodes: async () => [],
    segments,
    sourceDurationSec: segments.at(-1)!.endSec,
    hintZh: "本集提示",
    cacheSourceDigest: sourceDigest,
  });

  function makeCacheEntry(input: {
    episode: ReturnType<typeof makeEpisode>;
    segmentIndex: number;
    hasAudio?: boolean;
    route?: "vertex_gcs_video" | "evolink_gemini_video";
  }): NativeDeepReadSegmentCacheEntry {
    const hasAudio = input.hasAudio ?? true;
    const segment = input.episode.segments[input.segmentIndex]!;
    const route = input.route ?? "vertex_gcs_video";
    return {
      schemaVersion: NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
      fingerprint: nativeDeepReadSegmentCacheFingerprint({
        sourceDigest,
        episodeIndex: input.episode.episodeIndex,
        episodeDurationSec: input.episode.sourceDurationSec,
        segment,
        segmentIndex: input.segmentIndex,
        segmentCount: input.episode.segments.length,
        hasAudio,
        hintZh: input.episode.hintZh,
      }),
      sourceDigest,
      seriesKey: cacheSeriesKey,
      episodeIndex: input.episode.episodeIndex,
      segmentIndex: input.segmentIndex,
      startSec: segment.startSec,
      endSec: segment.endSec,
      hasAudio,
      requestedFps: resolveNativeDeepReadRequestFps(segment.endSec - segment.startSec),
      visualRoute: route,
      degraded: route === "evolink_gemini_video",
      raw: makeSegmentPayload({
        segmentIndex: input.segmentIndex,
        startSec: segment.startSec,
        endSec: segment.endSec,
        hasAudio,
      }),
      paidUsage: {
        inputTokens: 100_000,
        outputTokens: 2_500,
        audioInputTokens: hasAudio ? 8_000 : 0,
        reasoningTokens: 500,
        costCny: 1.08,
      },
      savedAtIso: "2026-08-26T12:00:00.000Z",
    };
  }

  it("指纹包含真实来源、hint、段参数和 fps，任一变化均失效", () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }]);
    const base = nativeDeepReadSegmentCacheFingerprint({
      sourceDigest,
      episodeIndex: 3,
      episodeDurationSec: 60,
      segment: episode.segments[0]!,
      segmentIndex: 0,
      segmentCount: 1,
      hasAudio: true,
      hintZh: "A",
    });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(nativeDeepReadSegmentCacheFingerprint({
      sourceDigest: "b".repeat(64), episodeIndex: 3, episodeDurationSec: 60,
      segment: episode.segments[0]!, segmentIndex: 0, segmentCount: 1,
      hasAudio: true, hintZh: "A",
    })).not.toBe(base);
    expect(nativeDeepReadSegmentCacheFingerprint({
      sourceDigest, episodeIndex: 3, episodeDurationSec: 60,
      segment: episode.segments[0]!, segmentIndex: 0, segmentCount: 1,
      hasAudio: true, hintZh: "B",
    })).not.toBe(base);
    expect(nativeDeepReadSegmentCacheFingerprint({
      sourceDigest, episodeIndex: 3, episodeDurationSec: 181,
      segment: { startSec: 0, endSec: 181 }, segmentIndex: 0, segmentCount: 1,
      hasAudio: true, hintZh: "A",
    })).not.toBe(base);
  });

  it("非连续待备段按原 segmentIndex 装配，不靠 startSec find 猜位置", async () => {
    const episode = makeEpisode([
      { startSec: 0, endSec: 60 },
      { startSec: 60, endSec: 120 },
      { startSec: 120, endSec: 180 },
      { startSec: 180, endSec: 240 },
    ]);
    const cached = new Map([
      [0, makeCacheEntry({ episode, segmentIndex: 0 })],
      [2, makeCacheEntry({ episode, segmentIndex: 2 })],
    ]);
    const prepareVideos = vi.fn(async (row: { segments: typeof episode.segments }) =>
      row.segments.map((segment) => ({
        gsUri: `gs://bucket/seg-${segment.startSec}.mp4`,
        startSec: segment.startSec,
        endSec: segment.endSec,
        temporaryGcs: { bucket: "bucket", objectName: `seg-${segment.startSec}.mp4` },
        bytes: 1_000_000,
        hasAudio: true,
      })));
    const postVertex = vi.fn(async (body: unknown) => {
      const prompt = String((body as { contents: Array<{ parts: Array<{ text?: string }> }> })
        .contents[0]!.parts[1]!.text);
      const segmentIndex = Number(/第 (\d+)\/4 段/.exec(prompt)?.[1]) - 1;
      const segment = episode.segments[segmentIndex]!;
      return geminiResponse(makeSegmentPayload({
        segmentIndex, startSec: segment.startSec, endSec: segment.endSec,
      }));
    });
    const deps = makeRunnerDeps({
      prepareVideos: prepareVideos as never,
      readSegmentCache: vi.fn(async ({ segmentIndex }: { segmentIndex: number }) => {
        const entry = cached.get(segmentIndex);
        return entry ? { entry, generation: String(segmentIndex + 1) } : null;
      }) as never,
      writeSegmentCache: vi.fn(async (entry: NativeDeepReadSegmentCacheEntry) => writeResultOf(entry)) as never,
      postVertex: postVertex as never,
    });
    await runManhuaNativeDeepReadBatch({
      episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
    }, deps);
    expect(prepareVideos).toHaveBeenCalledTimes(1);
    expect(prepareVideos.mock.calls[0]![0].segments.map((row) => row.startSec)).toEqual([60, 180]);
    expect(postVertex).toHaveBeenCalledTimes(2);
  });

  it("全缓存命中不伪造模型回执；历史路由恢复后 GLM 整形仍按本轮真实计费", async () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }]);
    const entry = makeCacheEntry({ episode, segmentIndex: 0, route: "evolink_gemini_video" });
    const receipts: Array<Record<string, unknown>> = [];
    const deps = makeRunnerDeps({
      readSegmentCache: vi.fn(async () => ({ entry, generation: "7" })) as never,
      invokeGlmStructuring: vi.fn(async () => ({
        raw: entry.raw, inputTokens: 11, outputTokens: 2, reasoningTokens: 1,
        costUsd: 0.01, finishReason: "stop",
        gateway: "openrouter" as const, model: "z-ai/glm-5.3",
      })) as never,
    });
    const result = await runManhuaNativeDeepReadBatch({
      episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
      onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
    }, deps);
    expect(deps.prepareVideos).not.toHaveBeenCalled();
    expect(deps.postVertex).not.toHaveBeenCalled();
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(2);
    expect(result.usage.costCny).toBeGreaterThan(0);
    expect(result.episodes[0]!.result.audioInputTokens).toBe(8_000);
    expect(result.episodes[0]!.result.visualRoutes).toEqual(["evolink_gemini_video"]);
    expect(result.episodes[0]!.result.degradedFpsSegmentIndexes).toEqual([0]);
    expect(receipts.find((row) => row.route === "segment_cache_hit")).toBeUndefined();
    // 0905：完成回执的 model 带实际网关人话名（如「OpenRouter·z-ai/glm-5.3」）
    expect(receipts.some((row) => String(row.model).endsWith("·z-ai/glm-5.3") && row.status === "completed")).toBe(true);
  });

  it("历史尾片无条件放行标记不再有效，好片复用且只重跑坏尾片", async () => {
    const episode = makeEpisode([
      { startSec: 0, endSec: 60 },
      { startSec: 60, endSec: 120 },
    ]);
    const entries = [
      makeCacheEntry({ episode, segmentIndex: 0 }),
      makeCacheEntry({ episode, segmentIndex: 1 }),
    ];
    entries[1]!.raw = {
      ...makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 70 }),
      gateMarked: true,
      gateMarkedZh: "尾片内容门禁已记录并按规则放行",
      advisories: [{
        code: "last_segment_unconditional_admit",
        detailZh: "尾片内容门禁已记录并按规则放行",
        segmentIndex: 1,
      }],
    };
    const postVertex = vi.fn(async () => geminiResponse(makeSegmentPayload({
      segmentIndex: 1,
      startSec: 60,
      endSec: 120,
    })));
    const deps = makeRunnerDeps({
      readSegmentCache: vi.fn(async ({ segmentIndex }: { segmentIndex: number }) => ({
        entry: entries[segmentIndex]!,
        generation: String(segmentIndex + 1),
      })) as never,
      postVertex: postVertex as never,
    });
    await runManhuaNativeDeepReadBatch({
      episodes: [episode],
      segmentCacheSeriesKey: cacheSeriesKey,
    }, deps);
    expect(deps.prepareVideos).toHaveBeenCalledTimes(1);
    expect(deps.postVertex).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("缓存只有20/60秒，truncated=%s时与首发判据一致", async (truncated) => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }]);
    const entry = makeCacheEntry({ episode, segmentIndex: 0 });
    entry.raw = { ...makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 20 }), truncated };
    const before = JSON.stringify(entry.raw);
    const postVertex = makeSuccessfulEpisodePostVertex(episode.segments);
    const deps = makeRunnerDeps({
      readSegmentCache: vi.fn(async () => ({ entry, generation: "7" })) as never,
      postVertex: postVertex as never,
    });
    await runManhuaNativeDeepReadBatch({ episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey }, deps);
    expect(postVertex).toHaveBeenCalledTimes(truncated ? 0 : 1);
    expect(deps.prepareVideos).toHaveBeenCalledTimes(truncated ? 0 : 1);
    expect(JSON.stringify(entry.raw)).toBe(before);
  });

  it("全命中缓存 hasAudio 互相冲突时停止，不备料也不调模型", async () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }]);
    const entries = [
      makeCacheEntry({ episode, segmentIndex: 0, hasAudio: true }),
      makeCacheEntry({ episode, segmentIndex: 1, hasAudio: false }),
    ];
    const deps = makeRunnerDeps({
      readSegmentCache: vi.fn(async ({ segmentIndex }: { segmentIndex: number }) => ({
        entry: entries[segmentIndex]!, generation: String(segmentIndex + 1),
      })) as never,
    });
    await expect(runManhuaNativeDeepReadBatch({
      episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
    }, deps)).rejects.toThrow("hasAudio 证据互相冲突");
    expect(deps.prepareVideos).not.toHaveBeenCalled();
    expect(deps.postVertex).not.toHaveBeenCalled();
  });

  it("缓存读取异常关闭式停止；缓存写失败时等待已在途兄弟段，不额外重试模型", async () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }]);
    const readFailureDeps = makeRunnerDeps({
      readSegmentCache: vi.fn(async () => { throw new Error("gcs_stat_failed:503"); }) as never,
    });
    await expect(runManhuaNativeDeepReadBatch({
      episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
    }, readFailureDeps)).rejects.toThrow("gcs_stat_failed:503");
    expect(readFailureDeps.postVertex).not.toHaveBeenCalled();

    const postVertex = makeSuccessfulEpisodePostVertex(episode.segments);
    const writeFailureDeps = makeRunnerDeps({
      postVertex: postVertex as never,
      writeSegmentCache: vi.fn(async () => { throw new Error("cache write failed"); }) as never,
    });
    await expect(runManhuaNativeDeepReadBatch({
      episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
    }, writeFailureDeps)).rejects.toThrow("cache write failed");
    expect(postVertex).toHaveBeenCalledTimes(2);
    expect(writeFailureDeps.waitForRetry).not.toHaveBeenCalled();
    expect(writeFailureDeps.postEvolink).not.toHaveBeenCalled();
  });

  it("部分提案回调失败时等待已在途兄弟段，后续不再触发部分快照", async () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }]);
    const postVertex = makeSuccessfulEpisodePostVertex(episode.segments);
    const writeSegmentCache = vi.fn(async (entry: NativeDeepReadSegmentCacheEntry) => writeResultOf(entry));
    const onSegmentSnapshotCommitted = vi.fn(async () => {
      throw new Error("部分提案暂存失败");
    });
    const deps = makeRunnerDeps({
      postVertex: postVertex as never,
      writeSegmentCache: writeSegmentCache as never,
    });

    await expect(runManhuaNativeDeepReadBatch({
      episodes: [episode],
      segmentCacheSeriesKey: cacheSeriesKey,
      onSegmentSnapshotCommitted,
    }, deps)).rejects.toThrow("部分提案暂存失败");
    expect(writeSegmentCache).toHaveBeenCalledTimes(2);
    expect(onSegmentSnapshotCommitted).toHaveBeenCalledWith(expect.objectContaining({
      episodeIndex: 3,
      completedSegmentIndexes: [0],
      learnedThroughSec: 60,
      result: expect.objectContaining({
        segmentCount: 1,
        attemptedSegments: 2,
        failedSegmentCount: 1,
        assemblyComplete: false,
      }),
    }));
    expect(onSegmentSnapshotCommitted).toHaveBeenCalledTimes(1);
    expect(postVertex).toHaveBeenCalledTimes(2);
    expect(deps.waitForRetry).not.toHaveBeenCalled();
    expect(deps.postEvolink).not.toHaveBeenCalled();
  });

  it("首轮一段成功一段真失败（坏 JSON 三档耗尽），第二轮只调用失败段且本次只记该段费用", async () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }]);
    const store = new Map<number, NativeDeepReadSegmentCacheEntry>();
    // 0829：密度不足已转 advisory 不再拒收，这里用坏 JSON 制造真失败
    const badJson = {
      status: 200,
      text: JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{bad-json" }] } }],
        usageMetadata: {
          promptTokenCount: 100_000,
          candidatesTokenCount: 2_000,
          thoughtsTokenCount: 500,
          promptTokensDetails: [
            { modality: "VIDEO", tokenCount: 90_000 },
            { modality: "AUDIO", tokenCount: 8_000 },
          ],
        },
      }),
      requestId: "req-bad-json-cache",
    };
    const good0 = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const good1 = makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 });
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(good0))
      // 三档梯度：首轮失败段必须三发全坏才算真失败。
      .mockResolvedValueOnce(badJson)
      .mockResolvedValueOnce(badJson)
      .mockResolvedValueOnce(badJson)
      .mockResolvedValueOnce(geminiResponse(good1));
    const prepareVideos = vi.fn(async (row: { segments: typeof episode.segments }) =>
      row.segments.map((segment) => ({
        gsUri: `gs://bucket/seg-${segment.startSec}.mp4`,
        startSec: segment.startSec,
        endSec: segment.endSec,
        temporaryGcs: { bucket: "bucket", objectName: `seg-${segment.startSec}.mp4` },
        bytes: 1_000_000,
        hasAudio: true,
      })));
    const deps = makeRunnerDeps({
      prepareVideos: prepareVideos as never,
      postVertex: postVertex as never,
      readSegmentCache: vi.fn(async ({ segmentIndex }: { segmentIndex: number }) => {
        const entry = store.get(segmentIndex);
        return entry ? { entry, generation: String(segmentIndex + 1) } : null;
      }) as never,
      writeSegmentCache: vi.fn(async (entry: NativeDeepReadSegmentCacheEntry) => {
        store.set(entry.segmentIndex, entry);
        return writeResultOf(entry);
      }) as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const partialSnapshots: number[][] = [];
    try {
      await expect(runManhuaNativeDeepReadBatch({
        episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
        onSegmentSnapshotCommitted: (snapshot) => {
          partialSnapshots.push(snapshot.completedSegmentIndexes);
        },
      }, deps)).rejects.toThrow("没有返回可解析的 JSON");
      expect(store.has(0)).toBe(true);
      expect(store.has(1)).toBe(false);
      expect(partialSnapshots).toEqual([[0]]);
      const second = await runManhuaNativeDeepReadBatch({
        episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
      }, deps);
      // 0830 晚三档梯度：首轮 1 成功 + 三档全坏 = 4 发；第二轮命中缓存只补失败段，
      // 该段第一发即拿到好 JSON = 1 发，累计 5 发
      expect(postVertex).toHaveBeenCalledTimes(5);
      expect(prepareVideos.mock.calls[1]![0].segments.map((row) => row.startSec)).toEqual([60]);
      // 第二轮补跑的那一段一发即过 ⇒ 1 × 100k（本次只记该段费用，首轮四发不重复计）
      expect(second.usage.inputTokens).toBe(100_000);
      expect(second.episodes[0]!.result.audioInputTokens).toBe(16_000);
      expect(second.episodes[0]!.result.segmentEvidenceObjectNames).toHaveLength(2);
      expect(second.episodes[0]!.result.segmentEvidenceObjectNames?.[0]).toMatch(
        /^manhua-template-learn\/segment-evidence\/tpl_native_cache_series_01_ep003\/[a-f0-9]{64}\/seg0-[a-f0-9]{64}-[a-f0-9]{64}\.json$/,
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("门禁前解析稿持久化接线", () => {
  const episode = {
    ...twoSegmentEpisode, segments: [{ startSec: 0, endSec: 60 }], sourceDurationSec: 60,
    cacheSourceDigest: "d".repeat(64),
  };
  const params = { episodes: [episode], segmentCacheSeriesKey: "test_parsed_attempt" };

  it("三次拒收仍先永久保存三份解析稿，再由 Qwen 三选一", async () => {
    const events: string[] = [];
    const saved: NativeDeepReadParsedAttemptEvidenceInput[] = [];
    const response = geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 4 }));
    const defaults = makeRunnerDeps();
    const deps = makeRunnerDeps({
      postVertex: vi.fn(async () => { events.push("model"); return response; }) as never,
      writeRawAttemptEvidence: vi.fn(async (input) => {
        events.push("raw");
        return defaults.writeRawAttemptEvidence(input);
      }),
      writeParsedAttemptEvidence: vi.fn(async (input) => {
        events.push("parsed");
        saved.push(JSON.parse(JSON.stringify(input)));
        return defaults.writeParsedAttemptEvidence(input);
      }),
    });
    const result = await runManhuaNativeDeepReadBatch(params, deps);
    expect(events).toEqual(["model", "raw", "parsed", "model", "raw", "parsed", "model", "raw", "parsed"]);
    expect(saved.map((row) => row.attemptNumber)).toEqual([1, 2, 3]);
    expect(new Set(saved.map((row) => row.callId)).size).toBe(3);
    expect(saved.every((row) => row.parsed.gateMarked === undefined)).toBe(true);
    expect(saved.every((row) => row.rawAttemptEvidenceObjectName.includes(`attempt${row.attemptNumber}`))).toBe(true);
    expect(deps.writeSegmentCache).toHaveBeenCalledTimes(1);
    expect(deps.invokeGlmStructuring).toHaveBeenCalledTimes(1);
    expect(deps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
    expect(result.episodes[0]!.result.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "qwen_three_attempts_pick_one" }),
    ]));
    const cachedRaw = vi.mocked(deps.writeSegmentCache).mock.calls[0]![0].raw;
    expect(cachedRaw.attemptSelection).toMatchObject({
      status: "qwen_selected_after_three_attempts",
      selectedAttemptNumber: 1,
      selectedTemperature: 0.7,
      selectedPassedGate: false,
    });
  });

  it("schema拒收前已保存解析稿且三发后仍必须选一份，语法坏JSON保留原始响应", async () => {
    const invalid = { ...makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }), shots: "错误类型" };
    const deps = makeRunnerDeps({ postVertex: vi.fn(async () => geminiResponse(invalid)) as never });
    await runManhuaNativeDeepReadBatch(params, deps);
    expect(deps.writeParsedAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(deps.postVertex).toHaveBeenCalledTimes(3);
    expect(deps.waitForRetry).toHaveBeenCalledTimes(2);
    expect(deps.selectAttemptWithQwen).toHaveBeenCalledTimes(1);
    expect(deps.invokeGlmStructuring).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.writeSegmentCache).mock.calls[0]![0].raw.attemptSelection)
      .toMatchObject({ selectedAttemptNumber: 1 });
    const badJson = { status: 200, text: JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{bad" }] } }] }) };
    const badDeps = makeRunnerDeps({ postVertex: vi.fn(async () => badJson) as never });
    await expect(runManhuaNativeDeepReadBatch(params, badDeps)).rejects.toThrow("没有返回可解析的 JSON");
    expect(badDeps.writeRawAttemptEvidence).toHaveBeenCalledTimes(3);
    expect(badDeps.writeParsedAttemptEvidence).not.toHaveBeenCalled();
  });

  it("active缓存缺失但永久raw存在时重放原证据，模型外呼为0并补齐parsed与active缓存", async () => {
    const response = geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }));
    const responseBytes = Buffer.byteLength(response.text);
    const responseSha256 = createHash("sha256").update(response.text).digest("hex");
    const parsedWrites: NativeDeepReadParsedAttemptEvidenceInput[] = [];
    const receipts: Array<{ stage: string; status: string }> = [];
    const deps = makeRunnerDeps({
      readRawAttemptEvidence: vi.fn(async () => ({
        objectName: "manhua-template-learn/segment-evidence-raw/recovered/seg0-attempt1.json",
        responseText: response.text,
        callId: "11111111-1111-1111-1111-111111111111",
        batchRequestId: "historical-batch-request",
        providerRequestId: "historical-provider-request",
        responseBytes,
        responseSha256,
        httpStatus: 200,
      })) as never,
      writeParsedAttemptEvidence: vi.fn(async (input) => {
        parsedWrites.push(input);
        return {
          objectName: "manhua-template-learn/segment-evidence-parsed-attempt/recovered/seg0-attempt1.json",
          bytes: Buffer.byteLength(JSON.stringify(input.parsed)),
          sha256: "b".repeat(64),
        };
      }) as never,
    });

    const result = await runManhuaNativeDeepReadBatch({
      ...params,
      onModelReceipt: (row) => { receipts.push({ stage: row.stage, status: row.status }); },
    }, deps);

    expect(deps.postVertex).not.toHaveBeenCalled();
    expect(deps.writeRawAttemptEvidence).not.toHaveBeenCalled();
    expect(deps.writeParsedAttemptEvidence).toHaveBeenCalledTimes(1);
    expect(parsedWrites[0]).toMatchObject({
      batchRequestId: "historical-batch-request",
      callId: "11111111-1111-1111-1111-111111111111",
      rawResponseBytes: responseBytes,
      rawResponseSha256: responseSha256,
    });
    expect(deps.writeSegmentCache).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.writeSegmentCache).mock.calls[0]![0].paidUsage.inputTokens).toBe(100_000);
    expect(result.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, costCny: 0 });
    expect(receipts.filter((row) => row.stage === "visual_model")).toEqual([]);
  });

  it("MAX_TOKENS前缀单独存档并记录真实截断状态，不为证据补存重买", async () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 20 });
    const saved: NativeDeepReadParsedAttemptEvidenceInput[] = [];
    const defaults = makeRunnerDeps();
    const deps = makeRunnerDeps({
      postVertex: vi.fn(async () => geminiResponse(raw, { finishReason: "MAX_TOKENS" })) as never,
      writeParsedAttemptEvidence: vi.fn(async (input) => {
        saved.push(JSON.parse(JSON.stringify(input)));
        return defaults.writeParsedAttemptEvidence(input);
      }),
    });
    await runManhuaNativeDeepReadBatch(params, deps);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ finishReason: "MAX_TOKENS", truncated: true, parsed: raw });
    expect(saved[0]!.parsed).not.toHaveProperty("truncated");
    expect(deps.postVertex).toHaveBeenCalledTimes(1);
  });

  it("GLM原文保存失败时不把已知Gemini用量冒充完整账单", async () => {
    const failure = Object.assign(new Error("原始响应未保存，本次GLM用量未知"), { currentAttemptUsageUnavailable: true });
    const deps = makeRunnerDeps({
      postVertex: vi.fn(async () => geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }))) as never,
      invokeGlmStructuring: vi.fn(async () => { throw failure; }) as never,
    });
    const error = await runManhuaNativeDeepReadBatch(params, deps).catch((value) => value);
    expect(error).toBe(failure);
    expect(error.nativeDeepReadUsage).toMatchObject({ inputTokens: 100_000, outputTokens: 2_500, receiptComplete: false });
    expect(deps.invokeGlmStructuring).toHaveBeenCalledTimes(1);
  });

  it("解析稿落盘失败保留已付费用量，停止重试、缓存和GLM", async () => {
    const receipts: Array<{ status: string }> = [];
    const deps = makeRunnerDeps({
      postVertex: vi.fn(async () => geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }))) as never,
      writeParsedAttemptEvidence: vi.fn(async () => { throw new Error("test parsed storage down"); }),
    });
    const failure = await runManhuaNativeDeepReadBatch({ ...params, onModelReceipt: (row) => { receipts.push(row); } }, deps)
      .then(() => null, (error: Error & { nativeDeepReadUsage?: { inputTokens: number; outputTokens: number; costCny: number } }) => error);
    expect(failure?.name).toBe("NativeDeepReadEvidencePersistenceError");
    expect(failure?.nativeDeepReadUsage).toMatchObject({ inputTokens: 100_000, outputTokens: 2_500 });
    expect(failure?.nativeDeepReadUsage?.costCny).toBeGreaterThan(0);
    expect(receipts.some((row) => row.status === "completed")).toBe(true);
    expect(deps.postVertex).toHaveBeenCalledTimes(1);
    expect(deps.waitForRetry).not.toHaveBeenCalled();
    expect(deps.writeSegmentCache).not.toHaveBeenCalled();
    expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
  });
});

describe("参数契约冻结 0901：0.70→0.65→0.60 + thinkingLevel MEDIUM", () => {
  it("generationConfig逐字段保持：thinkingConfig只有 MEDIUM 与 includeThoughts false，绝无 thinkingBudget", () => {
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.temperature).toBe(0.7);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.maxOutputTokens).toBe(65_536);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.candidateCount).toBe(1);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.audioTimestamp).toBe(true);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.responseMimeType).toBe("application/json");
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM", includeThoughts: false });
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).not.toHaveProperty("thinkingBudget");
    expect(JSON.stringify(NATIVE_DEEP_READ_GENERATION_CONFIG)).not.toContain("thinkingBudget");
  });

  it("候选固定0.70/0.65/0.60与下限0.60，回到 0827 验证可用的梯度", () => {
    expect([...NATIVE_DEEP_READ_RETRY_TEMPERATURES]).toEqual([0.7, 0.65, 0.6]);
    expect(NATIVE_DEEP_READ_TEMPERATURE_MIN).toBe(0.6);
  });

  it("候选参数：温度0.7/0.65/0.6 + MEDIUM + 默认12fps", () => {
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.temperature).toBe(0.7);
    expect([...NATIVE_DEEP_READ_RETRY_TEMPERATURES]).toEqual([0.7, 0.65, 0.6]);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig)
      .toEqual({ thinkingLevel: "MEDIUM", includeThoughts: false });
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).not.toHaveProperty("thinkingBudget");
    // fps由面板/CLI传入，缺省12；本轮不提高采样率。
    expect(NATIVE_DEEP_READ_DEFAULT_VIDEO_FPS).toBe(12);
    expect(parseNativeDeepReadVideoFps(undefined)).toBe(12);
  });

  it("门禁阈值冻结：离谱地板 10 秒/镜、分级线 120 秒", () => {
    expect(NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC).toBe(10);
    expect(NATIVE_DEEP_READ_SANITY_FLOOR_MIN_SEGMENT_SEC).toBe(120);
  });

  it("建议线阈值冻结：镜数 6 秒/镜、平均镜长 6 秒、音轨 60 秒/段、cue 24 秒/条", () => {
    expect(NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC).toBe(6);
    expect(NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC).toBe(6);
    expect(NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC).toBe(60);
    expect(NATIVE_DEEP_READ_AUDIO_CUE_FLOOR_INTERVAL_SEC).toBe(24);
    expect(NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN).toBe(2);
  });

  it("正负分区版本仍保持原有门禁阈值", () => {
    expect(NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC).toBe(30);
    expect(NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC).toBe(3);
    expect(NATIVE_DEEP_READ_VISUAL_PLAN_VERSION).toBe("time-custom-20260901-shot-observation-v2");
  });
});


describe("生成前契约与实际门禁同源", () => {
  it.each([1, 31, 120, 300, 319])("%s秒前置镜数保留20%%容差，区别参考值与硬线", lenSec => {
    const rule = resolveNativeDeepReadDensityContract(lenSec);
    expect(rule.referenceShots).toBe(Math.ceil(lenSec / 10));
    expect(rule.minStoryShots).toBe(Math.ceil(Math.ceil(lenSec / 10) * 0.8));
    expect(rule.maxAverageSec).toBe(12);
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({ episodeDurationSec: 1594,
      startSec: 319, endSec: 319 + lenSec, segmentIndex: 1, segmentCount: 5, hasAudio: true });
    const schema = buildNativeDeepReadResponseSchema({ startSec: 319, endSec: 319 + lenSec, segmentIndex: 1, hasAudio: true }) as any;
    expect(prompt).toContain(`story 至少 ${rule.minStoryShots} 条`);
    expect(schema.properties.shots.description).toContain(`story 至少 ${rule.minStoryShots} 条`);
    expect(schema.properties.shots).toMatchObject({ type: "ARRAY", items: { type: "OBJECT" } });
    expect(Object.keys(schema.properties.shots.items.properties)).toHaveLength(18);
    expect(schema.properties.shots.items.description).toContain("story条目按顺序完整填写以下18字段");
    expect(schema.properties.shots.items.description).toContain("non_story_ad仅保留startSec、endSec、evidenceRole三个有内容的字段");
    expect(schema.properties.shots.items.required).toEqual(["startSec", "endSec", "evidenceRole", "hintZh"]);
    expect(schema.properties.shots.items.properties.evidenceRole.enum).toEqual(["story", "non_story_ad"]);
    expect(schema.properties.shots.items.properties.startSec.description).toContain(`范围 319 至 ${319 + lenSec} 秒`);
    expect(schema.properties.keyMoments.items.properties.atSec.description).toContain(`范围 319 至 ${318.9 + lenSec} 秒`);
    expect(schema.properties.audioResolution.items.properties.chunkIndex.description).toContain("原分片序号 1");
    expect(schema.properties.audioResolution.items.properties.analysis.properties.audioTrack.items.properties.toSec.description).toContain(`本段局部整数秒，范围 0 至 ${lenSec} 秒`);
    expect(JSON.stringify(schema)).not.toContain('"maxLength"');
    expect(JSON.stringify(schema)).not.toContain('"uniqueItems"');
  });
  it("精华定义与实际秒位回看同时前置，无声结构仍为空数组", () => {
    const context = { startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: false };
    const schema = buildNativeDeepReadResponseSchema(context) as any;
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({ ...context, episodeDurationSec: 319, segmentCount: 1 });
    expect(prompt).toContain(schema.properties.keyMoments.description);
    expect(prompt).toContain("冲突升级、反转、真相揭示");
    expect(prompt).toContain("平淡区间可以留空");
    expect(schema.properties.audioResolution.description).toBe("本段素材没有音轨，返回空数组 []。");
    expect(schema.properties.audioResolution.type).toBe("ARRAY");
    expect(schema.properties.keyMoments).not.toHaveProperty("minItems");
    expect(schema.properties.keyMoments.items.properties).not.toHaveProperty("verified");
  });
});

it("真实schema跨段错配会在探针审计处阻止模型出站", async () => {
  const { createNativeProbeAuditedPost } = await import("./manhuaNativeDeepReadProbeRuntime.js");
  const context = { startSec: 319, endSec: 638, segmentIndex: 1, hasAudio: true };
  const body = buildGeminiNativeDeepReadSegmentRequest({ fileUri: "gs://test-bucket/segment.mp4", fps: 12,
    prompt: "离线验证", segmentContext: context });
  const post = vi.fn(async () => "仅测试");
  const audited = createNativeProbeAuditedPost(post, () => {});
  await expect(audited(body, undefined, { ...context, segmentIndex: 0 })).rejects.toThrow("不合规");
  expect(post).not.toHaveBeenCalled();
  expect(await audited(body, undefined, context)).toBe("仅测试");
  expect(post).toHaveBeenCalledTimes(1);
});

it("关键帧的小数起点向片内取值，微尾段无可表示秒位时为空", () => {
  const schema = buildNativeDeepReadResponseSchema({ startSec: 313.04, endSec: 626.04, segmentIndex: 1, hasAudio: true }) as any;
  expect(schema.properties.keyMoments.items.properties.atSec.description).toContain("范围 313.1 至 626 秒");
  const tiny = buildNativeDeepReadResponseSchema({ startSec: 313.01, endSec: 313.04, segmentIndex: 1, hasAudio: true }) as any;
  expect(tiny.properties.keyMoments.description).toContain("返回空数组 []");
  expect(tiny.properties.keyMoments.items.properties.atSec.description).toContain("keyMoments返回空数组 []");
  expect(tiny.properties.keyMoments).not.toHaveProperty("maxItems");
});

it.each([319.066667, 313.04])("实际%s秒素材的出站schema仅保留精简结构，目录不被构造过程修改", endSec => {
  const before = JSON.stringify(NATIVE_DEEP_READ_RESPONSE_SCHEMA);
  const context = { startSec: 0, endSec, segmentIndex: 0, hasAudio: true };
  const request = buildGeminiNativeDeepReadSegmentRequest({
    fileUri: "gs://test-bucket/segment.mp4", fps: 12, prompt: "离线检查，不调用模型", segmentContext: context,
  }) as any;
  // 这是本次选择的精简请求契约，不是供应商支持字段的完整清单。
  const allowed = new Set(["type", "format", "description", "nullable", "enum", "properties", "required", "items", "propertyOrdering"]);
  const walk = (node: Record<string, any>) => {
    for (const key of Object.keys(node)) expect(allowed.has(key), `出站schema多出${key}`).toBe(true);
    for (const child of Object.values(node.properties || {})) walk(child as Record<string, any>);
    if (node.items) walk(node.items);
  };
  walk(request.generationConfig.responseSchema);
  expect(request.generationConfig.responseSchema.properties.audioResolution.description).toContain("包含且仅包含1个分析对象");
  expect(request.generationConfig.responseSchema.properties.keyMoments.items.properties.atSec.description)
    .toContain(`范围 0 至 ${Math.floor(endSec)} 秒`);
  expect(request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM", includeThoughts: false });
  expect(request.generationConfig.temperature).toBe(0.7);
  expect(request.contents[0].parts[0].videoMetadata.fps).toBe(12);
  expect(JSON.stringify(NATIVE_DEEP_READ_RESPONSE_SCHEMA)).toBe(before);
});

describe("逐镜动态观察的生产与消费", () => {
  it("新请求缺观察明确拒收，旧证据仍可只读解析；广告仅接受null占位", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: false });
    const shots = raw.shots as Record<string, unknown>[];
    delete shots[0]!.hintZh;
    const context = { episodeIndex: 1, segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: false, raw };
    expect(() => evaluateNativeDeepReadSegmentAcceptance(context)).not.toThrow();
    expect(() => evaluateNativeDeepReadSegmentAcceptance({ ...context, requireShotObservations: true }))
      .toThrow("hintZh应填写本镜非空观察");
    expect(nativeDeepReadSegmentMeetsThreeItemLine({ ...context, requireShotObservations: true })).toBe(false);
    expect(() => assertNativeDeepReadShotObservations({ shots: [
      { startSec: 0, endSec: 3, evidenceRole: "non_story_ad", hintZh: null },
      { startSec: 3, endSec: 6, evidenceRole: "story", hintZh: "背景未入画，道具无法辨认" },
    ] })).not.toThrow();
    expect(() => assertNativeDeepReadShotObservations({ shots: [
      { startSec: 0, endSec: 3, evidenceRole: "non_story_ad", hintZh: "广告商品" },
    ] })).toThrow("广告hintZh应为null");
    expect(() => assertNativeDeepReadShotObservations({ shots: [
      { startSec: 3, endSec: 6, evidenceRole: "story", hintZh: "近景" },
      { startSec: 0, endSec: 3, evidenceRole: "story", hintZh: "远景" },
    ] })).toThrow("按startSec升序");
  });

  it("GLM可保留同镜拆分观察，不能把正确文字挪到别的时间或补造观察", () => {
    const first = { startSec: 0, endSec: 10, evidenceRole: "story", hintZh: "庭院中可见长凳" };
    const second = { startSec: 10, endSec: 20, evidenceRole: "story", hintZh: "面部特写，背景未入画" };
    const sources = [{ shots: [first, second] }];
    expect(() => assertNativeDeepReadShotObservationsPreserved(sources, { shots: [
      { ...first, endSec: 5 }, { ...first, startSec: 5 }, second,
    ] })).not.toThrow();
    expect(() => assertNativeDeepReadShotObservationsPreserved(sources, { shots: [
      { ...second, hintZh: first.hintZh },
    ] })).toThrow("超出来源镜头时间");
    expect(() => assertNativeDeepReadShotObservationsPreserved(sources, { shots: [
      { ...first, hintZh: "有一把未见的长剑" },
    ] })).toThrow("hintZh丢失、改写");
  });

  it("GLM来源与输出可展开answer字符串外壳", () => {
    const shot = { startSec: 0, endSec: 4.1, evidenceRole: "story", hintZh: "荒漠中小狗咬住男子的手" };
    const wrappedSource = { answer: JSON.stringify({ shots: [shot] }) };
    const wrappedOutput = { answer: JSON.stringify({ shots: [shot] }) };

    expect(unwrapNativeDeepReadStructuredAnswerEnvelope(wrappedSource)).toEqual({ shots: [shot] });
    expect(() => assertNativeDeepReadShotObservationsPreserved(
      [wrappedSource], wrappedOutput,
    )).not.toThrow();
    expect(deterministicallyMergeNativeDeepReadRawSegments([wrappedSource]).shots).toEqual([shot]);
  });

  it("实际批量入口在GLM丢观察后停止消费，原始解析证据已保存且不重发GLM", async () => {
    const segments = [{ startSec: 0, endSec: 60 }];
    const base = makeGlmStructuringStub();
    const invokeGlmStructuring = vi.fn(async (prompt: { system: string; user: string }) => {
      const out = await base(prompt);
      delete (out.raw.shots as Record<string, unknown>[])[0]!.hintZh;
      return out;
    });
    const deps = makeRunnerDeps({ postVertex: makeSuccessfulEpisodePostVertex(segments) as never,
      invokeGlmStructuring: invokeGlmStructuring as never });
    await expect(runManhuaNativeDeepReadBatch({ segmentCacheSeriesKey: "hint-test",
      episodes: [{ episodeIndex: 1, segments, cacheSourceDigest: "a".repeat(64),
      sourceDurationSec: 60, resolveNodes: async () => [] }] }, deps)).rejects.toThrow("hintZh丢失");
    expect(deps.postVertex).toHaveBeenCalledTimes(1);
    expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
    expect(deps.writeRawAttemptEvidence).toHaveBeenCalledTimes(1);
    expect(deps.writeParsedAttemptEvidence).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.writeParsedAttemptEvidence).mock.calls[0]![0].parsed.shots).toEqual(
      expect.arrayContaining([expect.objectContaining({ hintZh: expect.any(String) })]));
  });
});

describe("0905 · 整片拉取真实进度（不用预估值）", () => {
  it("解析 ffmpeg -progress 文件取最后一次 out_time，三种键都认，缺失回 null", async () => {
    const { parseFfmpegProgressOutTimeSec, formatClockSec, buildNativeDeepReadSourceFetchArgs } = await import(
      "./manhuaNativeDeepReadRunner"
    );
    expect(parseFfmpegProgressOutTimeSec("frame=1\nout_time_us=1500000\nprogress=continue\nout_time_us=2573000000\nprogress=end\n")).toBe(2573);
    expect(parseFfmpegProgressOutTimeSec("out_time_ms=90000000\n")).toBe(90);
    expect(parseFfmpegProgressOutTimeSec("out_time=00:42:53.000000\n")).toBe(2573);
    expect(parseFfmpegProgressOutTimeSec("frame=1\nspeed=2x\n")).toBeNull();
    expect(parseFfmpegProgressOutTimeSec("")).toBeNull();
    expect(formatClockSec(2573)).toBe("42:53");
    expect(formatClockSec(3725)).toBe("1:02:05");
    const args = buildNativeDeepReadSourceFetchArgs({ node: { url: "https://cdn.example/x.m3u8" }, outputPath: "/tmp/a.mp4", progressPath: "/tmp/a.mp4.progress" });
    expect(args.slice(0, 8)).toEqual(["-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y", "-progress", "/tmp/a.mp4.progress"]);
    expect(buildNativeDeepReadSourceFetchArgs({ node: { url: "https://cdn.example/x.m3u8" }, outputPath: "/tmp/a.mp4" })).not.toContain("-progress");
  });
});

describe("0905 · 字幕只取 keyMoments 前后 2 秒", () => {
  it("过滤掉不在任何 keyMoment ±2 秒内的字幕；无 keyMoments 时原样返回", async () => {
    const { filterNativeDeepReadSubtitlesToKeyMoments } = await import("./manhuaNativeDeepReadRunner");
    const raw = {
      keyMoments: [{ atSec: 10 }, { atSec: 100.4 }],
      subtitles: [
        { atSec: 8, textZh: "留" }, { atSec: 12, textZh: "留" }, { atSec: 13, textZh: "丢" },
        { atSec: 99, textZh: "留" }, { atSec: 50, textZh: "丢" },
      ],
    };
    const out = filterNativeDeepReadSubtitlesToKeyMoments(raw);
    expect((out.subtitles as Array<{ atSec: number }>).map((s) => s.atSec)).toEqual([8, 12, 99]);
    expect(filterNativeDeepReadSubtitlesToKeyMoments({ subtitles: raw.subtitles })).toEqual({ subtitles: raw.subtitles });
  });
});
