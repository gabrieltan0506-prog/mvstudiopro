/**
 * 原生视频精读 · 生产执行器。
 *
 * 0826 拍板换代：视觉学习整体从新加坡 Qwen 3.8 Max 换到 **Vertex Gemini 3.1 Pro
 * 从 GCS 直读**，连音轨一次调用出全六栏（不再有 Gemini 3.6 Flash 双声道取证 +
 * Qwen 仲裁两步）。实弹依据：
 *   · 新加坡 Qwen←GCS 吞吐 <0.15MB/s 不可用；北京 Qwen 可用但无音轨、474s、贵一倍；
 *   · `gemini-3.1-pro-preview` @ Vertex global，fileData gs:// + videoMetadata{fps:5}
 *     + generationConfig{responseMimeType:"application/json",audioTimestamp:true}，
 *     既有 360s 探针证明模型可读，但生产分片固定为最长 300s，确保 18 分钟素材
 *     恢复为 4 片，并缩小单片失败后的重跑范围。
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
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import {
  mapNativeDeepReadSegments,
  nativeDeepReadSegmentSchema,
  type NativeDeepReadOutput,
} from "../../shared/manhuaNativeDeepRead.js";
import { MANHUA_NATIVE_DEEP_READ_MODEL } from "../../shared/manhuaNativeDeepReadJob.js";
import {
  MANHUA_TEMPLATE_CLASSIFICATION_KEYS,
  hasManhuaTemplateClassificationFields,
  hasUsableManhuaTemplateClassification,
} from "../../shared/manhuaViralTemplateBank.js";
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
  NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  nativeDeepReadSegmentEvidenceObjectName,
  readNativeDeepReadSegmentCacheEntry,
  writeNativeDeepReadRawAttemptEvidence,
  writeNativeDeepReadSegmentCacheEntry,
  type NativeDeepReadSegmentCacheEntry,
  type NativeDeepReadSegmentCacheRead,
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
          evidenceRole: {
            type: "STRING",
            enum: ["story", "non_story_ad"],
          },
        },
        required: ["startSec", "endSec", "actionZh", "evidenceRole"],
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
      required: [
        "emotionTagsZh",
        "narrativeFeatureTagsZh",
        "performanceTagsZh",
        "audiovisualTagsZh",
        "audienceExperienceTagsZh",
      ],
    },
  },
  required: ["shots", "subtitles", "audioResolution", "beatStructureZh", "classification"],
} as const;

/**
 * 0827 实弹定稿：temperature 0.70、maxOutputTokens 65_536、单候选、
 * responseSchema、thinkingLevel HIGH；思考过程不进入输出 JSON。
 */
export const NATIVE_DEEP_READ_GENERATION_CONFIG = {
  temperature: 0.7,
  maxOutputTokens: 65_536,
  candidateCount: 1,
  audioTimestamp: true,
  responseMimeType: "application/json",
  responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: false },
} as const;

/**
 * 同一 Vertex 分片的固定三档尝试：所有失败统一降温重试两次；不得静默换供应商。
 * 用户主动中止不是失败，不进入重试。
 */
export const NATIVE_DEEP_READ_RETRY_TEMPERATURES = [0.7, 0.65, 0.6] as const;
export const NATIVE_DEEP_READ_RETRY_INTERVAL_MS = 60_000;
export const NATIVE_DEEP_READ_TEMPERATURE_MIN = 0.6;

/** 第二次尝试参数；保留导出供既有调用方与缓存指纹使用。 */
export const NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG = {
  ...NATIVE_DEEP_READ_GENERATION_CONFIG,
  temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[1],
} as const;

/** 第三次尝试参数。 */
export const NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG = {
  ...NATIVE_DEEP_READ_GENERATION_CONFIG,
  temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[2],
} as const;

/** 响应体上限：模型异常时可能吐超大 body，不设限会把内存吃干 */
const NATIVE_RESPONSE_CAP_CHARS = 8 * 1024 * 1024;
/** 单段视觉请求总时限：生产分片最长 300 秒，30 分钟为失联硬顶。 */
export const NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS = 30 * 60_000;
/**
 * Undici 默认只等 300 秒响应头；生产分片本身已到 300 秒，上游排队或 Fly
 * 资源繁忙时会先被这个隐含门槛切成 `TypeError: fetch failed`。这里与业务总时限收口，
 * 仍由 AbortSignal 负责 30 分钟硬中止，不把超时无限放开。
 */
export const NATIVE_DEEP_READ_HTTP_HEADERS_TIMEOUT_MS =
  NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS;
export const NATIVE_DEEP_READ_HTTP_BODY_TIMEOUT_MS =
  NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS;

const nativeDeepReadHttpDispatcher = new Agent({
  headersTimeout: NATIVE_DEEP_READ_HTTP_HEADERS_TIMEOUT_MS,
  bodyTimeout: NATIVE_DEEP_READ_HTTP_BODY_TIMEOUT_MS,
  connect: { timeout: 30_000 },
});

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
  /** 已可靠写入段缓存的 0-based 段号；部分提案与断点恢复以此为准。 */
  completedSegmentIndexes?: number[];
  /** 稳定媒体身份摘要；只进私有 provenance，不下发公开模板 DTO。 */
  sourceDigest?: string;
  /** 当前已成段集合的确定性快照；不含时间戳，供 CAS 单调更新。 */
  segmentSnapshotSha256?: string;
  /** 每个已付费分片的不可变原始 JSON 对象名；只进私有 provenance。 */
  segmentEvidenceObjectNames?: string[];
  /** 每次付费尝试在 parse/门禁前保存的完整上游响应对象名。 */
  rawAttemptEvidenceObjectNames?: string[];
  /** true 只表示全部计划段已成；完整集卡仍需通过整集门禁。 */
  assemblyComplete?: boolean;
};

export type NativeDeepReadSegmentSnapshot = {
  episodeIndex: number;
  completedSegmentIndexes: number[];
  learnedThroughSec: number;
  result: NativeDeepReadRunResult;
};

