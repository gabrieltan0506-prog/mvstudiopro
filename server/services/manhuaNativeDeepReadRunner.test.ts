/**
 * 原生精读执行器（0826 Gemini 换代）：开关、format 挑选、请求契约、双密度门禁、
 * Vertex 同通道重试纪律、历史路由缓存兼容与 GLM 整集结构化接线。
 * 网络与文件系统部分不在此测（真实 GCS/Vertex 已由实弹探针验证），此处锁路由与契约。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC,
  NATIVE_DEEP_READ_SANITY_FLOOR_MIN_SEGMENT_SEC,
  NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC,
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
  NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_INTERVAL_MS,
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  NATIVE_DEEP_READ_TEMPERATURE_MIN,
  NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES,
  NATIVE_DEEP_READ_MODEL,
  NATIVE_DEEP_READ_ROUTE_EVOLINK,
  NATIVE_DEEP_READ_ROUTE_VERTEX,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  assertNativeDeepReadEpisodeEvidence,
  assertNativeDeepReadSegmentDensity,
  buildGeminiNativeDeepReadSegmentPrompt,
  buildGeminiNativeDeepReadSegmentRequest,
  buildNativeDeepReadGlmSegmentRepairPrompt,
  buildNativeDeepReadGlmStructuringPrompt,
  isManhuaNativeDeepReadEnabled,
  pickSmallestVideoFormat,
  postNativeDeepReadGenerateContent,
  prepareEpisodeVideos,
  nativeDeepReadSegmentCacheFingerprint,
  resolveNativeDeepReadRequestFps,
  resolveNativeDeepReadSegmentFloors,
  runManhuaNativeDeepReadBatch,
  attachAudioChunkSpans,
  stripNonStoryAdShotsForEpisodeCard,
  validateNativeDeepReadSegments,
  type NativeDeepReadBatchRunnerDeps,
  type NativeDeepReadMediaPreparationDeps,
} from "./manhuaNativeDeepReadRunner";
import {
  MANHUA_NATIVE_DEEP_READ_MODEL,
  MANHUA_NATIVE_DEEP_READ_MODEL_LABEL,
} from "../../shared/manhuaNativeDeepReadJob";
import {
  NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  type NativeDeepReadSegmentCacheEntry,
} from "./manhuaNativeDeepReadSegmentCache";

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
    expect(NATIVE_DEEP_READ_VISUAL_PLAN_VERSION).toBe("time-300s-v12-key-moments");
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

  it("generationConfig 按 0829 晚定稿 0.70：官方上限 65_536、单候选、responseSchema、thinkingBudget 封顶 18_000", () => {
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG).toMatchObject({
      temperature: 0.65,
      maxOutputTokens: 65_536,
      candidateCount: 1,
      audioTimestamp: true,
      responseMimeType: "application/json",
      responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
    });
    // 0829 订正：thinkingBudget 不再是禁令，18K 只作成本封顶（长尾段不靠思考吃光 maxOutputTokens）
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).toMatchObject({ thinkingBudget: 18_000 });
  });

  it("同一 Vertex 分片固定两档重试：0.65→0.60，间隔 60 秒（0830 首发降 0.65）", () => {
    expect(NATIVE_DEEP_READ_RETRY_TEMPERATURES).toEqual([0.65, 0.6]);
    expect(NATIVE_DEEP_READ_RETRY_INTERVAL_MS).toBe(60_000);
    expect(NATIVE_DEEP_READ_TEMPERATURE_MIN).toBe(0.6);
    // 两档梯度下「第二发」即「末发」，两个常量同为 0.6（首发 0.65 在 GENERATION_CONFIG）
    expect(NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG).toEqual({
      ...NATIVE_DEEP_READ_GENERATION_CONFIG,
      temperature: 0.6,
    });
    expect(NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG).toEqual({
      ...NATIVE_DEEP_READ_GENERATION_CONFIG,
      temperature: 0.6,
    });
  });

  it("请求组装层会把任何低温旁路收口到 0.60", () => {
    const request = buildGeminiNativeDeepReadSegmentRequest({
      fileUri: "gs://bucket/segment.mp4",
      fps: 5,
      prompt: "test",
      generationConfig: {
        ...NATIVE_DEEP_READ_GENERATION_CONFIG,
        temperature: 0,
      },
    });
    expect(request.generationConfig).toMatchObject({ temperature: 0.6 });
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
    expect(NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties.shots.items.required).toEqual([
      "startSec",
      "endSec",
      "unitTypeZh",
      "shotSizeZh",
      "angleZh",
      "compositionZh",
      "cameraMoveZh",
      "blockingZh",
      "bodyActionZh",
      "limbPropActionZh",
      "microExpressionZh",
      "gazeBreathZh",
      "relationshipReactionZh",
      "lightingZh",
      "actionZh",
      "transitionInZh",
      "evidenceRole",
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

describe("两档 fps（0827 拍板：≤300s→10，否则5，永不更低）", () => {
  it("档位边界", () => {
    expect(resolveNativeDeepReadRequestFps(90)).toBe(10);
    expect(resolveNativeDeepReadRequestFps(180)).toBe(10);
    expect(resolveNativeDeepReadRequestFps(299.99)).toBe(10);
    expect(resolveNativeDeepReadRequestFps(300)).toBe(10);
    expect(resolveNativeDeepReadRequestFps(300.01)).toBe(5);
    expect(resolveNativeDeepReadRequestFps(360)).toBe(5);
    expect(resolveNativeDeepReadRequestFps(1080)).toBe(5);
  });
});

describe("双密度地板线（0826 双密度教训）", () => {
  it("360s 段：镜头 ≥60（0826 用户拍板时长制 len/6）、音轨段 ≥6、声音事件 ≥15", () => {
    expect(resolveNativeDeepReadSegmentFloors(360)).toEqual({
      minShots: 60,
      minAudioTracks: 6,
      minAudioCues: 15,
    });
  });
  it("60s 短段音轨地板降为 1（间隔 60 后与 FLOOR_MIN=1 兼容）", () => {
    expect(resolveNativeDeepReadSegmentFloors(60)).toEqual({
      minShots: 10,
      minAudioTracks: 1,
      minAudioCues: 3,
    });
  });

  it("29s 微尾段：时长制下 5 镜起（真实节奏 2-5s/镜可达标）、1 段音轨、2 事件", () => {
    expect(resolveNativeDeepReadSegmentFloors(29)).toEqual({
      minShots: 5,
      minAudioTracks: 1,
      minAudioCues: 2,
    });
  });

  it("360s 大段地板不受 P0-1 订正影响（间隔 60 下为 6 段音轨）", () => {
    expect(resolveNativeDeepReadSegmentFloors(360)).toEqual({
      minShots: 60,
      minAudioTracks: 6,
      minAudioCues: 15,
    });
  });

  it("提示词软化后不再下达任何音轨/镜数字目标（0829：数字目标会逼出编造）", () => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 389,
      startSec: 360,
      endSec: 389,
      segmentIndex: 1,
      segmentCount: 2,
      hasAudio: true,
    });
    expect(prompt).not.toMatch(/至少 \d+ 段/);
    expect(prompt).not.toMatch(/至少 \d+ 条/);
    expect(prompt).not.toMatch(/本段至少 \d+ 镜/);
    expect(prompt).toContain("安静段落只有 1 段是正常的");
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
    expect(prompt).toContain("全片（共 720 秒）的第 360–720 秒");
    expect(prompt).toContain("一律写全片绝对秒位");
    expect(prompt).toContain("360..720 秒");
  });

  it("音轨硬红线（亲耳所听/局部秒例外）与软边界建议齐全（0826 二次拍板）", () => {
    expect(prompt).toContain(`"chunkIndex":1`);
    expect(prompt).toContain("亲耳所听");
    expect(prompt).toContain("禁止凭画面编造声音");
    // 0829 软化：音轨不再给「至少 N 段 / 至少 N 条 cue」的数字，改「有几段写几段」
    expect(prompt).toContain("有几段写几段");
    expect(prompt).toContain("环境音、静场氛围同样算一段");
    expect(prompt).toContain("安静段落只有 1 段是正常的，禁止为凑数编造不存在的声音事件");
    expect(prompt).not.toMatch(/至少 \d+ 段/);
    expect(prompt).not.toMatch(/至少 \d+ 条/);
    expect(prompt).toContain("每一次可听见的独立声音事件");
    expect(prompt).toContain("每条 audioTrack 必须完整输出");
    expect(prompt).toContain("mixNotesZh");
    expect(prompt).toContain("优先压缩 subtitles，尽量保全镜头表与音轨栏的密度");
    expect(prompt).toContain("宁可少记也不要合并或编造");
    expect(prompt).toContain("钟表式时间");
    expect(prompt).toContain("硬约束（必须遵守）");
  });

  it("镜数改软引导（不再是验收数字，也不再限额长镜），长镜拆分硬约束保留", () => {
    // 0829 软化：镜数从「验收标准」降级为节奏软引导，删掉「超过 15 秒长镜至多 1 个」限额
    expect(prompt).toContain("真实节奏通常 2–5 秒一镜");
    expect(prompt).toContain("宁可少记也不要合并或编造");
    expect(prompt).not.toMatch(/本段至少 \d+ 镜/);
    expect(prompt).not.toContain("至多 1 个");
    expect(prompt).not.toContain("验收标准");
    // 0826 花钱买到的有效点破句必须保留
    expect(prompt).toContain("不要把「剧情段」当成一个镜头");
    // 诚实优先声明（软化后防模型仍按旧习惯凑数）
    expect(prompt).toContain("产出会被完整保留并交由结构化层整理，不达密度不会被拒收");
    expect(prompt).toContain("请如实记录");
    // 双向诚实：既禁编造，也禁漏记（0829 用户追问：只防往上编等于给偷懒开门）
    expect(prompt).toContain("漏记真实发生的切镜同样是错误");
    // 节奏是平均值不是单镜上限；长镜无变化可照实记一条，不为拆而拆
    expect(prompt).toContain("这是整段平均节奏，不是单镜上限");
    // 用户实测拍板：超 30 秒必须拆，否则模型把 140-300 秒当一个镜头交差
    expect(prompt).toContain("必须按镜内真实发生的构图、运镜、角色调度、动作、表演或光影变化拆成至少 2 个连续证据段");
    expect(prompt).toContain("同一物理长镜持续超过 30 秒");
    expect(prompt).toContain("每个证据段至少 1 秒");
    expect(prompt).toContain(`transitionInZh 固定写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」`);
    expect(prompt).toContain("不得裁掉内容");
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
    expect(silent).toContain("audioResolution 必须返回空数组");
    expect(silent).not.toContain("亲耳所听");
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
    expect(retry).toContain("【上一轮被拒原因】音轨仅 1 段");
    expect(retry).toContain("尽量不要降低镜头表或音轨密度");
  });
});

describe("Gemini 请求体（Google 原生格式，Vertex/EvoLink 同构）", () => {
  it("fileData + videoMetadata.fps + 定稿 generationConfig", () => {
    const body = buildGeminiNativeDeepReadSegmentRequest({
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
      generationConfig: NATIVE_DEEP_READ_GENERATION_CONFIG,
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

  it("🔒 截断段照样守长镜拒收线（0830 定 40 秒＋10% 容差＝44 秒）", () => {
    const raw = withoutClassification();
    // 0830 实弹定线：41 秒（真长镜）不该拒，60 秒以上（没读完）必须拒。
    // 先证 41 秒放行——这正是用户判定「可以接受，不需要重试」的那一条。
    const passing = withoutClassification();
    passing.shots = [{
      ...(passing.shots as Array<Record<string, unknown>>)[0]!,
      startSec: 0, endSec: 41,
    }];
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base, raw: passing, truncated: true,
    })).not.toThrow();
    // 再证 60 秒仍拒
    raw.shots = [{
      ...(raw.shots as Array<Record<string, unknown>>)[0]!,
      startSec: 0,
      endSec: 60,
    }];
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      raw,
      truncated: true,
    })).toThrow("44 秒");
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

  it("长镜证据拆分点不足 1 秒转 advisory：只记 long_take_split_discontinuous，不再拒收重买", () => {
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
      .toContain("长镜证据拆分点之间必须至少相隔 1 秒");
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
      .toThrow("缺 evidenceRole");
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
      .toThrow("unitTypeZh 缺失或无效");
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

  it("🔒 镜数下限已整条删除（0830 用户令）：360 秒段只有 16 镜也不再拒收", () => {
    // 「我都设好上限了，不要管下限了」——下限是替模型规定「该看到多少」，
    // 而不同体裁、不同片源本就不同；重试还要重付一整片视频输入。
    const input = {
      ...base,
      startSec: 0,
      endSec: 360,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 360, shotCountOverride: 16 }),
    };
    expect(() => assertNativeDeepReadSegmentDensity(input)).not.toThrow();
    const codes = assertNativeDeepReadSegmentDensity(input).advisories.map((r) => r.code);
    expect(codes).not.toContain("shot_density_low");
    expect(codes).not.toContain("shot_avg_too_long");
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
        audioTrackOverride: 3,
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
    expect(prompt.system).toContain("只整形不创作");
    expect(prompt.system).toContain("禁止虚构");
    expect(prompt.system).toContain(NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH);
    // 🔒 0830 实弹后撤销「合并相邻」许可：GLM 把 426 镜压成 99 镜（平均镜长
    // 3.6s→15.4s，贴着 30 秒上限往上合），而知识库实测漫剧真实节奏是 2.8–4.3s/镜。
    // 覆盖秒数一秒不差、无重叠无编造——三项对账全绿也拦不住，因为合并相邻镜头
    // 本来就保覆盖。根因就是这句许可证，必须反过来写成禁令。
    expect(prompt.system).not.toContain("允许合理合并相邻证据");
    expect(prompt.system).toContain("相邻但秒位**不重叠**的两条镜头");
    expect(prompt.system).toContain("绝不许合并成一条");
    expect(prompt.system).toContain("唯一允许合并的是**同一物理镜头的重复记录**");
    expect(prompt.system).toContain("超过 30 秒");
    expect(prompt.system).toContain("不得丢失时间轴覆盖");
    expect(prompt.system).toContain("并集去重");
    expect(prompt.system).toContain("钟表式秒位");
    expect(prompt.system).toContain("只返回一个 JSON 对象");
    expect(prompt.user).toContain("【上一轮门禁被拒原因】镜头轴存在空档");
    expect(prompt.user).not.toContain("只有相邻 story 证据可以合理合并");
    expect(prompt.user).toContain("只有秒位重叠的重复记录可以合并");
    expect(prompt.user).toContain("镜头数大幅变少、平均镜长明显拉长即为错误产出");
    // 0830 用户拍板：一次合并的总跨度上限 59 秒；超 30 秒必须切两段、各不超 30 秒、间隔 1 秒
    expect(prompt.user).toContain("一次合并的总跨度不得超过 59 秒");
    // 0830：措辞与代码真实语义对齐——SPLIT_MIN_SEC 判的是「每段各自 ≥1 秒」，
    // 不是「两段之间留 1 秒空隙」（后者会与「互不重叠、首尾相接」直接矛盾）。
    expect(prompt.user).toContain("每段各自不短于 1 秒");
    expect(prompt.user).toContain("不得删除仍需保留的");
    expect(prompt.system).toContain("emotionTagsZh/narrativeFeatureTagsZh/performanceTagsZh/audiovisualTagsZh/audienceExperienceTagsZh");
    // 0829 晚：删掉「至少两个维度」这个数量下限——数字目标只会逼模型编造凑数
    // （0826 实弹：安静段落被逼出不存在的声音事件）。改成有证据就写、没有写 []。
    expect(prompt.system).not.toContain("至少两个维度");
    expect(prompt.system).toContain("有证据就写");
    expect(prompt.system).toContain("原样保留 evidenceRole");
    expect(prompt.system).toContain("non_story_ad");
    expect(prompt.system).toContain("整行剔除");
    expect(prompt.system).toContain("excludedAdRanges:[{startSec,endSec}]");
    expect(prompt.system).toContain("输入没有 non_story_ad 镜头时不要输出 excludedAdRanges 字段");
    expect(prompt.system).toContain("广告区间内声音只作审计证据");
    expect(prompt.system).toContain("其余镜头一律保持 story");
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
    expect(prompt.system).toContain("truncated: true");
    // 用户 0829 晚拍板：门禁是贴标签的，标记一律不是废弃理由
    expect(prompt.system).toContain("这些标记一律不是废弃理由");
    expect(prompt.system).toContain("gateMarked: true");
    expect(prompt.system).toContain("不得因为带标记就丢弃或降权任何证据");
    // 同段多版本：通过版与被标记版一起喂，合格不等于更好
    expect(prompt.system).toContain("同一段可能出现多个版本");
    expect(prompt.system).toContain("通过不等于更好");
    // 0829 晚二次收口：矛盾消解成「记录去重，信息取并集」——去重删的是重复的记录，
    // 不丢弃保的是每一版独有的观察；同一物理镜头一条记录，但吸收所有版本的观察。
    expect(prompt.system).toContain("记录去重，信息取并集");
    expect(prompt.system).toContain("同一个物理镜头只保留一条记录，但那条记录必须吸收所有版本对它的观察");
    // 裁决顺序四条：骨架 / 更细优先 / 逐条比对 / 忠于原文
    expect(prompt.system).toContain("未被标记、未截断");
    expect(prompt.system).toContain("一律以切分更细的那一版为准");
    expect(prompt.system).toContain("秒位不重叠的记录全部保留");
    expect(prompt.system).toContain("不改写、不扩写");
    expect(prompt.system).toContain("必须忠于原文内容");
    // 唯一裁判尺子：互不重叠首尾相接，重叠即错误产出
    expect(prompt.system).toContain("一组互不重叠、首尾相接");
    expect(prompt.system).toContain("出现两条区间重叠即为错误产出");
    expect(prompt.system).toContain("同秒同 kind 的 cue 只留一条");
    expect(prompt.system).toContain("绝不许用丢弃证据的方式满足这条");
    // 五维分类不再设数量下限（数字目标只会逼出假标签）
    expect(prompt.system).toContain("不得为了凑数量而编造标签");
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
    expect(prompt.user).toContain("3 份分段卡");
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
    expect(prompt.system).toContain("emotionTagsZh/narrativeFeatureTagsZh/performanceTagsZh/audiovisualTagsZh/audienceExperienceTagsZh");
    // 0829 晚：删掉「至少两个维度」这个数量下限——数字目标只会逼模型编造凑数
    // （0826 实弹：安静段落被逼出不存在的声音事件）。改成有证据就写、没有写 []。
    expect(prompt.system).not.toContain("至少两个维度");
    expect(prompt.system).toContain("有证据就写");
    expect(prompt.system).toContain("evidenceRole 只能原样恢复");
    expect(prompt.system).toContain("原文缺失该字段则修复失败");
  });
});

/* ── 媒体准备 ── */

