/**
 * 原生视频精读 · 生产执行器。
 *
 * 0826 拍板换代：视觉学习整体从新加坡 Qwen 3.8 Max 换到 **Vertex Gemini 3.1 Pro
 * 从 GCS 直读**，连音轨一次调用出全六栏（不再有 Gemini 3.6 Flash 双声道取证 +
 * Qwen 仲裁两步）。实弹依据：
 *   · 新加坡 Qwen←GCS 吞吐 <0.15MB/s 不可用；北京 Qwen 可用但无音轨、474s、贵一倍；
 *   · `gemini-3.1-pro-preview` @ Vertex global，fileData gs:// + videoMetadata{fps:5}
 *     + generationConfig{responseMimeType:"application/json",audioTimestamp:true}，
 *     360s 段 144s 返回，输入 ≈129k tok（视频 118,866 + 音频 9,001）。
 *   · 双密度教训：v1 出 64 镜但音轨薄；v2 音轨达标但镜头被压到 16 —— 生产提示词
 *     必须同时锁两侧密度，入库门禁按地板线关闭式拒收。
 *
 * **每段一次调用**（不再多段合包）：Gemini 输入超 20 万 token 跳价档，
 * 分段调用停在低价档。
 *
 * ⚠️ 默认关闭（MANHUA_NATIVE_DEEP_READ=1 才启用）。
 */
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat, statfs, unlink } from "node:fs/promises";
import {
  mapNativeDeepReadSegments,
  nativeDeepReadSegmentSchema,
  type NativeDeepReadOutput,
} from "../../shared/manhuaNativeDeepRead.js";
import { MANHUA_NATIVE_DEEP_READ_MODEL } from "../../shared/manhuaNativeDeepReadJob.js";
import {
  hasClockTextZh,
  manhuaNativeAudioChunkAnalysisSchema,
  normalizeManhuaNativeAudioChunkAnalysis,
  type ManhuaNativeAudioDirectRoute,
} from "../../shared/manhuaNativeAudioAnalysis.js";
import type {
  ManhuaNativeModelReceipt,
  ManhuaNativeProviderErrorReceipt,
} from "../../shared/manhuaNativeModelReceipt.js";
import {
  deleteGcsObject,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "./gcs.js";
import {
  errorWithNativeProviderReceipt,
  formatNativeProviderErrorZh,
  nativeProviderReceiptFromError,
  parseNativeProviderErrorReceipt,
} from "./manhuaNativeProviderReceipt.js";
import {
  GlmGatewayError,
  OPENROUTER_GLM_MODEL,
  invokeGlmJsonChatWithGatewayFallback,
} from "./bailianChat.js";
import {
  baseUrlForVertex,
  getVertexAuthHeaders,
  getVertexProjectId,
} from "./vertexMedia.js";
import {
  readNativeDeepReadSegmentCacheEntry,
  writeNativeDeepReadSegmentCacheEntry,
  type NativeDeepReadSegmentCacheEntry,
} from "./manhuaNativeDeepReadSegmentCache.js";

/** 生产开关：未开时学习链路完全走原有抽帧，零行为变化 */
export function isManhuaNativeDeepReadEnabled(): boolean {
  return String(process.env.MANHUA_NATIVE_DEEP_READ || "").trim() === "1";
}

/** 请求与前端共用共享真值；provenance 记的必须是真跑的这个。 */
export const NATIVE_DEEP_READ_MODEL = MANHUA_NATIVE_DEEP_READ_MODEL;

/** 主线：Vertex 服务账号直读 gs://（音频链路已实弹证明无需签名 URL）。 */
export const NATIVE_DEEP_READ_ROUTE_VERTEX = "vertex_gcs_video" as const;
/**
 * 兜底：EvoLink Gemini 3.1 Pro（Google 原生 generateContent 同构端点）。
 * 0826 实弹：❌ gs:// 读不了（超时）；✅ GCS V4 签名 https URL 200/43s；
 * ⚠️ EvoLink 忽略 videoMetadata.fps（同段 fps5 输入仅 32,771 tok vs Vertex
 * 128,926）——即按默认 1fps 抽帧，兜底属**降采样降级模式**，门禁照跑，宁缺勿滥。
 */
export const NATIVE_DEEP_READ_ROUTE_EVOLINK = "evolink_gemini_video" as const;
export type NativeDeepReadVisualRoute =
  | typeof NATIVE_DEEP_READ_ROUTE_VERTEX
  | typeof NATIVE_DEEP_READ_ROUTE_EVOLINK;

/** 实弹口径：gemini-3.1-pro-preview 只在 global location 验证过。 */
export const NATIVE_DEEP_READ_VERTEX_LOCATION = "global" as const;

function resolveNativeDeepReadEvolinkBaseUrl(): string {
  return String(process.env.EVOLINK_DIRECT_BASE_URL || "https://direct.evolink.ai")
    .trim().replace(/\/+$/, "") || "https://direct.evolink.ai";
}

/**
 * 计价常量（¥/M token）：按 Vertex Gemini 3.1 Pro 目录价 $1.25/$10 × 7.2 折算。
 * ⚠️ 待账单核实。
 */
const PRICE_IN_PER_M = 9.0;
const PRICE_OUT_PER_M = 72.0;
/**
 * EvoLink 兜底档价：仓库暂无 Gemini 3.1 Pro 的 EvoLink 计价样例，
 * 先按 Vertex 同价折算记账。⚠️ 待账单核实。
 */
const EVOLINK_PRICE_IN_PER_M = 9.0;
const EVOLINK_PRICE_OUT_PER_M = 72.0;

function routePrices(route: NativeDeepReadVisualRoute): { inPerM: number; outPerM: number } {
  return route === NATIVE_DEEP_READ_ROUTE_EVOLINK
    ? { inPerM: EVOLINK_PRICE_IN_PER_M, outPerM: EVOLINK_PRICE_OUT_PER_M }
    : { inPerM: PRICE_IN_PER_M, outPerM: PRICE_OUT_PER_M };
}

/**
 * 生产 generationConfig 定稿（0826 实弹验证，三种 thinking 写法均 200）：
 * 显式高思考档；不开 includeThoughts（思考不得混进输出 JSON）；
 * temperature 显式 0.8（EvoLink 文档自述 Gemini 3.x 采样参数不影响输出——
 * 兜底路照写不报错即可）；maxOutputTokens 取模型上限 65535。
 * 六栏 schema 复杂，先用 responseMimeType + 提示词硬约束 + 入库门禁，
 * 不强上 responseSchema。
 */
/**
 * Vertex responseSchema（0826 参数定稿）：与 nativeDeepReadSegmentSchema /
 * manhuaNativeAudioChunkAnalysisSchema 同构的结构骨架。只靠 responseMimeType
 * 不足以保证字段与数组结构正确——schema 约束「可解析、字段齐」，
 * min/max 与语义仍由入库 zod 门禁把守（双门各司其职，不合并）。
 */
export const NATIVE_DEEP_READ_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    shots: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          startSec: { type: "NUMBER" },
          endSec: { type: "NUMBER" },
          shotSizeZh: { type: "STRING" },
          angleZh: { type: "STRING" },
          cameraMoveZh: { type: "STRING" },
          lightingZh: { type: "STRING" },
          actionZh: { type: "STRING" },
          transitionInZh: { type: "STRING" },
        },
        required: ["startSec", "endSec", "actionZh"],
      },
    },
    subtitles: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          atSec: { type: "NUMBER" },
          textZh: { type: "STRING" },
        },
        required: ["atSec", "textZh"],
      },
    },
    audioResolution: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          chunkIndex: { type: "INTEGER" },
          analysis: {
            type: "OBJECT",
            properties: {
              audioTrack: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    fromSec: { type: "INTEGER" },
                    toSec: { type: "INTEGER" },
                    emotionArcZh: { type: "STRING" },
                    toneZh: { type: "STRING" },
                    sfxZh: { type: "STRING" },
                    bgmZh: { type: "STRING" },
                    atmosphereZh: { type: "STRING" },
                    silenceZh: { type: "STRING" },
                    cues: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          atSec: { type: "INTEGER" },
                          kind: {
                            type: "STRING",
                            enum: [
                              "sfx",
                              "bgm_in",
                              "bgm_change",
                              "bgm_out",
                              "silence_in",
                              "silence_out",
                            ],
                          },
                          detailZh: { type: "STRING" },
                        },
                        required: ["atSec", "kind", "detailZh"],
                      },
                    },
                  },
                  required: [
                    "fromSec",
                    "toSec",
                    "emotionArcZh",
                    "toneZh",
                    "sfxZh",
                    "bgmZh",
                    "atmosphereZh",
                    "silenceZh",
                    "cues",
                  ],
                },
              },
              audioBeatStructureZh: { type: "STRING" },
              mixNotesZh: { type: "STRING" },
              reusableAudioZh: { type: "STRING" },
              genAudioHintZh: { type: "STRING" },
            },
            required: [
              "audioTrack",
              "audioBeatStructureZh",
              "mixNotesZh",
              "reusableAudioZh",
              "genAudioHintZh",
            ],
          },
        },
        required: ["chunkIndex", "analysis"],
      },
    },
    beatStructureZh: { type: "STRING" },
    moodArcZh: { type: "STRING" },
    reusableZh: { type: "STRING" },
    genPromptHintZh: { type: "STRING" },
    classification: {
      type: "OBJECT",
      properties: {
        emotionTagsZh: { type: "ARRAY", items: { type: "STRING" } },
        narrativeFeatureTagsZh: { type: "ARRAY", items: { type: "STRING" } },
        performanceTagsZh: { type: "ARRAY", items: { type: "STRING" } },
        audiovisualTagsZh: { type: "ARRAY", items: { type: "STRING" } },
        audienceExperienceTagsZh: { type: "ARRAY", items: { type: "STRING" } },
      },
    },
  },
  required: ["shots", "subtitles", "audioResolution", "beatStructureZh"],
} as const;

/**
 * 0826 参数定稿（探针实证坏 JSON 非截断：ep10 段1 finish=STOP、正文 12,401 tok
 * 远低于上限）：temperature 0.8→0.65（结构化证据抽取不需要高随机性）、
 * maxOutputTokens 用官方值 65_536、candidateCount 1、补 responseSchema、
 * thinkingLevel HIGH（官方枚举大写；3.1 Pro 不能关思考，禁止传 thinkingBudget）。
 */
export const NATIVE_DEEP_READ_GENERATION_CONFIG = {
  // 0826 用户二次拍板：0.65 探针实证密度被压（83→28 镜），回调到 0.75
  temperature: 0.75,
  maxOutputTokens: 65_536,
  candidateCount: 1,
  audioTimestamp: true,
  responseMimeType: "application/json",
  responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: false },
} as const;

/** 原地重试参数（0826 定稿）：第二次不再保留随机性；其余与首发完全一致。 */
export const NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG = {
  ...NATIVE_DEEP_READ_GENERATION_CONFIG,
  temperature: 0,
} as const;

/** 响应体上限：模型异常时可能吐超大 body，不设限会把内存吃干 */
const NATIVE_RESPONSE_CAP_CHARS = 8 * 1024 * 1024;
/** 单段视觉请求总时限：实测 360s 段 144s 返回，30 分钟为失联硬顶。 */
export const NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS = 30 * 60_000;

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("已取消");
}

/**
 * 一个可直接喂给 ffmpeg 的媒体节点。
 *
 * 从 `string` 扩成对象是因为**两个来源的节点性质不同**：
 *   · batch 脚本给的是页面 URL，要先 yt-dlp 解析出 CDN 副本；
 *   · 生产主链给的是素材接入层**已经探测成功**的媒体直链，附带它验证过的 Referer。
 * 后者再跑一次 yt-dlp 只会失败——直链没有 `bytevc1_540p` 这种 format_id。
 * Referer 丢了同样会被 CDN 拒，旧抽帧链路一路带着它。
 */
export type NativeDeepReadMediaNode = {
  url: string;
  referer?: string;
};

export type NativeDeepReadSegmentSpec = {
  /** 全片绝对秒 */
  startSec: number;
  endSec: number;
  /** 给模型的段落提示（来自粗读 hotspots 的 whyZh） */
  hintZh?: string;
};

export type NativeDeepReadRunResult = NativeDeepReadOutput & {
  /** 实际计费用量，供 provenance 落库 */
  usage: { inputTokens: number; outputTokens: number; costCny: number };
  attemptedSegments: number;
  /** Vertex/EvoLink 均为按量计费；不存在套餐额度概念 */
  usingPlanQuota?: boolean;
  /** 真跑的模型名，落 provenance 用（不让入库端自己再写一遍常量） */
  model: string;
  /** 该集所有分段调用共享的批次标识，便于把 N 段回执串成一集 */
  batchRequestId?: string;
  batchEpisodeCount?: number;
  /** 视觉输入里的 AUDIO modality token（Vertex usageMetadata 回报），音轨证据 */
  audioInputTokens: number;
  /** 素材是否有音轨（切片后本地 ffprobe 探测，零模型成本） */
  hasAudio: boolean;
  /** 该集实际用过的通道；含兜底时同时出现两个 */
  visualRoutes: NativeDeepReadVisualRoute[];
  /** 走 EvoLink 1fps 降级读取的段号（降采样降级模式，回执与日志已明示） */
  degradedFpsSegmentIndexes: number[];
};