export type NativeDeepReadBatchRunEpisode = {
  episodeIndex: number;
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  segments: readonly NativeDeepReadSegmentSpec[];
  sourceDurationSec: number;
  hintZh?: string;
  /** 启用段缓存时必填：稳定来源标识的 sha256，不得使用短期 CDN/签名 URL。 */
  cacheSourceDigest?: string;
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
export const NATIVE_DEEP_READ_VISUAL_PLAN_VERSION = "time-300s-v7-gemini-story-evidence" as const;

/** 0827 实弹口径：生产 300 秒分片保持 10fps；仅旧数据超 300 秒时降为 5fps。 */
export function resolveNativeDeepReadRequestFps(totalDurationSec: number): number {
  return totalDurationSec <= 300 ? 10 : 5;
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
 * 但标题卡/长定场 16–20s 真实存在）：>15s 至多允许 1 个真实长镜。
 * 同一物理长镜超过 30s 时不得截断或伪造切镜，而要按镜内真实变化拆成连续证据段。
 */
export const NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC = 15;
// 25 秒是质量提示线，不应因真实长镜只多 1 秒就重烧整段；30 秒才关闭式拒收。
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC = 30;
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE = 1;
/** 同一物理长镜超过 30 秒时，后续证据段必须用此固定标记，避免把证据拆分谎报成真实切镜。 */
export const NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH = "同一长镜证据拆分（非切镜）";
/** 长镜证据拆分点之间至少相隔 1 秒，禁止用同秒空切凑过 30 秒门禁。 */
export const NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC = 1;
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
    ? `6. audioResolution 固定为 [{"chunkIndex":${input.segmentIndex},"analysis":{…}}]，由你**亲耳所听**产出，禁止凭画面编造声音；audioTrack 与 cues 内时间用**本段局部秒**（0..${lenSec}），这是全 JSON 唯一的局部秒例外。`
    : `6. 本段素材没有音轨：audioResolution 必须返回空数组 []，禁止凭画面编造声音。`;
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
   "transitionInZh":"进入这一镜的转场：硬切/闪白/黑场/遮挡转场/叠化；同一物理长镜的后续证据段写固定标记「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」",
   "evidenceRole":"story 或 non_story_ad；只有与剧情无关的招商广告才写 non_story_ad"}],
 "subtitles":[{"atSec":整数,"textZh":"画面上真实出现的字幕原文，逐字照抄"}],
 "audioResolution":[{"chunkIndex":${input.segmentIndex},"analysis":{"audioTrack":[{"fromSec":局部整数秒,"toSec":局部整数秒,"emotionArcZh":"情绪强度变化","toneZh":"怎么说，不写台词","sfxZh":"音效","bgmZh":"配乐","atmosphereZh":"气氛","silenceZh":"留白","cues":[{"atSec":局部整数秒,"kind":"sfx/bgm_in/bgm_change/bgm_out/silence_in/silence_out","detailZh":"事件"}]}],"audioBeatStructureZh":"声音节奏","mixNotesZh":"混音","reusableAudioZh":"可复用声音手法","genAudioHintZh":"生成声音要素"}}],
 "beatStructureZh":"节奏结构：憋了几秒、第几秒爆、爆后怎么收",
 "moodArcZh":"情绪推进：起点→转折秒位→终点",
 "classification":{"emotionTagsZh":["从真证据提取的情绪标签"],"narrativeFeatureTagsZh":["叙事特色"],"performanceTagsZh":["表演特色"],"audiovisualTagsZh":["视听特色"],"audienceExperienceTagsZh":["观众体验"]},
 "reusableZh":"可复用手法（脱离本剧剧情，写成通用做法）",
 "genPromptHintZh":"若用 AI 生成类似片段，画面提示词该写哪几个要素"
}
硬约束（只有这六条，必须遵守）：
1. shots 与 subtitles 的 startSec/endSec/atSec **一律写全片绝对秒位**：本段即 ${Math.round(input.startSec)}..${Math.round(input.endSec)} 秒；shots 连续无空档覆盖整段。若同一物理长镜持续超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，不得截断、丢弃尾部或伪造切镜；必须按镜内真实发生的构图、运镜、角色调度、动作、表演或光影变化拆成至少 2 个连续证据段，每个证据段至少 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒，第二段及后续段的 transitionInZh 固定写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。
2. cameraMoveZh 只写真看到的运动，看不出运动就写「固定机位」，禁止套「镜头拉远」这类无依据说法。
3. 所有中文描述字段【禁止】出现钟表式时间（如 01:23、1:05:30）或「在第X秒」式秒位定位——秒位只进数字字段；描述动作时长（如「1.2秒内推近」）不在此限。
4. 先判断画面是否为真人剧。真人剧若出现明确与剧情无关的招商广告、贴片、品牌口播或品牌落版，仍用 shots 保持完整时间轴，但对应镜头 evidenceRole 必须写 non_story_ad；这类镜头不计学习密度，不得进入 subtitles、beatStructureZh、moodArcZh、classification、reusableZh 或 genPromptHintZh。其余镜头一律写 story。
5. 分析描述不写外部平台剧名、商标或原台词；subtitles 是唯一例外——逐字照抄画面上真实出现的剧情字幕，看不清写「[不可辨]」，禁止按剧情补全或从声音猜字；广告字幕不要进入 subtitles。
${audioHardRule}
建议（软边界，按素材实际情况尽量做到）：
a. 这类漫剧的真实节奏通常 2–5 秒一镜，按真实发生的切换逐镜记录，不要为省输出合并镜头。一个剧情段落通常由多个镜头切换组成——**不要把「剧情段」当成一个镜头**，每次画面切换（机位/景别/场景变化）都是新的一镜。验收标准（与入库门禁同一套数字）：本段至少 ${floors.minShots} 镜、平均每镜不超过 ${NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC} 秒；超过 ${NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC} 秒的真实长镜头（如标题卡/长定场）至多 1 个；单个证据段不超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，真实长镜超过该长度时按硬约束 1 拆分证据，不得裁掉内容。
${audioSoftRules}
d. reusableZh 尽量写成脱离本剧剧情的通用做法；classification 五个数组字段都必须输出，只写从本段真实证据提炼的特征标签（避免古言/逆袭/系统/甜宠等题材词）；没有真实证据的维度写 []，至少两个维度各保留一个真实标签，不得在单一维度堆标签冒充，也不得为凑满维度编造。`;
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
  /** 原地重试传 NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG；缺省=首发参数 */
  generationConfig?: Record<string, unknown>;
}): Record<string, unknown> {
  const requestedConfig = input.generationConfig || NATIVE_DEEP_READ_GENERATION_CONFIG;
  const requestedTemperature = Number(requestedConfig.temperature);
  const generationConfig = {
    ...requestedConfig,
    // 纵深门禁：未来即使有新旁路误传 0，也在真正组装请求体时收口到 0.60。
    temperature: Number.isFinite(requestedTemperature)
      ? Math.max(NATIVE_DEEP_READ_TEMPERATURE_MIN, requestedTemperature)
      : NATIVE_DEEP_READ_GENERATION_CONFIG.temperature,
  };
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
    generationConfig,
  };
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

function waitForNativeDeepReadRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type NativeDeepReadModelResponse = {
  status: number;
  text: string;
  requestId?: string;
};

type NativeDeepReadHttpDeps = {
  fetch: typeof undiciFetch;
  dispatcher: Dispatcher;
};

const defaultNativeDeepReadHttpDeps: NativeDeepReadHttpDeps = {
  fetch: undiciFetch,
  dispatcher: nativeDeepReadHttpDispatcher,
};

export async function postNativeDeepReadGenerateContent(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  abortSignal?: AbortSignal;
}, deps: NativeDeepReadHttpDeps = defaultNativeDeepReadHttpDeps): Promise<NativeDeepReadModelResponse> {
  const managed = makeTimedSignal(
    input.abortSignal,
    NATIVE_DEEP_READ_REQUEST_TOTAL_TIMEOUT_MS,
    "原生精读请求超过总时限",
  );
  try {
    const response = await deps.fetch(input.url, {
      method: "POST",
      headers: { ...input.headers, "Content-Type": "application/json" },
      signal: managed.signal,
      body: JSON.stringify(input.body),
      dispatcher: deps.dispatcher,
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
  return postNativeDeepReadGenerateContent({
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
  return postNativeDeepReadGenerateContent({
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
/** 切段前 /tmp 必须至少剩 500MB，否则关闭式停止（不切半截片）。 */
export const NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES = 500 * 1024 * 1024;
/** 单集媒体备料最多并行四段；跨集仍由 execution 串行，避免批量任务打满机器。 */
export const NATIVE_DEEP_READ_MEDIA_PREP_MAX_CONCURRENCY = 4;

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

  const prepared: Array<PreparedNativeVideo | undefined> = new Array(segments.length);
  const cutRows: Array<{
    runId: string;
    localPath: string;
    startSec: number;
    endSec: number;
    bytes: number;
  } | undefined> = new Array(segments.length);
  try {
    // 分片只按时间切；每片独立上传 GCS、独立调用 Gemini。
    // 禁止把整集各片体积相加后预转码：那是旧的多片合包请求逻辑。
    // 单集最多四段并行；每个 worker 内仍保留三次 CDN 节点刷新，跨集不并行。
    const concurrency = Math.max(1, Math.min(
      NATIVE_DEEP_READ_MEDIA_PREP_MAX_CONCURRENCY,
      segments.length,
      Math.floor(Math.max(0, freeBytes - NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES)
        / NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES) || 1,
    ));
    let nextIndex = 0;
    let stopSchedulingCuts = false;
    let cutFailed = false;
    let firstCutFailure: unknown;
    const prepareOne = async (index: number): Promise<void> => {
      abortSignal?.throwIfAborted();
      const segment = segments[index]!;
      let lastError: unknown;
      let completed = false;
      for (let attempt = 0; attempt < 3 && !completed; attempt += 1) {
        abortSignal?.throwIfAborted();
        const runId = crypto.randomUUID();
        const localPath = `/tmp/manhua-native-video-${runId}.mp4`;
        try {
          const nodes = await episode.resolveNodes();
          const node = nodes[attempt % Math.max(1, nodes.length)];
          if (!node?.url) {
            throw new Error(`第${episode.episodeIndex}集第${index + 1}段未解析到媒体节点`);
          }
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
          if (fileStat.size < 100_000) {
            throw new Error(`第${episode.episodeIndex}集第${index + 1}段大小不在处理范围`);
          }
          cutRows[index] = {
            runId,
            localPath,
            startSec: segment.startSec,
            endSec: segment.endSec,
            bytes: fileStat.size,
          };
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
    };
    const workers = Array.from({ length: concurrency }, async () => {
      while (!stopSchedulingCuts) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= segments.length) return;
        try {
          await prepareOne(index);
        } catch (error) {
          if (!cutFailed) firstCutFailure = error;
          cutFailed = true;
          stopSchedulingCuts = true;
          return;
        }
      }
    });
    await Promise.allSettled(workers);
    if (cutFailed) throw firstCutFailure;
    if (cutRows.filter(Boolean).length !== segments.length) {
      throw new Error(`第${episode.episodeIndex}集媒体切片结果不完整，已停止`);
    }

    const completeCutRows = cutRows as Array<NonNullable<(typeof cutRows)[number]>>;
    // 保持既有整集音轨口径：只探测首片一次，避免各片探测抖动制造互相冲突的假事实。
    const episodeHasAudio = await probeLocalSegmentHasAudio(
      completeCutRows[0]!.localPath,
      deps,
      abortSignal,
    );
    // 上传保持单路：uploadBufferToGcs 会复制 Buffer，四路并行可能放大到数 GB 内存。
    for (let index = 0; index < completeCutRows.length; index += 1) {
      abortSignal?.throwIfAborted();
      const row = completeCutRows[index]!;
      const uploaded = await deps.upload({
        objectName: `${NATIVE_VIDEO_TEMP_PREFIX}/${row.runId}.mp4`,
        buffer: await deps.readLocal(row.localPath),
        contentType: "video/mp4",
        signal: abortSignal,
      });
      await deps.unlinkLocal(row.localPath).catch(() => undefined);
      prepared[index] = {
        gsUri: uploaded.gcsUri,
        startSec: row.startSec,
        endSec: row.endSec,
        temporaryGcs: { bucket: uploaded.bucket, objectName: uploaded.objectName },
        bytes: row.bytes,
        hasAudio: episodeHasAudio,
      };
    }
    return prepared as PreparedNativeVideo[];
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      prepared.flatMap((row) => row ? [deps.remove(row.temporaryGcs)] : []),
    );
    if (cleanupResults.some((row) => row.status === "rejected")) {
      console.warn(`[nativeDeepRead] 第${episode.episodeIndex}集备料失败后的临时对象清理待核对`);
    }
    throw error;
  } finally {
    await Promise.allSettled(cutRows.flatMap((row) => row ? [deps.unlinkLocal(row.localPath)] : []));
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

type NativeDeepReadShotTiming = {
  startSec: number;
  endSec: number;
  transitionInZh: string;
  evidenceRole: "story" | "non_story_ad";
};

function sortedShots(raw: Record<string, unknown>): NativeDeepReadShotTiming[] {
  return (Array.isArray(raw.shots) ? raw.shots : [])
    .map((row) => row as Record<string, unknown>)
    .map((row): NativeDeepReadShotTiming => ({
      startSec: Number(row.startSec),
      endSec: Number(row.endSec),
      transitionInZh: String(row.transitionInZh || "").trim(),
      evidenceRole: row.evidenceRole === "non_story_ad" ? "non_story_ad" : "story",
    }))
    .filter((row) => Number.isFinite(row.startSec) && Number.isFinite(row.endSec) && row.endSec > row.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

function assertRawShotEvidenceRolePresence(raw: Record<string, unknown>, labelZh: string): void {
  const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
  for (let index = 0; index < rawShots.length; index += 1) {
    const shot = rawShots[index];
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) continue;
    const role = (shot as Record<string, unknown>).evidenceRole;
    if (role !== "story" && role !== "non_story_ad") {
      throw gateError(`${labelZh}第${index + 1}镜 evidenceRole 缺失或无效`);
    }
  }
}

/**
 * 将「真实切镜」与「同一长镜的证据拆分」分开计数。
 * 后者只是在同一物理镜头内增加观察颗粒，不得被误算成多个真实长镜，
 * 也不得用不足 1 秒的空切凑过 30 秒硬上限。
 */
function groupPhysicalShotDurations(shots: ReadonlyArray<NativeDeepReadShotTiming>): number[] {
  const tolerance = NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC;
  const groups: Array<{ startSec: number; endSec: number }> = [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!;
    const isEvidenceSplit = shot.transitionInZh === NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH;
    if (!isEvidenceSplit) {
      groups.push({ startSec: shot.startSec, endSec: shot.endSec });
      continue;
    }
    const previousShot = shots[index - 1];
    const currentGroup = groups.at(-1);
    if (!previousShot || !currentGroup || Math.abs(previousShot.endSec - shot.startSec) > tolerance) {
      throw gateError("长镜证据拆分没有连续承接上一段");
    }
    const previousPartSec = previousShot.endSec - previousShot.startSec;
    const currentPartSec = shot.endSec - shot.startSec;
    if (
      previousPartSec < NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC
      || currentPartSec < NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC
    ) {
      throw gateError(
        `长镜证据拆分点之间必须至少相隔 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒`,
      );
    }
    currentGroup.endSec = shot.endSec;
  }
  return groups.map((group) => group.endSec - group.startSec);
}

/** 长镜证据的段级不变量；只在付费分片首次验收时关闭式执行。 */
function assertLongTakeEvidenceInvariant(input: {
  shots: ReadonlyArray<NativeDeepReadShotTiming>;
  labelZh: string;
  maxPhysicalLongTakes: number;
}): void {
  const evidenceDurations = input.shots.map((shot) => shot.endSec - shot.startSec);
  const hardOverlong = evidenceDurations.filter(
    (shotLen) => shotLen > NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC,
  );
  if (hardOverlong.length > 0) {
    throw gateError(
      `${input.labelZh}存在超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒的镜头证据段（最长 ${Math.round(Math.max(...hardOverlong))} 秒）；真实长镜必须按镜内变化拆成连续证据段，禁止截断尾部`,
    );
  }
  const physicalLongTakes = groupPhysicalShotDurations(input.shots)
    .filter((shotLen) => shotLen > NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC);
  if (physicalLongTakes.length > input.maxPhysicalLongTakes) {
    throw gateError(
      `${input.labelZh}有 ${physicalLongTakes.length} 个超过 ${NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC} 秒的真实长镜（长定场限额 ${input.maxPhysicalLongTakes} 个），需重新检查是否合并了多次切镜`,
    );
  }
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
function assertRawAudioAnalysisFieldPresence(rawAnalysis: unknown, labelZh: string): void {
  if (!rawAnalysis || typeof rawAnalysis !== "object" || Array.isArray(rawAnalysis)) {
    throw gateError(`${labelZh}音轨 analysis 缺失或格式无效`);
  }
  const record = rawAnalysis as Record<string, unknown>;
  const requiredAnalysisFields = [
    "audioTrack", "audioBeatStructureZh", "mixNotesZh", "reusableAudioZh", "genAudioHintZh",
  ];
  const missingAnalysisFields = requiredAnalysisFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(record, field),
  );
  if (missingAnalysisFields.length > 0) {
    throw gateError(`${labelZh}音轨汇总字段不完整：缺 ${missingAnalysisFields.join("、")}`);
  }
  const requiredTrackFields = [
    "fromSec", "toSec", "emotionArcZh", "toneZh", "sfxZh", "bgmZh", "atmosphereZh", "silenceZh", "cues",
  ];
  const rawTracks = Array.isArray(record.audioTrack) ? record.audioTrack : [];
  for (let trackIndex = 0; trackIndex < rawTracks.length; trackIndex += 1) {
    const rawTrack = rawTracks[trackIndex];
    if (!rawTrack || typeof rawTrack !== "object" || Array.isArray(rawTrack)) {
      throw gateError(`${labelZh}第${trackIndex + 1}条音轨格式无效`);
    }
    const missingTrackFields = requiredTrackFields.filter(
      (field) => !Object.prototype.hasOwnProperty.call(rawTrack, field),
    );
    if (missingTrackFields.length > 0) {
      throw gateError(`${labelZh}第${trackIndex + 1}条音轨字段不完整：缺 ${missingTrackFields.join("、")}`);
    }
  }
}

export function assertNativeDeepReadSegmentDensity(input: {
  episodeIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio: boolean;
  raw: Record<string, unknown>;
}): void {
  const lenSec = Math.max(1, Math.round(input.endSec - input.startSec));
  // 存在性门禁必须先于 zod：必填字段缺失时必须返回具体字段名。
  const rawClassification = input.raw.classification;
  if (!rawClassification || typeof rawClassification !== "object" || Array.isArray(rawClassification)) {
    throw gateError(`第${input.segmentIndex + 1}段 classification 缺失`);
  }
  if (!hasManhuaTemplateClassificationFields(rawClassification)) {
    const row = rawClassification as Record<string, unknown>;
    const key = MANHUA_TEMPLATE_CLASSIFICATION_KEYS.find((candidate) =>
      !Object.prototype.hasOwnProperty.call(row, candidate) || !Array.isArray(row[candidate]));
    throw gateError(`第${input.segmentIndex + 1}段 classification.${key || "字段"} 缺失或不是数组`);
  }
  if (input.hasAudio) {
    const rawAudioRows = Array.isArray(input.raw.audioResolution)
      ? (input.raw.audioResolution as unknown[])
      : [];
    const rawAudioEntry = rawAudioRows[0];
    if (rawAudioRows.length > 0 && rawAudioEntry && typeof rawAudioEntry === "object" && !Array.isArray(rawAudioEntry)) {
      assertRawAudioAnalysisFieldPresence(
        (rawAudioEntry as Record<string, unknown>).analysis,
        `第${input.segmentIndex + 1}段`,
      );
    }
  }
  assertRawShotEvidenceRolePresence(input.raw, `第${input.segmentIndex + 1}段`);
  const parsed = nativeDeepReadSegmentSchema.safeParse(input.raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const issueZh = firstIssue
      ? `（${firstIssue.path.join(".") || "根"}: ${firstIssue.message}）`
      : "";
    throw gateError(`第${input.segmentIndex + 1}段结构不合六栏 schema${issueZh}`);
  }
  assertVisualTextNoClock(input.raw, `第${input.segmentIndex + 1}段`);
  const shots = sortedShots(input.raw);
  assertShotCoverage(shots, Math.round(input.startSec), Math.round(input.endSec), `第${input.segmentIndex + 1}段`);
  const storyShots = shots.filter((shot) => shot.evidenceRole === "story");
  const storyDurationSec = storyShots.reduce(
    (total, shot) => total + Math.max(0, shot.endSec - shot.startSec),
    0,
  );
  if (storyShots.length === 0 || storyDurationSec < 1) {
    throw gateError(`第${input.segmentIndex + 1}段没有可学习的剧情镜头（招商广告已排除）`);
  }
  const storyFloors = resolveNativeDeepReadSegmentFloors(storyDurationSec);
  const audioFloors = resolveNativeDeepReadSegmentFloors(lenSec);
  // 时长制镜头门禁（0826 用户参考稿 + 两处判断修订：微尾段豁免、长定场限额）
  if (storyDurationSec > NATIVE_DEEP_READ_SHOT_MICRO_SEGMENT_SEC) {
    if (storyShots.length < storyFloors.minShots) {
      throw gateError(
        `第${input.segmentIndex + 1}段剧情镜头密度不足：${Math.round(storyDurationSec)}秒至少需要${storyFloors.minShots}镜，实际${storyShots.length}（招商广告不计入）`,
      );
    }
    const averageShotSec = storyDurationSec / storyShots.length;
    if (averageShotSec > NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC) {
      throw gateError(
        `第${input.segmentIndex + 1}段镜头粒度过粗：平均每镜${averageShotSec.toFixed(1)}秒（上限 ${NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC} 秒）`,
      );
    }
    assertLongTakeEvidenceInvariant({
      shots: storyShots,
      labelZh: `第${input.segmentIndex + 1}段`,
      maxPhysicalLongTakes: NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE,
    });
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
  if (!hasUsableManhuaTemplateClassification(parsed.data.classification)) {
    throw gateError(`第${input.segmentIndex + 1}段五维特征标签不足两个有效维度（无法生成可审批分片卡）`);
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
  const analysis = manhuaNativeAudioChunkAnalysisSchema.parse(audioResolution[0]!.analysis);
  if (analysis.audioTrack.length < audioFloors.minAudioTracks) {
    throw gateError(
      `第${input.segmentIndex + 1}段音轨仅 ${analysis.audioTrack.length} 段，低于地板线 ${audioFloors.minAudioTracks}`,
    );
  }
  const cueCount = analysis.audioTrack.reduce((sum, track) => sum + track.cues.length, 0);
  if (cueCount < audioFloors.minAudioCues) {
    throw gateError(
      `第${input.segmentIndex + 1}段声音事件仅 ${cueCount} 条，低于地板线 ${audioFloors.minAudioCues}`,
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
      assertRawShotEvidenceRolePresence(raw, `第${input.episodeIndex}集`);
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
  const storyShots = allShots.filter((shot) => shot.evidenceRole === "story");
  const storyDurationSec = storyShots.reduce(
    (total, shot) => total + Math.max(0, shot.endSec - shot.startSec),
    0,
  );
  if (storyShots.length === 0 || storyDurationSec < 1) {
    throw new Error(`第${input.episodeIndex}集没有可学习的剧情镜头（招商广告已排除），整集拒绝入库`);
  }
  const minShots = Math.ceil(
    Math.max(1, storyDurationSec) / NATIVE_DEEP_READ_SHOT_FLOOR_INTERVAL_SEC,
  );
  if (storyShots.length < minShots) {
    throw new Error(
      `第${input.episodeIndex}集剧情镜头 ${storyShots.length} 个低于地板线 ${minShots}（招商广告不计入），整集拒绝入库`,
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
      try {
        assertRawAudioAnalysisFieldPresence(
          entry.analysis,
          `第${input.episodeIndex}集第${Number(entry.chunkIndex) + 1}段`,
        );
      } catch (presenceError) {
        throw new Error(
          `${presenceError instanceof Error ? presenceError.message : presenceError}，整集拒绝入库`,
        );
      }
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
const GLM_STRUCTURING_MAX_TOKENS = 131_072;
/** 四个 300 秒分片的真实组装曾在 12 分钟边界被本地中止；只放宽等待，不自动重提。 */
const GLM_STRUCTURING_TIMEOUT_MS = 30 * 60_000;
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
2. shots 已逐段通过付费前门禁。连续表演或连续剧情允许合理合并相邻证据，但合并后的单条证据不得超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，拆分边界必须至少相隔 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒；不得丢失时间轴覆盖。仍需拆分的同一物理长镜，其 transitionInZh 必须保留「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。
3. 每个 shot 必须原样保留 evidenceRole。non_story_ad 只用于保存完整原始时间轴，不得与 story 合并，也不得进入剧情字幕、节奏、情绪、分类、可复用手法或生成提示；其余镜头一律保持 story。
4. subtitles 只取 story 区间的并集去重，保持全片绝对秒位排序。
5. audioResolution 保留完整原始听觉证据；广告区间内声音只作审计证据，不得写入 audioBeatStructureZh/mixNotesZh/reusableAudioZh/genAudioHintZh 的可复用结论。
6. 所有中文描述文本【禁止】出现钟表式秒位（如 01:23）或「在第X秒」定位——秒位只进数字字段。
7. classification 必须显式输出 emotionTagsZh/narrativeFeatureTagsZh/performanceTagsZh/audiovisualTagsZh/audienceExperienceTagsZh 五个数组；没有证据的维度写 []，至少两个维度各有一个来自 story 镜头的真实标签。
8. 只返回一个 JSON 对象，不要 Markdown 围栏、不要解释。`,
    user: `把以下同一集的 ${input.rawSegments.length} 份分段卡整形合并成**一张整集六栏卡**（单个 JSON 对象，字段 schema 与分段卡完全相同：shots/subtitles/audioResolution/beatStructureZh/moodArcZh/classification/reusableZh/genPromptHintZh）。
要求：
1. shots 连续无空档覆盖全片 0..${Math.round(input.durationSec)} 秒（绝对秒位），每镜保留 evidenceRole；只有相邻 story 证据可以合理合并，non_story_ad 不得混入 story。合并后的单条证据不得超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，拆分边界至少相隔 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒，且不得删除仍需保留的「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」续接标记或丢失覆盖。
2. audioResolution 保留全部 [{chunkIndex,analysis}] 条目（chunkIndex 即段号，analysis 内为该段局部秒），逐段齐全${input.hasAudio ? "" : "；本集素材无音轨，audioResolution 保持空数组"}。
3. beatStructureZh/moodArcZh/reusableZh/genPromptHintZh 只整合 story 证据，可加「第X段」标注；classification 五维标签只取 story 输入并集，不得补猜。
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
4. shots 中的 evidenceRole 只能原样恢复为 story 或 non_story_ad，禁止猜测、改写或把 non_story_ad 混入 story；原文缺失该字段则修复失败。
5. 所有中文描述文本【禁止】出现钟表式秒位（如 01:23）或「在第X秒」定位——秒位只进数字字段。
6. classification 必须显式输出 emotionTagsZh/narrativeFeatureTagsZh/performanceTagsZh/audiovisualTagsZh/audienceExperienceTagsZh 五个数组；原文没有的维度写 []，至少两个维度必须能从原文 story 证据恢复出真实标签，否则修复失败。
7. 只返回一个 JSON 对象，不要 Markdown 围栏、不要解释。`,
    user: `修复以下第 ${input.episodeIndex} 集第 ${input.segmentIndex + 1} 段分段卡（覆盖绝对秒位 ${Math.round(input.startSec)}..${Math.round(input.endSec)} 秒，字段 schema：shots/subtitles/audioResolution/beatStructureZh/moodArcZh/classification/reusableZh/genPromptHintZh${input.hasAudio ? "" : "；本段素材无音轨，audioResolution 保持空数组"}）。
${input.rejectedReasonZh ? `【解析失败原因】${String(input.rejectedReasonZh).slice(0, 300)}\n` : ""}坏 JSON 原文：
${input.badJsonText}`,
  };
}