function makePreparationDeps(
  over: Partial<NativeDeepReadMediaPreparationDeps> = {},
): NativeDeepReadMediaPreparationDeps {
  return {
    runMedia: vi.fn(async (cmd: string) =>
      cmd === "ffprobe" ? JSON.stringify({ streams: [{ index: 1 }] }) : ""),
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
    }, undefined, deps)).rejects.toThrow("低于 500MB 下限");
    expect(deps.runMedia).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES).toBe(500 * 1024 * 1024);
  });

  it("切片失败会刷新媒体节点后安全重试，上传后立即删本地段文件，产出 gs:// 不签 URL", async () => {
    const resolveNodes = vi.fn()
      .mockResolvedValueOnce([{ url: "https://cdn.example/expired.mp4" }])
      .mockResolvedValueOnce([{ url: "https://cdn.example/fresh.mp4" }]);
    const runMedia = vi.fn()
      .mockRejectedValueOnce(new Error("cdn expired"))
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(JSON.stringify({ streams: [{ index: 1 }] }));
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
    expect(ffmpegCalls).toHaveLength(1);
    expect(ffmpegCalls[0]?.[1]).toContain("https://cdn.example/fresh.mp4");
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(prepared).toHaveLength(1);
    warn.mockRestore();
  });

  it("默认并发上限 10：5 段一次全发，完成乱序也按原分段顺序落位并只探测首片音轨", async () => {
    const cutGates = new Map<number, ReturnType<typeof deferred>>();
    let activeCuts = 0;
    let maxActiveCuts = 0;
    let ffprobeCalls = 0;
    const runMedia = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "ffprobe") {
        ffprobeCalls += 1;
        return JSON.stringify({ streams: [{ index: 1 }] });
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

    // 0829 晚用户令「改成并发，不是串行」：默认上限 10，5 段不再切成 4+1 两波。
    await vi.waitFor(() => expect(cutGates.size).toBe(5));
    expect(Array.from(cutGates.keys()).sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40]);
    expect(maxActiveCuts).toBe(5);
    // 乱序完成：真正的不变量是「按分段下标落位」，不是「按完成顺序落位」。
    for (const startSec of [40, 10, 30, 0, 20]) cutGates.get(startSec)!.resolve();

    const prepared = await task;
    expect(prepared.map((row) => row.startSec)).toEqual([0, 10, 20, 30, 40]);
    expect(ffprobeCalls).toBe(1);
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
      if (cmd === "ffprobe") return JSON.stringify({ streams: [{ index: 1 }] });
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
      if (cmd === "ffprobe") return JSON.stringify({ streams: [{ index: 1 }] });
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

  it("首片本地探测无音轨时整集 hasAudio=false", async () => {
    const deps = makePreparationDeps({
      runMedia: vi.fn(async (cmd: string) =>
        cmd === "ffprobe" ? JSON.stringify({ streams: [] }) : ""),
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

describe("分片原样上传 GCS", () => {
  const MB = 1024 * 1024;

  it("多片总体积超过旧预算仍逐片原样上传，不触发预转码", async () => {
    const runMedia = vi.fn(async (cmd: string, _args: string[]) =>
      cmd === "ffprobe" ? JSON.stringify({ streams: [{ index: 1 }] }) : "");
    const statLocal = vi.fn()
      .mockResolvedValueOnce({ size: 60 * MB })
      .mockResolvedValueOnce({ size: 60 * MB });
    const deps = makePreparationDeps({ runMedia, statLocal });
    const prepared = await prepareEpisodeVideos({
      episodeIndex: 2,
      resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
      segments: [{ startSec: 0, endSec: 300 }, { startSec: 300, endSec: 600 }],
      sourceDurationSec: 601,
    }, undefined, deps);
    const ffmpegCalls = runMedia.mock.calls.filter((call) => call[0] === "ffmpeg");
    expect(ffmpegCalls).toHaveLength(2);
    expect(ffmpegCalls.flatMap((call) => call[1])).not.toContain("libx264");
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
    // 桩件按同样口径先剔掉被标记版，否则同秒位区间会重叠——
    // 这正是「两版一起喂」必须依赖 GLM 去重的地方。
    const rows = readRawSegmentsFromGlmPrompt(prompt.user)
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
    writeRawAttemptEvidence: vi.fn(async (input: { callId: string; responseText: string }) => ({
      objectName: `manhua-template-learn/segment-evidence-raw/test/${input.callId}.json`,
      bytes: Buffer.byteLength(input.responseText),
      sha256: "a".repeat(64),
    })) as never,
    waitForRetry: vi.fn(async () => undefined),
    ...over,
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

describe("Vertex 主线：每段一次调用（不再多段合包）", () => {
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
        expect(text).toContain("【上一轮被拒原因】");
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
    expect(prompt.system).toContain("记录去重，信息取并集");
  });

  it("🔒 段被门禁标记后重试，两版都进 GLM 输入（用户 0829 晚：所有产出都进 GLM）", async () => {
    const segments = twoSegmentEpisode.segments;
    // 第2段首发把整 60 秒当成一个镜头——撞 30 秒硬上限（探针实弹里段5 就是 45 秒长镜）。
    // 覆盖仍然完整，只是颗粒度被标记。重试那发合规。
    // 旧口径只把重试版交给 GLM，首发那 ¥6-8 直接丢掉。
    const markedFirst = makeSegmentPayload({
      segmentIndex: 1, startSec: 60, endSec: 120, shotCountOverride: 1,
    });
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 })))
      .mockResolvedValueOnce(geminiResponse(markedFirst))
      .mockResolvedValueOnce(geminiResponse(makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 })));
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
      const prompt = invokeGlmStructuring.mock.calls[0]![0] as { system: string; user: string };
      const sent = readRawSegmentsFromGlmPrompt(prompt.user);
      // 2 段通过版 + 1 份被标记版 = 3 份，被标记那份一分钱都不许白花
      expect(sent).toHaveLength(3);
      const marked = sent.filter((row) => row.gateMarked === true);
      expect(marked).toHaveLength(1);
      expect(String(marked[0]!.gateMarkedZh || "")).not.toBe("");
      expect(marked[0]!.attemptNumber).toBe(1);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
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
      const last = raw.shots[raw.shots.length - 1]!;
      last.endSec = Number(last.endSec) - 6;  // ① 整集时间轴尾部空 6 秒
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

describe("Vertex 同通道两档重试（禁止 EvoLink fallback）", () => {
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

  it("Vertex 4xx 按 0.65→0.60 原通道重试两档，耗尽后原错失败", async () => {
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
      expect(postVertex).toHaveBeenCalledTimes(2);
      expect(deps.waitForRetry).toHaveBeenCalledTimes(1);  // 两档＝1 次等待
      expect(deps.waitForRetry).toHaveBeenNthCalledWith(1, 60_000, undefined);
      expect(deps.postEvolink).not.toHaveBeenCalled();
      expect(deps.signReadUrl).not.toHaveBeenCalled();
      expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
      const started = receipts.filter(
        (row) => row.route === "vertex_gcs_video" && row.status === "started",
      );
      expect(started.map((row) => [row.attemptNumber, row.temperature])).toEqual([
        [1, 0.65], [2, 0.6],
      ]);
      const failed = receipts.filter(
        (row) => row.route === "vertex_gcs_video" && row.status === "failed",
      );
      expect(failed).toHaveLength(2);
      expect(failed.every((row) =>
        (row.providerError as { httpStatus?: number })?.httpStatus === 400)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("Vertex 网络失联同样走两档，最终原错失败且不调用 EvoLink", async () => {
    const postVertex = vi.fn(async () => { throw new Error("socket hang up"); });
    const deps = makeRunnerDeps({
      prepareVideos: singlePrep as never,
      postVertex: postVertex as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(runManhuaNativeDeepReadBatch({ episodes: [episode] }, deps))
        .rejects.toThrow("socket hang up");
      expect(postVertex).toHaveBeenCalledTimes(2);
      expect(deps.waitForRetry).toHaveBeenCalledTimes(1);  // 两档＝1 次等待
      expect(deps.postEvolink).not.toHaveBeenCalled();
      expect(deps.signReadUrl).not.toHaveBeenCalled();
      expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("两档坏 JSON 耗尽后原错失败，不再发起 GLM 结构化调用", async () => {
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
      expect(deps.postVertex).toHaveBeenCalledTimes(2);
      expect(deps.waitForRetry).toHaveBeenCalledTimes(1);  // 两档＝1 次等待
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
    expect(receipts.some((row) => row.model === "z-ai/glm-5.3" && row.status === "completed")).toBe(true);
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

  it("首轮一段成功一段真失败（坏 JSON 两档耗尽），第二轮只调用失败段且本次只记该段费用", async () => {
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
      // 三档梯度：首轮失败段必须三发全坏才算真失败（0829 晚恢复 0.7/0.65/0.6）
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
      // 0830 两档梯度：首轮 1 成功 + 两档全坏 = 3 发；第二轮命中缓存只补失败段、
      // 该段仍两档耗尽 = 2 发，累计 5 发（发数巧合不变，但构成变了）
      expect(postVertex).toHaveBeenCalledTimes(5);
      expect(prepareVideos.mock.calls[1]![0].segments.map((row) => row.startSec)).toEqual([60]);
      // 第二轮补跑的那一段两档耗尽 ⇒ 2 × 100k
      expect(second.usage.inputTokens).toBe(200_000);
      // 同上：第二轮那一段两档耗尽 ⇒ 音频 token 也是 2 发累计
      expect(second.episodes[0]!.result.audioInputTokens).toBe(24_000);
      expect(second.episodes[0]!.result.segmentEvidenceObjectNames).toHaveLength(2);
      expect(second.episodes[0]!.result.segmentEvidenceObjectNames?.[0]).toMatch(
        /^manhua-template-learn\/segment-evidence\/tpl_native_cache_series_01_ep003\/[a-f0-9]{64}\/seg0-[a-f0-9]{64}-[a-f0-9]{64}\.json$/,
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("参数冻结锁（0829 用户拍板 · 非用户允许不得变更）", () => {
  it("generationConfig 逐字段冻结：thinkingConfig 只有 thinkingBudget 18K 与 includeThoughts false，绝无 thinkingLevel", () => {
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.temperature).toBe(0.65);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.maxOutputTokens).toBe(65_536);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.candidateCount).toBe(1);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.audioTimestamp).toBe(true);
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.responseMimeType).toBe("application/json");
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).toEqual({
      thinkingBudget: 18_000,
      includeThoughts: false,
    });
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).not.toHaveProperty("thinkingLevel");
    expect(JSON.stringify(NATIVE_DEEP_READ_GENERATION_CONFIG)).not.toContain("thinkingLevel");
  });

  it("重试梯度冻结为 [0.65, 0.6] 两档（0830 用户拍板：首发 0.7→0.65）", () => {
    expect([...NATIVE_DEEP_READ_RETRY_TEMPERATURES]).toEqual([0.65, 0.6]);
    expect(NATIVE_DEEP_READ_TEMPERATURE_MIN).toBe(0.6);
  });

  it("门禁阈值冻结：离谱地板 10 秒/镜、分级线 120 秒、整片 300 秒", () => {
    expect(NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC).toBe(10);
    expect(NATIVE_DEEP_READ_SANITY_FLOOR_MIN_SEGMENT_SEC).toBe(120);
    expect(NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC).toBe(300);
  });

  it("建议线阈值冻结：镜数 6 秒/镜、平均镜长 6 秒、音轨 60 秒/段、cue 24 秒/条", () => {
    expect(NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC).toBe(6);
    expect(NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC).toBe(6);
    expect(NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC).toBe(60);
    expect(NATIVE_DEEP_READ_AUDIO_CUE_FLOOR_INTERVAL_SEC).toBe(24);
    expect(NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN).toBe(1);
  });

  it("长镜与分片规格冻结：单条证据段 30 秒、拆分间隔 1 秒、PLAN_VERSION v10", () => {
    expect(NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC).toBe(30);
    expect(NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC).toBe(1);
    expect(NATIVE_DEEP_READ_VISUAL_PLAN_VERSION).toBe("time-300s-v12-key-moments");
  });
});