export type NativeDeepReadBatchRunEpisode = {
  episodeIndex: number;
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  segments: readonly NativeDeepReadSegmentSpec[];
  sourceDurationSec: number;
  hintZh?: string;
};

export type NativeDeepReadBatchRunResult = {
  episodes: Array<{ episodeIndex: number; result: NativeDeepReadRunResult }>;
  usage: { inputTokens: number; outputTokens: number; costCny: number };
  usingPlanQuota?: boolean;
  model: string;
  batchRequestId: string;
};

export type NativeDeepReadVisualModelReceipt = ManhuaNativeModelReceipt & {
  stage: "visual_model" | "visual_parse";
  batchRequestId: string;
  videoCount: number;
};

async function emitVisualModelReceipt(
  receipt: NativeDeepReadVisualModelReceipt,
  callback?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>,
): Promise<void> {
  console.info(`[nativeDeepReadModel] ${JSON.stringify(receipt)}`);
  try {
    await callback?.(receipt);
  } catch (error) {
    console.warn(
      "[nativeDeepReadModel] 画面阶段回执写入未完成：",
      error instanceof Error ? error.message : error,
    );
  }
}

export type NativeDeepReadRunError = Error & {
  /** 中止前已取得用量回执的成本；当前在途请求可能尚无回执。 */
  nativeDeepReadCostCny?: number;
  nativeDeepReadUsage?: {
    inputTokens: number;
    outputTokens: number;
    costCny: number;
    usingPlanQuota?: boolean;
    receiptComplete: boolean;
  };
};

function run(
  cmd: string,
  args: string[],
  timeoutMs = 600_000,
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) =>
    // signal 直通：取消时 ffmpeg 会被杀掉，否则一段 18 分钟的切片要跑完才停
    execFile(
      cmd,
      args,
      { maxBuffer: 1 << 28, timeout: timeoutMs, signal: abortSignal },
      (err, stdout, stderr) =>
        err ? reject(new Error(String(stderr || err).slice(0, 300))) : resolve(stdout),
    ),
  );
}

/** 官方单视频 2000 帧上限内留 10% 余量，避免取整后越界。 */
export const NATIVE_DEEP_READ_TARGET_FRAMES = 1_800;
/**
 * v4（0826 拍板）：视觉调用换 Vertex Gemini 3.1 Pro 从 GCS 直读、每段一次调用、
 * 音轨同调直出、双密度门禁。计划口径与采样语义全变——旧确认码必须全废。
 */
export const NATIVE_DEEP_READ_VISUAL_PLAN_VERSION = "adaptive-1800f-360s-v4-gemini" as const;

/** 两档 fps（0826 拍板）：段时长 ≤180s → 10；否则 5（下限，不再降） */
export function resolveNativeDeepReadRequestFps(totalDurationSec: number): number {
  return totalDurationSec <= 180 ? 10 : 5;
}
/** 官方视频输入 fps 上限。 */
export const NATIVE_DEEP_READ_MAX_FPS = 10;

/** 仅供旧 Fly 探针脚本引用的自适应采样函数；生产两档制不再使用。 */
export function resolveNativeDeepReadInputFps(durationSec: number): number {
  const duration = Math.max(1, Number(durationSec) || 1);
  const raw = Math.min(NATIVE_DEEP_READ_MAX_FPS, NATIVE_DEEP_READ_TARGET_FRAMES / duration);
  return Math.max(0.1, Math.floor(raw * 100) / 100);
}

/* ────────────────── 双密度地板线（0826 双密度教训的代码化） ────────────────── */

/**
 * 镜头表地板（0826 用户拍板改时长制）：15 秒地板等于允许「场面段」冒充逐镜——
 * 探针实证 360s 段 28 镜（均 12.9s/镜、最长 26s）也能过旧地板，品质过粗。
 * 温度只管发挥不管密度，密度必须靠代码门禁：
 *   镜头数 ≥ ceil(段时长/6) · 平均每镜 ≤6s · 单镜 ≤15s（超了=合并了多次切镜）。
 */
export const NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC = 6;
export const NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC = 6;
/**
 * 单镜上限的判断修订（实测依据 0823：95 镜均 2.76s，对白戏最慢 3.47s；
 * 但标题卡/长定场 16–20s 真实存在）：>15s 至多允许 1 个且 ≤25s——
 * 一律硬拒会逼模型编造假切点过门禁（违反零编造红线）或整段白烧。
 */
export const NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC = 15;
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC = 25;
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE = 1;
/** 微尾段豁免：计划切段真实存在 9s 尾段（如 1080–1089），诚实的单镜结尾不该必拒 */
export const NATIVE_DEEP_READ_SHOT_MICRO_SEGMENT_SEC = 12;
/** 音轨段数地板：≥ max(1, ceil(段时长/60)) */
/**
 * 音轨段数硬下限＝1（审查 P0-1 订正）：曾设 3 想防偷懒，但间隔公式在长段本就 ≥3，
 * 「3」只会咬短段/微尾段——提示词目标低于门禁，模型照实输出必被拒收、白买重试。
 * 反偷懒完全由 ceil(段长/间隔) 承担，硬下限只兜「至少 1 段」。
 */
export const NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN = 1;
/**
 * 45 → 60（0826 病历单问题三）：ep8 第3段模型真实听出 7 段 < 地板 8 被误拒——
 * 实际内容声音相位密度低于 45 秒公式，模型没偷懒。360s 段地板 8→6。
 */
export const NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC = 60;
/** cues 总数地板：≥ ceil(段时长/24) */
export const NATIVE_DEEP_READ_AUDIO_CUE_FLOOR_INTERVAL_SEC = 24;
/** 时间轴连续覆盖容差（秒） */
export const NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC = 0.5;

export function resolveNativeDeepReadSegmentFloors(lenSec: number): {
  minShots: number;
  minAudioTracks: number;
  minAudioCues: number;
} {
  const len = Math.max(1, Number(lenSec) || 1);
  return {
    minShots: Math.ceil(len / NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC),
    minAudioTracks: Math.max(
      NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN,
      Math.ceil(len / NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_INTERVAL_SEC),
    ),
    minAudioCues: Math.ceil(len / NATIVE_DEEP_READ_AUDIO_CUE_FLOOR_INTERVAL_SEC),
  };
}

/* ────────────────── 每段提示词与请求体（Google 原生格式） ────────────────── */

export function buildGeminiNativeDeepReadSegmentPrompt(input: {
  episodeDurationSec: number;
  startSec: number;
  endSec: number;
  segmentIndex: number;
  segmentCount: number;
  hasAudio: boolean;
  hintZh?: string;
  rejectedReasonZh?: string;
}): string {
  const lenSec = Math.max(1, Math.round(input.endSec - input.startSec));
  const floors = resolveNativeDeepReadSegmentFloors(lenSec);
  const hint = String(input.hintZh || "").trim();
  /**
   * 0826 用户拍板：硬约束只留「错了会污染入库数据」的红线；密度要求只有一套标准
   * ——就是代码门禁本身，提示词如实告知同一组验收数字，禁止「目标一套、门禁一套」。
   */
  const audioHardRule = input.hasAudio
    ? `5. audioResolution 固定为 [{"chunkIndex":${input.segmentIndex},"analysis":{…}}]，由你**亲耳所听**产出，禁止凭画面编造声音；audioTrack 与 cues 内时间用**本段局部秒**（0..${lenSec}），这是全 JSON 唯一的局部秒例外。`
    : `5. 本段素材没有音轨：audioResolution 必须返回空数组 []，禁止凭画面编造声音。`;
  const audioSoftRules = input.hasAudio
    ? `b. 音轨按声音性质切段、连续覆盖本段；验收标准：至少 ${floors.minAudioTracks} 段、声音事件（cues 总数）至少 ${floors.minAudioCues} 条。每条 audioTrack 必须完整输出 emotionArcZh/toneZh/sfxZh/bgmZh/atmosphereZh/silenceZh 与 cues 七栏，禁止省略字段；确实没有某类声音时对应文本写「无」，cues 仍必须是数组。cues 记录每一次可听见的独立声音事件（音效、配乐进出与变化、留白转换、语气突变）。analysis 的 audioBeatStructureZh/mixNotesZh/reusableAudioZh/genAudioHintZh 四栏也必须完整输出。
c. 输出预算紧张时优先压缩 subtitles，尽量保全镜头表与音轨栏的密度。`
    : "";
  const base = `你是漫剧成片的「导演手法」分析师。当前视频是全片（共 ${Math.round(input.episodeDurationSec)} 秒）的第 ${Math.round(input.startSec)}–${Math.round(input.endSec)} 秒（第 ${input.segmentIndex + 1}/${input.segmentCount} 段）${hint ? `（${hint}）` : ""}。

**重点是拍法，不是剧情。** 只返回一个 JSON，不要 Markdown 围栏：
{
 "shots":[{"startSec":整数,"endSec":整数,
   "shotSizeZh":"景别：极特写/特写/近景/中景/全景/大远景",
   "angleZh":"机位：平视/仰拍/俯拍/过肩/主观",
   "cameraMoveZh":"运镜：方向与速度，例「1.2秒内从中景推到面部特写」「快速右摇」；看不出运动写「固定机位」",
   "lightingZh":"光影：光位、色调、明暗对比",
   "actionZh":"这一镜的可拍动作",
   "transitionInZh":"进入这一镜的转场：硬切/闪白/黑场/遮挡转场/叠化"}],
 "subtitles":[{"atSec":整数,"textZh":"画面上真实出现的字幕原文，逐字照抄"}],
 "audioResolution":[{"chunkIndex":${input.segmentIndex},"analysis":{"audioTrack":[{"fromSec":局部整数秒,"toSec":局部整数秒,"emotionArcZh":"情绪强度变化","toneZh":"怎么说，不写台词","sfxZh":"音效","bgmZh":"配乐","atmosphereZh":"气氛","silenceZh":"留白","cues":[{"atSec":局部整数秒,"kind":"sfx/bgm_in/bgm_change/bgm_out/silence_in/silence_out","detailZh":"事件"}]}],"audioBeatStructureZh":"声音节奏","mixNotesZh":"混音","reusableAudioZh":"可复用声音手法","genAudioHintZh":"生成声音要素"}}],
 "beatStructureZh":"节奏结构：憋了几秒、第几秒爆、爆后怎么收",
 "moodArcZh":"情绪推进：起点→转折秒位→终点",
 "classification":{"emotionTagsZh":["从真证据提取的情绪标签"],"narrativeFeatureTagsZh":["叙事特色"],"performanceTagsZh":["表演特色"],"audiovisualTagsZh":["视听特色"],"audienceExperienceTagsZh":["观众体验"]},
 "reusableZh":"可复用手法（脱离本剧剧情，写成通用做法）",
 "genPromptHintZh":"若用 AI 生成类似片段，画面提示词该写哪几个要素"
}
硬约束（只有这五条，必须遵守）：
1. shots 与 subtitles 的 startSec/endSec/atSec **一律写全片绝对秒位**：本段即 ${Math.round(input.startSec)}..${Math.round(input.endSec)} 秒；shots 连续无空档覆盖整段。
2. cameraMoveZh 只写真看到的运动，看不出运动就写「固定机位」，禁止套「镜头拉远」这类无依据说法。
3. 所有中文描述字段【禁止】出现钟表式时间（如 01:23、1:05:30）或「在第X秒」式秒位定位——秒位只进数字字段；描述动作时长（如「1.2秒内推近」）不在此限。
4. 分析描述不写外部平台剧名、商标或原台词；subtitles 是唯一例外——逐字照抄画面上真实出现的字幕，看不清写「[不可辨]」，禁止按剧情补全或从声音猜字。
${audioHardRule}
建议（软边界，按素材实际情况尽量做到）：
a. 这类漫剧的真实节奏通常 2–5 秒一镜，按真实发生的切换逐镜记录，不要为省输出合并镜头。一个剧情段落通常由多个镜头切换组成——**不要把「剧情段」当成一个镜头**，每次画面切换（机位/景别/场景变化）都是新的一镜。验收标准（与入库门禁同一套数字）：本段至少 ${floors.minShots} 镜、平均每镜不超过 ${NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC} 秒；超过 ${NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC} 秒的长镜头（如标题卡/长定场）至多 1 个且不超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒。
${audioSoftRules}
d. reusableZh 尽量写成脱离本剧剧情的通用做法；classification 建议只写从本段真实证据提炼的特征标签（避免古言/逆袭/系统/甜宠等题材词），每类可多项。`;
  return input.rejectedReasonZh
    ? `${base}\n【上一轮被拒原因】${String(input.rejectedReasonZh).slice(0, 300)}。请修正后重新输出完整 JSON；修正时尽量不要降低镜头表或音轨密度。`
    : base;
}

/**
 * Google 原生 generateContent 请求体；Vertex 与 EvoLink 同构，只换端点与鉴权。
 * fileData 主线用 gs://（Vertex 服务账号可读），兜底用 GCS V4 签名 https。
 */