/**
 * 每段缓存的真实请求契约指纹。不能只 hash 一份“典型提示词”：真实集时长、段号、
 * 段数、hint、fps、音轨口径和来源只要有一项改变，都必须让旧缓存失效。
 */
export function nativeDeepReadSegmentCacheFingerprint(input: {
  sourceDigest: string;
  episodeIndex: number;
  episodeDurationSec: number;
  segment: NativeDeepReadSegmentSpec;
  segmentIndex: number;
  segmentCount: number;
  hasAudio: boolean;
  hintZh?: string;
}): string {
  const fps = resolveNativeDeepReadRequestFps(input.segment.endSec - input.segment.startSec);
  const prompt = buildGeminiNativeDeepReadSegmentPrompt({
    episodeDurationSec: input.episodeDurationSec,
    startSec: input.segment.startSec,
    endSec: input.segment.endSec,
    segmentIndex: input.segmentIndex,
    segmentCount: input.segmentCount,
    hasAudio: input.hasAudio,
    hintZh: input.segment.hintZh || input.hintZh,
  });
  const repairPrompt = buildNativeDeepReadGlmSegmentRepairPrompt({
    episodeIndex: input.episodeIndex,
    segmentIndex: input.segmentIndex,
    startSec: input.segment.startSec,
    endSec: input.segment.endSec,
    hasAudio: input.hasAudio,
    badJsonText: "<CACHE_FINGERPRINT>",
  });
  return crypto.createHash("sha256").update(JSON.stringify({
    cacheSchemaVersion: NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
    planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
    model: NATIVE_DEEP_READ_MODEL,
    glmRepairModel: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
    generationConfig: NATIVE_DEEP_READ_GENERATION_CONFIG,
    retryGenerationConfig: NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG,
    finalRetryGenerationConfig: NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG,
    retryIntervalMs: NATIVE_DEEP_READ_RETRY_INTERVAL_MS,
    sourceDigest: input.sourceDigest,
    requestedFps: fps,
    prompt,
    repairPrompt,
  }), "utf8").digest("hex");
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
  writeRawAttemptEvidence: typeof writeNativeDeepReadRawAttemptEvidence;
  waitForRetry: typeof waitForNativeDeepReadRetry;
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
  writeRawAttemptEvidence: writeNativeDeepReadRawAttemptEvidence,
  waitForRetry: waitForNativeDeepReadRetry,
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
  visualRoute: NativeDeepReadVisualRoute;
  finishReason?: string;
  providerRequestId?: string;
  rawAttemptEvidenceObjectName?: string;
};

