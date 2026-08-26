/**
 * 原生精读执行器（0826 Gemini 换代）：开关、format 挑选、请求契约、双密度门禁、
 * EvoLink 兜底路由铁律与 GLM 结构化整形接线。
 * 网络与文件系统部分不在此测（真实 GCS/Vertex 已由实弹探针验证），此处锁路由与契约。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
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
  prepareEpisodeVideos,
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

  it("generationConfig 按 0826 实弹定稿：显式高思考、温度 0.8、65535 上限、不混思考", () => {
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG).toEqual({
      temperature: 0.8,
      maxOutputTokens: 65_535,
      audioTimestamp: true,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "high" },
    });
    expect(NATIVE_DEEP_READ_GENERATION_CONFIG).not.toHaveProperty("includeThoughts");
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
  it("360s 段：镜头 ≥24、音轨段 ≥8、声音事件 ≥15", () => {
    expect(resolveNativeDeepReadSegmentFloors(360)).toEqual({
      minShots: 24,
      minAudioTracks: 8,
      minAudioCues: 15,
    });
  });
  it("60s 短段音轨地板降为 2（审查 P0-1：硬下限 3 只会咬短段，反偷懒由 ceil(len/45) 承担）", () => {
    expect(resolveNativeDeepReadSegmentFloors(60)).toEqual({
      minShots: 4,
      minAudioTracks: 2,
      minAudioCues: 3,
    });
  });

  it("29s 微尾段地板宽松到可真实达标（1 段音轨/2 镜/2 事件），不再必拒收", () => {
    expect(resolveNativeDeepReadSegmentFloors(29)).toEqual({
      minShots: 2,
      minAudioTracks: 1,
      minAudioCues: 2,
    });
  });

  it("360s 大段地板不受 P0-1 订正影响（8 段音轨照旧）", () => {
    expect(resolveNativeDeepReadSegmentFloors(360)).toEqual({
      minShots: 24,
      minAudioTracks: 8,
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
    expect(prompt).toContain("段数 ≥ 1");
    expect(prompt).not.toContain("段数 ≥ 0");
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

  it("音轨直读五条硬指标齐全（0826 拍板照抄）", () => {
    expect(prompt).toContain(`"chunkIndex":1`);
    expect(prompt).toContain("亲耳所听");
    expect(prompt).toContain("禁止留空");
    expect(prompt).toContain("段数 ≥ 12"); // ceil(360/30)
    expect(prompt).toContain("每一次可听见的独立声音事件");
    expect(prompt).toContain("只许压缩 subtitles，禁止压缩镜头表或音轨栏");
    expect(prompt).toContain("禁止为省输出合并真实发生切换的镜头");
    expect(prompt).toContain("钟表式时间");
  });

  it("镜头地板写进提示词：360s 段 ≥24 镜", () => {
    expect(prompt).toContain("镜头数 ≥ 24");
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

  it("带拒因重试时附上一轮被拒原因且禁止降密度", () => {
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
    expect(retry).toContain("禁止降低镜头表或音轨密度");
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
    })).toThrow("低于地板线");
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
    const thin = makeSegmentPayload({
      segmentIndex: 0, startSec: 0, endSec: 60, audioTrackOverride: 1,
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
    const thin = makeSegmentPayload({
      segmentIndex: 0, startSec: 0, endSec: 60, audioTrackOverride: 1,
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