export function buildGeminiNativeDeepReadSegmentRequest(input: {
  fileUri: string;
  fps: number;
  prompt: string;
  /** 原地重试传 NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG（temperature 0）；缺省=首发参数 */
  generationConfig?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    contents: [{
      role: "user",
      parts: [
        // 定稿口径：影片 part 在前，提示词 part 在后
        {
          fileData: { fileUri: input.fileUri, mimeType: "video/mp4" },
          videoMetadata: { fps: input.fps },
        },
        { text: input.prompt },
      ],
    }],
    generationConfig: input.generationConfig || NATIVE_DEEP_READ_GENERATION_CONFIG,
  };
}

/**
 * 段缓存参数指纹：PLAN_VERSION + generationConfig + 提示词模板（含/不含音轨两个典型实例）。
 * 任何会改变模型产出口径的改动都会翻新指纹，旧缓存自动作废——缓存永远不冒充新标准的产出。
 */
let segmentCacheFingerprintMemo: string | null = null;
export function nativeDeepReadSegmentCacheFingerprint(): string {
  if (segmentCacheFingerprintMemo) return segmentCacheFingerprintMemo;
  const canonical = [
    NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
    JSON.stringify(NATIVE_DEEP_READ_GENERATION_CONFIG),
    buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 3600, startSec: 0, endSec: 360,
      segmentIndex: 0, segmentCount: 10, hasAudio: true,
    }),
    buildGeminiNativeDeepReadSegmentPrompt({
      episodeDurationSec: 3600, startSec: 0, endSec: 360,
      segmentIndex: 0, segmentCount: 10, hasAudio: false,
    }),
  ].join("\n⊞\n");
  segmentCacheFingerprintMemo = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return segmentCacheFingerprintMemo;
}

/* ────────────────── HTTP 通道（Vertex 主线 / EvoLink 兜底） ────────────────── */

function makeTimedSignal(parent: AbortSignal | undefined, timeoutMs: number, message: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
  const onAbort = () => controller.abort(abortReason(parent));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", onAbort); },
  };
}

export type NativeDeepReadModelResponse = {
  status: number;
  text: string;
  requestId?: string;
};

async function postGenerateContent(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  abortSignal?: AbortSignal;
}): Promise<NativeDeepReadModelResponse> {
  const managed = makeTimedSignal(
    input.abortSignal,
    NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS,
    "原生精读请求超过总时限",
  );
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: { ...input.headers, "Content-Type": "application/json" },
      signal: managed.signal,
      body: JSON.stringify(input.body),
    });
    const text = await response.text();
    if (text.length > NATIVE_RESPONSE_CAP_CHARS) {
      throw new Error("原生精读响应超过处理上限");
    }
    return {
      status: response.status,
      text,
      requestId: String(
        response.headers.get("x-request-id")
        || response.headers.get("request-id")
        || response.headers.get("x-goog-request-id")
        || "",
      ).trim() || undefined,
    };
  } finally {
    managed.dispose();
  }
}

async function postVertexNativeDeepRead(
  body: unknown,
  abortSignal?: AbortSignal,
): Promise<NativeDeepReadModelResponse> {
  const url = `${baseUrlForVertex(NATIVE_DEEP_READ_VERTEX_LOCATION)}/v1/projects/`
    + `${encodeURIComponent(getVertexProjectId())}/locations/${NATIVE_DEEP_READ_VERTEX_LOCATION}`
    + `/publishers/google/models/${encodeURIComponent(NATIVE_DEEP_READ_MODEL)}:generateContent`;
  return postGenerateContent({
    url,
    headers: await getVertexAuthHeaders(),
    body,
    abortSignal,
  });
}

async function postEvolinkNativeDeepRead(
  body: unknown,
  abortSignal?: AbortSignal,
): Promise<NativeDeepReadModelResponse> {
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new Error("EVOLINK_API_KEY 未配置，EvoLink 兜底不可用");
  const url = `${resolveNativeDeepReadEvolinkBaseUrl()}/v1beta/models/`
    + `${encodeURIComponent(NATIVE_DEEP_READ_MODEL)}:generateContent`;
  return postGenerateContent({
    url,
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    abortSignal,
  });
}

/* ────────────────── 媒体节点解析（yt-dlp，与批处理脚本共用） ────────────────── */

/** 按体积挑 format：同为 720p，h264 是 477MB 而 bytevc1 只有 225MB —— 不能按 height 排 */
export function pickSmallestVideoFormat(
  formats: ReadonlyArray<Record<string, unknown>>,
): { url: string; sizeMB: number } | null {
  const candidates = formats
    .filter((f) => String(f.format_id || "").startsWith("bytevc1_540p"))
    .map((f) => ({
      url: String(f.url || ""),
      size: Number(f.filesize || f.filesize_approx || 0),
    }))
    .filter((f) => f.url)
    .sort((a, b) => (a.size || 9e15) - (b.size || 9e15));
  const best = candidates[0];
  return best ? { url: best.url, sizeMB: best.size / 1048576 } : null;
}

/**
 * 解析该集的 CDN 节点副本：**只拿地址，不下载**。
 *
 * 「挑 format 按体积不按 height」这个口径只能有一处实现（判据收口）。
 * `abortSignal` 必须直通：否则用户中止时会卡在 yt-dlp 解析上等它自己结束。
 */
export async function resolveNativeDeepReadNodeUrls(
  sourceUrl: string,
  abortSignal?: AbortSignal,
): Promise<NativeDeepReadMediaNode[]> {
  const url = String(sourceUrl || "").trim();
  if (!url) throw new Error("缺少可解析的剧集地址");
  const cookie = String(process.env.DOUYIN_COOKIE || "").trim();
  const stdout = await run(
    "yt-dlp",
    ["-J", "--no-warnings", ...(cookie ? ["--add-header", `Cookie:${cookie}`] : []), url],
    120_000,
    abortSignal,
  );
  const info = JSON.parse(stdout) as { formats?: Array<Record<string, unknown>> };
  const best = pickSmallestVideoFormat(info.formats || []);
  if (!best) throw new Error("未解析到可用的 540p 档");
  /**
   * 0826 实弹修复：节点必须自带 Referer——抖音 CDN 无 Referer 会拒（仓库教条）。
   * 在解析器层一次收口，切片/探测两处调用方全部受益，防"同一课学两遍"。
   */
  return [{ url: best.url, referer: "https://www.douyin.com/" }];
}

/* ────────────────── 切段 → GCS 上传 → 用后删（媒体准备） ────────────────── */

const NATIVE_VIDEO_TEMP_PREFIX = "manhua-template-learn/tmp/native-deep-read";
const NATIVE_VIDEO_SEGMENT_MAX_BYTES = 90 * 1024 * 1024;
/**
 * 0826 拍板保留的 64MB 单集媒体预算（源自 Qwen 时代 120 秒下载窗实弹，
 * 对 Gemini 同样是控制单段/单集体积与转码触发线的守恒量，暂不放宽）。
 */
export const NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES = 64 * 1024 * 1024;
/** 切段前 /tmp 必须至少剩 500MB，否则关闭式停止（不切半截片）。 */
export const NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES = 500 * 1024 * 1024;

function mediaHeaders(node: NativeDeepReadMediaNode): string[] {
  const referer = String(node.referer || "").trim();
  return [
    "-user_agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    ...(referer ? ["-headers", `Referer: ${referer}\r\n`] : []),
  ];
}

/** 长片切段仅做容器复制，不重编码；-ss 放在 -i 前，避免先下载整集。 */
export function buildNativeDeepReadVideoSegmentArgs(input: {
  node: NativeDeepReadMediaNode;
  startSec: number;
  durationSec: number;
  outputPath: string;
}): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    ...mediaHeaders(input.node),
    "-ss", String(input.startSec), "-i", input.node.url,
    "-t", String(input.durationSec), "-map", "0:v:0", "-map", "0:a?",
    "-c", "copy", "-avoid_negative_ts", "make_zero", input.outputPath,
  ];
}

/** 兼容既有调用者；实现统一委托给新的长片分段参数构造器。 */
export function buildCutSegmentArgs(
  node: NativeDeepReadMediaNode,
  startSec: number,
  lenSec: number,
  localPath: string,
): string[] {
  return buildNativeDeepReadVideoSegmentArgs({
    node,
    startSec,
    durationSec: lenSec,
    outputPath: localPath,
  });
}

/**
 * 转码压体积的目标视频码率（kbps）。
 *
 * 让整集所有分片压进单集媒体预算：预算字节 ×8 换成比特，×0.92 给容器与
 * 码率波动留余量，摊到整集时长后再扣掉 48kbps 音轨（音轨必须保留，模型听声）。
 */
export function resolveNativeDeepReadTranscodeVideoKbps(
  budgetBytes: number,
  episodeTotalDurationSec: number,
): number {
  const duration = Math.max(1, Number(episodeTotalDurationSec) || 1);
  return Math.floor((Math.max(0, Number(budgetBytes) || 0) * 8 * 0.92 / duration) / 1000) - 48;
}

/** 超预算分片的转码参数：540p + libx264 限码率，音轨保留 48k AAC。 */
export function buildNativeDeepReadTranscodeToFitArgs(input: {
  inputPath: string;
  outputPath: string;
  videoKbps: number;
}): string[] {
  const kbps = Math.max(1, Math.floor(input.videoKbps));
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", input.inputPath,
    "-vf", "scale=-2:540",
    "-c:v", "libx264", "-preset", "veryfast",
    "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${2 * kbps}k`,
    "-c:a", "aac", "-b:a", "48k",
    input.outputPath,
  ];
}

export type PreparedNativeVideo = {
  /** GCS 对象地址（gs://）；Vertex 主线直读，EvoLink 兜底再签 https。 */
  gsUri: string;
  startSec: number;
  endSec: number;
  temporaryGcs: { bucket: string; objectName: string };
  /** 上传分片的实际字节数。 */
  bytes: number;
  /** 该分片本地探测是否含音轨（整集口径取首片探测结果）。 */
  hasAudio: boolean;
};

export type NativeDeepReadMediaPreparationDeps = {
  runMedia: (
    cmd: string,
    args: string[],
    timeoutMs?: number,
    abortSignal?: AbortSignal,
  ) => Promise<string>;
  statLocal: (path: string) => Promise<{ size: number }>;
  readLocal: (path: string) => Promise<Buffer>;
  unlinkLocal: (path: string) => Promise<void>;
  upload: typeof uploadBufferToGcs;
  remove: typeof deleteGcsObject;
  /** 切段前的 /tmp 可用空间检查（node:fs/promises statfs）。 */
  statfsTmp: () => Promise<{ freeBytes: number }>;
};

const defaultMediaPreparationDeps: NativeDeepReadMediaPreparationDeps = {
  runMedia: run,
  statLocal: async (path) => stat(path),
  readLocal: async (path) => readFile(path),
  unlinkLocal: unlink,
  upload: uploadBufferToGcs,
  remove: deleteGcsObject,
  statfsTmp: async () => {
    const stats = await statfs("/tmp");
    return { freeBytes: Number(stats.bsize) * Number(stats.bavail) };
  },
};

/** 本地切片的音轨探测（零模型成本）；探不动按「无音轨」保守处理并告警。 */
async function probeLocalSegmentHasAudio(
  localPath: string,
  deps: NativeDeepReadMediaPreparationDeps,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  try {
    const text = await deps.runMedia(
      "ffprobe",
      [
        "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=index", "-of", "json", "-i", localPath,
      ],
      30_000,
      abortSignal,
    );
    const parsed = JSON.parse(text || "{}") as { streams?: unknown[] };
    return Array.isArray(parsed.streams) && parsed.streams.length > 0;
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.warn("[nativeDeepRead] 本地音轨探测未完成，按无音轨保守处理");
    return false;
  }
}

/**
 * 每集统一走 切段 → GCS 上传 → 用后删；Gemini 拉不了抖音 CDN 直链，
 * 不再保留「整集直读 CDN」路径。上传后立即删本地段文件。
 */
