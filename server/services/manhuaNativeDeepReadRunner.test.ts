/**
 * 原生精读执行器（0826 Gemini 换代）：开关、format 挑选、请求契约、双密度门禁、
 * EvoLink 兜底路由铁律与 GLM 结构化整形接线。
 * 网络与文件系统部分不在此测（真实 GCS/Vertex 已由实弹探针验证），此处锁路由与契约。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_HTTP_BODY_TIMEOUT_MS,
  NATIVE_DEEP_READ_HTTP_HEADERS_TIMEOUT_MS,
  NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
  NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG,
  NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES,
  NATIVE_DEEP_READ_MODEL,
  NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES,
  NATIVE_DEEP_READ_ROUTE_EVOLINK,
  NATIVE_DEEP_READ_ROUTE_VERTEX,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  assertNativeDeepReadEpisodeEvidence,
  assertNativeDeepReadSegmentDensity,
  buildGeminiNativeDeepReadSegmentPrompt,
  buildGeminiNativeDeepReadSegmentRequest,
  buildNativeDeepReadGlmStructuringPrompt,
  buildNativeDeepReadTranscodeToFitArgs,
  isManhuaNativeDeepReadEnabled,
  pickSmallestVideoFormat,
  postNativeDeepReadGenerateContent,
  prepareEpisodeVideos,
  nativeDeepReadSegmentCacheFingerprint,
  resolveNativeDeepReadRequestFps,
  resolveNativeDeepReadSegmentFloors,
  resolveNativeDeepReadTranscodeVideoKbps,
  runManhuaNativeDeepReadBatch,
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
    expect(NATIVE_DEEP_READ_VISUAL_PLAN_VERSION).toBe("adaptive-1800f-360s-v4-gemini");
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

  it("generationConfig 按 0826 参数定稿（二次拍板 0.75）：官方上限 65_536、单候选、responseSchema、HIGH 思考不外发", () => {
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG).toEqual({
      temperature: 0.75,
      maxOutputTokens: 65_536,
      candidateCount: 1,
      audioTimestamp: true,
      responseMimeType: "application/json",
      responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: false },
    });
    // 定稿禁令：不得同时传 thinkingBudget
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig).not.toHaveProperty("thinkingBudget");
  });

  it("原地重试参数：仅温度归零，其余与首发一致（0826 定稿）", () => {
    expect(NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG).toEqual({
      ...NATIVE_DEEP_READ_GENERATION_CONFIG,
      temperature: 0,
    });
  });

  it("responseSchema 覆盖六栏骨架：shots/subtitles/audioResolution/beatStructureZh 必填", () => {
    expect(NATIVE_DEEP_READ_RESPONSE_SCHEMA.required).toEqual([
      "shots", "subtitles", "audioResolution", "beatStructureZh",
    ]);
    expect(Object.keys(NATIVE_DEEP_READ_RESPONSE_SCHEMA.properties)).toEqual([
      "shots", "subtitles", "audioResolution", "beatStructureZh",
      "moodArcZh", "reusableZh", "genPromptHintZh", "classification",
    ]);
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
  });
});

describe("两档 fps（0826 拍板：≤180s→10，否则5，永不更低）", () => {
  it("档位边界", () => {
    expect(resolveNativeDeepReadRequestFps(90)).toBe(10);
    expect(resolveNativeDeepReadRequestFps(180)).toBe(10);
    expect(resolveNativeDeepReadRequestFps(181)).toBe(5);
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

  it("提示词音轨目标钳到地板线之上：29s 微尾段提示词与门禁一致（审查 P0-1）", () => {
    const prompt = buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 389,
      startSec: 360,
      endSec: 389,
      segmentIndex: 1,
      segmentCount: 2,
      hasAudio: true,
    });
    expect(prompt).toContain("至少 1 段");
    expect(prompt).not.toContain("至少 0 段");
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
    expect(prompt).toContain("至少 6 段"); // 与门禁 floors.minAudioTracks 同一套数字
    expect(prompt).toContain("每一次可听见的独立声音事件");
    expect(prompt).toContain("每条 audioTrack 必须完整输出");
    expect(prompt).toContain("mixNotesZh");
    expect(prompt).toContain("优先压缩 subtitles，尽量保全镜头表与音轨栏的密度");
    expect(prompt).toContain("不要为省输出合并镜头");
    expect(prompt).toContain("钟表式时间");
    expect(prompt).toContain("硬约束（只有这五条，必须遵守）");
  });

  it("镜头验收与门禁同一套数字：360s 段至少 60 镜、平均 ≤6 秒、长镜头限额 1 个 ≤25 秒", () => {
    expect(prompt).toContain("本段至少 60 镜、平均每镜不超过 6 秒");
    expect(prompt).toContain("超过 15 秒的长镜头（如标题卡/长定场）至多 1 个且不超过 25 秒");
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
    shotSizeZh: "近景",
    angleZh: "平视",
    cameraMoveZh: "固定机位",
    lightingZh: "顶光冷调",
    actionZh: `人物动作${i}`,
    transitionInZh: "硬切",
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

describe("段级双密度门禁", () => {
  const base = { episodeIndex: 1, segmentIndex: 0, startSec: 0, endSec: 60, hasAudio: true };

  it("密度达标放行", () => {
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }),
    })).not.toThrow();
  });

  it("镜头低于地板线拒收（防 16 镜式偷懒）", () => {
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      startSec: 0,
      endSec: 360,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 360, shotCountOverride: 16 }),
    })).toThrow("镜头密度不足");
  });

  it("audioResolution 留空拒收", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    raw.audioResolution = [];
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).toThrow("禁留空");
  });

  it("音轨段数低于地板线拒收", () => {
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      startSec: 0,
      endSec: 360,
      raw: makeSegmentPayload({
        segmentIndex: 0,
        startSec: 0,
        endSec: 360,
        audioTrackOverride: 3,
      }),
    })).toThrow("音轨仅");
  });

  it("音轨原始结构省略 cues 时拒收，不让 zod 默认空数组掩盖缺栏", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const analysis = (raw.audioResolution as Array<{ analysis: { audioTrack: Array<Record<string, unknown>> } }>)[0]!.analysis;
    delete analysis.audioTrack[0]!.cues;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow("音轨字段不完整：缺 cues");
  });

  it("min(1) 必填字段 genAudioHintZh 缺失也返回具体拒因", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const analysis = (raw.audioResolution as Array<{ analysis: Record<string, unknown> }>)[0]!.analysis;
    delete analysis.genAudioHintZh;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow("音轨汇总字段不完整：缺 genAudioHintZh");
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

  it("音轨汇总省略 mixNotesZh 时拒收，不让默认空串静默入库", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const analysis = (raw.audioResolution as Array<{ analysis: Record<string, unknown> }>)[0]!.analysis;
    delete analysis.mixNotesZh;
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw }))
      .toThrow("音轨汇总字段不完整：缺 mixNotesZh");
  });

  it("素材无音轨却返回 audioResolution 拒收", () => {
    expect(() => assertNativeDeepReadSegmentDensity({
      ...base,
      hasAudio: false,
      raw: makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 }),
    })).toThrow("无音轨");
  });

  it("镜头时间轴有空档拒收", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.shots as Array<{ startSec: number }>).splice(1, 1);
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).toThrow("空档或重叠");
  });

  it("视觉描述文本含钟表式秒位拒收（assertNoClockText 口径）", () => {
    const raw = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    (raw.shots as Array<{ cameraMoveZh?: string }>)[0]!.cameraMoveZh = "在01:23处推近";
    expect(() => assertNativeDeepReadSegmentDensity({ ...base, raw })).toThrow("钟表式秒位");
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

  it("整集镜头未覆盖完整片长拒收", () => {
    expect(() => assertNativeDeepReadEpisodeEvidence({
      episodeIndex: 1,
      durationSec: 180,
      segments: [{ startSec: 0, endSec: 180 }],
      hasAudio: true,
      rawSegments: [rawSegments[0]!],
    })).toThrow("整集拒绝入库");
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
    expect(prompt.system).toContain("密度只增不减");
    expect(prompt.system).toContain("取并集去重");
    expect(prompt.system).toContain("钟表式秒位");
    expect(prompt.system).toContain("只返回一个 JSON 对象");
    expect(prompt.user).toContain("【上一轮门禁被拒原因】镜头轴存在空档");
    expect(prompt.user).toContain("禁止为省输出合并真实切换的镜头");
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

describe("超预算整集的转码压体积（64MB 预算保持不变）", () => {
  const MB = 1024 * 1024;

  it("64MB 预算与目标码率公式不变", () => {
    expect(NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES).toBe(64 * MB);
    expect(resolveNativeDeepReadTranscodeVideoKbps(85 * MB, 1080)).toBe(559);
  });

  it("转码参数保留音轨（模型听声）且限死码率峰值", () => {
    const args = buildNativeDeepReadTranscodeToFitArgs({
      inputPath: "/tmp/in.mp4",
      outputPath: "/tmp/out.mp4",
      videoKbps: 559,
    });
    expect(args.join(" ")).toContain("-c:v libx264 -preset veryfast");
    expect(args.join(" ")).toContain("-b:v 559k -maxrate 559k -bufsize 1118k");
    expect(args.join(" ")).toContain("-c:a aac -b:a 48k");
    expect(args).not.toContain("-an");
  });

  it("整集切片超预算时逐片转码后再上传", async () => {
    const runMedia = vi.fn(async (cmd: string, _args: string[]) =>
      cmd === "ffprobe" ? JSON.stringify({ streams: [{ index: 1 }] }) : "");
    const statLocal = vi.fn()
      .mockResolvedValueOnce({ size: 60 * MB })
      .mockResolvedValueOnce({ size: 60 * MB })
      .mockResolvedValueOnce({ size: 30 * MB })
      .mockResolvedValueOnce({ size: 30 * MB });
    const deps = makePreparationDeps({ runMedia, statLocal });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const prepared = await prepareEpisodeVideos({
        episodeIndex: 2,
        resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
        segments: [{ startSec: 0, endSec: 300 }, { startSec: 300, endSec: 600 }],
        sourceDurationSec: 601,
      }, undefined, deps);
      const ffmpegCalls = runMedia.mock.calls.filter((call) => call[0] === "ffmpeg");
      // 2 次切片 + 2 次转码；转码在上传之前
      expect(ffmpegCalls).toHaveLength(4);
      expect(ffmpegCalls[2]?.[1]).toContain("libx264");
      expect(deps.upload).toHaveBeenCalledTimes(2);
      expect(prepared.map((row) => row.bytes)).toEqual([30 * MB, 30 * MB]);
    } finally {
      warn.mockRestore();
    }
  });

  it("转码后仍超预算时关闭式失败，不上传也不发模型请求", async () => {
    const statLocal = vi.fn(async () => ({ size: 60 * MB }));
    const deps = makePreparationDeps({ statLocal });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(prepareEpisodeVideos({
        episodeIndex: 5,
        resolveNodes: async () => [{ url: "https://cdn.example/full.mp4" }],
        segments: [{ startSec: 0, endSec: 300 }, { startSec: 300, endSec: 600 }],
        sourceDurationSec: 601,
      }, undefined, deps)).rejects.toThrow("第5集转码后仍超下载预算，请缩短分段");
      expect(deps.upload).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

/* ── 主链：逐段调用 + EvoLink 兜底 + GLM 整形 ── */

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
    invokeGlmStructuring: vi.fn() as never,
    readSegmentCache: vi.fn(async () => null) as never,
    writeSegmentCache: vi.fn(async () => undefined) as never,
    ...over,
  };
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
    expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();

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

  it("密度不达标带拒因原地重试一次；重试成功后两次调用的钱都入账", async () => {
    const segment = { startSec: 0, endSec: 60 };
    // 时长制下的「薄卡」：60s 只给 8 镜——密度不足（<10）且平均 7.5s/镜过粗，两道必拒
    const thin = makeSegmentPayload({
      segmentIndex: 0, startSec: 0, endSec: 60, shotCountOverride: 8,
    });
    const good = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(thin))
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

describe("EvoLink 兜底（路由铁律 + 1fps 降级 + GLM 必过）", () => {
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

  it("Vertex 4xx 被拒 → 换 EvoLink（签名 https）；降级产物必过 GLM 整形，回执带 degraded", async () => {
    const receipts: Array<Record<string, unknown>> = [];
    const payload = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const postVertex = vi.fn(async () => ({
      status: 400,
      text: JSON.stringify({ error: { code: "INVALID_ARGUMENT", message: "bad video" } }),
      requestId: "req-vertex-400",
    }));
    const postEvolink = vi.fn(async (body: unknown) => {
      const fileUri = (body as {
        contents: Array<{ parts: Array<{ fileData?: { fileUri: string } }> }>;
      }).contents[0]!.parts[0]!.fileData!.fileUri;
      // EvoLink 拉不了 gs://，必须是 GCS V4 签名 https
      expect(fileUri).toBe("https://storage.googleapis.com/signed.mp4");
      return geminiResponse(payload);
    });
    const invokeGlmStructuring = vi.fn(async () => ({
      raw: payload,
      inputTokens: 5_000,
      outputTokens: 3_000,
      reasoningTokens: 100,
      costUsd: 0.134,
      provider: "Z.AI",
      providerRequestId: "req-glm-1",
      finishReason: "stop",
    }));
    const deps = makeRunnerDeps({
      prepareVideos: singlePrep as never,
      postVertex: postVertex as never,
      postEvolink: postEvolink as never,
      invokeGlmStructuring: invokeGlmStructuring as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await runManhuaNativeDeepReadBatch({
        episodes: [episode],
        onModelReceipt: (receipt) => { receipts.push(receipt as unknown as Record<string, unknown>); },
      }, deps);
      expect(postEvolink).toHaveBeenCalledTimes(1);
      expect(deps.signReadUrl).toHaveBeenCalledWith("gs://test-bucket/seg-0.mp4", 2 * 60 * 60);
      // 降级路必过 GLM 结构化整形
      expect(invokeGlmStructuring).toHaveBeenCalledTimes(1);
      const only = result.episodes[0]!.result;
      expect(only.visualRoutes).toContain("evolink_gemini_video");
      expect(only.degradedFpsSegmentIndexes).toEqual([0]);
      // GLM 计价按 usage.cost 直记（×7.2 折 CNY）并入集成本
      expect(only.usage.costCny).toBeCloseTo(
        100_000 * 9 / 1e6 + 2_500 * 72 / 1e6 + 0.134 * 7.2,
        6,
      );
      const evolinkReceipts = receipts.filter((r) => r.route === "evolink_gemini_video");
      expect(evolinkReceipts.length).toBeGreaterThanOrEqual(2);
      expect(evolinkReceipts.every((r) => r.degraded === true)).toBe(true);
      const glmReceipts = receipts.filter((r) => r.route === "openrouter_glm_structuring");
      expect(glmReceipts.map((r) => r.status)).toEqual(["started", "completed"]);
      expect(glmReceipts[1]).toMatchObject({ costUsd: 0.134, model: "z-ai/glm-5.3" });
      // 失败的 Vertex 尝试也要有失败回执（含供应商正文）
      const failedVertex = receipts.find(
        (r) => r.route === "vertex_gcs_video" && r.status === "failed",
      );
      expect(failedVertex).toMatchObject({
        providerError: { httpStatus: 400, code: "INVALID_ARGUMENT" },
      });
      expect(warn.mock.calls.some((call) => String(call[0]).includes("1fps 降级读取"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("主线网络失联（结果不明）→ 按路由铁律不回落 EvoLink，抛出待 reconcile", async () => {
    const postVertex = vi.fn(async () => { throw new Error("socket hang up"); });
    const deps = makeRunnerDeps({
      prepareVideos: singlePrep as never,
      postVertex: postVertex as never,
    });
    await expect(runManhuaNativeDeepReadBatch({ episodes: [episode] }, deps))
      .rejects.toThrow("不回落 EvoLink");
    expect(deps.postEvolink).not.toHaveBeenCalled();
    expect(deps.invokeGlmStructuring).not.toHaveBeenCalled();
  });

  it("EvoLink 兜底产物过 GLM 后门禁照跑：GLM 合成卡厚度不达标照拒（宁缺勿滥）", async () => {
    const good = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    // 时长制薄卡：8 镜/60s，GLM 合成卡照样过不了镜头门禁
    const thin = makeSegmentPayload({
      segmentIndex: 0, startSec: 0, endSec: 60, shotCountOverride: 8,
    });
    const deps = makeRunnerDeps({
      prepareVideos: singlePrep as never,
      postVertex: vi.fn(async () => ({
        status: 429,
        text: JSON.stringify({ error: { message: "rate limited" } }),
      })) as never,
      postEvolink: vi.fn(async () => geminiResponse(good)) as never,
      // GLM 只回了薄音轨的合成卡——门禁在 GLM 之后再跑一遍，照拒
      invokeGlmStructuring: vi.fn(async () => ({
        raw: thin,
        inputTokens: 1_000,
        outputTokens: 500,
        reasoningTokens: 0,
        costUsd: 0.01,
        finishReason: "stop",
      })) as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(runManhuaNativeDeepReadBatch({ episodes: [episode] }, deps))
        .rejects.toThrow("整集拒绝入库");
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
      writeSegmentCache: vi.fn(async () => undefined) as never,
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

  it("缓存读取异常关闭式停止；缓存写失败时不继续烧下一段", async () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }]);
    const readFailureDeps = makeRunnerDeps({
      readSegmentCache: vi.fn(async () => { throw new Error("gcs_stat_failed:503"); }) as never,
    });
    await expect(runManhuaNativeDeepReadBatch({
      episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
    }, readFailureDeps)).rejects.toThrow("gcs_stat_failed:503");
    expect(readFailureDeps.postVertex).not.toHaveBeenCalled();

    const postVertex = vi.fn(async () => geminiResponse(makeSegmentPayload({
      segmentIndex: 0, startSec: 0, endSec: 60,
    })));
    const writeFailureDeps = makeRunnerDeps({
      postVertex: postVertex as never,
      writeSegmentCache: vi.fn(async () => { throw new Error("cache write failed"); }) as never,
    });
    await expect(runManhuaNativeDeepReadBatch({
      episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
    }, writeFailureDeps)).rejects.toThrow("cache write failed");
    expect(postVertex).toHaveBeenCalledTimes(1);
  });

  it("首轮一段成功一段失败，第二轮只调用失败段且本次只记该段费用", async () => {
    const episode = makeEpisode([{ startSec: 0, endSec: 60 }, { startSec: 60, endSec: 120 }]);
    const store = new Map<number, NativeDeepReadSegmentCacheEntry>();
    const thin = makeSegmentPayload({
      segmentIndex: 1, startSec: 60, endSec: 120, shotCountOverride: 8,
    });
    const good0 = makeSegmentPayload({ segmentIndex: 0, startSec: 0, endSec: 60 });
    const good1 = makeSegmentPayload({ segmentIndex: 1, startSec: 60, endSec: 120 });
    const postVertex = vi.fn()
      .mockResolvedValueOnce(geminiResponse(good0))
      .mockResolvedValueOnce(geminiResponse(thin))
      .mockResolvedValueOnce(geminiResponse(thin))
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
      }) as never,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(runManhuaNativeDeepReadBatch({
        episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
      }, deps)).rejects.toThrow("镜头密度不足");
      expect(store.has(0)).toBe(true);
      expect(store.has(1)).toBe(false);
      const second = await runManhuaNativeDeepReadBatch({
        episodes: [episode], segmentCacheSeriesKey: cacheSeriesKey,
      }, deps);
      expect(postVertex).toHaveBeenCalledTimes(4);
      expect(prepareVideos.mock.calls[1]![0].segments.map((row) => row.startSec)).toEqual([60]);
      expect(second.usage.inputTokens).toBe(100_000);
      expect(second.episodes[0]!.result.audioInputTokens).toBe(16_000);
    } finally {
      warn.mockRestore();
    }
  });
});