/** 收到明确 HTTP 失败响应的错误（结果确定），可按路由铁律换通道重试。 */
type HttpFailure = Error & { nativeDeepReadHttpStatus?: number };

const ROUTE_LABEL_ZH: Record<NativeDeepReadVisualRoute, string> = {
  [NATIVE_DEEP_READ_ROUTE_VERTEX]: "Vertex Gemini 3.1 Pro 视频精读",
  [NATIVE_DEEP_READ_ROUTE_EVOLINK]: "EvoLink Gemini 3.1 Pro 视频精读（兜底）",
};

/**
 * 一次请求读取一集（逐段调用），回传后按段合并成集卡。
 * 任一段失败均按 0.70→0.65→0.60 原通道重试两次，每次间隔 60 秒；
 * 三次仍失败才终止本集（用户主动中止不重试）。
 */
export async function runManhuaNativeDeepReadBatch(params: {
  episodes: readonly NativeDeepReadBatchRunEpisode[];
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>;
  /** 传入即启用段级恢复与永久证据；生产 execution 和单集入口都必须传稳定 seriesKey。 */
  segmentCacheSeriesKey?: string;
  /** 仅获授权证据探针使用：保留 GCS 视频分片，不执行 finally 清理。 */
  preservePreparedVideos?: boolean;
  /**
   * 段缓存可靠落盘后的强回调。失败必须阻止下一次模型调用，避免出现“钱已花、卡不可见”。
   * 最后一段由整集门禁/正式 ingest 接管，避免在整集结构尚未验收前冒充 4/4 完成卡。
   */
  onSegmentSnapshotCommitted?: (
    snapshot: NativeDeepReadSegmentSnapshot,
  ) => void | Promise<void>;
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
    videosBySegment: Map<number, PreparedNativeVideo>;
    cachedSegments: Map<number, NativeDeepReadSegmentCacheEntry>;
  }> = [];
  const episodes: NativeDeepReadBatchRunResult["episodes"] = [];
  try {
    for (const episode of validated) {
      const cachedSegments = new Map<number, NativeDeepReadSegmentCacheEntry>();
      if (params.segmentCacheSeriesKey) {
        if (!/^[0-9a-f]{64}$/.test(String(episode.cacheSourceDigest || ""))) {
          throw new Error(`第${episode.episodeIndex}集缺少稳定来源摘要，禁止启用段缓存`);
        }
        for (let segmentIndex = 0; segmentIndex < episode.segments.length; segmentIndex += 1) {
          const segment = episode.segments[segmentIndex]!;
          const cached = await deps.readSegmentCache({
            seriesKey: params.segmentCacheSeriesKey,
            episodeIndex: episode.episodeIndex,
            segmentIndex,
          });
          if (!cached) continue;
          const entry = cached.entry;
          const expectedFingerprint = nativeDeepReadSegmentCacheFingerprint({
            sourceDigest: episode.cacheSourceDigest!,
            episodeIndex: episode.episodeIndex,
            episodeDurationSec: episode.sourceDurationSec,
            segment,
            segmentIndex,
            segmentCount: episode.segments.length,
            hasAudio: entry.hasAudio,
            hintZh: episode.hintZh,
          });
          if (
            entry.sourceDigest !== episode.cacheSourceDigest
            || entry.fingerprint !== expectedFingerprint
            || Math.abs(entry.startSec - segment.startSec) > 0.01
            || Math.abs(entry.endSec - segment.endSec) > 0.01
            || Math.abs(
              entry.requestedFps
              - resolveNativeDeepReadRequestFps(segment.endSec - segment.startSec),
            ) > 0.001
          ) {
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存契约已换代，按 miss 处理`,
            );
            continue;
          }
          try {
            // 门禁代码收紧时，即使指纹未变，旧段也必须按当前标准复验；未过即 miss。
            assertNativeDeepReadSegmentDensity({
              episodeIndex: episode.episodeIndex,
              segmentIndex,
              startSec: segment.startSec,
              endSec: segment.endSec,
              hasAudio: entry.hasAudio,
              raw: entry.raw,
            });
          } catch (error) {
            if (!isNativeDeepReadGateFailure(error)) throw error;
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存未过当前门禁，按 miss 重学`,
            );
            continue;
          }
          cachedSegments.set(segmentIndex, entry);
        }
        const cachedAudioKinds = new Set(
          Array.from(cachedSegments.values()).map((entry) => entry.hasAudio),
        );
        if (cachedAudioKinds.size > 1) {
          throw new Error(`第${episode.episodeIndex}集段缓存的 hasAudio 证据互相冲突，已停止以避免重复付费`);
        }
      }

      const videosBySegment = new Map<number, PreparedNativeVideo>();
      const allVideos: PreparedNativeVideo[] = [];
      const prepareSegmentIndexes = async (indexes: readonly number[]): Promise<void> => {
        if (!indexes.length) return;
        const selectedSegments = indexes.map((index) => episode.segments[index]!);
        const prepared = await deps.prepareVideos(
          { ...episode, segments: selectedSegments },
          params.abortSignal,
        );
        if (prepared.length !== indexes.length) {
          throw new Error(`第${episode.episodeIndex}集备料数量与请求段数不一致，已停止`);
        }
        prepared.forEach((video, position) => {
          const segmentIndex = indexes[position]!;
          const expected = episode.segments[segmentIndex]!;
          if (
            Math.abs(video.startSec - expected.startSec) > 0.01
            || Math.abs(video.endSec - expected.endSec) > 0.01
          ) {
            throw new Error(`第${episode.episodeIndex}集第${segmentIndex + 1}段备料秒位错配，已停止`);
          }
          videosBySegment.set(segmentIndex, video);
          allVideos.push(video);
        });
      };

      const pendingIndexes = episode.segments
        .map((_, index) => index)
        .filter((index) => !cachedSegments.has(index));
      await prepareSegmentIndexes(pendingIndexes);

      // 新备段与历史缓存的音轨事实不一致时，缓存不能继续参与本次装配；只补备原缓存段。
      if (videosBySegment.size > 0 && cachedSegments.size > 0) {
        const preparedHasAudio = Array.from(videosBySegment.values())[0]!.hasAudio === true;
        const cacheHasAudio = Array.from(cachedSegments.values())[0]!.hasAudio;
        if (preparedHasAudio !== cacheHasAudio) {
          cachedSegments.clear();
          videosBySegment.clear();
          await prepareSegmentIndexes(episode.segments.map((_, index) => index));
        }
      }
      const resolvedAudioKinds = new Set<boolean>([
        ...Array.from(videosBySegment.values()).map((video) => video.hasAudio === true),
        ...Array.from(cachedSegments.values()).map((entry) => entry.hasAudio),
      ]);
      if (resolvedAudioKinds.size !== 1) {
        throw new Error(`第${episode.episodeIndex}集各段 hasAudio 实测不一致，已停止以避免错误装配`);
      }
      preparedByEpisode.push({
        episode,
        videos: allVideos,
        videosBySegment,
        cachedSegments,
      });
    }

    for (const { episode, videosBySegment, cachedSegments } of preparedByEpisode) {
      params.abortSignal?.throwIfAborted();
      const episodeRequestId = validated.length === 1 ? batchRequestId : crypto.randomUUID();
      const firstPrepared = Array.from(videosBySegment.values())[0];
      const firstCached = Array.from(cachedSegments.values())[0];
      const hasAudio = firstPrepared
        ? firstPrepared.hasAudio === true
        : firstCached?.hasAudio === true;
      const segmentCount = episode.segments.length;
      const rawSegments: Array<Record<string, unknown> | undefined> = new Array(segmentCount);
      const committedEntries = new Map<number, NativeDeepReadSegmentCacheEntry>();
      const committedIndexes: number[] = [];
      let episodeInput = 0;
      let episodeOutput = 0;
      let episodeCost = 0;
      let episodeAudioInput = 0;
      let episodeReasoning = 0;
      const routesUsed = new Set<NativeDeepReadVisualRoute>();
      const rawAttemptEvidenceObjectNames = new Set<string>();
      const degradedFpsSegmentIndexes: number[] = [];
      const paidUsageBySegment = Array.from({ length: segmentCount }, () => ({
        inputTokens: 0,
        outputTokens: 0,
        audioInputTokens: 0,
        reasoningTokens: 0,
        costCny: 0,
      }));
      const addPaidUsage = (segmentIndex: number, usage: {
        inputTokens: number;
        outputTokens: number;
        audioInputTokens: number;
        reasoningTokens: number;
        costCny: number;
      }) => {
        const target = paidUsageBySegment[segmentIndex]!;
        target.inputTokens += usage.inputTokens;
        target.outputTokens += usage.outputTokens;
        target.audioInputTokens += usage.audioInputTokens;
        target.reasoningTokens += usage.reasoningTokens;
        target.costCny += usage.costCny;
      };

      const buildCommittedSnapshot = (): NativeDeepReadSegmentSnapshot => {
        const sortedIndexes = [...committedIndexes].sort((a, b) => a - b);
        // 当前执行严格按段号推进；出现空洞说明缓存或调用顺序已损坏，不能拿它装部分卡。
        if (sortedIndexes.some((value, index) => value !== index)) {
          throw new Error(`第${episode.episodeIndex}集已成段不是连续前缀，拒绝生成部分提案`);
        }
        const snapshotRows = sortedIndexes.map((index) => rawSegments[index]!);
        const mapped = mapNativeDeepReadSegments(snapshotRows.map((raw) => ({
          startSec: 0,
          endSec: episode.sourceDurationSec,
          finish: "stop",
          text: JSON.stringify(raw),
        })));
        if (mapped.segmentCount !== sortedIndexes.length) {
          throw new Error(`第${episode.episodeIndex}集已成段无法确定性装配，拒绝生成部分提案`);
        }
        const entries = sortedIndexes.map((index) => committedEntries.get(index)!);
        const snapshotSha256 = crypto.createHash("sha256").update(JSON.stringify({
          sourceDigest: episode.cacheSourceDigest,
          segments: entries.map((entry) => ({
            index: entry.segmentIndex,
            fingerprint: entry.fingerprint,
          })),
        })).digest("hex");
        const accumulated = entries.reduce((sum, entry) => ({
          inputTokens: sum.inputTokens + entry.paidUsage.inputTokens,
          outputTokens: sum.outputTokens + entry.paidUsage.outputTokens,
          audioInputTokens: sum.audioInputTokens + entry.paidUsage.audioInputTokens,
          costCny: sum.costCny + entry.paidUsage.costCny,
        }), { inputTokens: 0, outputTokens: 0, audioInputTokens: 0, costCny: 0 });
        const learnedThroughSec = entries.at(-1)?.endSec || 0;
        return {
          episodeIndex: episode.episodeIndex,
          completedSegmentIndexes: sortedIndexes,
          learnedThroughSec,
          result: {
            ...mapped,
            segmentCount: sortedIndexes.length,
            failedSegmentCount: segmentCount - sortedIndexes.length,
            attemptedSegments: segmentCount,
            model: NATIVE_DEEP_READ_MODEL,
            usingPlanQuota: false,
            batchRequestId: episodeRequestId,
            batchEpisodeCount: 1,
            audioInputTokens: accumulated.audioInputTokens,
            hasAudio,
            visualRoutes: Array.from(new Set(entries.map((entry) => entry.visualRoute))),
            degradedFpsSegmentIndexes: entries
              .filter((entry) => entry.degraded)
              .map((entry) => entry.segmentIndex),
            completedSegmentIndexes: sortedIndexes,
            sourceDigest: episode.cacheSourceDigest,
            segmentSnapshotSha256: snapshotSha256,
            segmentEvidenceObjectNames: entries.map(nativeDeepReadSegmentEvidenceObjectName),
            rawAttemptEvidenceObjectNames: Array.from(new Set(entries
              .map((entry) => entry.rawAttemptEvidenceObjectName)
              .filter((value): value is string => Boolean(value)))),
            assemblyComplete: sortedIndexes.length === segmentCount,
            usage: {
              inputTokens: accumulated.inputTokens,
              outputTokens: accumulated.outputTokens,
              costCny: accumulated.costCny,
            },
          },
        };
      };

      let proposalCommitChain = Promise.resolve();
      let proposalCommitFailure: unknown;
      let stopSchedulingSegments = false;
      const commitSegmentToProposal = async (
        segmentIndex: number,
        entry: NativeDeepReadSegmentCacheEntry,
      ): Promise<void> => {
        committedEntries.set(segmentIndex, entry);
        proposalCommitChain = proposalCommitChain.then(async () => {
          while (committedIndexes.length < segmentCount) {
            const nextIndex = committedIndexes.length;
            const nextEntry = committedEntries.get(nextIndex);
            if (!nextEntry) break;
            rawSegments[nextIndex] = nextEntry.raw;
            committedIndexes.push(nextIndex);
            // 4/4 由后面的整集门禁写入；这里只有 1/4、2/4、3/4 的可审批快照。
            if (
              params.onSegmentSnapshotCommitted
              && committedIndexes.length < segmentCount
              && !proposalCommitFailure
            ) {
              try {
                await params.onSegmentSnapshotCommitted(buildCommittedSnapshot());
              } catch (error) {
                // 已发出的兄弟请求仍要收回执；尚未开始的后续分片立即停止，避免继续扣费。
                proposalCommitFailure = error;
                stopSchedulingSegments = true;
              }
            }
          }
        });
        await proposalCommitChain;
      };

      /** 单次通道尝试：发请求→解 envelope→段门禁；用量在门禁之前入账（钱已花）。 */
      const attemptSegment = async (input: {
        route: NativeDeepReadVisualRoute;
        fileUri: string;
        segmentIndex: number;
        fps: number;
        attemptNumber: number;
        temperature: number;
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
          attemptNumber: input.attemptNumber,
          temperature: input.temperature,
          degraded: degraded || undefined,
        }, params.onModelReceipt);
        const body = buildGeminiNativeDeepReadSegmentRequest({
          fileUri: input.fileUri,
          fps: input.fps,
          generationConfig: {
            ...NATIVE_DEEP_READ_GENERATION_CONFIG,
            temperature: input.temperature,
          },
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
          let rawAttemptEvidenceObjectName: string | undefined;
          if (params.segmentCacheSeriesKey && episode.cacheSourceDigest) {
            const requestFingerprint = nativeDeepReadSegmentCacheFingerprint({
              sourceDigest: episode.cacheSourceDigest,
              episodeIndex: episode.episodeIndex,
              episodeDurationSec: episode.sourceDurationSec,
              segment,
              segmentIndex: input.segmentIndex,
              segmentCount,
              hasAudio,
              hintZh: episode.hintZh,
            });
            try {
              const evidence = await deps.writeRawAttemptEvidence({
                seriesKey: params.segmentCacheSeriesKey,
                episodeIndex: episode.episodeIndex,
                segmentIndex: input.segmentIndex,
                segmentCount,
                sourceDigest: episode.cacheSourceDigest,
                requestFingerprint,
                batchRequestId: episodeRequestId,
                callId,
                attemptNumber: input.attemptNumber,
                temperature: input.temperature,
                visualRoute: input.route,
                httpStatus: response.status,
                providerRequestId: response.requestId,
                responseText: response.text,
              });
              rawAttemptEvidenceObjectName = evidence.objectName;
              rawAttemptEvidenceObjectNames.add(evidence.objectName);
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `原始响应已永久取证：${evidence.objectName} · ${evidence.bytes} bytes`
                + ` · sha256=${evidence.sha256}`,
              );
            } catch (error) {
              const failure = new Error(
                `原生精读原始证据落盘失败，已停止且不得自动重试：${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              );
              failure.name = "NativeDeepReadEvidencePersistenceError";
              throw failure;
            }
          }
          const envelope = JSON.parse(response.text) as GeminiEnvelope;
          const usage = envelope.usageMetadata;
          const attemptInput = Math.max(0, Number(usage?.promptTokenCount) || 0);
          const attemptOutput = Math.max(0, Number(usage?.candidatesTokenCount) || 0)
            + Math.max(0, Number(usage?.thoughtsTokenCount) || 0);
          const attemptAudioInput = audioTokensFromUsage(usage?.promptTokensDetails);
          const attemptReasoning = Math.max(0, Number(usage?.thoughtsTokenCount) || 0);
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
          episodeReasoning += attemptReasoning;
          routesUsed.add(input.route);
          addPaidUsage(input.segmentIndex, {
            inputTokens: attemptInput,
            outputTokens: attemptOutput,
            audioInputTokens: attemptAudioInput,
            reasoningTokens: attemptReasoning,
            costCny: attemptCost,
          });
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
            attemptNumber: input.attemptNumber,
            temperature: input.temperature,
            elapsedMs: Date.now() - startedAt,
            inputTokens: attemptInput,
            audioInputTokens: attemptAudioInput || undefined,
            outputTokens: attemptOutput,
            reasoningTokens: attemptReasoning || undefined,
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
            const enriched = gateError(
              `${parseError instanceof Error ? parseError.message : String(parseError)}（${evidenceZh}）`,
            );
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
            reasoningTokens: attemptReasoning,
            visualRoute: input.route,
            finishReason: candidate?.finishReason,
            providerRequestId: response.requestId,
            rawAttemptEvidenceObjectName,
          };
        } catch (error) {
          if (!isNativeDeepReadGateFailure(error)) {
            const providerError = nativeProviderReceiptFromError(error);
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
              attemptNumber: input.attemptNumber,
              temperature: input.temperature,
              elapsedMs: Date.now() - startedAt,
              errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
              providerRequestId: providerError?.requestId,
              providerError,
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
      const logFinalGateFailure = (segmentIndex: number, error: unknown): void => {
        if (!isNativeDeepReadGateFailure(error)) return;
        const errorZh = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
        console.warn(
          `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段重试后仍未过：${errorZh}`,
        );
      };

      /**
       * 同一 Vertex 通道统一三次尝试：所有错误都按 0.70→0.65→0.60 重试，
       * 两次间隔固定 60 秒。三次后若仍是坏 JSON，才允许 GLM 只修语法，避免第四次读视频。
       */
      const attemptWithSegmentRetry = async (input: {
        route: NativeDeepReadVisualRoute;
        fileUri: string;
        segmentIndex: number;
        fps: number;
      }): Promise<SegmentAttemptResult> => {
        let lastError: unknown;
        let rejectedReasonZh: string | undefined;
        for (let attemptIndex = 0; attemptIndex < NATIVE_DEEP_READ_RETRY_TEMPERATURES.length; attemptIndex += 1) {
          const temperature = NATIVE_DEEP_READ_RETRY_TEMPERATURES[attemptIndex]!;
          if (attemptIndex > 0) {
            const retryReasonZh = rejectedReasonZh || "上一次调用未完成";
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
              + `第${attemptIndex}次未完成，60 秒后按 temperature ${temperature} 重试：${retryReasonZh}`,
            );
            await deps.waitForRetry(NATIVE_DEEP_READ_RETRY_INTERVAL_MS, params.abortSignal);
            params.abortSignal?.throwIfAborted();
          }
          try {
            return await attemptSegment({
              ...input,
              attemptNumber: attemptIndex + 1,
              temperature,
              rejectedReasonZh,
            });
          } catch (error) {
            if (params.abortSignal?.aborted) throw error;
            if (error instanceof Error && error.name === "NativeDeepReadEvidencePersistenceError") {
              throw error;
            }
            lastError = error;
            rejectedReasonZh = (error instanceof Error ? error.message : String(error)).slice(0, 300);
          }
        }

        const retryError = lastError || new Error("分片三次尝试均未完成");
        // 三次 Vertex 尝试就是付费上限；坏 JSON 也不得自动切到 GLM 形成第四次调用。
        logFinalGateFailure(input.segmentIndex, retryError);
        throw retryError;
      };

      const processSegment = async (segmentIndex: number): Promise<void> => {
        params.abortSignal?.throwIfAborted();
        const segment = episode.segments[segmentIndex]!;
        const cachedEntry = cachedSegments.get(segmentIndex);
        if (cachedEntry) {
          if (cachedEntry.rawAttemptEvidenceObjectName) {
            rawAttemptEvidenceObjectNames.add(cachedEntry.rawAttemptEvidenceObjectName);
          }
          // 缓存命中不是模型外呼，禁止伪造 ManhuaNativeModelReceipt；历史 token 只作听觉证据。
          // 旧缓存可能早于永久 evidence 机制；先幂等补写不可变原始证据，再允许装卡。
          await deps.writeSegmentCache(cachedEntry);
          episodeAudioInput += Math.max(0, Number(cachedEntry.paidUsage.audioInputTokens) || 0);
          routesUsed.add(cachedEntry.visualRoute);
          if (cachedEntry.degraded) degradedFpsSegmentIndexes.push(segmentIndex);
          console.info(
            `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段命中已验缓存，本次模型调用 0`,
          );
          rawSegments[segmentIndex] = cachedEntry.raw;
          await commitSegmentToProposal(segmentIndex, cachedEntry);
          return;
        }
        const video = videosBySegment.get(segmentIndex);
        if (!video) {
          throw new Error(`第${episode.episodeIndex}集第${segmentIndex + 1}段缺少对应备料，已停止`);
        }
        const fps = resolveNativeDeepReadRequestFps(video.endSec - video.startSec);
        const result = await attemptWithSegmentRetry({
          route: NATIVE_DEEP_READ_ROUTE_VERTEX,
          fileUri: video.gsUri,
          segmentIndex,
          fps,
        });
        if (params.segmentCacheSeriesKey) {
          const sourceDigest = episode.cacheSourceDigest!;
          const entry: NativeDeepReadSegmentCacheEntry = {
            schemaVersion: NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
            fingerprint: nativeDeepReadSegmentCacheFingerprint({
              sourceDigest,
              episodeIndex: episode.episodeIndex,
              episodeDurationSec: episode.sourceDurationSec,
              segment,
              segmentIndex,
              segmentCount,
              hasAudio,
              hintZh: episode.hintZh,
            }),
            sourceDigest,
            seriesKey: params.segmentCacheSeriesKey,
            episodeIndex: episode.episodeIndex,
            segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            hasAudio,
            requestedFps: fps,
            visualRoute: result.visualRoute,
            degraded: result.visualRoute === NATIVE_DEEP_READ_ROUTE_EVOLINK,
            raw: result.raw,
            rawAttemptEvidenceObjectName: result.rawAttemptEvidenceObjectName,
            paidUsage: { ...paidUsageBySegment[segmentIndex]! },
            savedAtIso: new Date().toISOString(),
          };
          // “段过门禁即入账”：并发请求已在途，缓存写入仍是该段成功的强步骤。
          await deps.writeSegmentCache(entry);
          rawSegments[segmentIndex] = result.raw;
          await commitSegmentToProposal(segmentIndex, entry);
          return;
        }
        rawSegments[segmentIndex] = result.raw;
      };

      const segmentFailures: Array<{ segmentIndex: number; error: unknown }> = [];
      let nextSegmentIndex = 0;
      const segmentConcurrency = Math.min(4, segmentCount);
      const segmentWorkers = Array.from({ length: segmentConcurrency }, async () => {
        while (!stopSchedulingSegments) {
          const segmentIndex = nextSegmentIndex;
          nextSegmentIndex += 1;
          if (segmentIndex >= segmentCount) return;
          try {
            await processSegment(segmentIndex);
          } catch (error) {
            segmentFailures.push({ segmentIndex, error });
            // 已发出的兄弟请求必须等回执；尚未发出的长集后续段停止，避免继续烧钱。
            stopSchedulingSegments = true;
          }
        }
      });
      await Promise.allSettled(segmentWorkers);
      await proposalCommitChain;
      if (proposalCommitFailure) throw proposalCommitFailure;
      if (segmentFailures.length > 0) {
        const first = segmentFailures.sort((a, b) => a.segmentIndex - b.segmentIndex)[0]!;
        throw first.error;
      }
      if (rawSegments.some((raw) => !raw)) {
        throw new Error(`第${episode.episodeIndex}集并发精读结果不完整，已停止`);
      }
      const completeRawSegments = rawSegments as Array<Record<string, unknown>>;

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
              rawSegments: completeRawSegments,
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
      const annotateSegmentRows = () => completeRawSegments.map((raw, index) => {
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
            gateEpisode(completeRawSegments);
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
        const committedSnapshot = committedIndexes.length === segmentCount
          ? buildCommittedSnapshot()
          : undefined;
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
            completedSegmentIndexes: committedSnapshot?.completedSegmentIndexes,
            sourceDigest: committedSnapshot?.result.sourceDigest,
            segmentSnapshotSha256: committedSnapshot?.result.segmentSnapshotSha256,
            segmentEvidenceObjectNames: committedSnapshot?.result.segmentEvidenceObjectNames,
            rawAttemptEvidenceObjectNames: Array.from(rawAttemptEvidenceObjectNames),
            assemblyComplete: true,
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
    const cleanupTargets = params.preservePreparedVideos
      ? []
      : preparedByEpisode.flatMap((row) => row.videos);
    const cleanupResults = await Promise.allSettled(
      cleanupTargets.map((video) => deps.remove(video.temporaryGcs)),
    );
    const cleanupFailures = cleanupResults.flatMap((row, index) => row.status === "rejected"
      ? [{
        objectName: cleanupTargets[index]?.temporaryGcs.objectName || "unknown",
        errorZh: (row.reason instanceof Error ? row.reason.message : String(row.reason)).slice(0, 500),
      }]
      : []);
    if (cleanupFailures.length > 0) {
      console.warn(
        `[nativeDeepRead] 批次 ${batchRequestId} 的视频临时对象清理待核对：${JSON.stringify(cleanupFailures)}`,
      );
    }
  }
}

/**
 * 单集入口：与批处理共用同一条 Vertex 分段链路（切段→GCS→逐段调用→合并）。
 *
 * ⚠️ 调用方必须检查 failedSegmentCount / droppedCount；新链路不得截断镜头证据。
 */
export async function runManhuaNativeDeepRead(params: {
  /** 单集/旁路同样必须给稳定身份；否则付费返回无法永久落盘，入口直接拒绝。 */
  seriesKey: string;
  episodeIndex?: number;
  sourceDigest: string;
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  segments: readonly NativeDeepReadSegmentSpec[];
  sourceDurationSec?: number;
  hintZh?: string;
  abortSignal?: AbortSignal;
  /** 仅获授权证据探针使用：保留 GCS 视频分片。 */
  preservePreparedVideos?: boolean;
}, deps: NativeDeepReadBatchRunnerDeps = defaultBatchRunnerDeps): Promise<NativeDeepReadRunResult> {
  const duration = Number(params.sourceDurationSec);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("原生精读缺少可信片长，未发出模型请求");
  }
  const batch = await runManhuaNativeDeepReadBatch({
    episodes: [{
      episodeIndex: params.episodeIndex || 1,
      resolveNodes: params.resolveNodes,
      segments: params.segments,
      sourceDurationSec: duration,
      hintZh: params.hintZh,
      cacheSourceDigest: params.sourceDigest,
    }],
    abortSignal: params.abortSignal,
    segmentCacheSeriesKey: params.seriesKey,
    preservePreparedVideos: params.preservePreparedVideos,
  }, deps);
  const only = batch.episodes[0];
  if (!only) throw new Error("原生精读没有返回集卡");
  return only.result;
}

export type { NativeDeepReadOutput };
export type { ManhuaNativeAudioDirectRoute };
export type { ManhuaNativeProviderErrorReceipt };