export async function prepareEpisodeVideos(
  episode: NativeDeepReadBatchRunEpisode,
  abortSignal?: AbortSignal,
  deps: NativeDeepReadMediaPreparationDeps = defaultMediaPreparationDeps,
): Promise<PreparedNativeVideo[]> {
  const segments = validateNativeDeepReadSegments(episode.segments);

  // 切段前先看 /tmp：磁盘打满时 ffmpeg 会切出半截片，宁可关闭式停止。
  const { freeBytes } = await deps.statfsTmp();
  if (freeBytes < NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES) {
    throw new Error(
      `/tmp 可用空间 ${(freeBytes / 1048576).toFixed(0)}MB 低于 500MB 下限，已停止切段`,
    );
  }

  const prepared: PreparedNativeVideo[] = [];
  const cutRows: Array<{
    runId: string;
    localPath: string;
    startSec: number;
    endSec: number;
    bytes: number;
  }> = [];
  let episodeHasAudio = false;
  try {
    // 第一阶段：全部分片先切到本地并记下体积——整集总字节数已知后才能判断
    // 是否超单集媒体预算；超了必须在上传 GCS 之前转码压体积。
    for (let index = 0; index < segments.length; index += 1) {
      abortSignal?.throwIfAborted();
      const segment = segments[index]!;
      let lastError: unknown;
      let completed = false;
      for (let attempt = 0; attempt < 3 && !completed; attempt += 1) {
        abortSignal?.throwIfAborted();
        const nodes = await episode.resolveNodes();
        const node = nodes[attempt % Math.max(1, nodes.length)];
        if (!node?.url) throw new Error(`第${episode.episodeIndex}集第${index + 1}段未解析到媒体节点`);
        const runId = crypto.randomUUID();
        const localPath = `/tmp/manhua-native-video-${runId}.mp4`;
        try {
          await deps.runMedia(
            "ffmpeg",
            buildNativeDeepReadVideoSegmentArgs({
              node,
              startSec: segment.startSec,
              durationSec: segment.endSec - segment.startSec,
              outputPath: localPath,
            }),
            20 * 60_000,
            abortSignal,
          );
          const fileStat = await deps.statLocal(localPath);
          if (fileStat.size < 100_000 || fileStat.size > NATIVE_VIDEO_SEGMENT_MAX_BYTES) {
            throw new Error(`第${episode.episodeIndex}集第${index + 1}段大小不在处理范围`);
          }
          cutRows.push({
            runId,
            localPath,
            startSec: segment.startSec,
            endSec: segment.endSec,
            bytes: fileStat.size,
          });
          if (index === 0) {
            episodeHasAudio = await probeLocalSegmentHasAudio(localPath, deps, abortSignal);
          }
          completed = true;
        } catch (error) {
          await deps.unlinkLocal(localPath).catch(() => undefined);
          lastError = error;
          if (abortSignal?.aborted) throw error;
          if (attempt < 2) {
            console.warn(`[nativeDeepRead] 第${episode.episodeIndex}集第${index + 1}段媒体准备失败，刷新节点后重试`);
          }
        }
      }
      if (!completed) throw lastError instanceof Error ? lastError : new Error("视频分片准备失败");
    }

    // 第二阶段：整集总字节超预算时逐片转码压体积。
    const totalBytesBefore = cutRows.reduce((sum, row) => sum + row.bytes, 0);
    if (totalBytesBefore > NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES) {
      const episodeDurationSec = cutRows.reduce(
        (sum, row) => sum + Math.max(1, row.endSec - row.startSec),
        0,
      );
      const videoKbps = resolveNativeDeepReadTranscodeVideoKbps(
        NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES,
        episodeDurationSec,
      );
      if (videoKbps <= 0) {
        throw new Error(`第${episode.episodeIndex}集转码后仍超下载预算，请缩短分段`);
      }
      console.warn(
        `[nativeDeepRead] 第${episode.episodeIndex}集切片共 ${(totalBytesBefore / 1048576).toFixed(1)}MB `
        + `超过单请求下载预算，按 ${videoKbps}kbps 逐片转码压体积（音轨保留）`,
      );
      for (const row of cutRows) {
        abortSignal?.throwIfAborted();
        const outputPath = `/tmp/manhua-native-video-${row.runId}-fit.mp4`;
        try {
          await deps.runMedia(
            "ffmpeg",
            buildNativeDeepReadTranscodeToFitArgs({
              inputPath: row.localPath,
              outputPath,
              videoKbps,
            }),
            20 * 60_000,
            abortSignal,
          );
          const transStat = await deps.statLocal(outputPath);
          if (transStat.size < 100_000) {
            throw new Error(`第${episode.episodeIndex}集转码产物大小不在处理范围`);
          }
          await deps.unlinkLocal(row.localPath).catch(() => undefined);
          row.localPath = outputPath;
          row.bytes = transStat.size;
        } catch (error) {
          await deps.unlinkLocal(outputPath).catch(() => undefined);
          throw error;
        }
      }
      const totalBytesAfter = cutRows.reduce((sum, row) => sum + row.bytes, 0);
      if (totalBytesAfter > NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES) {
        throw new Error(`第${episode.episodeIndex}集转码后仍超下载预算，请缩短分段`);
      }
      console.warn(
        `[nativeDeepRead] 第${episode.episodeIndex}集转码完成：`
        + `${(totalBytesBefore / 1048576).toFixed(1)}MB → ${(totalBytesAfter / 1048576).toFixed(1)}MB`,
      );
    }

    // 第三阶段：确认在预算内后再上传 GCS。Vertex 直读 gs://，这里不签任何 URL；
    // 上传成功即删本地段文件（finally 统一兜底）。
    for (const row of cutRows) {
      abortSignal?.throwIfAborted();
      const uploaded = await deps.upload({
        objectName: `${NATIVE_VIDEO_TEMP_PREFIX}/${row.runId}.mp4`,
        buffer: await deps.readLocal(row.localPath),
        contentType: "video/mp4",
        signal: abortSignal,
      });
      await deps.unlinkLocal(row.localPath).catch(() => undefined);
      prepared.push({
        gsUri: uploaded.gcsUri,
        startSec: row.startSec,
        endSec: row.endSec,
        temporaryGcs: { bucket: uploaded.bucket, objectName: uploaded.objectName },
        bytes: row.bytes,
        hasAudio: episodeHasAudio,
      });
    }
    return prepared;
  } catch (error) {
    await Promise.allSettled(prepared.map((row) => deps.remove(row.temporaryGcs)));
    throw error;
  } finally {
    await Promise.allSettled(cutRows.map((row) => deps.unlinkLocal(row.localPath)));
  }
}

/* ────────────────── 段级密度门禁与整集证据门禁 ────────────────── */

export function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 兜底解析也必须包 try：0826 实弹第8集,模型坏 JSON 在这里抛原始 SyntaxError
    // （"Expected ':' after property name…"）,绕过下方标准文案 → 重试分类器不认,
    // 该重试一次的没重试,整集停机保占位。任何解析失败都必须收敛到标准门禁文案。
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      }
    } catch {
      // 落到统一 throw
    }
  }
  throw new Error("原生精读没有返回可解析的 JSON 对象");
}

/** 门禁类失败（结构/密度/时间轴）：值得带被拒原因原地重试一次；网络/HTTP 失败不算。 */
const NATIVE_DEEP_READ_GATE_PREFIX = "原生精读密度门禁";

export function isNativeDeepReadGateFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ZodError") return true;
  return error.message.includes(NATIVE_DEEP_READ_GATE_PREFIX)
    || /音频分析|音频事件|音频描述|没有返回可解析的 JSON|输出被截断/.test(error.message);
}

function gateError(detailZh: string): Error {
  return new Error(`${NATIVE_DEEP_READ_GATE_PREFIX}：${detailZh}`);
}

function sortedShots(raw: Record<string, unknown>): Array<{ startSec: number; endSec: number }> {
  return (Array.isArray(raw.shots) ? raw.shots : [])
    .map((row) => row as Record<string, unknown>)
    .map((row) => ({ startSec: Number(row.startSec), endSec: Number(row.endSec) }))
    .filter((row) => Number.isFinite(row.startSec) && Number.isFinite(row.endSec) && row.endSec > row.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

function assertShotCoverage(
  shots: ReadonlyArray<{ startSec: number; endSec: number }>,
  startSec: number,
  endSec: number,
  labelZh: string,
): void {
  const tolerance = NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC;
  if (!shots.length || Math.abs(shots[0]!.startSec - startSec) > tolerance) {
    throw gateError(`${labelZh}镜头未从 ${startSec} 秒开始`);
  }
  let cursor = startSec;
  for (const shot of shots) {
    if (shot.startSec > cursor + tolerance || shot.startSec < cursor - tolerance) {
      throw gateError(`${labelZh}镜头时间轴存在空档或重叠`);
    }
    cursor = shot.endSec;
  }
  if (Math.abs(cursor - endSec) > tolerance) {
    throw gateError(`${labelZh}镜头未覆盖到 ${endSec} 秒`);
  }
}

/**
 * 视觉描述文本零秒位门禁（assertNoClockText 口径，MM:SS 钟表式）：
 * 秒位只进数字字段；subtitles 是唯一例外（画面证据逐字照抄，可能含内嵌时码）。
 * 「1.2秒内推近」这类动作时长不含冒号，天然不触发。
 */
function assertVisualTextNoClock(raw: Record<string, unknown>, labelZh: string): void {
  const offenders: string[] = [];
  const check = (field: string, value: unknown) => {
    if (typeof value === "string" && hasClockTextZh(value)) offenders.push(field);
  };
  for (const shot of Array.isArray(raw.shots) ? raw.shots : []) {
    const row = shot as Record<string, unknown>;
    for (const field of [
      "shotSizeZh", "angleZh", "cameraMoveZh", "lightingZh", "actionZh", "transitionInZh",
    ]) check(`shots.${field}`, row[field]);
  }
  for (const field of ["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh"]) {
    check(field, raw[field]);
  }
  const classification = raw.classification as Record<string, unknown> | undefined;
  if (classification && typeof classification === "object") {
    for (const [key, tags] of Object.entries(classification)) {
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) check(`classification.${key}`, tag);
    }
  }
  if (offenders.length) {
    throw gateError(
      `${labelZh}描述文本含钟表式秒位（${Array.from(new Set(offenders)).slice(0, 5).join("、")}）——秒位只进数字字段`,
    );
  }
}

/**
 * 段级双密度门禁（0826 双密度教训）：
 *   镜头表：绝对秒位、连续覆盖本段、镜头数 ≥ ceil(段时长/6)；
 *   音轨栏：audioResolution 恰好 [{chunkIndex:段号}]、audioTrack 段数
 *     ≥ max(3, ceil(段时长/60))、cues 总数 ≥ ceil(段时长/24)、
 *     局部时间轴连续覆盖 ±0.5s（复用共享 normalize 的硬校验）。
 * 不达标＝该段拒收（带拒因重试一次由调用方负责）。
 */
export function assertNativeDeepReadSegmentDensity(input: {
  episodeIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio: boolean;
  raw: Record<string, unknown>;
}): void {
  const lenSec = Math.max(1, Math.round(input.endSec - input.startSec));
  const floors = resolveNativeDeepReadSegmentFloors(lenSec);
  const parsed = nativeDeepReadSegmentSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw gateError(`第${input.segmentIndex + 1}段结构不合六栏 schema`);
  }
  assertVisualTextNoClock(input.raw, `第${input.segmentIndex + 1}段`);
  const shots = sortedShots(input.raw);
  assertShotCoverage(shots, Math.round(input.startSec), Math.round(input.endSec), `第${input.segmentIndex + 1}段`);
  // 时长制镜头门禁（0826 用户参考稿 + 两处判断修订：微尾段豁免、长定场限额）
  if (lenSec > NATIVE_DEEP_READ_SHOT_MICRO_SEGMENT_SEC) {
    if (shots.length < floors.minShots) {
      throw gateError(
        `第${input.segmentIndex + 1}段镜头密度不足：${lenSec}秒至少需要${floors.minShots}镜，实际${shots.length}（禁止为省输出合并镜头）`,
      );
    }
    const averageShotSec = lenSec / shots.length;
    if (averageShotSec > NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC) {
      throw gateError(
        `第${input.segmentIndex + 1}段镜头粒度过粗：平均每镜${averageShotSec.toFixed(1)}秒（上限 ${NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC} 秒）`,
      );
    }
    const overlongShots = shots
      .map((shot) => shot.endSec - shot.startSec)
      .filter((shotLen) => shotLen > NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC);
    const hardOverlong = overlongShots.filter(
      (shotLen) => shotLen > NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC,
    );
    if (hardOverlong.length > 0) {
      throw gateError(
        `第${input.segmentIndex + 1}段存在超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒的镜头段（最长 ${Math.round(Math.max(...hardOverlong))} 秒），需重新检查是否合并了多次切镜`,
      );
    }
    if (overlongShots.length > NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE) {
      throw gateError(
        `第${input.segmentIndex + 1}段有 ${overlongShots.length} 个超过 ${NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC} 秒的镜头段（长定场限额 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE} 个），需重新检查是否合并了多次切镜`,
      );
    }
  }
  // 审查 P1-4：空文本会在 mapNativeDeepReadSegments 被静默丢弃（actionZh 空丢单镜、
  // beatStructureZh 空丢整段镜头），密度承诺被掏空——门禁前置拒收。
  // 注意从 raw.shots 原始对象取 actionZh（sortedShots 只保留秒位字段）。
  const emptyActionCount = (Array.isArray(input.raw.shots) ? input.raw.shots : [])
    .filter((shot) =>
      !String((shot as Record<string, unknown>).actionZh || "").trim()).length;
  if (emptyActionCount > 0) {
    throw gateError(`第${input.segmentIndex + 1}段有 ${emptyActionCount} 个镜头 actionZh 为空（落库会被丢弃）`);
  }
  if (!String((input.raw as Record<string, unknown>).beatStructureZh || "").trim()) {
    throw gateError(`第${input.segmentIndex + 1}段 beatStructureZh 为空（落库整段镜头会被丢弃）`);
  }
  const audioResolution = parsed.data.audioResolution;
  if (!input.hasAudio) {
    if (audioResolution.length > 0) {
      throw gateError(`第${input.segmentIndex + 1}段素材无音轨却返回了 audioResolution`);
    }
    return;
  }
  if (audioResolution.length !== 1 || audioResolution[0]!.chunkIndex !== input.segmentIndex) {
    throw gateError(
      `第${input.segmentIndex + 1}段 audioResolution 必须恰好为 [{chunkIndex:${input.segmentIndex}}]，禁留空`,
    );
  }
  // responseSchema 只约束 Vertex 主调用；GLM 修复与兼容通道路由仍可能省字段。
  // 在 zod 默认值生效前检查原始对象，避免把缺栏静默补成空字符串/空 cues 后入库。
  const rawAudioRows = Array.isArray((input.raw as Record<string, unknown>).audioResolution)
    ? ((input.raw as Record<string, unknown>).audioResolution as unknown[])
    : [];
  const rawAudioEntry = rawAudioRows[0];
  const rawAnalysis = rawAudioEntry && typeof rawAudioEntry === "object" && !Array.isArray(rawAudioEntry)
    ? (rawAudioEntry as Record<string, unknown>).analysis
    : undefined;
  if (!rawAnalysis || typeof rawAnalysis !== "object" || Array.isArray(rawAnalysis)) {
    throw gateError(`第${input.segmentIndex + 1}段音轨 analysis 缺失或格式无效`);
  }
  const rawAnalysisRecord = rawAnalysis as Record<string, unknown>;
  const requiredAnalysisFields = [
    "audioTrack",
    "audioBeatStructureZh",
    "mixNotesZh",
    "reusableAudioZh",
    "genAudioHintZh",
  ];
  const missingAnalysisFields = requiredAnalysisFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(rawAnalysisRecord, field),
  );
  if (missingAnalysisFields.length > 0) {
    throw gateError(
      `第${input.segmentIndex + 1}段音轨汇总字段不完整：缺 ${missingAnalysisFields.join("、")}`,
    );
  }
  const requiredTrackFields = [
    "fromSec",
    "toSec",
    "emotionArcZh",
    "toneZh",
    "sfxZh",
    "bgmZh",
    "atmosphereZh",
    "silenceZh",
    "cues",
  ];
  const rawTracks = Array.isArray(rawAnalysisRecord.audioTrack)
    ? rawAnalysisRecord.audioTrack
    : [];
  for (let trackIndex = 0; trackIndex < rawTracks.length; trackIndex += 1) {
    const rawTrack = rawTracks[trackIndex];
    if (!rawTrack || typeof rawTrack !== "object" || Array.isArray(rawTrack)) {
      throw gateError(`第${input.segmentIndex + 1}段第${trackIndex + 1}条音轨格式无效`);
    }
    const missingTrackFields = requiredTrackFields.filter(
      (field) => !Object.prototype.hasOwnProperty.call(rawTrack, field),
    );
    if (missingTrackFields.length > 0) {
      throw gateError(
        `第${input.segmentIndex + 1}段第${trackIndex + 1}条音轨字段不完整：缺 ${missingTrackFields.join("、")}`,
      );
    }
  }
  const analysis = manhuaNativeAudioChunkAnalysisSchema.parse(audioResolution[0]!.analysis);
  if (analysis.audioTrack.length < floors.minAudioTracks) {
    throw gateError(
      `第${input.segmentIndex + 1}段音轨仅 ${analysis.audioTrack.length} 段，低于地板线 ${floors.minAudioTracks}`,
    );
  }
  const cueCount = analysis.audioTrack.reduce((sum, track) => sum + track.cues.length, 0);
  if (cueCount < floors.minAudioCues) {
    throw gateError(
      `第${input.segmentIndex + 1}段声音事件仅 ${cueCount} 条，低于地板线 ${floors.minAudioCues}`,
    );
  }
  // 局部时间轴连续覆盖 ±0.5s、cue 落区间、文本秒位剥离——共享 normalize 全套硬校验。
  normalizeManhuaNativeAudioChunkAnalysis({
    raw: audioResolution[0]!.analysis,
    chunk: { index: input.segmentIndex, startSec: 0, endSec: lenSec },
  });
}

/**
 * 整集证据门禁（段卡合并后再跑一遍）：
 * 全部段齐、镜头轴 0..durationSec 连续全覆盖、整集镜头数 ≥ ceil(时长/6)、
 * 有音轨时 audioResolution 段号恰好 0..n-1。
 */
export function assertNativeDeepReadEpisodeEvidence(input: {
  episodeIndex: number;
  durationSec: number;
  segments: readonly NativeDeepReadSegmentSpec[];
  hasAudio: boolean;
  /** 确定性拼接时为逐段卡数组；GLM 整形后为单张合成卡。 */
  rawSegments: ReadonlyArray<Record<string, unknown>>;
}): void {
  if (!input.rawSegments.length) {
    throw new Error(`第${input.episodeIndex}集没有分段产出，整集拒绝入库`);
  }
  // 门禁在 GLM 之后重跑：整形/修复产物同样零秒位（assertNoClockText 口径）。
  for (const raw of input.rawSegments) {
    try {
      assertVisualTextNoClock(raw, `第${input.episodeIndex}集`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}，整集拒绝入库`,
      );
    }
  }
  const allShots = input.rawSegments
    .flatMap((raw) => sortedShots(raw))
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  try {
    assertShotCoverage(allShots, 0, Math.round(input.durationSec), "整集");
  } catch (error) {
    throw new Error(
      `第${input.episodeIndex}集${error instanceof Error ? error.message : String(error)}，整集拒绝入库`,
    );
  }
  const minShots = Math.ceil(
    Math.max(1, input.durationSec) / NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC,
  );
  if (allShots.length < minShots) {
    throw new Error(
      `第${input.episodeIndex}集整集镜头 ${allShots.length} 个低于地板线 ${minShots}，整集拒绝入库`,
    );
  }
  if (input.hasAudio) {
    const entries = input.rawSegments
      .flatMap((raw) => (Array.isArray(raw.audioResolution) ? raw.audioResolution : [])
        .map((row) => row as Record<string, unknown>))
      .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
    const chunkIndexes = entries.map((row) => Number(row.chunkIndex));
    const expected = input.segments.map((_, index) => index);
    if (JSON.stringify(chunkIndexes) !== JSON.stringify(expected)) {
      throw new Error(`第${input.episodeIndex}集音轨分段不完整，整集拒绝入库`);
    }
    // 门禁永远在 GLM 之后再跑：整形只管结构干净，音轨厚度不达标照拒（宁缺勿滥）。
    for (const entry of entries) {
      const segment = input.segments[Number(entry.chunkIndex)]!;
      const lenSec = Math.max(1, Math.round(segment.endSec - segment.startSec));
      const floors = resolveNativeDeepReadSegmentFloors(lenSec);
      const parsed = manhuaNativeAudioChunkAnalysisSchema.safeParse(entry.analysis);
      if (!parsed.success) {
        throw new Error(`第${input.episodeIndex}集第${Number(entry.chunkIndex) + 1}段音轨结构无效，整集拒绝入库`);
      }
      const cueCount = parsed.data.audioTrack.reduce((sum, track) => sum + track.cues.length, 0);
      if (
        parsed.data.audioTrack.length < floors.minAudioTracks
        || cueCount < floors.minAudioCues
      ) {
        throw new Error(
          `第${input.episodeIndex}集第${Number(entry.chunkIndex) + 1}段音轨密度低于地板线，整集拒绝入库`,
        );
      }
    }
  }
}

/* ────────────────── 段规格前置校验 ────────────────── */

/**
 * 段规格前置校验：**在 resolveNodes 与任何网络动作之前**。
 *
 * 秒位反了、NaN、重复段，走到 ffmpeg 才炸就已经解析过地址、可能已经切过片；
 * 重复段更糟——同一段跑两遍，钱花两次、卡里镜头还重复。
 */
export function validateNativeDeepReadSegments(
  segments: readonly NativeDeepReadSegmentSpec[],
): NativeDeepReadSegmentSpec[] {
  if (!segments.length) throw new Error("原生精读没有可执行片段");
  if (segments.length > 32) throw new Error("原生精读单次最多处理32段");

  const seen = new Set<string>();
  return segments.map((segment, index) => {
    const startSec = Number(segment.startSec);
    const endSec = Number(segment.endSec);
    if (
      !Number.isFinite(startSec)
      || !Number.isFinite(endSec)
      || startSec < 0
      || endSec <= startSec
    ) {
      throw new Error(`原生精读第${index + 1}段秒位无效`);
    }
    const key = `${startSec}:${endSec}`;
    if (seen.has(key)) throw new Error(`原生精读存在重复片段：${key}`);
    seen.add(key);
    return { ...segment, startSec, endSec };
  });
}

/* ────────────────── GLM 5.3 结构化整形层（入库前，0826 实弹验证） ────────────────── */

/**
 * 通道：OpenRouter `z-ai/glm-5.3`（实弹 222s/$0.134，合成卡全门禁通过、
 * 64 镜动作与原卡逐字一致零虚构）。适用：
 *   ① EvoLink 兜底路必过——降级产物入库前先过 GLM 整形；
 *   ② 主线仅作修复——分段卡拼集卡默认走确定性代码拼接（免费可审计），
 *     只在拼接结果过不了门禁时降级请 GLM 修复一次，修复后门禁重跑，再不过才拒收。
 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE = "openrouter_glm_structuring" as const;
export const NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL = OPENROUTER_GLM_MODEL;
const GLM_STRUCTURING_MAX_TOKENS = 60_000;
const GLM_STRUCTURING_TIMEOUT_MS = 12 * 60_000;
const OPENROUTER_USD_TO_CNY_EQUIVALENT = 7.2;

export function buildNativeDeepReadGlmStructuringPrompt(input: {
  episodeIndex: number;
  durationSec: number;
  segments: readonly NativeDeepReadSegmentSpec[];
  hasAudio: boolean;
  rawSegments: ReadonlyArray<Record<string, unknown>>;
  rejectedReasonZh?: string;
}): { system: string; user: string } {
  return {
    system: `你是漫剧模板卡的「结构化整形师」。只整形不创作：
1. 禁止虚构输入卡里没有的镜头、字幕、声音或描述；每一条产出都必须能在输入卡里找到出处。
2. shots 与 audioTrack 密度只增不减——同一时间区间有多份描述时以更密、更具体的一方为基底。
3. subtitles 取并集去重，保持全片绝对秒位排序。
4. 所有中文描述文本【禁止】出现钟表式秒位（如 01:23）或「在第X秒」定位——秒位只进数字字段。
5. 只返回一个 JSON 对象，不要 Markdown 围栏、不要解释。`,
    user: `把以下同一集的 ${input.rawSegments.length} 份分段卡整形合并成**一张整集六栏卡**（单个 JSON 对象，字段 schema 与分段卡完全相同：shots/subtitles/audioResolution/beatStructureZh/moodArcZh/classification/reusableZh/genPromptHintZh）。
要求：
1. shots 连续无空档覆盖全片 0..${Math.round(input.durationSec)} 秒（绝对秒位），禁止为省输出合并真实切换的镜头。
2. audioResolution 保留全部 [{chunkIndex,analysis}] 条目（chunkIndex 即段号，analysis 内为该段局部秒），逐段齐全${input.hasAudio ? "" : "；本集素材无音轨，audioResolution 保持空数组"}。
3. beatStructureZh/moodArcZh/reusableZh/genPromptHintZh 按段整合，可加「第X段」标注；classification 五维标签取并集。
整集元数据：${JSON.stringify({
      episodeIndex: input.episodeIndex,
      durationSec: Math.round(input.durationSec),
      segments: input.segments.map((segment, index) => ({
        segmentIndex: index,
        startSec: Math.round(segment.startSec),
        endSec: Math.round(segment.endSec),
      })),
    })}
${input.rejectedReasonZh ? `【上一轮门禁被拒原因】${String(input.rejectedReasonZh).slice(0, 300)}\n` : ""}分段卡 JSON：${JSON.stringify(input.rawSegments)}`,
  };
}

/**
 * 段级坏 JSON 的省钱修复提示词（0826 病历单问题二第 2 步）：
 * 不重读视频（每次 ¥1.2 上下），把第一次的坏 JSON 原文交 GLM 只修语法不创作。
 * 修完密度门禁照跑，不过照拒——GLM 只负责让结构可解析。
 */
export function buildNativeDeepReadGlmSegmentRepairPrompt(input: {
  episodeIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio: boolean;
  badJsonText: string;
  rejectedReasonZh?: string;
}): { system: string; user: string } {
  return {
    system: `你是漫剧模板卡的「JSON 语法修复师」。只修语法不创作：
1. 输入是一份 JSON 语法损坏的分段卡原文；你的唯一任务是恢复成合法 JSON。
2. 禁止虚构原文里没有的镜头、字幕、声音或描述；禁止删减原文已有的内容。
3. 原文若被截断，保留能恢复的完整条目，丢弃最后一条残缺条目，不要补写。
4. 所有中文描述文本【禁止】出现钟表式秒位（如 01:23）或「在第X秒」定位——秒位只进数字字段。
5. 只返回一个 JSON 对象，不要 Markdown 围栏、不要解释。`,
    user: `修复以下第 ${input.episodeIndex} 集第 ${input.segmentIndex + 1} 段分段卡（覆盖绝对秒位 ${Math.round(input.startSec)}..${Math.round(input.endSec)} 秒，字段 schema：shots/subtitles/audioResolution/beatStructureZh/moodArcZh/classification/reusableZh/genPromptHintZh${input.hasAudio ? "" : "；本段素材无音轨，audioResolution 保持空数组"}）。
${input.rejectedReasonZh ? `【解析失败原因】${String(input.rejectedReasonZh).slice(0, 300)}\n` : ""}坏 JSON 原文：
${input.badJsonText}`,
  };
}

export type NativeDeepReadGlmStructuringResult = {
  raw: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** OpenRouter 返回的 usage.cost 直记（USD） */
  costUsd: number;
  provider?: string;
  providerRequestId?: string;
  finishReason?: string;
};

async function invokeNativeDeepReadGlmStructuring(
  prompt: { system: string; user: string },
  abortSignal?: AbortSignal,
): Promise<NativeDeepReadGlmStructuringResult> {
  let raw: Record<string, unknown> | undefined;
  const response = await invokeGlmJsonChatWithGatewayFallback({
    system: prompt.system,
    user: prompt.user,
    maxTokens: GLM_STRUCTURING_MAX_TOKENS,
    abortSignal,
    gatewayPolicy: "openrouter_only",
    timeoutMs: GLM_STRUCTURING_TIMEOUT_MS,
    requireParameters: true,
    requireFinishReasonStop: true,
    validateContent: (content) => {
      raw = parseJsonObject(content);
    },
  });
  if (response.gateway !== "openrouter" || !raw) {
    throw new Error("GLM 结构化整形通道锁失效或未返回 JSON");
  }
  return {
    raw,
    inputTokens: Math.max(0, Number(response.usage?.prompt_tokens) || 0),
    outputTokens: Math.max(0, Number(response.usage?.completion_tokens) || 0),
    reasoningTokens: Math.max(
      0,
      Number(response.usage?.completion_tokens_details?.reasoning_tokens) || 0,
    ),
    costUsd: Math.max(0, Number(response.usage?.cost) || 0),
    provider: String(response.provider || "").trim() || undefined,
    providerRequestId: String(response.requestId || "").trim() || undefined,
    finishReason: String(response.choices?.[0]?.finish_reason || "").trim() || undefined,
  };
}

/* ────────────────── 主执行：每段一次调用 + EvoLink 兜底 ────────────────── */

export type NativeDeepReadBatchRunnerDeps = {
  prepareVideos: typeof prepareEpisodeVideos;
  remove: typeof deleteGcsObject;
  postVertex: typeof postVertexNativeDeepRead;
  postEvolink: typeof postEvolinkNativeDeepRead;
  signReadUrl: typeof signGsUriV4ReadUrl;
  invokeGlmStructuring: typeof invokeNativeDeepReadGlmStructuring;
  readSegmentCache: typeof readNativeDeepReadSegmentCacheEntry;
  writeSegmentCache: typeof writeNativeDeepReadSegmentCacheEntry;
};

const defaultBatchRunnerDeps: NativeDeepReadBatchRunnerDeps = {
  prepareVideos: prepareEpisodeVideos,
  remove: deleteGcsObject,
  postVertex: postVertexNativeDeepRead,
  postEvolink: postEvolinkNativeDeepRead,
  signReadUrl: signGsUriV4ReadUrl,
  invokeGlmStructuring: invokeNativeDeepReadGlmStructuring,
  readSegmentCache: readNativeDeepReadSegmentCacheEntry,
  writeSegmentCache: writeNativeDeepReadSegmentCacheEntry,
};

type GeminiEnvelope = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    promptTokensDetails?: unknown;
  };
};

function audioTokensFromUsage(details: unknown): number {
  if (!Array.isArray(details)) return 0;
  return details
    .filter((row) => String((row as { modality?: unknown }).modality || "").toUpperCase() === "AUDIO")
    .reduce((sum, row) => sum + (Number((row as { tokenCount?: unknown }).tokenCount) || 0), 0);
}

type SegmentAttemptResult = {
  raw: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  audioInputTokens: number;
  reasoningTokens: number;
  /** 本次尝试的实付（缓存写入快照用；总账已在循环内入账） */
  costCny: number;
  finishReason?: string;
  providerRequestId?: string;
};

/** 收到明确 HTTP 失败响应的错误（结果确定），可按路由铁律换通道重试。 */
type HttpFailure = Error & { nativeDeepReadHttpStatus?: number };

/** 坏 JSON 解析失败：随错误外带原文，重试层交 GLM 整形修复而不重读视频。 */
type NativeDeepReadBadJsonFailure = Error & { nativeDeepReadBadJsonText?: string };

function isHttpFailure(error: unknown): boolean {
  return Number.isFinite(Number((error as HttpFailure)?.nativeDeepReadHttpStatus));
}

const ROUTE_LABEL_ZH: Record<NativeDeepReadVisualRoute, string> = {
  [NATIVE_DEEP_READ_ROUTE_VERTEX]: "Vertex Gemini 3.1 Pro 视频精读",
  [NATIVE_DEEP_READ_ROUTE_EVOLINK]: "EvoLink Gemini 3.1 Pro 视频精读（兜底）",
};

/**
 * 一次请求读取一集（逐段调用），回传后按段合并成集卡。
 * 任一段不达标带拒因重试一次，仍不达标整集失败（宁缺勿滥）。
 */
export async function runManhuaNativeDeepReadBatch(params: {
  episodes: readonly NativeDeepReadBatchRunEpisode[];
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>;
  /** 传入即启用段级产物缓存（0826 拍板）：命中段免调用零计费；旁路/CLI 不传=不碰缓存 */
  segmentCacheSeriesKey?: string;
}, deps: NativeDeepReadBatchRunnerDeps = defaultBatchRunnerDeps): Promise<NativeDeepReadBatchRunResult> {
  if (!params.episodes.length) throw new Error("多视频精读批次为空");
  const seen = new Set<number>();
  const validated = params.episodes.map((episode) => {
    if (!Number.isInteger(episode.episodeIndex) || episode.episodeIndex < 1) {
      throw new Error("多视频精读 episodeIndex 无效");
    }
    if (seen.has(episode.episodeIndex)) throw new Error(`多视频精读重复第${episode.episodeIndex}集`);
    seen.add(episode.episodeIndex);
    const segments = validateNativeDeepReadSegments(episode.segments);
    const first = segments[0]!;
    const last = segments[segments.length - 1]!;
    if (first.startSec > 0.5 || Math.abs(last.endSec - episode.sourceDurationSec) > 0.5) {
      throw new Error(`第${episode.episodeIndex}集分片未覆盖完整片长`);
    }
    for (let index = 1; index < segments.length; index += 1) {
      if (Math.abs(segments[index]!.startSec - segments[index - 1]!.endSec) > 0.01) {
        throw new Error(`第${episode.episodeIndex}集分片存在空档或重叠`);
      }
    }
    return { ...episode, segments };
  });

  const batchRequestId = crypto.randomUUID();
  let inputTokens = 0;
  let outputTokens = 0;
  let costCny = 0;
  const preparedByEpisode: Array<{
    episode: (typeof validated)[number];
    videos: PreparedNativeVideo[];
    /** 段级缓存命中（0826 拍板）：命中段免调用零计费；key=segmentIndex */
    cachedSegments: Map<number, NativeDeepReadSegmentCacheEntry>;
  }> = [];
  const episodes: NativeDeepReadBatchRunResult["episodes"] = [];
  const segmentCacheFingerprint = params.segmentCacheSeriesKey
    ? nativeDeepReadSegmentCacheFingerprint()
    : "";
  try {
    for (const episode of validated) {
      // 备料前先查段缓存：命中的段连切段/上传都省掉
      const cachedSegments = new Map<number, NativeDeepReadSegmentCacheEntry>();
      if (params.segmentCacheSeriesKey) {
        for (let segmentIndex = 0; segmentIndex < episode.segments.length; segmentIndex += 1) {
          const segment = episode.segments[segmentIndex]!;
          const entry = await deps.readSegmentCache({
            seriesKey: params.segmentCacheSeriesKey,
            episodeIndex: episode.episodeIndex,
            segmentIndex,
          });
          if (!entry) continue;
          if (
            entry.fingerprint !== segmentCacheFingerprint
            || Math.abs(entry.startSec - segment.startSec) > 0.01
            || Math.abs(entry.endSec - segment.endSec) > 0.01
          ) {
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存指纹/秒位不符（参数或切段已换代），按 miss 处理`,
            );
            continue;
          }
          try {
            // 缓存必须过**当前**门禁才算数：门禁收紧后旧缓存自动失效
            assertNativeDeepReadSegmentDensity({
              episodeIndex: episode.episodeIndex,
              segmentIndex,
              startSec: segment.startSec,
              endSec: segment.endSec,
              hasAudio: entry.hasAudio,
              raw: entry.raw,
            });
          } catch (gateErr) {
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存复验未过当前门禁，按 miss 处理：${
                gateErr instanceof Error ? gateErr.message : gateErr
              }`,
            );
            continue;
          }
          cachedSegments.set(segmentIndex, entry);
        }
      }
      const pendingSegments = episode.segments.filter((_, index) => !cachedSegments.has(index));
      let videos = pendingSegments.length
        ? await deps.prepareVideos({ ...episode, segments: pendingSegments }, params.abortSignal)
        : [];
      // hasAudio 一致性：新备段实测与缓存记录不符→保守弃缓存并二次补备（缓存只能省钱不能改口径）
      if (videos.length && cachedSegments.size) {
        const preparedHasAudio = videos[0]!.hasAudio === true;
        const mismatched = Array.from(cachedSegments.entries())
          .filter(([, entry]) => entry.hasAudio !== preparedHasAudio);
        if (mismatched.length) {
          console.warn(
            `[nativeDeepRead] 第${episode.episodeIndex}集 ${mismatched.length} 段缓存 hasAudio 与实测不符，弃用并补备`,
          );
          for (const [segmentIndex] of mismatched) cachedSegments.delete(segmentIndex);
          const refill = episode.segments.filter((segment, index) =>
            !cachedSegments.has(index)
            && !videos.some((video) => Math.abs(video.startSec - segment.startSec) < 0.01));
          if (refill.length) {
            videos = videos.concat(
              await deps.prepareVideos({ ...episode, segments: refill }, params.abortSignal),
            );
          }
        }
      }
      preparedByEpisode.push({ episode, videos, cachedSegments });
    }

    for (const { episode, videos, cachedSegments } of preparedByEpisode) {
      params.abortSignal?.throwIfAborted();
      const episodeRequestId = validated.length === 1 ? batchRequestId : crypto.randomUUID();
      // 全段缓存命中时没有新备视频，hasAudio 取自缓存记录（写入时来自当轮实测）
      const hasAudio = videos.length
        ? videos[0]!.hasAudio === true
        : Array.from(cachedSegments.values())[0]?.hasAudio === true;
      const segmentCount = episode.segments.length;
      const rawSegments: Array<Record<string, unknown>> = [];
      let episodeInput = 0;
      let episodeOutput = 0;
      let episodeCost = 0;
      let episodeAudioInput = 0;
      const routesUsed = new Set<NativeDeepReadVisualRoute>();
      const degradedFpsSegmentIndexes: number[] = [];

      /** 单次通道尝试：发请求→解 envelope→段门禁；用量在门禁之前入账（钱已花）。 */
      const attemptSegment = async (input: {
        route: NativeDeepReadVisualRoute;
        fileUri: string;
        segmentIndex: number;
        fps: number;
        rejectedReasonZh?: string;
      }): Promise<SegmentAttemptResult> => {
        const segment = episode.segments[input.segmentIndex]!;
        const callId = crypto.randomUUID();
        const startedAt = Date.now();
        const degraded = input.route === NATIVE_DEEP_READ_ROUTE_EVOLINK;
        await emitVisualModelReceipt({
          callId,
          model: NATIVE_DEEP_READ_MODEL,
          route: input.route,
          stage: "visual_model",
          status: "started",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          chunkIndex: input.segmentIndex,
          segmentCount: episode.segments.length,
          videoCount: 1,
          degraded: degraded || undefined,
        }, params.onModelReceipt);
        const body = buildGeminiNativeDeepReadSegmentRequest({
          fileUri: input.fileUri,
          fps: input.fps,
          // 0826 定稿：原地重试（带被拒原因那一发）temperature 归零，不再保留随机性
          generationConfig: input.rejectedReasonZh
            ? NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG
            : undefined,
          prompt: buildGeminiNativeDeepReadSegmentPrompt({
            episodeDurationSec: episode.sourceDurationSec,
            startSec: segment.startSec,
            endSec: segment.endSec,
            segmentIndex: input.segmentIndex,
            segmentCount,
            hasAudio,
            hintZh: segment.hintZh || episode.hintZh,
            rejectedReasonZh: input.rejectedReasonZh,
          }),
        });
        try {
          const response = await (input.route === NATIVE_DEEP_READ_ROUTE_EVOLINK
            ? deps.postEvolink(body, params.abortSignal)
            : deps.postVertex(body, params.abortSignal));
          if (response.status >= 300) {
            const providerError = parseNativeProviderErrorReceipt({
              httpStatus: response.status,
              responseText: response.text,
              requestId: response.requestId,
            });
            const failure = errorWithNativeProviderReceipt(
              formatNativeProviderErrorZh(ROUTE_LABEL_ZH[input.route], providerError),
              providerError,
            ) as HttpFailure;
            failure.nativeDeepReadHttpStatus = response.status;
            throw failure;
          }
          const envelope = JSON.parse(response.text) as GeminiEnvelope;
          const usage = envelope.usageMetadata;
          const attemptInput = Math.max(0, Number(usage?.promptTokenCount) || 0);
          const attemptOutput = Math.max(0, Number(usage?.candidatesTokenCount) || 0)
            + Math.max(0, Number(usage?.thoughtsTokenCount) || 0);
          const attemptAudioInput = audioTokensFromUsage(usage?.promptTokensDetails);
          const prices = routePrices(input.route);
          const attemptCost =
            (attemptInput * prices.inPerM) / 1e6 + (attemptOutput * prices.outPerM) / 1e6;
          // 门禁在下面才跑；这一次调用的钱已经花了，先入账（失败回执纪律）。
          inputTokens += attemptInput;
          outputTokens += attemptOutput;
          costCny += attemptCost;
          episodeInput += attemptInput;
          episodeOutput += attemptOutput;
          episodeCost += attemptCost;
          episodeAudioInput += attemptAudioInput;
          routesUsed.add(input.route);
          const candidate = envelope.candidates?.[0];
          const emitCompleted = async () => emitVisualModelReceipt({
            callId,
            model: NATIVE_DEEP_READ_MODEL,
            route: input.route,
            stage: "visual_model",
            status: "completed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            chunkIndex: input.segmentIndex,
          segmentCount: episode.segments.length,
            videoCount: 1,
            elapsedMs: Date.now() - startedAt,
            inputTokens: attemptInput,
            audioInputTokens: attemptAudioInput || undefined,
            outputTokens: attemptOutput,
            reasoningTokens: Math.max(0, Number(usage?.thoughtsTokenCount) || 0) || undefined,
            finishReason: candidate?.finishReason,
            providerRequestId: response.requestId,
            priceEquivalentCny: attemptCost,
            degraded: degraded || undefined,
          }, params.onModelReceipt);
          if (candidate?.finishReason === "MAX_TOKENS") {
            await emitCompleted();
            throw gateError(`第${input.segmentIndex + 1}段输出被截断（只许压字幕，禁止压镜头表或音轨栏）`);
          }
          if (candidate?.finishReason && candidate.finishReason !== "STOP") {
            await emitCompleted();
            throw gateError(`第${input.segmentIndex + 1}段未正常结束（${candidate.finishReason}）`);
          }
          const text = (candidate?.content?.parts || [])
            .filter((part) => !part.thought)
            .map((part) => String(part.text || ""))
            .join("");
          // 先记 completed 回执再解析（审查 P1-1）：解析失败属门禁类不再发 failed 回执，
          // 若先解析，这笔已扣费调用会只剩 started 回执，秒级账单对不上总账。
          await emitCompleted();
          let raw: Record<string, unknown>;
          try {
            raw = parseJsonObject(text);
          } catch (parseError) {
            // 取证（0826 病历单问题二）：坏 JSON 疑与思考挤占 maxOutputTokens 相关，
            // finishReason 可能仍是 STOP——把关键用量与响应尾部一起落进失败上下文。
            const evidenceZh =
              `finish=${candidate?.finishReason || "?"}`
              + ` · 思考 ${Number(usage?.thoughtsTokenCount) || 0} tok`
              + ` · 正文 ${Number(usage?.candidatesTokenCount) || 0} tok`
              + ` · 尾部「${text.slice(-200)}」`;
            const enriched = new Error(
              `${parseError instanceof Error ? parseError.message : String(parseError)}（${evidenceZh}）`,
            );
            // 坏文本随错误外带：重试层用它走 GLM 整形修复，省一次视频重读的钱
            (enriched as NativeDeepReadBadJsonFailure).nativeDeepReadBadJsonText = text;
            throw enriched;
          }
          assertNativeDeepReadSegmentDensity({
            episodeIndex: episode.episodeIndex,
            segmentIndex: input.segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            hasAudio,
            raw,
          });
          return {
            raw,
            inputTokens: attemptInput,
            outputTokens: attemptOutput,
            audioInputTokens: attemptAudioInput,
            reasoningTokens: Math.max(0, Number(usage?.thoughtsTokenCount) || 0),
            costCny: attemptCost,
            finishReason: candidate?.finishReason,
            providerRequestId: response.requestId,
          };
        } catch (error) {
          if (!isNativeDeepReadGateFailure(error)) {
            await emitVisualModelReceipt({
              callId,
              model: NATIVE_DEEP_READ_MODEL,
              route: input.route,
              stage: "visual_model",
              status: "failed",
              batchRequestId: episodeRequestId,
              episodeIndexes: [episode.episodeIndex],
              chunkIndex: input.segmentIndex,
          segmentCount: episode.segments.length,
              videoCount: 1,
              elapsedMs: Date.now() - startedAt,
              errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
              providerError: nativeProviderReceiptFromError(error),
              degraded: degraded || undefined,
            }, params.onModelReceipt);
          }
          throw error;
        }
      };

      /**
       * 段级坏 JSON 的省钱修复（0826 病历单问题二第 2 步）：
       * 不重读视频，把第一次的坏 JSON 原文交 GLM 修语法；修完密度门禁照跑，不过照拒。
       * 回执与费用记账口径与整集 glmStructure 一致（visual_parse 阶段）。
       */
      const repairSegmentBadJson = async (input: {
        segmentIndex: number;
        badJsonText: string;
        rejectedReasonZh: string;
      }): Promise<SegmentAttemptResult> => {
        const segment = episode.segments[input.segmentIndex]!;
        const callId = crypto.randomUUID();
        const startedAt = Date.now();
        await emitVisualModelReceipt({
          callId,
          model: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
          route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
          stage: "visual_parse",
          status: "started",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          chunkIndex: input.segmentIndex,
          segmentCount: episode.segments.length,
          videoCount: 1,
        }, params.onModelReceipt);
        try {
          const structured = await deps.invokeGlmStructuring(
            buildNativeDeepReadGlmSegmentRepairPrompt({
              episodeIndex: episode.episodeIndex,
              segmentIndex: input.segmentIndex,
              startSec: segment.startSec,
              endSec: segment.endSec,
              hasAudio,
              badJsonText: input.badJsonText,
              rejectedReasonZh: input.rejectedReasonZh,
            }),
            params.abortSignal,
          );
          const structuringCostCny = structured.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT;
          inputTokens += structured.inputTokens;
          outputTokens += structured.outputTokens;
          costCny += structuringCostCny;
          episodeInput += structured.inputTokens;
          episodeOutput += structured.outputTokens;
          episodeCost += structuringCostCny;
          // 与 attemptSegment 同序：钱已花，先记 completed，再跑门禁
          await emitVisualModelReceipt({
            callId,
            model: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
            route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
            stage: "visual_parse",
            status: "completed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            chunkIndex: input.segmentIndex,
            segmentCount: episode.segments.length,
            videoCount: 1,
            elapsedMs: Date.now() - startedAt,
            inputTokens: structured.inputTokens,
            outputTokens: structured.outputTokens,
            reasoningTokens: structured.reasoningTokens || undefined,
            costUsd: structured.costUsd,
            priceEquivalentCny: structuringCostCny,
            provider: structured.provider,
            providerRequestId: structured.providerRequestId,
            finishReason: structured.finishReason,
          }, params.onModelReceipt);
          assertNativeDeepReadSegmentDensity({
            episodeIndex: episode.episodeIndex,
            segmentIndex: input.segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            hasAudio,
            raw: structured.raw,
          });
          return {
            raw: structured.raw,
            inputTokens: structured.inputTokens,
            outputTokens: structured.outputTokens,
            audioInputTokens: 0,
            reasoningTokens: structured.reasoningTokens,
            costCny: structuringCostCny,
            finishReason: structured.finishReason,
            providerRequestId: structured.providerRequestId,
          };
        } catch (error) {
          // 门禁类失败 completed 已记账，不再发 failed（防双计）；调用类失败要落已扣费用
          if (!isNativeDeepReadGateFailure(error)) {
            const failedUsage = error instanceof GlmGatewayError ? error.usage : undefined;
            const failedCostCny = failedUsage
              ? failedUsage.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT
              : 0;
            if (failedUsage) {
              inputTokens += failedUsage.inputTokens;
              outputTokens += failedUsage.outputTokens;
              costCny += failedCostCny;
              episodeInput += failedUsage.inputTokens;
              episodeOutput += failedUsage.outputTokens;
              episodeCost += failedCostCny;
            }
            await emitVisualModelReceipt({
              callId,
              model: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
              route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
              stage: "visual_parse",
              status: "failed",
              batchRequestId: episodeRequestId,
              episodeIndexes: [episode.episodeIndex],
              chunkIndex: input.segmentIndex,
              segmentCount: episode.segments.length,
              videoCount: 1,
              elapsedMs: Date.now() - startedAt,
              inputTokens: failedUsage?.inputTokens || undefined,
              outputTokens: failedUsage?.outputTokens || undefined,
              costUsd: failedUsage?.costUsd || undefined,
              priceEquivalentCny: failedCostCny || undefined,
              errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
              providerError: nativeProviderReceiptFromError(error),
            }, params.onModelReceipt);
          }
          throw error;
        }
      };

      /**
       * 段级重试耗尽的最终失败（0826 病历单问题一）：
       * 门禁类失败按设计跳过 attemptSegment 的 failed 回执（防双计账），
       * 结果重试后再失败时日志/回执两处都没落。这里补一条**只带拒因不带 token**
       * 的 failed 回执（token 已在 completed 回执记过），并打最终 console.warn。
       */
      const recordFinalGateFailure = async (segmentIndex: number, error: unknown): Promise<void> => {
        if (!isNativeDeepReadGateFailure(error)) return;
        const errorZh = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
        console.warn(
          `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段重试后仍未过：${errorZh}`,
        );
        await emitVisualModelReceipt({
          callId: crypto.randomUUID(),
          model: NATIVE_DEEP_READ_MODEL,
          route: "gate_retry_exhausted",
          stage: "visual_parse",
          status: "failed",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          chunkIndex: segmentIndex,
          segmentCount: episode.segments.length,
          videoCount: 1,
          errorZh,
        }, params.onModelReceipt);
      };

      /** 同通道门禁重试一次（带被拒原因）；坏 JSON 走 GLM 修复省钱路；非门禁失败原样上抛。 */
      const attemptWithGateRetry = async (input: {
        route: NativeDeepReadVisualRoute;
        fileUri: string;
        segmentIndex: number;
        fps: number;
      }): Promise<SegmentAttemptResult> => {
        try {
          return await attemptSegment(input);
        } catch (error) {
          if (params.abortSignal?.aborted || !isNativeDeepReadGateFailure(error)) throw error;
          const rejectedReasonZh = (error instanceof Error ? error.message : String(error)).slice(0, 300);
          console.warn(
            `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段未过密度门禁，`
            + `带被拒原因原地重试一次（temperature 0）：${rejectedReasonZh}`,
          );
          try {
            // 0826 定稿：只允许原地重试一次（RETRY config 温度归零），不换模型不降 fps
            return await attemptSegment({ ...input, rejectedReasonZh });
          } catch (retryError) {
            if (params.abortSignal?.aborted) throw retryError;
            // 重试后仍是坏 JSON：不再重读视频（第三发视频钱不花），交已获批的
            // GLM 结构化整形层只修语法（与整集 glmStructure 同一层）；门禁照跑不过照拒。
            const retryBadJsonText = String(
              (retryError as NativeDeepReadBadJsonFailure).nativeDeepReadBadJsonText || "",
            );
            if (isNativeDeepReadGateFailure(retryError) && retryBadJsonText.trim()) {
              console.warn(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段重试后仍坏 JSON，`
                + `交 GLM 整形修复（不重读视频）`,
              );
              try {
                return await repairSegmentBadJson({
                  segmentIndex: input.segmentIndex,
                  badJsonText: retryBadJsonText,
                  rejectedReasonZh:
                    (retryError instanceof Error ? retryError.message : String(retryError)).slice(0, 300),
                });
              } catch (repairError) {
                if (!params.abortSignal?.aborted) {
                  await recordFinalGateFailure(input.segmentIndex, repairError);
                }
                throw repairError;
              }
            }
            await recordFinalGateFailure(input.segmentIndex, retryError);
            throw retryError;
          }
        }
      };

      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        params.abortSignal?.throwIfAborted();
        const segment = episode.segments[segmentIndex]!;
        const cachedEntry = cachedSegments.get(segmentIndex);
        if (cachedEntry) {
          // 缓存命中：免调用零计费；音轨 token 快照随行作「真听过」证据
          episodeAudioInput += Math.max(0, Number(cachedEntry.paidUsage?.audioInputTokens) || 0);
          await emitVisualModelReceipt({
            callId: crypto.randomUUID(),
            model: NATIVE_DEEP_READ_MODEL,
            route: "segment_cache_hit",
            stage: "visual_model",
            status: "completed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            chunkIndex: segmentIndex,
            segmentCount: episode.segments.length,
            videoCount: 1,
            inputTokens: 0,
            outputTokens: 0,
            priceEquivalentCny: 0,
            finishReason: "CACHED",
          }, params.onModelReceipt);
          rawSegments.push(cachedEntry.raw);
          continue;
        }
        // 备料按秒位对号：命中段没备视频，videos 与 segmentIndex 不再一一对应
        const video = videos.find((row) => Math.abs(row.startSec - segment.startSec) < 0.01);
        if (!video) {
          throw new Error(`第${episode.episodeIndex}集第${segmentIndex + 1}段缺备料视频（缓存/备料装配不一致），停止`);
        }
        const fps = resolveNativeDeepReadRequestFps(video.endSec - video.startSec);
        let result: SegmentAttemptResult;
        try {
          result = await attemptWithGateRetry({
            route: NATIVE_DEEP_READ_ROUTE_VERTEX,
            fileUri: video.gsUri,
            segmentIndex,
            fps,
          });
        } catch (error) {
          if (params.abortSignal?.aborted) throw error;
          /**
           * 路由铁律：拿到**明确失败响应**（4xx 参数/内容拒绝、5xx/429 通道故障）
           * 才允许换通道重试——结果确定没产出，不会双付。
           * 网络断/超时属「结果不明」：不回落，抛出交 reconcile 人工核对。
           * 门禁类失败也不回落（EvoLink 是 1fps 降级，密度只会更差）。
           */
          if (!isHttpFailure(error)) {
            if (isNativeDeepReadGateFailure(error)) throw error;
            throw new Error(
              `第${episode.episodeIndex}集第${segmentIndex + 1}段主线结果不明（${
                error instanceof Error ? error.message : String(error)
              }），按路由铁律不回落 EvoLink，待 reconcile 后重试`,
              { cause: error },
            );
          }
          console.warn(
            `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段 Vertex 主线被拒，`
            + `回落 EvoLink——注意：EvoLink 忽略 videoMetadata.fps，兜底为 1fps 降级读取`,
          );
          // ⚠️ EvoLink 拉不了 gs://（实弹超时），必须签 GCS V4 https 读链。
          const signedUrl = deps.signReadUrl(video.gsUri, 2 * 60 * 60);
          degradedFpsSegmentIndexes.push(segmentIndex);
          result = await attemptWithGateRetry({
            route: NATIVE_DEEP_READ_ROUTE_EVOLINK,
            fileUri: signedUrl,
            segmentIndex,
            fps,
          });
        }
        if (params.segmentCacheSeriesKey) {
          // 写通段缓存（旁路，失败只 warn）：这段的钱已花，产出从此不再重买
          try {
            await deps.writeSegmentCache({
              fingerprint: segmentCacheFingerprint,
              seriesKey: params.segmentCacheSeriesKey,
              episodeIndex: episode.episodeIndex,
              segmentIndex,
              startSec: segment.startSec,
              endSec: segment.endSec,
              hasAudio,
              raw: result.raw,
              paidUsage: {
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                audioInputTokens: result.audioInputTokens,
                reasoningTokens: result.reasoningTokens,
                costCny: result.costCny,
              },
              savedAtIso: new Date().toISOString(),
            });
          } catch (cacheError) {
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存写入失败（不影响本轮）：`,
              cacheError instanceof Error ? cacheError.message : cacheError,
            );
          }
        }
        rawSegments.push(result.raw);
      }

      // 段卡合并成集卡：默认**确定性代码拼接**（免费可审计）——各段 shots/subtitles
      // 已是绝对秒位直接拼接、文本类栏按段加「第X段」标注、audioResolution 保
      // chunkIndex=段号。GLM 5.3 结构化整形层只在两种情况介入：
      //   ① EvoLink 兜底路必过（降级产物入库前先整形）；
      //   ② 主线拼接结果过不了门禁时降级请 GLM 修复一次。
      // 门禁永远在 GLM 之后再跑一遍——GLM 只管结构干净，厚度不达标照拒。
      const glmStructure = async (rejectedReasonZh?: string): Promise<Record<string, unknown>> => {
        const callId = crypto.randomUUID();
        const startedAt = Date.now();
        await emitVisualModelReceipt({
          callId,
          model: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
          route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
          stage: "visual_parse",
          status: "started",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          videoCount: segmentCount,
        }, params.onModelReceipt);
        try {
          const structured = await deps.invokeGlmStructuring(
            buildNativeDeepReadGlmStructuringPrompt({
              episodeIndex: episode.episodeIndex,
              durationSec: episode.sourceDurationSec,
              segments: episode.segments,
              hasAudio,
              rawSegments,
              rejectedReasonZh,
            }),
            params.abortSignal,
          );
          const structuringCostCny = structured.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT;
          inputTokens += structured.inputTokens;
          outputTokens += structured.outputTokens;
          costCny += structuringCostCny;
          episodeInput += structured.inputTokens;
          episodeOutput += structured.outputTokens;
          episodeCost += structuringCostCny;
          await emitVisualModelReceipt({
            callId,
            model: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
            route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
            stage: "visual_parse",
            status: "completed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            videoCount: segmentCount,
            elapsedMs: Date.now() - startedAt,
            inputTokens: structured.inputTokens,
            outputTokens: structured.outputTokens,
            reasoningTokens: structured.reasoningTokens || undefined,
            costUsd: structured.costUsd,
            priceEquivalentCny: structuringCostCny,
            provider: structured.provider,
            providerRequestId: structured.providerRequestId,
            finishReason: structured.finishReason,
          }, params.onModelReceipt);
          return structured.raw;
        } catch (error) {
          // 审查 P1-2：整形失败时 OpenRouter 已实扣的费用随 GlmGatewayError 带出，
          // 必须落回执与总账，不能只记 errorZh。
          const failedUsage = error instanceof GlmGatewayError ? error.usage : undefined;
          const failedCostCny = failedUsage
            ? failedUsage.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT
            : 0;
          if (failedUsage) {
            inputTokens += failedUsage.inputTokens;
            outputTokens += failedUsage.outputTokens;
            costCny += failedCostCny;
            episodeInput += failedUsage.inputTokens;
            episodeOutput += failedUsage.outputTokens;
            episodeCost += failedCostCny;
          }
          await emitVisualModelReceipt({
            callId,
            model: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
            route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
            stage: "visual_parse",
            status: "failed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            videoCount: segmentCount,
            elapsedMs: Date.now() - startedAt,
            inputTokens: failedUsage?.inputTokens || undefined,
            outputTokens: failedUsage?.outputTokens || undefined,
            costUsd: failedUsage?.costUsd || undefined,
            priceEquivalentCny: failedCostCny || undefined,
            errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
            providerError: nativeProviderReceiptFromError(error),
          }, params.onModelReceipt);
          throw error;
        }
      };
      const gateEpisode = (payloads: ReadonlyArray<Record<string, unknown>>) =>
        assertNativeDeepReadEpisodeEvidence({
          episodeIndex: episode.episodeIndex,
          durationSec: episode.sourceDurationSec,
          segments: episode.segments,
          hasAudio,
          rawSegments: payloads,
        });
      const annotateSegmentRows = () => rawSegments.map((raw, index) => {
        if (segmentCount === 1) return raw;
        const copy: Record<string, unknown> = { ...raw };
        for (const key of ["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh"]) {
          const value = String(copy[key] || "").trim();
          if (value) copy[key] = `第${index + 1}段：${value}`;
        }
        return copy;
      });
      const parseCallId = `${episodeRequestId}:parse`;
      await emitVisualModelReceipt({
        callId: parseCallId,
        model: NATIVE_DEEP_READ_MODEL,
        route: "local_schema_gate",
        stage: "visual_parse",
        status: "started",
        batchRequestId: episodeRequestId,
        episodeIndexes: [episode.episodeIndex],
        videoCount: segmentCount,
        inputTokens: episodeInput,
        outputTokens: episodeOutput,
      }, params.onModelReceipt);
      try {
        let episodeRows: Array<Record<string, unknown>>;
        if (degradedFpsSegmentIndexes.length > 0) {
          // EvoLink 兜底路必过 GLM 整形；整形后门禁照跑，不达标照拒。
          const structuredRaw = await glmStructure();
          gateEpisode([structuredRaw]);
          episodeRows = [structuredRaw];
        } else {
          try {
            gateEpisode(rawSegments);
            episodeRows = annotateSegmentRows();
          } catch (mergeGateFailure) {
            if (params.abortSignal?.aborted) throw mergeGateFailure;
            const rejectedReasonZh =
              (mergeGateFailure instanceof Error ? mergeGateFailure.message : String(mergeGateFailure)).slice(0, 300);
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集确定性拼接未过门禁，`
              + `降级请 GLM 结构化整形修复一次：${rejectedReasonZh}`,
            );
            const structuredRaw = await glmStructure(rejectedReasonZh);
            // 修复后门禁重跑，再不过才拒收。
            gateEpisode([structuredRaw]);
            episodeRows = [structuredRaw];
          }
        }
        const mapped = mapNativeDeepReadSegments(episodeRows.map((raw) => ({
          // shots/subtitles 已是全片绝对秒位，偏移一律为 0。
          startSec: 0,
          endSec: episode.sourceDurationSec,
          finish: "stop",
          text: JSON.stringify(raw),
        })));
        if (mapped.segmentCount !== episodeRows.length) {
          throw new Error(`第${episode.episodeIndex}集结构解析失败，整集拒绝入库`);
        }
        episodes.push({
          episodeIndex: episode.episodeIndex,
          result: {
            ...mapped,
            segmentCount,
            failedSegmentCount: 0,
            attemptedSegments: segmentCount,
            model: NATIVE_DEEP_READ_MODEL,
            usingPlanQuota: false,
            batchRequestId: episodeRequestId,
            batchEpisodeCount: 1,
            audioInputTokens: episodeAudioInput,
            hasAudio,
            visualRoutes: Array.from(routesUsed),
            degradedFpsSegmentIndexes,
            usage: {
              inputTokens: episodeInput,
              outputTokens: episodeOutput,
              costCny: episodeCost,
            },
          },
        });
        await emitVisualModelReceipt({
          callId: parseCallId,
          model: NATIVE_DEEP_READ_MODEL,
          route: "local_schema_gate",
          stage: "visual_parse",
          status: "completed",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          videoCount: segmentCount,
          inputTokens: episodeInput,
          outputTokens: episodeOutput,
        }, params.onModelReceipt);
      } catch (error) {
        await emitVisualModelReceipt({
          callId: parseCallId,
          model: NATIVE_DEEP_READ_MODEL,
          route: "local_schema_gate",
          stage: "visual_parse",
          status: "failed",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          videoCount: segmentCount,
          inputTokens: episodeInput,
          outputTokens: episodeOutput,
          errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
        }, params.onModelReceipt);
        throw error;
      }
    }

    return {
      episodes,
      usage: { inputTokens, outputTokens, costCny },
      usingPlanQuota: false,
      model: NATIVE_DEEP_READ_MODEL,
      batchRequestId,
    };
  } catch (error) {
    const wrapped = (error instanceof Error ? error : new Error(String(error))) as NativeDeepReadRunError;
    wrapped.nativeDeepReadCostCny = costCny;
    wrapped.nativeDeepReadUsage = {
      inputTokens,
      outputTokens,
      costCny,
      usingPlanQuota: false,
      // 中止/失联时在途请求可能尚无回执，不能把已知部分冒充完整账单。
      receiptComplete: inputTokens > 0 || outputTokens > 0,
    };
    throw wrapped;
  } finally {
    const cleanup = preparedByEpisode.flatMap((row) =>
      row.videos.map((video) => deps.remove(video.temporaryGcs)));
    const cleanupResults = await Promise.allSettled(cleanup);
    if (cleanupResults.some((row) => row.status === "rejected")) {
      console.warn(`[nativeDeepRead] 批次 ${batchRequestId} 的视频临时对象清理待核对`);
    }
  }
}

/**
 * 单集入口：与批处理共用同一条 Vertex 分段链路（切段→GCS→逐段调用→合并）。
 *
 * ⚠️ 调用方必须检查 failedSegmentCount / droppedCount / truncated ——
 * 静默少几个镜头比整体失败更难发现。
 */
export async function runManhuaNativeDeepRead(params: {
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  segments: readonly NativeDeepReadSegmentSpec[];
  sourceDurationSec?: number;
  hintZh?: string;
  abortSignal?: AbortSignal;
}, deps: NativeDeepReadBatchRunnerDeps = defaultBatchRunnerDeps): Promise<NativeDeepReadRunResult> {
  const duration = Number(params.sourceDurationSec);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("原生精读缺少可信片长，未发出模型请求");
  }
  const batch = await runManhuaNativeDeepReadBatch({
    episodes: [{
      episodeIndex: 1,
      resolveNodes: params.resolveNodes,
      segments: params.segments,
      sourceDurationSec: duration,
      hintZh: params.hintZh,
    }],
    abortSignal: params.abortSignal,
  }, deps);
  const only = batch.episodes[0];
  if (!only) throw new Error("原生精读没有返回集卡");
  return only.result;
}

export type { NativeDeepReadOutput };
export type { ManhuaNativeAudioDirectRoute };
export type { ManhuaNativeProviderErrorReceipt };
