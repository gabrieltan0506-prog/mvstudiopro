
/**
 * 原生视频精读 · 生产执行器。
 *
 * Vertex Gemini 3.1 Pro 从 GCS 逐片读取音画，不合包调用。
 * 分片时长与采样率由调用方独立配置；精确切片验收通过后才上传和调用模型。
 * 模型原始响应、解析原稿与通过门禁的段证据分别持久化，重跑按请求指纹恢复。
 *
 * ⚠️ 默认关闭（MANHUA_NATIVE_DEEP_READ=1 才启用）。
 */
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat, statfs, unlink } from "node:fs/promises";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import {
  dedupeNativeDeepReadAdvisories,
  mapNativeDeepReadSegments,
  nativeDeepReadSegmentSchema,
  type NativeDeepReadAdvisory,
  type NativeDeepReadOutput,
} from "../../shared/manhuaNativeDeepRead.js";
import {
  type ManhuaNativeStructuringModelId,
  MANHUA_NATIVE_DEEP_READ_MODEL,
  MANHUA_NATIVE_DEEP_READ_MODEL_LABELS,
  MANHUA_NATIVE_DEEP_READ_MODEL_OPTIONS,
  parseNativeDeepReadModel,
  type ManhuaNativeDeepReadModelId,
  MANHUA_NATIVE_GLM_REASONING_EFFORT,
  NATIVE_DEEP_READ_MAX_VIDEO_FPS,
  parseNativeDeepReadVideoFps,
} from "../../shared/manhuaNativeDeepReadJob.js";
import {
  MANHUA_TEMPLATE_CLASSIFICATION_KEYS,
  hasManhuaTemplateClassificationFields,
  hasUsableManhuaTemplateClassification,
} from "../../shared/manhuaViralTemplateBank.js";
import {
  MANHUA_NATIVE_AUDIO_CUE_KINDS,
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
  downloadGcsObject,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import {
  errorWithNativeProviderReceipt,
  formatNativeProviderErrorZh,
  nativeProviderReceiptFromError,
  parseNativeProviderErrorReceipt,
} from "./manhuaNativeProviderReceipt.js";
import {
  EVOLINK_GLM_MODEL,
  GLM_MODEL_GATEWAYS,
  GlmGatewayError,
  OPENROUTER_GLM_MODEL,
  STRUCTURING_CHAIN_GATEWAYS,
  STRUCTURING_CHAIN_QWEN_FIRST_GATEWAYS,
  invokeGlmJsonChatWithGatewayFallback,
} from "./bailianChat.js";
import type { GlmGatewayName } from "./bailianChat.js";
import {
  createNativeDeepReadGlmEvidenceStore,
  readNativeDeepReadGlmRecoveredEvidence,
  type NativeDeepReadGlmEvidence,
  type NativeDeepReadGlmEvidenceContext,
  type NativeDeepReadGlmEvidenceDeps,
} from "./manhuaNativeDeepReadGlmEvidence.js";
import {
  NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONTRACT_SHA256,
  NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL,
  nativeDeepReadAttemptSelectionUsageFromError,
  selectNativeDeepReadAttemptWithQwen,
  type NativeDeepReadAttemptSelectionResult,
} from "./manhuaNativeDeepReadAttemptSelector.js";
import {
  baseUrlForVertex,
  getVertexAuthHeaders,
  getVertexProjectId,
} from "./vertexMedia.js";
import {
  NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  nativeDeepReadSegmentEvidenceObjectName,
  readNativeDeepReadRawAttemptEvidence,
  readNativeDeepReadSegmentCacheEntry,
  writeNativeDeepReadRawAttemptEvidence,
  writeNativeDeepReadParsedAttemptEvidence,
  writeNativeDeepReadSegmentCacheEntry,
  type NativeDeepReadSegmentCacheEntry,
  type NativeDeepReadSegmentCacheRead,
} from "./manhuaNativeDeepReadSegmentCache.js";

/** 运行时递归冻结；避免同一进程里的调用方改写共享模型参数或 Schema。 */
function deepFreezeNativeContract<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeNativeContract(child);
  }
  return Object.freeze(value);
}

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
 * 计价常量（¥/M token）：3.1 Pro 按 Vertex 目录价 $1.25/$10 × 7.2 折算；
 * 3.8 Flash 按 flash 档目录价 $0.30/$2.50 × 7.2 折算。⚠️ 均待账单核实。
 * EvoLink 兜底档：仓库暂无对应计价样例，先按 Vertex 同价折算记账。
 */
const MODEL_PRICES_PER_M: Record<ManhuaNativeDeepReadModelId, { inPerM: number; outPerM: number }> = {
  "gemini-3.1-pro-preview": { inPerM: 9.0, outPerM: 72.0 },
  "gemini-3.8-flash": { inPerM: 2.16, outPerM: 18.0 },
};

function routePrices(
  _route: NativeDeepReadVisualRoute,
  model: ManhuaNativeDeepReadModelId,
): { inPerM: number; outPerM: number } {
  return MODEL_PRICES_PER_M[model];
}

/** 观察说明由prompt与schema共用，保持环境、道具、动作的要求一致。 */
const NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH = {
  hintZh: "先观察本镜起止范围内可见的环境、道具及其状态，写成供本镜后续分析使用的观察记录；未入画或无法辨认时明确写出。随镜头时间更新，仅对应本镜。",
  compositionZh: "先交代本镜实际可见的环境特征与背景核心道具，再写主体位置、前中后景关系、视线方向与空间层次；背景未入画时明确可见范围。",
  limbPropActionZh: "先辨认本镜实际可见的四肢或等效附肢，以及手中或身边的道具，再写动作、持握方式、道具状态与交互；道具未入画时明确可见动作范围。",
  actionZh: "结合本镜可见的环境与道具，写出实际动作过程、信息变化、结果与辨识特征；各镜各写该时段的画面事实。",
} as const;

/**
 * Vertex responseSchema（0826 参数定稿）：与 nativeDeepReadSegmentSchema /
 * manhuaNativeAudioChunkAnalysisSchema 同构的结构骨架。只靠 responseMimeType
 * 不足以保证字段与数组结构正确——schema 约束「可解析、字段齐」，
 * min/max 与语义仍由入库 zod 门禁把守（双门各司其职，不合并）。
 */
export const NATIVE_DEEP_READ_RESPONSE_SCHEMA = deepFreezeNativeContract({
  type: "OBJECT",
  properties: {
    shots: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          startSec: { type: "NUMBER" },
          endSec: { type: "NUMBER" },
          evidenceRole: {
            type: "STRING",
            enum: ["story", "non_story_ad"],
            description: "story=推动剧情因果的镜头；non_story_ad=与剧情无关的商业广告，仅记录时间轴与分类，hintZh填null。",
          },
          hintZh: {
            type: "STRING",
            nullable: true,
            maxLength: 80,
            description: NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.hintZh + "story填写非空观察记录；non_story_ad固定为null。",
          },
          unitTypeZh: {
            type: "STRING",
            enum: ["剪辑镜头", "拆分镜证据段"],
            description: "真实剪辑切换写剪辑镜头；同一长镜为满足单条时长上限而连续细分的记录写拆分镜证据段。",
          },
          shotSizeZh: { type: "STRING", maxLength: 28 },
          angleZh: { type: "STRING", maxLength: 28 },
          compositionZh: {
            type: "STRING",
            maxLength: 80,
            description: NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.compositionZh,
          },
          cameraMoveZh: {
            type: "STRING",
            maxLength: 80,
            description: "完整运镜轨迹：起点、方向、速度或节奏、幅度与落点。",
          },
          blockingZh: {
            type: "STRING",
            maxLength: 70,
            description: "角色站位、朝向、距离、进退路径、遮挡关系与群像调度变化。",
          },
          bodyActionZh: {
            type: "STRING",
            maxLength: 70,
            description: "角色整体姿态、躯体重心、移动方式、结构形变与动作阶段变化。",
          },
          limbPropActionZh: {
            type: "STRING",
            maxLength: 70,
            description: NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.limbPropActionZh,
          },
          microExpressionZh: {
            type: "STRING",
            maxLength: 58,
            description: "面部或等效表情器官的可见细微变化，只写画面证据。",
          },
          gazeBreathZh: {
            type: "STRING",
            maxLength: 58,
            description: "视线或感知指向、眨眼、呼吸、能量节奏及其可见变化。",
          },
          relationshipReactionZh: {
            type: "STRING",
            maxLength: 60,
            description: "角色之间的动作因果、反应顺序、感知回应与距离变化。",
          },
          lightingZh: { type: "STRING", maxLength: 58 },
          actionZh: { type: "STRING", maxLength: 60, description: NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.actionZh },
          transitionInZh: { type: "STRING", maxLength: 50 },
        },
        /**
         * 两类条目共用基础字段目录；story的18字段与广告的空观察占位要求
         * 由实际请求的description、提示词和返回后的分类门禁共同保留。
         */
        required: ["startSec", "endSec", "evidenceRole", "hintZh"],
      },
    },
    /**
     * v12 新增：模型自报的抓帧秒位。位置刻意排在 shots 之后、其余字段之前——
     * responseSchema 越靠后的字段越先被 MAX_TOKENS 截断（classification 排末位就是
     * 因此长期被截，0829 才不得不给它开豁免）。这个字段是抽帧链的唯一输入，不能被截掉。
     */
    keyMoments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          atSec: {
            type: "NUMBER",
            description: "该重点时刻的精确抓帧秒位（全片绝对秒，可含一位小数）。取事件真正发生的那一帧，不是镜头区间中点。",
          },
          kindZh: {
            type: "STRING",
            enum: ["切镜", "情绪", "灯光", "剧情", "音轨"],
          },
          noteZh: { type: "STRING", maxLength: 60 },
        },
        required: ["atSec", "kindZh", "noteZh"],
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
                    emotionArcZh: { type: "STRING", maxLength: 18 },
                    toneZh: { type: "STRING", maxLength: 14 },
                    sfxZh: { type: "STRING", maxLength: 18 },
                    bgmZh: { type: "STRING", maxLength: 18 },
                    atmosphereZh: { type: "STRING", maxLength: 14 },
                    silenceZh: { type: "STRING", maxLength: 14 },
                    cues: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          atSec: { type: "INTEGER" },
                          kind: {
                            type: "STRING",
                            enum: MANHUA_NATIVE_AUDIO_CUE_KINDS,
                          },
                          detailZh: { type: "STRING", maxLength: 18 },
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
    beatStructureZh: { type: "STRING", maxLength: 90 },
    moodArcZh: { type: "STRING", maxLength: 70 },
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
  /**
   * keyMoments 进 required（0830 用户拍板）：不进 required 时，模型在输出预算紧张
   * 会优先跳过它——那这一轮抓帧秒位就是扑空。加进来逼它必吐。
   * 安全前提：zod 侧已改成 optional + catch（旧卡没这字段照样解析、非法条目只丢不炸），
   * 所以「必吐」不会反过来变成新的硬失败源。
   */
  required: [
    "shots", "keyMoments", "subtitles", "audioResolution", "beatStructureZh", "classification",
  ],
} as const);

/**
 * 0901 用户冻结：除分片时长与 fps 外，模型参数、prompt 与 Schema 均不得改写。
 * 固定首发0.7、两次重试0.65/0.6，thinkingLevel=MEDIUM，无thinkingBudget。
 */
export const NATIVE_DEEP_READ_GENERATION_CONFIG = deepFreezeNativeContract({
  temperature: 0.7,
  maxOutputTokens: 65_536,
  candidateCount: 1,
  audioTimestamp: true,
  responseMimeType: "application/json",
  // 基础字段目录；真正请求按可信分片上下文派生动态schema。
  responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  /**
   * 只发thinkingLevel，不恢复thinkingBudget。includeThoughts:false仅关闭思考摘要回显；
   * 实际思考用量以供应商回执为准，不根据档位推断内容质量。
   */
  thinkingConfig: { thinkingLevel: "MEDIUM", includeThoughts: false },
  /**
   * 0831 删除 mediaResolution：0830 实测「设了等于没设」——传 MEDIUM 后输入 token
   * 与 LOW 那轮完全一致（210,198 vs 210,134，仍约 66–70 token/帧）。Google 文档亦写明
   * Gemini 3 视频档 默认／LOW／MEDIUM 同为 70 token/帧，只有 HIGH 是 280。
   * 两个已验证成功的历史版本都没有发送此参数，故回到不发送＝默认，去掉这份噪音。
   * 若日后要提画面精度，唯一有效动作是显式 HIGH（4 倍帧 token，成本与上下文须另算）。
   */
} as const);

/**
 * 同一分片固定三档：0.7 → 0.65 → 0.6，共一次首发、两次重试。
 * 调用方不能插入、删除、换序或覆盖温度；三档均未过时只在已保存、可解析
 * 的三份结果中按同一数值评分择优，不产生第四发。
 */
export const NATIVE_DEEP_READ_RETRY_TEMPERATURES = deepFreezeNativeContract([0.7, 0.65, 0.6] as const);

/**
 * 普通建议按三家族及偏差判定；独立覆盖与证据段上限优先于该计数线。
 *
 * 用户原话：「只有三項不合標準才重試，只有一項到兩項一率放行」
 * 「模型跑出來是怎麼樣就怎麼樣」「進去ＧＬＭ他出來什麼就是什麼」。
 *
 * 为什么是「计数」而不是「命中即重试」：0829–0830 实测，单项不合标准
 * （音轨只有 1 段、末镜 41 秒、五维少一维）几乎全是**真实产出**而非模型偷懒——
 * 安静段落就是 1 段音轨，收尾镜本来就长。为这类单项重买一发 Gemini，
 * 0829 一集就白烧 ¥20.5 且被拒内容全部有效。三项同时不合才有「这一发确实糊了」
 * 的判别力，那时重试才是买到新东西而不是买重复。
 *
 * 不受本线约束的两种情况（它们不是「不合标准」，是**根本没有产出**）：
 *   · JSON / zod 解析失败 —— 拿不到可用卡，重试是唯一出路
 *   · 传输层失败（429、超时、空响应）—— 模型没说话，谈不上「出什么就是什么」
 */
export const NATIVE_DEEP_READ_SEGMENT_RETRY_MIN_FAILURES = 3;

/**
 * 2 项不合标准时的重跑判据（0830 晚用户拍板）：任一项偏离门槛超过 **20%** 即重跑。
 *
 * 用户原话：「如果不達標等於兩項的，要看是否在誤差百分之二十內，如果超過，依然重跑」
 * 「這個不能放鬆」「我已經把誤差放鬆了，改重跑還是要跑」。
 *
 * 语义：容差已经给到 20%，还超出去的就不是「差一点」而是真不合格。
 * 与 `NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO`（10%，用于硬门本身的上下让步）不是一回事：
 * 那条决定**算不算命中**，这条决定**命中 2 项时要不要重买**。
 */
export const NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO = 0.20;

/**
 * 覆盖率重跑线（0830 晚用户拍板：「把覆蓋率低於 90% 也列入重跑的條件」）。
 *
 * 与三项线无关：正常结束的本片镜头覆盖率 < 90% 就重试。
 * MAX_TOKENS 仍保留可解析前缀，不因覆盖不足重复购买。
 * 实证：v32 第 4 片 300 秒只读了 20 秒（覆盖 6.7%）、思考 0、输出 3,661，
 * 却因为撞上 45% 硬拒收线抛错、被「硬门单独命中＝1 项」的分支接住而放行入库。
 * 覆盖越差越容易被当成 1 项放行——硬门一抛，带偏差值的 coverage_* advisory
 * 根本没机会产生。这条把覆盖单独拎出来，在硬门之前判，不再被吞。
 */
export const NATIVE_DEEP_READ_SEGMENT_COVERAGE_RETRY_RATIO = 0.90;

/**
 * 只有这些判定的偏差才参与「2 项且超 20% 就重跑」（0830 晚用户圈定）：
 * 用户原话「主要看音軌段數，鏡頭數，這幾樣，音軌長度不在 20% 限制內」。
 *
 * 纳入：音轨**段数**（audio_track_thin）、镜头时间轴覆盖（缺整段/缺头/缺尾/中间空档）。
 * 排除：`audio_cue_thin`（声音事件条数≈音轨长度密度）。安静段落声音事件天然少，
 * 拿它推重买等于为「本来就没声音」付钱。`audio_timeline_invalid` 不属于密度建议：
 * 它会令整集音轨规范化直接拒收，所以任何一片命中都必须在片内重试。
 */
/**
 * 判定家族（0830 晚用户拍板②「同源合併繼承一項」）。
 *
 * 实证：漫剧第 5 片只是尾部少读 3 秒（1%），却同时点亮「镜头没覆盖到 1500 秒」
 * 「声音事件仅 12 条」「音频分析未覆盖片段结尾」三条 → 凑够 3 项重买一整片。
 * 三条说的是同一件事，按三件算就是拿一个缺陷收三次费。
 * 计数改为**按家族计**：同家族命中多少条都只算 1 项。
 */
export const NATIVE_DEEP_READ_ADVISORY_FAMILIES: ReadonlyArray<{
  familyZh: string;
  codes: ReadonlySet<string>;
}> = [
  { familyZh: "覆盖", codes: new Set([
    "coverage_missing", "coverage_head_gap", "coverage_tail_gap",
    "timeline_gap", "timeline_overlap",
  ]) },
  { familyZh: "音轨", codes: new Set([
    "audio_track_thin", "audio_cue_thin", "audio_timeline_invalid",
    "audio_chunk_shape", "audio_schema_invalid", "audio_field_missing", "audio_unexpected",
  ]) },
  { familyZh: "镜头", codes: new Set([
    "long_take_count", "long_take_split_discontinuous", "no_story_shots", "empty_action",
    "shot_density_low", "shot_avg_too_long", "shot_out_of_segment_range", "ad_ratio_suspicious",
  ]) },
  { familyZh: "结构", codes: new Set([
    "classification_thin", "empty_beat_structure", "clock_text",
  ]) },
];

/** 把 advisory 归到家族；不属任何家族的各自独立成项（用 code 本身当家族名）。 */
export function nativeDeepReadAdvisoryFamilyOf(code: string): string {
  for (const fam of NATIVE_DEEP_READ_ADVISORY_FAMILIES) {
    if (fam.codes.has(code)) return fam.familyZh;
  }
  return code;
}

/**
 * 覆盖类可**单独触发**重跑（0830 晚用户拍板①）：不必凑够 2 项，
 * 只要覆盖缺口偏差 > 20% 就重买。少一大段画面是硬伤，不是「差一点」。
 */
/**
 * 广告时长占本段的比例上限。超过即判模型拿 non_story_ad 当偷懒出口。
 *
 * 为什么必须有（0831 用户点出的口子）：`non_story_ad` 只需填
 * startSec/endSec/evidenceRole **三个字段**，而 story 要填 **十七个**。
 * 把正片标成广告，能通过全部 schema 检查、段卡合并时被整行剔除，
 * 于是「钱照烧、证据为零，而且看起来一切正常」——没有任何 advisory 会亮。
 * 它还能**绕过镜数地板**：地板数的是 storyShots，广告镜不计入。
 *
 * 0.35 的来源：真人剧片头版权卡＋贴片实测约占 30%（0830），漫剧招商更少。
 * 留 5 个点余量；超过就该有人看一眼，而不是默默把整片当广告丢掉。
 */
export const NATIVE_DEEP_READ_AD_RATIO_MAX = 0.35;

/**
 * 单条广告镜的时长占比上限。
 *
 * 只看总占比不够：真实广告是**片头版权卡＋贴片＋中插**这样的多段短区间，
 * 而偷懒是**一条大广告吞掉整段**。后者才是要抓的形态——模型写一行
 * `{startSec:0, endSec:300, evidenceRole:"non_story_ad"}` 就交差了。
 * 两条同时超标才判可疑，避免把「广告多但如实标注」误判成偷懒。
 */
export const NATIVE_DEEP_READ_AD_SINGLE_MAX_RATIO = 0.6;

export const NATIVE_DEEP_READ_COVERAGE_SOLO_RETRY_CODES: ReadonlySet<string> = new Set([
  "coverage_missing", "coverage_head_gap", "coverage_tail_gap", "timeline_gap",
  /**
   * 0831 用户拍板加回：镜数低于「离谱地板」可**单独触发**重试。
   *
   * 为什么必须有：0830 删掉段级镜数反馈后，模型写 9 镜和写 90 镜，
   * 门禁反应完全一样。实测 run probe_douyin_20260831035500_86a2a69d attempt1
   * 给出 **9 镜 / 319 秒 ＝ 35.4 秒一镜**、输出只用 3,689 token（上限的 5.6%）——
   * 319 秒的漫剧不可能只有 9 个镜头，这是躺平不是「诚实地少写」。
   * 提示词里的自检基准是软的，模型可以不理，这一发就是不理的证据。
   *
   * ⚠️ 这不是回到「硬拒收逼模型凑数」：地板取的是**离谱线 10 秒/镜**
   * （319 秒＝32 镜），不是 v11 的建议线 6 秒/镜（53 镜）。
   * 目的只是让「只写 9 镜」有代价，不是逼它写够 53 镜。
   */
  "shot_density_low",
  // 平均镜长同样可单独触发：等分切法能压在镜数地板上蒙混过关，只有它抓得住。
  "shot_avg_too_long",
  // 广告占比异常同样可单独触发重试：整片被标成广告时，其他判据都数不到东西。
  "ad_ratio_suspicious",
]);

export const NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES: ReadonlySet<string> = new Set([
  "shot_density_low",
  "shot_avg_too_long",
  "ad_ratio_suspicious",
  "audio_track_thin",
  "coverage_missing",
  "coverage_head_gap",
  "coverage_tail_gap",
  "timeline_gap",
]);
/**
 * 不进重试拒因文本的 advisory（0831 修复，实测退化根因）。
 *
 * 实锤：第 1 片两次请求只差「追加拒因 + 温度 0.65→0.60」，结果 35 镜→15 镜，
 * 其中 12 条描述逐字相同、铺满 289 秒（90.6%）。模型对拒因的「修正」方式
 * 就是砍条数 + 通用词填充——**拒因本身在诱导降密度**。
 *
 * 剔除两类：
 * · 音轨全家族——0829 用户明令「音轨有几段写几段，安静段落 1 段是正常的，
 *   禁止凑数编造」。把它写进拒因等于当面逼模型编声音事件，与明令直接冲突。
 * · long_take_count——它的 detailZh 自带「仅提示不拒收」，模型却照单全改。
 *   真正必须拆的超长镜由硬拒收 shot_evidence_too_long 独立发出，不靠这条。
 *
 * 这些条目**仍照常记账、仍参与重试决策**，只是不作为「要模型改什么」的指示发出去。
 */
/**
 * 不外发给模型的拒因。**只收「模型照做只会更差」的密度类**，不是整个音轨家族。
 *
 * 0831 审查纠正：初版把 audio_* 全拉黑了，过宽。逐条看发出点就知道差别——
 * · audio_unexpected：素材无音轨却返回了 audioResolution ＝ **模型凭画面编造声音**。
 *   这是唯一能当场制止幻觉的那句话，滤掉它与用户「禁止凭画面编造声音」正好反向。
 * · audio_chunk_shape / audio_schema_invalid / audio_field_missing：纯格式错，
 *   零密度诱导，模型改了就对，必须发。
 * 留在这里的三条才是真·不可执行：两条音轨密度地板（发了就是逼模型凑数编造），
 * 以及自己就写着「仅提示不拒收」的 long_take_count。
 */
/**
 * 首发提示词里的「真实性四条」。0831 首跑实测后新增。
 *
 * 为什么必须放进**首发**而不只是重试：那次是首发就偷懒、一次过、没触发重试，
 * 所以原先只写在重试拒因里的四条反偷懒禁令根本没机会生效——
 * 等于修好了重试路径，却放着首发不管。
 *
 * 实测形态：319 秒的一段，前 160 秒给了 48 镜（真实剪辑点、秒位不规则），
 * 后 159 秒只给 18 镜，其中 12 镜是三条描述严格 10 秒等分循环四遍。
 * 同时段字幕有 44 条、内容是热闹的对话戏（「让他在修仙界开铸剑坊」），
 * 而镜头写的是「少主在魔界发号施令」——听到了、转写了，就是不肯写镜头，改用模板顶替。
 *
 * ⚠️ 这四条是**真实性**要求，不是密度下限。用户 0830 明令「上限设好就别管下限」，
 * 0831 用户令删除全部免责条款：素材是高清画面，「看不清」不成立；
 * 必填字段不得再给「没有就输出空」的后门——那些都是模型偷懒时可引用的依据。
 * 上一句「密度属于建议项，不作为拒收依据」若不配这四条，等于发给模型一张偷懒许可证。
 */
/**
 * 密度正向引导（0831 重构后新增）。与禁止区分开：这里只说**该做什么**。
 * 替代了原先那句自相矛盾的「镜头密度属于建议项，不作为拒收依据」——
 * 一句免责写在「必须遵守」下面，模型当然选它，实测首发 100% 躺平。
 * 门禁那边已有 advisory 在管密度，提示词不替门禁做免责声明。
 */
export const NATIVE_DEEP_READ_DENSITY_GUIDE_BLOCK =
  `逐镜回看本段，镜头条数与时长由实际画面切换和镜内变化决定。
本段最后三分之一与开头同等重要，用同样的观察密度处理。`;

/** 单条镜头证据的生成上限；在构造禁止区之前初始化，避免模块加载时访问未初始化常量。 */
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC = 30;

/**
 * 统一禁止区（0831 重构）。
 *
 * 用户点破的结构性问题：正面要求区里混了禁止项，禁止项里又夹着「必须做」，
 * 前提已经禁止又要求模型做，自相矛盾。更糟的是第 4 条曾同时写着
 * 「镜头密度属于建议项，不作为拒收依据」和「平均镜长偏大就是你漏记了，回去补」——
 * 一句免责、一句要求，模型当然选免责那句，于是首发 100% 躺平（9-10 镜、
 * 输出只用上限的 5.6%）。用户此前就警告过「硬限制不能太多，否则模型会直接躺平罢工」。
 *
 * 重构原则：
 *   · 正面区（1-5 条）只讲**该做什么**，不出现任何「禁止/不得/不要」
 *   · 本区只讲**不许做什么**，不夹带任何要求
 *   · 删掉一切免责声明——门禁那边已有 advisory 在管，提示词不替门禁做免责
 */
export const NATIVE_DEEP_READ_PROHIBITION_BLOCK = `
【不得出现】

以下集中列出禁止事项。

判定产出无效：
· 将 MM:SS 或 HH:MM:SS 去掉冒号后直接当作累计秒，跳过分钟×60或小时×3600换算；例如把文件内 05:13 的本段累计秒误写为 513。
· 同一段描述套用到不同时间段；两条镜头的画面描述逐字相同。
· 用等长等距的时间切分代替真实剪辑点，包括整段按固定步长切、以及只在后段这样做。
· 镜头内容与该时段实际画面不符；该时段有台词时写与台词情境无关的场面。
· 用其他段落的描述顶替本该逐镜观察的内容。
· 将补充信息中的场景、道具或动作直接当成当前镜头的可见事实。
· 为填写hintZh而补猜未入画或无法辨认的环境、道具，或把上一镜的观察直接套到下一镜。

不得为之：
· 逐字转写全片对白；落在 keyMoments 邻域之外的台词一概不收。
· 为了多写字幕而压缩镜头条数或缩短镜头描述。
· 为凑镜数而等距拆段、虚构变化或改写真实镜头内容。
· 将普通切镜、普通打光或持续背景音乐本身当作精华；为前中后覆盖或类别齐全凑 keyMoments。
· 按剧情顺序猜测 keyMoments 秒位、用附近另一秒的画面顶替，或将尚未核实的人物、地点、动作写进说明。
· 为凑够音轨段数或声音事件数而编造不存在的声音。
· 凭画面推测声音。
· 长镜拆分时不得截断原镜头尾部。
· 不得为了打破等长而改动真实剪辑点或虚构镜内变化。
· 总结中不得引入镜头表里没有的内容。
· non_story_ad 的 hintZh 除null空占位外不得写入内容；除 startSec、endSec、evidenceRole 外，其他描述及衍生内容严禁写入。
· 单条 shots 记录的 endSec − startSec 超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒。
· 把同一长镜的证据段边界伪报为真实剪辑切换。`;


export const NATIVE_DEEP_READ_NON_ACTIONABLE_RETRY_CODES: ReadonlySet<string> = new Set([
  "audio_track_thin", "audio_cue_thin", "long_take_count",
]);

/** 单项命中也必须重试；这些错误会让下游整集规范化必然失败，不能只记 advisory。 */
export const NATIVE_DEEP_READ_REQUIRED_RETRY_CODES: ReadonlySet<string> = new Set([
  "audio_timeline_invalid",
]);

/** 门禁未过的降温重试间隔（进契约 SHA 与请求指纹，非用户明令不得改）。 */
export const NATIVE_DEEP_READ_RETRY_INTERVAL_MS = 60_000;
/**
 * 503/429/RESOURCE_EXHAUSTED（视频服务器繁忙）专用退避：不降温、原档补发。
 * 0904 用户令：**隔 30 秒重试 4 次**（原为 60 秒 3 次）。
 * 单开一条常量而不改 RETRY_INTERVAL_MS，是为了不动契约 SHA 与段缓存指纹——
 * 那条一改，已买断的分片缓存会全部失配、重复付费。
 */
export const NATIVE_DEEP_READ_RESOURCE_RETRY_INTERVAL_MS = 30_000;
export const NATIVE_DEEP_READ_RESOURCE_RETRY_MAX = 4;
export const NATIVE_DEEP_READ_TEMPERATURE_MIN = 0.6;

/** 第二次尝试参数；保留导出供既有调用方与缓存指纹使用。 */
export const NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG = deepFreezeNativeContract({
  ...NATIVE_DEEP_READ_GENERATION_CONFIG,
  temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[1],
} as const);

/** 第三次（末次）尝试参数：收口到温度下限。 */
export const NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG = deepFreezeNativeContract({
  ...NATIVE_DEEP_READ_GENERATION_CONFIG,
  temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[NATIVE_DEEP_READ_RETRY_TEMPERATURES.length - 1],
} as const);

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
  /** 调用方提供的可选段落定位信息；仅辅助观察，不代替当前镜头的画面证据。 */
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
  /** 整集GLM请求、每档原始响应与消费前解析JSON的永久取证回执。 */
  glmEvidence?: NativeDeepReadGlmEvidence;
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
  /** 本集所有分片共用的采样率；不按时长或尾片自动降档。 */
  videoFps?: number;
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

/** 选段诊断只交付原索引段证据，不能作为整集结果或产品验收回执。 */
export type NativeDeepReadSelectedSegmentsResult = {
  mode: "gemini_selected";
  assemblyComplete: false;
  glmStatus: "not_run";
  productAcceptance: "not_run";
  sourceDigest: string;
  sourceDurationSec: number;
  totalSegmentCount: number;
  selectedSegmentIndexes: number[];
  episodeIndex: number;
  batchRequestId: string;
  model: string;
  segments: Array<SegmentAttemptResult & {
    segmentIndex: number;
    startSec: number;
    endSec: number;
    hasAudio: boolean;
    requestFingerprint: string;
    rawAttemptEvidenceObjectName: string;
    /** 本片全部已回执尝试的用量；外层单次字段保留最后接受尝试的原值。 */
    paidUsage: { inputTokens: number; outputTokens: number; audioInputTokens: number; reasoningTokens: number; costCny: number };
  }>;
  usage: { inputTokens: number; outputTokens: number; costCny: number };
  rawAttemptEvidenceObjectNames: string[];
};

export type NativeDeepReadSelectedSegmentsParams = {
  seriesKey: string;
  episodeIndex?: number;
  sourceDigest: string;
  /** 保持完整原集计划；不得裁成选片长度或把原索引重新编号。 */
  segments: readonly NativeDeepReadSegmentSpec[];
  sourceDurationSec: number;
  videoFps?: number;
  hintZh?: string;
  selectedSegmentIndexes: readonly number[];
  /** 仅包含已验证的选中片；诊断入口不接受片源解析函数。 */
  preparedVideos: readonly PreparedNativeVideo[];
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>;
  segmentModelConcurrency?: number;
};

export type NativeDeepReadVisualModelReceipt = ManhuaNativeModelReceipt & {
  stage: "visual_model" | "visual_parse";
  batchRequestId: string;
  videoCount: number;
  /** 0829 段门禁转建议：该段命中的 advisory code 清单（不阻断入库）。 */
  advisoryCodes?: string[];
  /** 同上，人读文案；面板据此显示「本段仅 28 镜 / 覆盖缺 50 秒」。 */
  advisoriesZh?: string;
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
 * 精确切片与独立采样配置改变请求语义；旧流复制切片的缓存与确认码不得复用。
 * 本版验证首发0.65与历史两次重试温度，保留既有时间解释；实测过关前不宣称冻结。
 */
export const NATIVE_DEEP_READ_VISUAL_PLAN_VERSION = "time-custom-20260905-key-shot-tiers-v3" as const;

/** 分片时长和采样率独立配置；默认值来自共享配置，不按长短片自动降档。 */
export function resolveNativeDeepReadRequestFps(totalDurationSec: number, requestedFps?: number): number {
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    throw new Error("原生精读采样时长必须为有限正数");
  }
  return parseNativeDeepReadVideoFps(requestedFps);
}
/** 官方视频输入 fps 上限。 */
/** 0831 用户裁决：保持官方上限 24，不回退到 v11 的 10。实际采样率由 CLI/面板传入。 */
export const NATIVE_DEEP_READ_MAX_FPS = NATIVE_DEEP_READ_MAX_VIDEO_FPS;
/** 旧自适应探针保留原来的 10fps 上限，不让官方上限换名悄悄改变旧算法。 */
const NATIVE_DEEP_READ_LEGACY_MAX_FPS = 10;

/** 仅供旧 Fly 探针脚本引用的自适应采样函数；生产不使用此旧算法。 */
export function resolveNativeDeepReadInputFps(durationSec: number): number {
  const duration = Math.max(1, Number(durationSec) || 1);
  const raw = Math.min(NATIVE_DEEP_READ_LEGACY_MAX_FPS, NATIVE_DEEP_READ_TARGET_FRAMES / duration);
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
/**
 * 离谱地板（0829 用户拍板）：镜数门禁不全取消，按段长分级——
 * 段长 ≤120 秒全收（只记 advisory）；>120 秒仍保留 ceil(段长/10) 的底线标记＋重试。
 * 依据：现行 ceil(/6)=50 对 300 秒段的诚实产出太严；0826 实测模型躺平是 28 镜/300 秒，
 * 30 这条线卡在躺平之上、诚实之下。音轨侧不设任何门禁线（安静段落只有 1 段是真实的）。
 */
export const NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC = 10;
/**
 * 0831 删除 NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC（原值 300）。
 * 它的唯一用途是「够长才套镜数门禁」，而 0830 用户令「我都设好上限了，
 * 不要管下限了」已把镜数门禁整条删除，此后零消费者，只剩一句
 * expect(...).toBe(300) 的测试在守一个没人读的数字。
 * 另注：分片长度现在由面板/CLI 传入（生产默认 319 秒，非 300），
 * 留着这个 300 反而会误导后人以为整片长度还是硬编码的。
 */
export const NATIVE_DEEP_READ_SANITY_FLOOR_MIN_SEGMENT_SEC = 120;
/** @deprecated 0830 用户令删除：6 秒是漫剧节奏，跨体裁误报。保留常量仅供历史卡比对。 */
export const NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC = 6;
/**
 * 单镜上限的判断修订（实测依据 0823：95 镜均 2.76s，对白戏最慢 3.47s；
 * 但标题卡/长定场 16–20s 真实存在）：>15s 至多允许 1 个真实长镜。
 * 同一物理长镜超过 30s 时不得截断或伪造切镜，而要按镜内真实变化拆成连续证据段。
 */
export const NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC = 15;
// 25 秒是质量提示线，不应因真实长镜只多 1 秒就重烧整段；30 秒才标记并重试。
/**
 * 🔒 单条证据段硬上限（用户多次实测拍板，不得放宽为 advisory）：
 * 不加这条硬约束，模型会把 140–300 秒整段当成「一个长镜」交差——那不是长镜，
 * 是躺平的另一种形态。0829 曾试图改成「无变化可照实记一条」，用户当场否决：
 * 「不行，超过三十秒必须要拆」「这个不加模型会一次跑 140-300 秒这样的长镜」「我都试过了」。
 * 提示词硬约束 1 与本门禁必须同时保持硬性，任何 agent 不得单方面放宽。
 */
/**
 * 生成前安排观察与边界；返回后的算术验收由代码执行。
 * 这些文字是生成指引，不代表模型能回退修改已经输出的JSON，也不保证内容正确。
 */
export function buildNativeDeepReadObservationPlanBlock(lenSec: number): string {
  return `
【观察与输出顺序】

1. 通览本段 ${Math.round(lenSec)} 秒画面，定位每次真实剪辑切换及镜内变化，规划连续覆盖整段的时间边界。
2. 按硬约束 2 先确定每条记录的起止秒位，再输出该条字段；每完成一条，沿已观察到的时间轴继续下一条。
3. ${buildNativeDeepReadDensityContract(lenSec)}
4. 写入每条 keyMoment 前，先定位 atSec 的原帧，观察人物、地点、动作及可见字幕，再据此填写 noteZh；音轨类同时听取该秒声音。`;
}





/**
 * 单片镜头数**观察线**（不是硬上限，也不进提示词）。
 *
 * 🔴 0830 晚订正：它一度被写进提示词当硬上限，与「如实记录全部证据」直接冲突——
 * 真有 80 镜时模型只剩漏记、合并、超限三条路，每条都违反红线。
 *
 * 68 这个数当初按 800 token/镜 保守推算，而 v28 实测只有 221–468 token/镜，估高了约 70%。
 * 按最坏实测重算：80 镜 × 468 + 最高实测思考 24,674 = 62,114 / 65,536，**并不会撞顶**。
 * 故降级为代码侧观察指标：超过它只记 advisory 供监控，绝不据此要求模型压缩真实镜头。
 */
export const NATIVE_DEEP_READ_SHOT_COUNT_WATCH_PER_SEGMENT = 68;
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE = 1;
/** 同一物理长镜超过 30 秒时，后续证据段必须用此固定标记，避免把证据拆分谎报成真实切镜。 */
export const NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH = "同一长镜证据拆分（非切镜）";
/** 仅同一物理长镜的证据拆分段至少3秒；真实剪辑镜头可以更短。 */
export const NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC = 3;
/**
 * 🔒 单次合并的总跨度硬上限（0830 用户拍板 59 秒）。
 * 59 = 两段各 30 秒、中间相隔 1 秒的上限形态：跨度超过 30 秒就必须表达成两段。
 * ⚠️ 这条管的是「一次合并能跨多远」，与单条证据 30 秒硬上限是两把不同的尺子，别合并。
 */
export const NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC = 60;
/**
 * 🔒 整集镜头留存率地板（0830 事故后立，纯算术闸）。
 *
 * 定在 0.5 的依据：段边界重复是**真实存在**的去重来源（8 份段卡覆盖 6 个分片，
 * 边界处同一镜头会被记两次），所以留存率天然不可能是 100%。
 * 0830 实测两个参照点——Qwen 332/426 = 78%（正常），GLM 99/426 = 23%（压碎）。
 * 0.5 卡在两者中间，既放过正常去重，也拦得住压碎。
 * ⚠️ 这是**下限不是目标**：不要为了抬高这个数去阻止合法去重。
 */
export const NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_FLOOR = 0.5;
/** 历史覆盖地板，仅保留导出兼容；当前独立重试线见 SEGMENT_COVERAGE_RETRY_RATIO。 */
export const NATIVE_DEEP_READ_SEGMENT_COVERAGE_FLOOR_RATIO = 0.5;
/**
 * 🔒 门禁容差（0830 用户拍板）：**任一数值门禁参数在 10% 误差之内，一律通过、不再重试。**
 *
 * 立这条的账：重试不是免费的——每重试一片就要**重付一整片视频输入**。
 * 为了「30.4 秒 vs 30 秒」这种擦边去重买一整片，换回来的产出并不更对。
 * 只对**数值**门禁生效；字段齐全 / 五维五键 / zod 这类二值判定没有 10% 可言，不受影响。
 */
/** 0831 用户当面确认保留 10% 容差（实际拒收线 33 秒），不回退到 v11 的零容差。 */
export const NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO = 0.10;
/**
 * 单镜拒收线 = 硬上限 × (1 + 10% 容差) = 33 秒（0830 晚用户拍板）。
 * 🔴 软上限整条删除：用户原话「軟上限就是有偷懒的空間」——
 * 40–60 秒的镜头此前既不触发 advisory 也不拒收，模型自然往粗里切。
 * v28 实证：上限放到 60 后，六片镜头数在 18–72 之间摆动 4 倍，三片命中 long_take_count。
 */
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC =
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC * (1 + NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO);
/**
 * 整集镜头留存率**实际拒收线** = 0.5 × 0.9 = 0.45（0830 用户令「容错率改为上下百分之十」：
 * 每条数值门禁按方向各让 10%——上限 +10%，下限 −10%）。此前这条漏了容差。
 */
export const NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_REJECT =
  NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_FLOOR * (1 - NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO);
/** 历史覆盖拒收线，仅保留导出兼容；不再参与当前段级决策。 */
export const NATIVE_DEEP_READ_SEGMENT_COVERAGE_REJECT_RATIO =
  NATIVE_DEEP_READ_SEGMENT_COVERAGE_FLOOR_RATIO * (1 - NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO);
/** 微尾段豁免：计划切段真实存在 9s 尾段（如 1080–1089），诚实的单镜结尾不该必拒 */
export const NATIVE_DEEP_READ_SHOT_MICRO_SEGMENT_SEC = 12;
/** 音轨段数地板：≥ max(1, ceil(段时长/60))；0829 起只用于生成 advisory，不影响入库。 */
/**
 * 音轨段数硬下限＝1（审查 P0-1 订正）：曾设 3 想防偷懒，但间隔公式在长段本就 ≥3，
 * 「3」只会咬短段/微尾段——提示词目标低于门禁，模型照实输出必被拒收、白买重试。
 * 反偷懒完全由 ceil(段长/间隔) 承担，硬下限只兜「至少 1 段」。
 *
 * 0829 拍板补充：**环境音也算一段**。一个安静段落只返回 1 段音轨、0 条 cue 是
 * 合法产出，不是偷懒——所以基于时长的地板 ceil(len/60) 与 cue 地板 ceil(len/24)
 * 一律降级为 advisory（记「音轨仅 N 段」给人看），绝不作为重买条件。
 */
/** 0831 用户裁决：保持 2（0830 晚拍板的固定地板），不回退到 v11 的 1。 */
export const NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN = 2;
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
    /**
     * 🔴 0830 晚用户拍板：「音軌地板最少兩段」——由 `ceil(段长/60)` 改为**固定 2 段**。
     *
     * 旧式 300 秒段要 5 段，与提示词自相矛盾：提示词明写「安静段落只有 1 段是正常的，
     * 禁止为凑数编造」，门禁却拿 1 段推重买——重跑后模型仍会诚实回 1 段，
     * 第二发同样触发，钱花两遍结果一模一样。漫剧实测 6 片有 4 片栽在这条。
     * 固定 2 段：既拦得住「整段没听」，又不逼模型为安静段编造。
     */
    minAudioTracks: NATIVE_DEEP_READ_AUDIO_TRACK_FLOOR_MIN,
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
  videoFps?: number;
  hintZh?: string;
  rejectedReasonZh?: string;
}): string {
  const lenSec = Math.max(1, Math.round(input.endSec - input.startSec));
  const videoFps = resolveNativeDeepReadRequestFps(lenSec, input.videoFps);
  const sampleIntervalSec = Number((1 / videoFps).toFixed(4));
  const exampleLocalSec = Math.min(69, lenSec - 1);
  const fileClock = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const minuteSecond = `${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    return minutes < 60 ? minuteSecond : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minuteSecond}`;
  };
  const hint = String(input.hintZh || "").trim();
  /**
   * 音轨条数沿用观察建议，保持真实声音优先；镜数与均长的现行拒收条件
   * 已在观察顺序及动态schema前置，两者分别处理，避免用声音条数逼出编造。
   */
  const audioHardRule = input.hasAudio
    ? `6. 音轨范围与时间基准
audioResolution 固定为 [{"chunkIndex":${input.segmentIndex},"analysis":{…}}]，内容由你**亲耳所听**产出。
audioTrack 与 cues 内时间用**本段局部秒**（0..${lenSec}），这是全 JSON 唯一的局部秒例外。`
    : `6. 音轨范围与时间基准
本段素材没有音轨，audioResolution 返回空数组 []。`;
  const base = `【必须遵守】

1. 时间坐标
所附视频文件只有本段 ${lenSec} 秒，文件 00:00 对应全片 ${Math.round(input.startSec)} 秒。先定位原帧，再将文件内 MM:SS 或 HH:MM:SS 换算为本段累计秒 t = 小时×3600 + 分钟×60 + 秒；全片秒位 = ${Math.round(input.startSec)} + t，音轨局部秒位 = t。例如文件 ${fileClock(exampleLocalSec)} 对应本段 ${exampleLocalSec} 秒、全片 ${Math.round(input.startSec) + exampleLocalSec} 秒；文件末尾 ${fileClock(lenSec)} 对应本段 ${lenSec} 秒、全片 ${Math.round(input.endSec)} 秒。
数字时间字段以累计秒为单位。格式换算示范：文件内 05:13 的本段累计秒 t = 5×60+13 = 313；对应全片绝对秒 = 本段起点 + 313，即 ${Math.round(input.startSec)} + 313 = ${Math.round(input.startSec) + 313}。此示范只说明换算方法，实际秒位范围仍按本段起止确定。
shots.startSec/endSec、keyMoments.atSec 使用全片绝对秒，可保留一位小数；subtitles.atSec 使用全片绝对整数秒。本段范围为 ${Math.round(input.startSec)} 至 ${Math.round(input.endSec)} 秒，shots 按时间排序，连续覆盖整段。
audioResolution 内的 fromSec/toSec、cues.atSec 使用本段局部整数秒，以本段起点为 0；chunkIndex 使用传入原值。
位置写入数字字段；中文描述里可以写动作持续时长，如「1.2 秒内推近」。

2. 镜头记录与生成前长镜拆分
真实剪辑切换的 unitTypeZh 写「剪辑镜头」。
**每条 shots 记录最长 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒。**在输出本条 JSON 对象之前，先确定 startSec 和 endSec，使 0 < endSec − startSec ≤ ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC}；然后填写本条画面内容。
真实剪辑镜头按实际起止秒位记录，短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒也完整保留；相邻镜头时长可以相同。
遇到持续超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒的同一真实长镜，先规划多个首尾相接的证据段，再逐条输出，完整覆盖原镜头。优先在实际构图、运镜、角色调度、动作、表演或光影变化处分段；持续静止或持续对话同样按上限续接，并如实记录该段保持的状态。
同一长镜的每个拆分证据段保持 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}—${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒；该下限仅适用于同一长镜的拆分证据段。
在输出前安排好尾段：不足 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒的余量与前段共同调整边界，使各段仍处于上述范围，原镜头首尾保持完整。
拆分后的 unitTypeZh 写「拆分镜证据段」；第二段及后续段的 transitionInZh 固定写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。

3. 统一适用范围
以下逐镜内容、抓帧、字幕、音轨与总结要求均适用于 story；其他类别按末尾的统一分类与字段规则处理。

4. 完整性与密度
如实记录全部可见、可听的证据。每次真实画面切换，包括机位、景别或场景切换，都记录为新的一镜。
${NATIVE_DEEP_READ_DENSITY_GUIDE_BLOCK}

${audioHardRule}

5. 输出格式
返回一个 JSON 对象，字段名、类型、枚举遵循 Schema；各类别的必填项遵循下列分类要求。各描述字段遵守下列字数上限；镜头条数由真实内容决定。

【任务与输入】

你是影视成片的导演手法分析师。重点分析拍法：镜头、构图、运镜、角色调度、动作、表演、灯光与声音，以及这些要素形成的节奏和情绪变化。
逐镜字段记录直接观察到的事实；总结字段根据这些证据提炼可复用手法。真人、动画及非人角色采用同一观察原则。

全片时长：${Math.round(input.episodeDurationSec)} 秒。
当前片段：第 ${Math.round(input.startSec)} 至 ${Math.round(input.endSec)} 秒。
分段序号：第 ${input.segmentIndex + 1}/${input.segmentCount} 段。
音轨段号：${input.segmentIndex}。${hint ? `\n补充信息：${hint}。\n补充信息用于辅助定位；本镜的环境、道具与动作以该时段原片可见证据为准。` : ""}

${buildNativeDeepReadObservationPlanBlock(lenSec)}

【正向要求一：逐镜分析 shots】

story 镜头分两档（0905 用户令，省 token）：
- **重点镜**：起止秒与任一 keyMoments.atSec 前后 ${NATIVE_DEEP_READ_KEY_SHOT_WINDOW_SEC} 秒有交集的镜头，按以下顺序完整填写 18 字段——先记录本镜时间与分类，再生成本镜观察 hintZh，随后依据本镜画面填写详细分析。
- **简写镜**：其余镜头只填 startSec、endSec、evidenceRole、hintZh（≤40字）、actionZh（≤40字），**其它字段一律省略不写**；唯一例外：长镜拆分的续段仍要写 transitionInZh 的规定续接标记。镜头切分、时间覆盖与数量要求两档相同，简写不是少记镜头，只是少写字段。
先定 keyMoments 再决定各镜档位；hintZh 是本次输出的逐镜观察，和调用前的补充信息各自独立。
- startSec / endSec：本镜实际起止秒位。单条最长 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒；真实短镜按实际时长保留，超过上限的长镜按硬约束 2 拆成每段 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}—${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒。
- evidenceRole：按统一分类规则填写。
- hintZh：${NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.hintZh}≤80字。
- unitTypeZh：剪辑镜头／拆分镜证据段。
- shotSizeZh：实际景别，如极特写、特写、近景、中景、全景、大远景，≤28字。
- angleZh：实际机位，如平视、仰拍、俯拍、过肩、主观，≤28字。
- compositionZh：${NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.compositionZh}≤80字。
- cameraMoveZh：运镜起点、方向、速度或节奏、幅度与落点；静止画面写「固定机位」，≤80字。
- blockingZh：角色站位、朝向、距离、进退路径、遮挡与群像调度变化，≤70字。
- bodyActionZh：整体姿态、躯体重心、移动方式、结构形变与动作阶段，≤70字。
- limbPropActionZh：${NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.limbPropActionZh}≤70字。
- microExpressionZh：面部或等效表情器官的可见细微变化，≤58字。
- gazeBreathZh：视线或感知指向、眨眼、呼吸及可见节律变化，≤58字。
- relationshipReactionZh：角色动作先后、彼此回应与距离变化，≤60字。
- lightingZh：主辅光位、色调、明暗关系、轮廓光与环境光变化，≤58字。
- actionZh：${NATIVE_DEEP_READ_SHOT_OBSERVATION_ZH.actionZh}≤60字。
- transitionInZh：进入本镜的实际转场方式；长镜续段使用规定标记，≤50字。

【正向要求二：关键抓帧 keyMoments】

${NATIVE_DEEP_READ_KEY_MOMENT_SELECTION_ZH}
下游按 atSec 抓取一张原片画面，优先取关键事件已经清晰呈现的代表帧。
五类选点依据（均以承载上述剧情重点或鲜明视听手法为前提）：
- 切镜：景别或机位发生突变后，画面清晰落定的代表帧，例如中景切到特写的瞬间。
- 情绪：微表情的峰值时刻，例如眉头锁紧、眼神变化最明确的那一秒。
- 灯光：氛围切换前后各一条，例如暖光转为面部阴影加深时，分别记录变化前后的代表帧。
- 剧情：推动因果的关键节点，例如字幕点明冲突、关键道具亮相。
- 音轨：声音事件发生秒，例如配乐转折、关键音效或声音分段切换。
逐一审阅本段前、中、后三个区间，按精华事件的实际分布选点；同一事件优先选最清楚的一帧，变化前后确有对照价值时可各选一帧，平淡区间可以留空。
每条包含：
- atSec：全片绝对秒，可保留一位小数（如 673.6）。输入按 ${videoFps}fps 抽帧，采样间隔约 ${sampleIntervalSec} 秒；取事件真正发生的那一帧的秒位。
- kindZh：切镜／情绪／灯光／剧情／音轨。
- noteZh：写清本帧可见的关键事件，以及它对冲突、反转、情绪或视听表达的作用，≤60字。

【正向要求三：关键时刻字幕 subtitles】

字幕只是关键时刻的旁证，镜头表才是本次的主产物。
仅收录 atSec 落在任一 keyMoment.atSec 前后 2 秒范围内的真实剧情字幕。
每条包含：
- atSec：字幕实际出现的全片绝对整数秒。
- textZh：画面中该条字幕的原文，逐字照抄。
命中几条记录几条。

【正向要求四：声音解析 audioResolution】

按照实际声音状态及其变化组织 audioTrack；音轨内容来自你亲耳所听。数组形状遵循传入的音轨条件和 Schema。
每段填写：
- fromSec、toSec：本段局部起止整数秒。
- emotionArcZh：可听见的情绪强弱变化，≤18字。
- toneZh：语气、语速与发声方式，≤14字。
- sfxZh：实际音效，≤18字。
- bgmZh：实际配乐特征，≤18字。
- atmosphereZh：可听见的环境与气氛，≤14字。
- silenceZh：停顿、静默与留白，≤14字。
- cues：实际发生的声音事件。
每条 cue 包含：
- atSec：事件发生的本段局部整数秒。
- kind：使用 Schema 提供的声音事件枚举。
- detailZh：事件描述，≤18字。
声音总结：
- audioBeatStructureZh：声音节奏的组织与变化。
- mixNotesZh：人声、配乐、音效的层次及强弱关系。
- reusableAudioZh：脱离具体剧情仍可复用的声音手法。
- genAudioHintZh：复现这些声音效果所需的生成要素。


【正向要求五：节奏、情绪与手法总结】

根据上面已写入的逐镜证据提炼总结。

- beatStructureZh：概括实际节奏，如「铺垫→蓄势→转折→收束」，≤90字。
- moodArcZh：依据表演与声画变化描述「起点→变化→终点」，≤70字。
- reusableZh：提炼可脱离角色、剧名与具体情节复用的通用做法。
- genPromptHintZh：提炼构图、运镜、调度、表演、光影等生成要素。
classification 完整输出五个数组：
- emotionTagsZh：情绪特征。
- narrativeFeatureTagsZh：叙事特征。
- performanceTagsZh：表演特征。
- audiovisualTagsZh：视听特征。
- audienceExperienceTagsZh：观众体验特征。
标签来自本段真实证据，覆盖至少两个维度。

【统一分类与字段规则】

shots 条目按 evidenceRole 区分两种结构：
1. story —— 推动剧情因果的镜头。使用完整18字段结构，hintZh填写非空观察；看不清时明确可见范围及无法辨认的部分。
2. non_story_ad —— 与剧情无关的商业广告。仅保留 startSec、endSec、evidenceRole 三个有内容的字段，用于保存时间轴与分类标记；hintZh固定填null，作为统一Schema的必填空占位。
`;
  const retryRequirements = input.rejectedReasonZh
    ? `${base}
【上一轮未通过的检查】${nativeDeepReadRetryReasonForPrompt(input.rejectedReasonZh).slice(0, 300)}

本轮重做要求（0831 实测加固：上一轮模型把「修正」做成了砍条数＋通用词填充，35 条降到 15 条、12 条描述逐字相同）：
1. 只修正上面点名的问题，其余一律照常完整观察。
2. 证据段过长时的唯一正确做法是**按前文长镜拆分规则拆成多条**（每段 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}—${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，
   后续段 transitionInZh 写固定标记）。
3. 每条证据的画面描述必须来自你在该时间段真实看到的内容。${
  // 无音轨片保持空数组契约；声音观察要求仅用于有音轨片。
  input.hasAudio
    ? `
4. 声音部分按实际听到的写，安静段落本来就少。`
    : ""}`
    : base;
  const retryProhibitions = input.rejectedReasonZh
    ? `

重试禁止事项：
· 镜头表条数只增不减。
· 修正过长证据段时，不得删掉、不得合并、不得拉长单条覆盖。
· 禁止用「剧情推进」「人物交替出现」「交谈与动作」「表情自然」这类通用词填充字段；各条不得雷同。${input.hasAudio
    ? `
· 不要为了"补足"而增加不存在的声音事件。`
    : ""}`
    : "";
  // 首发与重试共用一个禁止区；重试新增禁令也留在此区，避免再次混入正向要求。
  return `${retryRequirements}\n${NATIVE_DEEP_READ_PROHIBITION_BLOCK}${retryProhibitions}`;
}

/** 同一段的可信输入由生产者传递，既用于生成请求，也用于探针独立校验。 */
export type NativeDeepReadSegmentContext = {
  startSec: number;
  endSec: number;
  segmentIndex: number;
  hasAudio: boolean;
};

export const NATIVE_DEEP_READ_KEY_MOMENT_SELECTION_ZH = "keyMoments 是剧情精华与有学习价值的视听瞬间的抓帧秒位表。优先选择冲突升级、反转、真相揭示、关键决定或动作结果、情绪峰值；切镜、灯光和声音只有对这些重点或鲜明导演手法有实质作用时才入选。每个点先回看该秒原帧，核实人物、地点、动作及可见字幕与说明相符；音轨类同时核实该秒真实声音。";

export function resolveNativeDeepReadDensityContract(lenSec: number) {
  const referenceShots = Math.ceil(Math.max(1, Math.round(lenSec)) / NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC);
  return {
    referenceShots,
    minStoryShots: Math.ceil(referenceShots * (1 - NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO)),
    maxAverageSec: NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC * (1 + NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO),
  };
}

function buildNativeDeepReadDensityContract(lenSec: number): string {
  const rule = resolveNativeDeepReadDensityContract(lenSec);
  return `本段镜数参考线为 ${rule.referenceShots} 条；存在剧情镜时 story 至少 ${rule.minStoryShots} 条，广告另计。剧情镜平均时长（剧情镜时长总和÷剧情镜数）上限为 ${rule.maxAverageSec} 秒；完整${Math.round(lenSec)}秒均为剧情时，至少需要 ${Math.ceil(lenSec / rule.maxAverageSec)} 条。镜数和平均时长用于提示可能漏记的内容，逐镜边界和描述以原片实际证据为准。每条 shots 记录的 endSec − startSec 上限固定为 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒；真实长镜按该上限提前规划连续证据段。完整输出覆盖整段时间轴。`;
}

/** 仅整理模型可见的长镜拒因；完整诊断、内部容差和重试决策原样保留。 */
function nativeDeepReadRetryReasonForPrompt(reason: string): string {
  return reason
    .replace(/超过\s*33\s*秒的镜头证据段（要求\s*30\s*秒\s*\+\s*10%\s*容差）/g,
      "超过30秒输出上限的镜头证据段")
    .replace(/镜头证据段超过\s*33\s*秒/g, "镜头证据段超过30秒输出上限")
    .replace("；这几条必须按镜内变化拆成连续证据段，禁止截断尾部",
      "；本次生成前按长镜拆分规则安排完整连续的证据段");
}

type NativeResponseSchemaNode = {
  [key: string]: unknown;
  type?: string;
  description?: string;
  maxLength?: number;
  properties?: Record<string, NativeResponseSchemaNode>;
  items?: NativeResponseSchemaNode;
};

/** 保留基础数组/对象结构，分片数值与分类要求写入描述；返回后的质量门禁不变。 */
export function buildNativeDeepReadResponseSchema(context: NativeDeepReadSegmentContext): Record<string, unknown> {
  if (!Number.isFinite(context.startSec) || !Number.isFinite(context.endSec)
    || context.startSec < 0 || context.endSec <= context.startSec
    || !Number.isSafeInteger(context.segmentIndex) || context.segmentIndex < 0
    || typeof context.hasAudio !== "boolean") throw new Error("生成schema缺少有效分片上下文");
  const schema = JSON.parse(JSON.stringify(NATIVE_DEEP_READ_RESPONSE_SCHEMA)) as NativeResponseSchemaNode;
  const props = schema.properties!;
  const lenSec = Math.max(1, Math.round(context.endSec - context.startSec));
  const absoluteRangeZh = `全片绝对秒，范围 ${Math.round(context.startSec)} 至 ${Math.round(context.endSec)} 秒`;
  const shot = props.shots!.items!;
  props.shots!.description = buildNativeDeepReadDensityContract(lenSec)
    + "story与non_story_ad分别按条目分类要求填写。";
  shot.description = `story条目分两档：重点镜（起止与任一 keyMoments.atSec 前后 ${NATIVE_DEEP_READ_KEY_SHOT_WINDOW_SEC} 秒有交集）按顺序完整填写以下18字段：${Object.keys(shot.properties!).join("、")}；其余简写镜只填 startSec、endSec、evidenceRole、hintZh、actionZh，其它字段省略。`
    + "先写本镜hintZh观察，再写详细分析。non_story_ad仅保留startSec、endSec、evidenceRole三个有内容的字段，hintZh固定为null空占位。";
  // 官方结构化输出支持propertyOrdering；仅约束逐镜生成顺序，与正文逐项顺序一致。
  shot.propertyOrdering = Object.keys(shot.properties!);
  shot.properties!.startSec = { type: "NUMBER", description: `${absoluteRangeZh}，填写实际起点，可保留一位小数。` };
  shot.properties!.endSec = { type: "NUMBER", description: `${absoluteRangeZh}，生成本条前确定终点，满足startSec < endSec ≤ startSec + ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC}，可保留一位小数；真实长镜按单条上限连续分段。` };
  props.keyMoments!.description = NATIVE_DEEP_READ_KEY_MOMENT_SELECTION_ZH;
  const firstFrameSec = Number((Math.ceil(context.startSec * 10) / 10).toFixed(1));
  const lastFrameSec = Number((Math.ceil(context.endSec * 10) / 10 - 0.1).toFixed(1));
  const hasFrameTime = firstFrameSec <= lastFrameSec;
  if (!hasFrameTime) props.keyMoments!.description += "本微尾段没有可表示的一位小数秒位，返回空数组 []。";
  props.keyMoments!.items!.properties!.atSec = { type: "NUMBER",
    description: hasFrameTime
      ? `先回看该秒原帧核实说明，再填写全片绝对秒，范围 ${firstFrameSec} 至 ${lastFrameSec} 秒，可保留一位小数。`
      : "本微尾段没有可表示的一位小数秒位，keyMoments返回空数组 []。" };
  props.keyMoments!.items!.properties!.noteZh!.description = "本帧可见的关键事件及其对冲突、反转、情绪或视听表达的作用。";
  props.subtitles!.items!.properties!.atSec = { type: "INTEGER", description: `${absoluteRangeZh}，使用整数。` };
  props.audioResolution!.description = context.hasAudio
    ? "本段有音轨，数组包含且仅包含1个分析对象，内容来自本段真实声音。"
    : "本段素材没有音轨，返回空数组 []。";
  props.audioResolution!.items!.properties!.chunkIndex = { type: "INTEGER", description: `固定填写当前原分片序号 ${context.segmentIndex}。` };
  const track = props.audioResolution!.items!.properties!.analysis!.properties!.audioTrack!.items!;
  for (const key of ["fromSec", "toSec"]) track.properties![key] = {
    type: "INTEGER", description: `本段局部整数秒，范围 0 至 ${lenSec} 秒，toSec大于fromSec。`,
  };
  track.properties!.cues!.items!.properties!.atSec = {
    type: "INTEGER", description: `本段局部整数秒，范围 0 至 ${lenSec} 秒，位于所属audioTrack时间区间内。`,
  };
  // 保留单一对象结构，仅逐镜声明生成顺序；字数继续使用描述，不添加分支或范围约束。
  const normalize = (node: NativeResponseSchemaNode): void => {
    if (node.maxLength !== undefined) {
      node.description = `${node.description || ""}≤${node.maxLength}字。`;
      delete node.maxLength;
    }
    if (node.properties) Object.values(node.properties).forEach(normalize);
    if (node.items) normalize(node.items);
  };
  normalize(schema);
  return schema;
}

/**
 * 冻结契约覆盖参数、基础/动态 Schema、首发与拒因 prompt。
 * 只把分片边界、fps、hint 当作样例输入；它们仍可由任务数据动态提供。
 */
export function nativeDeepReadFrozenContractSha256(): string {
  const animationContext = { startSec: 0, endSec: 319, segmentIndex: 0, hasAudio: true } as const;
  const liveContext = { startSec: 313, endSec: 626, segmentIndex: 1, hasAudio: false } as const;
  const promptInput = {
    episodeDurationSec: 1_594,
    startSec: animationContext.startSec,
    endSec: animationContext.endSec,
    segmentIndex: animationContext.segmentIndex,
    segmentCount: 5,
    hasAudio: animationContext.hasAudio,
    videoFps: 12,
    hintZh: "冻结契约样例：只作动态补充信息，不代替逐镜观察。",
  } as const;
  return crypto.createHash("sha256").update(JSON.stringify({
    // 0903 双模型拍板：冻结「允许的模型集合」而非单一模型；扩表需用户重新授权
    models: MANHUA_NATIVE_DEEP_READ_MODEL_OPTIONS,
    generationConfig: NATIVE_DEEP_READ_GENERATION_CONFIG,
    retryTemperatures: NATIVE_DEEP_READ_RETRY_TEMPERATURES,
    retryIntervalMs: NATIVE_DEEP_READ_RETRY_INTERVAL_MS,
    glmStructuringConfig: NATIVE_DEEP_READ_GLM_STRUCTURING_CONFIG,
    baseResponseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
    animationResponseSchema: buildNativeDeepReadResponseSchema(animationContext),
    liveResponseSchema: buildNativeDeepReadResponseSchema(liveContext),
    firstPrompt: buildGeminiNativeDeepReadSegmentPrompt(promptInput),
    retryPrompt: buildGeminiNativeDeepReadSegmentPrompt({
      ...promptInput,
      rejectedReasonZh: "第1段镜头时间轴覆盖不足，镜头证据段超过30秒输出上限",
    }),
  }), "utf8").digest("hex");
}

/** 修改冻结项必须由用户在当前任务重新授权；禁止只更新这个摘要让测试变绿。
 * 0903 更新授权：用户拍板读片双模型（3.1 Pro / 3.8 Flash 面板可选），冻结集合随之换代。
 * 0905 更新授权：用户解冻逐镜字段契约——18 字段只写重点镜（keyMoment ±6 秒），其余简写镜；
 * 改毕即**重新冻结**（`NATIVE_DEEP_READ_KEY_SHOT_WINDOW_SEC`、两档必填字段表、提示词两档说明与本摘要一起冻结，再改需用户授权）。
 * 同时整形 maxTokens 退回 131,072、链序 structuring_chain（用户 0905 拍板）。 */
/** 0905 用户重新授权：整形链改五档逐档 30 分钟切换 + maxTokens 262K，冻结集合随之换代（只作废整形批次缓存，不动读片分片缓存）。 */
export const NATIVE_DEEP_READ_FROZEN_CONTRACT_SHA256 = "f935285f528d48a50b948545a1c5ce7cd0986a184e3f5873c10837a7f09fb527" as const;

export function assertNativeDeepReadFrozenContract(): void {
  const actual = nativeDeepReadFrozenContractSha256();
  if (actual !== NATIVE_DEEP_READ_FROZEN_CONTRACT_SHA256) {
    throw new Error(`Gemini 3.1 Pro读片冻结契约漂移：${actual}`);
  }
}

/**
 * Google 原生 generateContent 请求体；Vertex 与 EvoLink 同构，只换端点与鉴权。
 * fileData 主线用 gs://（Vertex 服务账号可读），兜底用 GCS V4 签名 https。
 */
export function buildGeminiNativeDeepReadSegmentRequest(input: {
  fileUri: string;
  fps: number;
  prompt: string;
  segmentContext: NativeDeepReadSegmentContext;
  /** 只允许选择冻结梯度中的尝试序号；调用方不能覆盖 generationConfig。 */
  attemptIndex?: 0 | 1 | 2;
}): Record<string, unknown> {
  assertNativeDeepReadFrozenContract();
  const attemptIndex = input.attemptIndex ?? 0;
  if (!Number.isSafeInteger(attemptIndex)
    || attemptIndex < 0 || attemptIndex >= NATIVE_DEEP_READ_RETRY_TEMPERATURES.length) {
    throw new Error("原生精读只允许冻结的0.7/0.65/0.6三档尝试序号");
  }
  const generationConfig = {
    ...NATIVE_DEEP_READ_GENERATION_CONFIG,
    responseSchema: buildNativeDeepReadResponseSchema(input.segmentContext),
    temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[attemptIndex],
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
  _context?: NativeDeepReadSegmentContext,
  model: ManhuaNativeDeepReadModelId = MANHUA_NATIVE_DEEP_READ_MODEL,
): Promise<NativeDeepReadModelResponse> {
  const url = `${baseUrlForVertex(NATIVE_DEEP_READ_VERTEX_LOCATION)}/v1/projects/`
    + `${encodeURIComponent(getVertexProjectId())}/locations/${NATIVE_DEEP_READ_VERTEX_LOCATION}`
    + `/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
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
  _context?: NativeDeepReadSegmentContext,
  model: ManhuaNativeDeepReadModelId = MANHUA_NATIVE_DEEP_READ_MODEL,
): Promise<NativeDeepReadModelResponse> {
  const apiKey = String(process.env.EVOLINK_API_KEY || "").trim();
  if (!apiKey) throw new Error("EVOLINK_API_KEY 未配置，EvoLink 兜底不可用");
  const url = `${resolveNativeDeepReadEvolinkBaseUrl()}/v1beta/models/`
    + `${encodeURIComponent(model)}:generateContent`;
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
  // 清晰度以可用为准（0829 用户拍板）：540p 优先，取不到降 480p，再取不到用任意可用带音画档。
  const rank = (f: Record<string, unknown>): number => {
    const id = String(f.format_id || "");
    if (id.startsWith("bytevc1_540p")) return 0;
    if (id.startsWith("bytevc1_480p") || id.includes("480p")) return 1;
    const hasAv = String(f.vcodec || "none") !== "none" && String(f.acodec || "none") !== "none";
    return hasAv ? 2 : 9;
  };
  const candidates = formats
    .map((f) => ({
      url: String(f.url || ""),
      size: Number(f.filesize || f.filesize_approx || 0),
      tier: rank(f),
    }))
    .filter((f) => f.url && f.tier < 9)
    .sort((a, b) => a.tier - b.tier || (a.size || 9e15) - (b.size || 9e15));
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
  // 凭证不得进入子进程 argv（AGENTS.md 硬红线）：yt-dlp 一律匿名解析；
  // 需要登录态的来源由进程内 fetch 解析层（manhuaDouyinMediaResolve）承接。
  let best: { url: string; sizeMB: number } | null = null;
  try {
    const stdout = await run(
      "yt-dlp",
      ["-J", "--no-warnings", url],
      120_000,
      abortSignal,
    );
    const info = JSON.parse(stdout) as { formats?: Array<Record<string, unknown>> };
    best = pickSmallestVideoFormat(info.formats || []);
  } catch {
    best = null;
  }
  if (!best) {
    // 兜底：进程内解析（登录态只进本进程 fetch 请求头，绝不进子进程 argv）。
    const { resolveDouyinMediaUrl } = await import("./manhuaDouyinMediaResolve.js");
    const resolved = await resolveDouyinMediaUrl(url);
    best = { url: resolved.mediaUrl, sizeMB: 0 };
  }
  if (!best.url) throw new Error("未解析到可用的带音画媒体流");
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
/**
 * 单集媒体备料并发上限。
 * 跨集仍由 execution 串行，避免批量任务打满机器。
 * ⚠️ 这只是**上限**，实际并发仍被 /tmp 可用空间公式二次夹紧（切片会落地本地文件）。
 * 🔓 上限由调用方入参覆盖（用户令「上限应该是我来定的，不是写死的」）。
 */
// 0901 实锤降档：真人剧 9 段 ×10 路并发从小站 CDN（gzcrkt8888 链）拉流，
// 同 IP 并发长连接被连环 reset（End of file / Connection reset），第 9 段一分钟内即断。
// 抖音 CDN 扛得住 10 路，小站扛不住；4 路与上传并发同级，对两类源都安全。
export const NATIVE_DEEP_READ_MEDIA_PREP_MAX_CONCURRENCY = 4;
/**
 * 分片上传 GCS 的并发上限。曾经是**严格串行**（一个 for 循环），是全链最明显的串行点。
 * 改并发但保留上限：uploadBufferToGcs 会复制 Buffer，10 路并行在极端片源下可放大到 GB 级内存。
 * 实测依据：300 秒 540p 分片约 15–20MB（知识库 3.6MB/分钟），4 路 ≈ 160MB，安全。
 * 🔓 同样可由入参覆盖。
 */
export const NATIVE_DEEP_READ_MEDIA_UPLOAD_MAX_CONCURRENCY = 4;
/**
 * 单集模型调用并发上限。0901 拍板 5 片；**0904 用户令降到 4**，为的是压住 503：
 * Vertex 上 3.8 flash 无固定配额（动态共享池），5 路扇出会把自己挤成资源拥堵。
 * 调用方可调低，不能抬高生产上限。
 */
export const NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY = 4;

function mediaHeaders(node: NativeDeepReadMediaNode): string[] {
  const referer = String(node.referer || "").trim();
  return [
    "-user_agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    ...(referer ? ["-headers", `Referer: ${referer}\r\n`] : []),
  ];
}

/** 整片抓取超时：46–52 分钟 vod 以 CDN 限速顺序拉，30 分钟封顶。 */
export const NATIVE_DEEP_READ_SOURCE_FETCH_TIMEOUT_MS = 30 * 60_000;
/** 整片拉取进度播报间隔。 */
export const NATIVE_DEEP_READ_SOURCE_FETCH_PROGRESS_INTERVAL_MS = 20_000;
/** 整片落盘的空间估算：按 400KB/s（≈3.2Mbps vod 上限档）估，再叠 500MB 底线。 */
export const NATIVE_DEEP_READ_SOURCE_BYTES_PER_SEC_ESTIMATE = 400_000;

/**
 * 0901 定案：多段集不再逐段远程拉流——真人剧小站 CDN（gzcrkt8888 链）对同 IP
 * 并发长连接连环 reset，且不支持范围续传（-reconnect_streamed 断线后从 0 字节
 * 重读，把时间轴接歪，被「视频流起点不是本段零位」验收当场拦下）。
 * 改为整片一条顺序连接 -c copy 落 /tmp（m3u8 天然按小文件逐个请求，抗掐线），
 * 之后全部分段从本地文件切，切段永不再碰网络。
 */
export function buildNativeDeepReadSourceFetchArgs(input: {
  node: NativeDeepReadMediaNode;
  outputPath: string;
  /** 传入即让 ffmpeg 把 out_time 等进度键值追加写到该文件，供拉取进度按真实片长播报。 */
  progressPath?: string;
}): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y",
    ...(input.progressPath ? ["-progress", input.progressPath] : []),
    ...(/^https?:\/\//i.test(input.node.url) ? mediaHeaders(input.node) : []),
    "-i", input.node.url,
    "-map", "0:v:0", "-map", "0:a?",
    "-c", "copy", "-movflags", "+faststart", input.outputPath,
  ];
}

/**
 * 解析 ffmpeg `-progress` 文件里最后一次上报的已处理片长（秒）。
 * 新版写 out_time_us（微秒）、旧版写 out_time_ms（实际也是微秒）、另有 out_time=HH:MM:SS.micro；
 * 三者取最后出现的一个；无可用值返回 null（调用方回落到「只报已下 MB」）。
 */
export function parseFfmpegProgressOutTimeSec(text: string): number | null {
  let last: number | null = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^out_time_(?:us|ms)=(-?\d+)\s*$/.exec(line);
    if (m) {
      const value = Number(m[1]) / 1_000_000;
      if (Number.isFinite(value) && value >= 0) last = value;
      continue;
    }
    const clock = /^out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\s*$/.exec(line);
    if (clock) {
      const value = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
      if (Number.isFinite(value) && value >= 0) last = value;
    }
  }
  return last;
}

/** 秒 → mm:ss（≥1 小时用 h:mm:ss），给面板读。 */
export function formatClockSec(sec: number): string {
  const total = Number.isFinite(Number(sec)) ? Math.max(0, Math.floor(Number(sec))) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 输入端精确 seek 会解码并丢弃前关键帧到目标起点的内容；流复制做不到这一点。
 * 保留原分辨率、帧率及全部音轨，不缩放、不补帧；音画均重编码以免复制音轨保留前滚。
 */
export function buildNativeDeepReadVideoSegmentArgs(input: {
  node: NativeDeepReadMediaNode;
  startSec: number;
  durationSec: number;
  outputPath: string;
  /** 仅真实整集尾片读至 EOF，保留计划秒位四舍五入后的不足一秒尾部。 */
  toSourceEnd?: boolean;
}): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y",
    ...(/^https?:\/\//i.test(input.node.url) ? mediaHeaders(input.node) : []),
    "-ss", String(input.startSec), "-accurate_seek", "-i", input.node.url,
    ...(input.toSourceEnd ? [] : ["-t", String(input.durationSec)]),
    "-map", "0:v:0", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2",
    "-fps_mode", "passthrough", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", input.outputPath,
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
  /** 该分片通过本地时长与音轨验收后的事实。 */
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
  /** 段级重试退避；测试注入零等待，生产走真实计时器。 */
  sleepMs?: (ms: number) => Promise<void>;
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

/** 切片验收只接受实际 ffprobe 数据；探测失败不允许冒充无音轨。 */
export function assertNativeDeepReadPreparedMedia(
  probe: unknown,
  expected: { durationSec: number; isEpisodeTail: boolean },
): { hasAudio: boolean; durationSec: number } {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  const number = (value: unknown): number =>
    (typeof value === "number" || (typeof value === "string" && value.trim()))
      ? Number(value) : NaN;
  const data = record(probe);
  const streams = Array.isArray(data.streams) ? data.streams.map(record) : [];
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const fail = (detail: string): never => { throw new Error(`视频分片验收失败：${detail}`); };
  if (!Number.isFinite(expected.durationSec) || expected.durationSec <= 0) {
    fail("计划时长无效");
  }
  if (videos.length !== 1) fail("未取得唯一视频流");
  const video = videos[0]!;
  if (!(number(video.width) > 0) || !(number(video.height) > 0)) fail("视频分辨率无效");
  const [fpsNumerator, fpsDenominator] = String(video.avg_frame_rate || "").split("/").map(Number);
  const fps = fpsNumerator! / fpsDenominator!;
  if (!Number.isFinite(fps) || fps <= 0) fail("视频帧率无效");
  // 起点最多容许 0.1 秒，不因长片或尾片放宽；时长尾片另容许计划四舍五入的 0.5 秒。
  const frameTolerance = Math.min(0.1, Math.max(0.05, 1 / fps));
  const tailRoundingTolerance = expected.isEpisodeTail ? 0.5 : 0;
  const assertSpan = (stream: Record<string, unknown>, label: string, tolerance: number): number => {
    const start = number(stream.start_time);
    const duration = number(stream.duration);
    if (!Number.isFinite(start) || Math.abs(start) > 0.1 + 1e-6) {
      fail(`${label}起点不是本段零位`);
    }
    if (!Number.isFinite(duration) || duration <= 0
      || Math.abs(duration - expected.durationSec) > tolerance + tailRoundingTolerance + 1e-6) {
      fail(`${label}实际时长 ${Number.isFinite(duration) ? duration : "未知"} 秒与计划 ${expected.durationSec} 秒不符`);
    }
    return duration;
  };
  const durationSec = assertSpan(video, "视频流", frameTolerance);
  // AAC 编码帧会带来毫秒级尾差，不能拿容器的较长音轨掩盖视频截短。
  assertSpan(record(data.format), "容器", frameTolerance + 0.05);
  // 0905 实锤（花开锦绣第 6 集尾段 2107–2402 秒）：整集尾片读至 EOF 时，片源音轨常比最后一帧画面多出
  // 零点几秒到一两秒，属片源本身的尾差，不是切段截短；尾片放宽到 2 秒，中间段仍按 0.1 秒严卡。
  const audioTailOverrunTolerance = expected.isEpisodeTail ? 2 : 0;
  for (const audio of audios) {
    const start = number(audio.start_time);
    const duration = number(audio.duration);
    // 真实音轨允许晚起或早停；不把无声区当截短，也不填造静默音频。
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0
      || start + duration > durationSec + 0.1 + audioTailOverrunTolerance + 1e-6) {
      fail(`音轨时间范围无效或超出实际视频（音轨 ${Number.isFinite(start) ? start.toFixed(2) : "?"}+${Number.isFinite(duration) ? duration.toFixed(2) : "?"} 秒 · 视频 ${durationSec.toFixed(2)} 秒）`);
    }
  }
  return { hasAudio: audios.length > 0, durationSec };
}

async function probeLocalSegmentMedia(
  localPath: string,
  expected: { durationSec: number; isEpisodeTail: boolean },
  deps: NativeDeepReadMediaPreparationDeps,
  abortSignal?: AbortSignal,
): Promise<{ hasAudio: boolean; durationSec: number }> {
  const text = await deps.runMedia("ffprobe", [
    "-v", "error", "-show_entries",
    "format=start_time,duration:stream=codec_type,start_time,duration,width,height,avg_frame_rate",
    "-of", "json", "-i", localPath,
  ], 30_000, abortSignal);
  return assertNativeDeepReadPreparedMedia(JSON.parse(text), expected);
}

/**
 * 每集统一走 切段 → GCS 上传 → 用后删；Gemini 拉不了抖音 CDN 直链，
 * 不再保留「整集直读 CDN」路径。上传后立即删本地段文件。
 */
export async function prepareEpisodeVideos(
  episode: NativeDeepReadBatchRunEpisode,
  abortSignal?: AbortSignal,
  deps: NativeDeepReadMediaPreparationDeps = defaultMediaPreparationDeps,
  limits?: {
    cutConcurrency?: number;
    uploadConcurrency?: number;
    /** 媒体备料全程进度播报：整片拉取 / 落盘完成 / 切片 N/M / 上传 N/M（0905 用户令：面板不许十几分钟零进度）。 */
    onSourceFetchProgress?: (zh: string) => void | Promise<void>;
  },
): Promise<PreparedNativeVideo[]> {
  const segments = validateNativeDeepReadSegments(episode.segments);
  // 播报是旁路：写不进去不影响备料
  const reportMedia = async (zh: string) => {
    try {
      await limits?.onSourceFetchProgress?.(zh);
    } catch {
      /* ignore */
    }
  };
  let cutDone = 0;
  let uploadDone = 0;

  // 切段前先看 /tmp：磁盘打满时 ffmpeg 会切出半截片，宁可关闭式停止。
  // 0901 起整片先落盘再本地切，空间按时长估算叠加 500MB 底线一起验。
  const sourceBytesEstimate = Math.ceil(
    episode.sourceDurationSec * NATIVE_DEEP_READ_SOURCE_BYTES_PER_SEC_ESTIMATE,
  );
  const { freeBytes } = await deps.statfsTmp();
  if (freeBytes < NATIVE_DEEP_READ_MIN_TMP_FREE_BYTES + sourceBytesEstimate) {
    throw new Error(
      `/tmp 可用空间 ${(freeBytes / 1048576).toFixed(0)}MB 不足（整片约需 `
      + `${(sourceBytesEstimate / 1048576).toFixed(0)}MB + 500MB 底线），已停止切段`,
    );
  }

  // 整片一条顺序连接落盘：小站 CDN 扛不住并发长连接，也不支持范围续传；
  // 一次拉完后所有分段改从本地切，网络故障面从 9 段收敛到 1 次抓取。
  const sourceRunId = crypto.randomUUID();
  const localSourcePath = `/tmp/manhua-native-source-${sourceRunId}.mp4`;
  {
    let fetched = false;
    let lastFetchError: unknown;
    for (let attempt = 0; attempt < 3 && !fetched; attempt += 1) {
      abortSignal?.throwIfAborted();
      try {
        const nodes = await episode.resolveNodes();
        const node = nodes[attempt % Math.max(1, nodes.length)];
        if (!node?.url) throw new Error(`第${episode.episodeIndex}集未解析到媒体节点`);
        const fetchStartedAt = Date.now();
        const reportFetch = reportMedia;
        const totalSec = Math.max(1, episode.sourceDurationSec);
        await reportFetch(
          `第${episode.episodeIndex}集 · 整片拉取开始（节点 ${attempt + 1}/${Math.max(1, nodes.length)}，`
          + `片长 ${formatClockSec(totalSec)}）`,
        );
        // 0905 用户令「只显示真实值」：百分比按 ffmpeg -progress 报出的已读片长 / 真实总片长算，
        // 不再按码率估体积（估值偏大会让进度停在半路，用户以为卡死去掐任务）
        const progressPath = `${localSourcePath}.progress`;
        const fetchPromise = deps.runMedia(
          "ffmpeg",
          buildNativeDeepReadSourceFetchArgs({ node, outputPath: localSourcePath, progressPath }),
          NATIVE_DEEP_READ_SOURCE_FETCH_TIMEOUT_MS,
          abortSignal,
        );
        // 播报节拍走真实挂钟计时器（不走 deps.sleepMs：测试注入零等待会让这里空转）
        let fetchSettled = false;
        let wake: (() => void) | undefined;
        const ticker = (async () => {
          while (!fetchSettled) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, NATIVE_DEEP_READ_SOURCE_FETCH_PROGRESS_INTERVAL_MS);
              wake = () => {
                clearTimeout(timer);
                resolve();
              };
            });
            if (fetchSettled) break;
            const size = await deps.statLocal(localSourcePath).then((s) => s.size).catch(() => 0);
            let readSec: number | null = null;
            try {
              readSec = parseFfmpegProgressOutTimeSec((await deps.readLocal(progressPath)).toString("utf8"));
            } catch {
              readSec = null;
            }
            const elapsedSec = Math.max(1, Math.round((Date.now() - fetchStartedAt) / 1000));
            const speedZh = `${(size / 1048576 / elapsedSec).toFixed(1)}MB/s`;
            await reportFetch(
              readSec == null
                ? `第${episode.episodeIndex}集 · 整片拉取中 · 已下 ${(size / 1048576).toFixed(0)}MB · ${speedZh} · 已耗时 ${elapsedSec} 秒`
                : `第${episode.episodeIndex}集 · 整片拉取中 ${Math.min(99, Math.floor((readSec / totalSec) * 100))}%`
                  + `（已读到 ${formatClockSec(readSec)} / ${formatClockSec(totalSec)} · 已下 ${(size / 1048576).toFixed(0)}MB · ${speedZh} · 已耗时 ${elapsedSec} 秒）`,
            );
          }
        })();
        try {
          await fetchPromise;
        } finally {
          fetchSettled = true;
          wake?.();
          await ticker.catch(() => undefined);
          await deps.unlinkLocal(progressPath).catch(() => undefined);
        }
        const sourceStat = await deps.statLocal(localSourcePath);
        if (!Number.isFinite(sourceStat.size) || sourceStat.size <= 0) {
          throw new Error(`第${episode.episodeIndex}集整片落盘为空`);
        }
        // 时长验收：拉不全的片在这里就地拒绝，不让 9 段各自撞尾部缺失
        const probeText = await deps.runMedia("ffprobe", [
          "-v", "error", "-select_streams", "v:0",
          "-show_entries", "format=duration", "-of", "json", localSourcePath,
        ], 60_000, abortSignal);
        const probedSec = Number(JSON.parse(probeText)?.format?.duration);
        if (!Number.isFinite(probedSec) || probedSec < episode.sourceDurationSec - 2) {
          throw new Error(
            `第${episode.episodeIndex}集整片时长 ${probedSec ? probedSec.toFixed(1) : "未知"} 秒，`
            + `低于计划 ${episode.sourceDurationSec} 秒，判定拉取不完整`,
          );
        }
        await reportMedia(
          `第${episode.episodeIndex}集 · 整片落盘完成 100% · ${(sourceStat.size / 1048576).toFixed(0)}MB`
          + ` · 片长 ${formatClockSec(probedSec)} · 耗时 ${Math.round((Date.now() - fetchStartedAt) / 1000)} 秒`
          + ` · 开始本地切 ${segments.length} 段`,
        );
        fetched = true;
      } catch (error) {
        await deps.unlinkLocal(localSourcePath).catch(() => undefined);
        lastFetchError = error;
        if (abortSignal?.aborted) throw error;
        if (attempt < 2) {
          console.warn(`[nativeDeepRead] 第${episode.episodeIndex}集整片落盘失败，退避后重拉`);
          await (deps.sleepMs
            ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(
            8_000 * (attempt + 1),
          );
          abortSignal?.throwIfAborted();
        }
      }
    }
    if (!fetched) {
      throw lastFetchError instanceof Error ? lastFetchError : new Error("整片落盘失败");
    }
  }

  const prepared: Array<PreparedNativeVideo | undefined> = new Array(segments.length);
  const cutRows: Array<{
    runId: string;
    localPath: string;
    startSec: number;
    endSec: number;
    bytes: number;
    hasAudio: boolean;
  } | undefined> = new Array(segments.length);
  try {
    // 每片按时间精确切割，独立上传、独立调用；不按各片总体积降低清晰度。
    // 并发由调用方和磁盘空间共同限制；每个 worker 保留三次 CDN 节点刷新。
    const cutCap = Math.max(1, Math.floor(
      Number(limits?.cutConcurrency) || NATIVE_DEEP_READ_MEDIA_PREP_MAX_CONCURRENCY,
    ));
    const concurrency = Math.max(1, Math.min(
      cutCap,
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
      const isEpisodeTail = Math.abs(segment.endSec - episode.sourceDurationSec) < 0.001;
      let lastError: unknown;
      let completed = false;
      for (let attempt = 0; attempt < 3 && !completed; attempt += 1) {
        abortSignal?.throwIfAborted();
        const runId = crypto.randomUUID();
        const localPath = `/tmp/manhua-native-video-${runId}.mp4`;
        try {
          await deps.runMedia(
            "ffmpeg",
            buildNativeDeepReadVideoSegmentArgs({
              node: { url: localSourcePath },
              startSec: segment.startSec,
              durationSec: segment.endSec - segment.startSec,
              outputPath: localPath,
              toSourceEnd: isEpisodeTail,
            }),
            20 * 60_000,
            abortSignal,
          );
          const fileStat = await deps.statLocal(localPath);
          if (!Number.isFinite(fileStat.size) || fileStat.size <= 0) {
            throw new Error(`第${episode.episodeIndex}集第${index + 1}段大小不在处理范围`);
          }
          const media = await probeLocalSegmentMedia(localPath, {
            durationSec: segment.endSec - segment.startSec,
            isEpisodeTail,
          }, deps, abortSignal);
          cutRows[index] = {
            runId,
            localPath,
            startSec: segment.startSec,
            endSec: segment.endSec,
            bytes: fileStat.size,
            hasAudio: media.hasAudio,
          };
          completed = true;
          cutDone += 1;
          await reportMedia(
            `第${episode.episodeIndex}集 · 切片 ${cutDone}/${segments.length} 完成`
            + `（第 ${index + 1} 段 ${Math.round(segment.startSec)}–${Math.round(segment.endSec)} 秒 · ${(fileStat.size / 1048576).toFixed(0)}MB）`,
          );
        } catch (error) {
          await deps.unlinkLocal(localPath).catch(() => undefined);
          lastError = error;
          if (abortSignal?.aborted) throw error;
          if (attempt < 2) {
            console.warn(`[nativeDeepRead] 第${episode.episodeIndex}集第${index + 1}段本地切段失败，重试`);
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
    if (completeCutRows.some((row) => row.hasAudio !== completeCutRows[0]!.hasAudio)) {
      throw new Error(`第${episode.episodeIndex}集分片音轨存在性不一致，已停止上传`);
    }
    // 上传改并发（0829 晚用户令「改成并发，不是串行」）。
    // 旧实现是一个严格串行 for 循环——六片就是六次往返排队，是全链最明显的串行点。
    // 仍保留并发上限：uploadBufferToGcs 会复制 Buffer，无上限并发在极端片源下吃内存。
    const uploadCap = Math.max(1, Math.floor(
      Number(limits?.uploadConcurrency) || NATIVE_DEEP_READ_MEDIA_UPLOAD_MAX_CONCURRENCY,
    ));
    const uploadConcurrency = Math.max(1, Math.min(uploadCap, completeCutRows.length));
    let nextUploadIndex = 0;
    let uploadFailure: unknown;
    let stopUploading = false;
    const uploadOne = async (index: number): Promise<void> => {
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
        hasAudio: row.hasAudio,
      };
      uploadDone += 1;
      await reportMedia(
        `第${episode.episodeIndex}集 · 上传 ${uploadDone}/${completeCutRows.length} 完成`
        + (uploadDone === completeCutRows.length ? " · 备料齐全，开始逐段模型调用" : ""),
      );
    };
    const uploadWorkers = Array.from({ length: uploadConcurrency }, async () => {
      while (!stopUploading) {
        const index = nextUploadIndex;
        nextUploadIndex += 1;
        if (index >= completeCutRows.length) return;
        try {
          await uploadOne(index);
        } catch (error) {
          // 已在途的兄弟上传照样等回执（外层 catch 负责清理已传对象），
          // 但不再排新的，避免失败后继续往 GCS 堆垃圾。
          if (uploadFailure === undefined) uploadFailure = error;
          stopUploading = true;
          return;
        }
      }
    });
    await Promise.allSettled(uploadWorkers);
    if (uploadFailure !== undefined) throw uploadFailure;
    if (prepared.filter(Boolean).length !== completeCutRows.length) {
      throw new Error(`第${episode.episodeIndex}集分片上传结果不完整，已停止`);
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
    await Promise.allSettled([
      deps.unlinkLocal(localSourcePath),
      ...cutRows.flatMap((row) => row ? [deps.unlinkLocal(row.localPath)] : []),
    ]);
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

/**
 * 部分 OpenAI 兼容供应商会在 json_object 模式下把真正对象包成
 * { answer: "<JSON>" }。永久证据保留供应商原样；业务消费时只展开这一层，
 * 避免中间批次的 shots 在最终整形与来源门禁中变成空数组。
 */
export function unwrapNativeDeepReadStructuredAnswerEnvelope(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  let current = raw;
  for (let depth = 0; depth < 3 && !Array.isArray(current.shots); depth += 1) {
    const answer = current.answer;
    let nested: Record<string, unknown> | null = null;
    if (typeof answer === "string" && answer.trim()) {
      try {
        nested = parseJsonObject(answer);
      } catch {
        return current;
      }
    } else if (answer && typeof answer === "object" && !Array.isArray(answer)) {
      nested = answer as Record<string, unknown>;
    }
    if (!nested || nested === current) return current;
    current = nested;
  }
  return current;
}

/**
 * 截断 JSON 的可用前缀修复（0829：MAX_TOKENS 不再整段丢弃）。
 *
 * 实证：一集 6 段里两段是 MAX_TOKENS 截断但前半完全有效，旧口径直接判失败重买。
 * 做法：逐字符扫描（跳过字符串字面量内的括号），找到**最后一个在深度 ≥1 处闭合的
 * 数组/对象元素**，截到那里再按剩余括号栈补闭合符。截断处不会留尾逗号，因此补完即合法。
 * 修不出对象时抛与 parseJsonObject 同一句门禁文案，落回原重试。
 */
export function parseTruncatedJsonObject(text: string): Record<string, unknown> {
  try {
    return parseJsonObject(text);
  } catch {
    // 落到下面的前缀修复
  }
  const stack: string[] = [];
  let remainingAtLastSafe: string[] | undefined;
  let lastSafeIndex = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") { inString = true; continue; }
    if (ch === "{") { stack.push("}"); continue; }
    if (ch === "[") { stack.push("]"); continue; }
    if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length >= 1) {
        lastSafeIndex = index;
        remainingAtLastSafe = [...stack];
      }
      continue;
    }
  }
  if (lastSafeIndex >= 0 && remainingAtLastSafe) {
    const repaired = text.slice(0, lastSafeIndex + 1) + [...remainingAtLastSafe].reverse().join("");
    try {
      return parseJsonObject(repaired);
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

/**
 * `detailZh` 是**记账用**的完整原因（进日志、进最终失败记录）。
 * `modelReasonZh` 是**发给下一发提示词**的那份，已剔除不可执行项；
 * 传空串表示「本轮不附拒因，只换温度重掷」。不传＝两者相同。
 * 分开是因为早先只有一份文本：过滤后连最终失败原因都变成了假话。
 */
type NativeDeepReadGateError = Error & { modelReasonZh?: string };

function gateError(detailZh: string, modelReasonZh?: string): Error {
  const error: NativeDeepReadGateError = new Error(`${NATIVE_DEEP_READ_GATE_PREFIX}：${detailZh}`);
  if (modelReasonZh !== undefined) error.modelReasonZh = modelReasonZh;
  return error;
}

/** 必需证据缺陷不得被「硬门单项放行」吞掉；不要通过中文错误文案识别。 */
export class NativeDeepReadRequiredEvidenceError extends Error {
  constructor(
    readonly code: "coverage_below_90" | "shot_evidence_too_long" | "shot_observation_missing",
    detailZh: string,
  ) {
    super(`${NATIVE_DEEP_READ_GATE_PREFIX}：${detailZh}`);
    this.name = "NativeDeepReadRequiredEvidenceError";
  }
}

type NativeDeepReadSegmentGateInput = {
  episodeIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio: boolean;
  raw: Record<string, unknown>;
  truncated?: boolean;
  /** 新请求/当前缓存必填；旧JSON只读检查保持兼容。 */
  requireShotObservations?: boolean;
};

/** 首发、缓存、同源迁移共用完整判据，不另按 advisory 条数造第二把尺子。 */
export function evaluateNativeDeepReadSegmentAcceptance(input: NativeDeepReadSegmentGateInput) {
  if (input.requireShotObservations) assertNativeDeepReadShotObservations(input.raw);
  let gated: ReturnType<typeof assertNativeDeepReadSegmentDensity>;
  try {
    gated = assertNativeDeepReadSegmentDensity(input);
  } catch (error) {
    if (error instanceof NativeDeepReadRequiredEvidenceError
      || (error instanceof Error
        && (error.name === NATIVE_DEEP_READ_SCHEMA_ERROR_NAME || error.name === "ZodError"))) {
      throw error;
    }
    if (!isNativeDeepReadGateFailure(error)) throw error;
    gated = {
      raw: input.raw,
      advisories: [{
        code: "gate_passed_under_threshold",
        detailZh: (error instanceof Error ? error.message : String(error))
          .replace(`${NATIVE_DEEP_READ_GATE_PREFIX}：`, "").slice(0, 500),
        segmentIndex: input.segmentIndex,
      }],
    };
  }
  /**
   * 🔴 0831 实测修复：不可执行的 advisory **不得参与重试决策**。
   *
   * 此前只把它们从拒因文本里过滤掉（不发给模型），却仍让它们触发重试与最终失败——
   * 审查当时就点名这是「最差的一档」，我只做了一半。实弹代价：一发 ¥9.75，
   * 三次重试全部因为下面这句话被拒，而模型什么都没做错：
   *
   *   「第1段有 6 个超过 15 秒的真实长镜（最长 21 秒），**仅提示不拒收**；
   *     第1段音轨仅 1 段，低于建议地板 2；第1段声音事件仅 3 条，低于建议地板 14」
   *
   * 音轨真的只有 1 段（整片 0–319 秒连续），声音事件真的只有 3 条。
   * 拿建议地板拒收真实产出，直接违反用户 0829 两条明令：
   * 「音轨有几段写几段，禁止凑数编造」与「门禁转建议，不再拒收」。
   * 那条 long_take_count 更荒谬——它自己的文案就写着「仅提示不拒收」。
   *
   * 注意：这里只影响**重试决策**。gated.advisories 原样返回，
   * 记账、段卡、报告、GLM 提示词照旧看得到全部条目，不是把问题藏起来。
   */
  const countableFailures = input.truncated === true ? [] : gated.advisories.filter(
    (row) => !NATIVE_DEEP_READ_NON_ACTIONABLE_RETRY_CODES.has(row.code),
  );
  const families = Array.from(new Set(countableFailures.map((row) =>
    nativeDeepReadAdvisoryFamilyOf(row.code))));
  const failureCount = families.length;
  const twoItemOverDeviation = failureCount === 2 && countableFailures.some((row) =>
    NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES.has(row.code)
      && (row.deviationRatio ?? 0) > NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO);
  const coverageSoloRetry = countableFailures.some((row) =>
    NATIVE_DEEP_READ_COVERAGE_SOLO_RETRY_CODES.has(row.code)
      && (row.deviationRatio ?? 0) > NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO);
  const requiredValidationRetry = countableFailures.some((row) =>
    NATIVE_DEEP_READ_REQUIRED_RETRY_CODES.has(row.code));
  return {
    ...gated,
    families,
    failureCount,
    twoItemOverDeviation,
    coverageSoloRetry,
    requiredValidationRetry,
    retry: failureCount >= NATIVE_DEEP_READ_SEGMENT_RETRY_MIN_FAILURES
      || twoItemOverDeviation || coverageSoloRetry || requiredValidationRetry,
  };
}

/**
 * 三项线的**唯一判据**：这份段卡按当前标准能不能直接入库/复用缓存。
 *
 * 抽出来是因为审计必修③：入库口用三项线（1–2 项放行），缓存复验口却仍用
 * 「硬门抛不抛」——两把尺子会形成死循环：**放行入库 → 下次复验拒绝 → 整片重读
 * → 再放行**，每次运行按整片重复计费。两处必须问同一个函数。
 *
 * 判定与入库口逐条对齐：
 *   · 截断段豁免计数（重试仍会截断，纯烧钱）
 *   · 按同一套家族、偏差、覆盖与证据段上限复验
 *   · 其余硬门单独命中 = 1 项 → 可用；覆盖不足与超长证据段不豁免
 *   · schema / zod 失败 → 不可用（卡根本不能用，不是「不合标准」）
 *   · 非门禁错误（网络等）原样上抛，不吞
 */
export function nativeDeepReadSegmentMeetsThreeItemLine(input: NativeDeepReadSegmentGateInput): boolean {
  try {
    return !evaluateNativeDeepReadSegmentAcceptance(input).retry;
  } catch (error) {
    if (error instanceof Error
      && (error.name === NATIVE_DEEP_READ_SCHEMA_ERROR_NAME || error.name === "ZodError")) {
      return false;
    }
    if (!isNativeDeepReadGateFailure(error)) throw error;
    return false;
  }
}

/**
 * schema 解析失败（数据不可用）的关闭式失败标记。0829 起段门禁其余判定都转 advisory，
 * 只有这一类与「JSON 彻底解析不了」是真的没法用；且它不进温度梯度重试（重买解决不了）。
 */
export const NATIVE_DEEP_READ_SCHEMA_ERROR_NAME = "NativeDeepReadSchemaError";

function schemaGateError(detailZh: string): Error {
  const error = gateError(detailZh);
  error.name = NATIVE_DEEP_READ_SCHEMA_ERROR_NAME;
  return error;
}

type NativeDeepReadShotTiming = {
  startSec: number;
  endSec: number;
  transitionInZh: string;
  evidenceRole: "story" | "non_story_ad";
};

function sortedShots(raw: Record<string, unknown>): NativeDeepReadShotTiming[] {
  return (Array.isArray(raw.shots) ? raw.shots : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
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

/** 全部镜头（含广告）在本段内的区间并集；越界和重叠不能虚增覆盖率。 */
export function measureNativeDeepReadSegmentCoverage(input: {
  shots: ReadonlyArray<{ startSec: number; endSec: number }>;
  startSec: number;
  endSec: number;
}): { coveredSec: number; durationSec: number; coverageRatio: number } {
  const durationSec = Math.max(0, input.endSec - input.startSec);
  const spans = input.shots
    .map((shot) => ({
      startSec: Math.max(input.startSec, shot.startSec),
      endSec: Math.min(input.endSec, shot.endSec),
    }))
    .filter((span) => Number.isFinite(span.startSec) && Number.isFinite(span.endSec)
      && span.endSec > span.startSec)
    .sort((a, b) => a.startSec - b.startSec);
  let cursor = input.startSec;
  let coveredSec = 0;
  for (const span of spans) {
    const from = Math.max(cursor, span.startSec);
    if (span.endSec > from) coveredSec += span.endSec - from;
    cursor = Math.max(cursor, span.endSec);
  }
  return { coveredSec, durationSec, coverageRatio: durationSec > 0 ? coveredSec / durationSec : 0 };
}

/**
 * 0905 用户解冻：逐镜 18 字段只写在 keyMoment 前后 ±6 秒的「重点镜」；其余镜头只写
 * 起止秒 / evidenceRole / hintZh / actionZh（简写镜）。用户原话「我从没这样要求过」——
 * 18 字段全写是 PR #1324（0828）把 0827 探针字段全量推上生产并设为必填所致，第 5 集 379 镜
 * 每镜约 450 字节，是读片输出 token 的大头。
 */
export const NATIVE_DEEP_READ_KEY_SHOT_WINDOW_SEC = 6;
const NATIVE_DEEP_READ_REQUIRED_BRIEF_SHOT_FIELDS = [
  "startSec", "endSec", "evidenceRole", "actionZh",
] as const; // hintZh 由 assertNativeDeepReadShotObservations 单独把关
export function isNativeDeepReadKeyShot(
  shot: { startSec?: unknown; endSec?: unknown },
  keyMomentSecs: readonly number[],
  windowSec = NATIVE_DEEP_READ_KEY_SHOT_WINDOW_SEC,
): boolean {
  const start = Number(shot.startSec); const end = Number(shot.endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return keyMomentSecs.some((at) => at + windowSec >= start && at - windowSec <= end);
}
export function nativeDeepReadKeyMomentSecs(raw: Record<string, unknown>): number[] {
  return Array.isArray(raw.keyMoments)
    ? (raw.keyMoments as Array<{ atSec?: unknown }>).map((row) => Number(row?.atSec)).filter(Number.isFinite)
    : [];
}
const NATIVE_DEEP_READ_REQUIRED_SHOT_FIELDS = [
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
] as const;

/** non_story_ad 镜头只保存时间轴与分类标记，仅这三项必填（0830 晚用户定稿的 Schema 分支）。 */
const NATIVE_DEEP_READ_REQUIRED_AD_SHOT_FIELDS = [
  "startSec", "endSec", "evidenceRole",
] as const;

/** 只核对观察是否存在及时间顺序，不把字段齐全当作画面已核实。 */
export function assertNativeDeepReadShotObservations(raw: Record<string, unknown>): void {
  let previousStart = -Infinity;
  const shots = Array.isArray(raw.shots) ? raw.shots : [];
  for (let index = 0; index < shots.length; index += 1) {
    const value = shots[index];
    const row = value as Record<string, unknown> | null;
    if (!row || typeof row !== "object") continue; // 结构错误交给既有schema门禁。
    const start = Number(row.startSec);
    const invalid = row.evidenceRole === "non_story_ad"
      ? row.hintZh !== null
      : typeof row.hintZh !== "string" || !row.hintZh.trim();
    if (invalid || start < previousStart) {
      throw new NativeDeepReadRequiredEvidenceError("shot_observation_missing",
        `第${index + 1}镜观察契约不完整：${invalid
          ? row.evidenceRole === "non_story_ad" ? "广告hintZh应为null空占位" : "hintZh应填写本镜非空观察，看不清时说明可见范围"
          : "shots应按startSec升序排列，观察随本镜时间保留"}`);
    }
    previousStart = start;
  }
}

/** GLM只能保留来源镜头的观察；跨镜挪用、改写或丢字段均停止消费，原稿仍永久保存。 */
export function assertNativeDeepReadShotObservationsPreserved(
  sourceRows: ReadonlyArray<Record<string, unknown>>,
  output: Record<string, unknown>,
): void {
  const sources = sourceRows.flatMap((raw) => {
    const normalized = unwrapNativeDeepReadStructuredAnswerEnvelope(raw);
    return Array.isArray(normalized.shots) ? normalized.shots : [];
  })
    .filter((row): row is Record<string, unknown> => row && typeof row === "object"
      && row.evidenceRole === "story" && typeof row.hintZh === "string" && Boolean(row.hintZh.trim()));
  if (!sources.length) return; // 历史证据不补写观察。
  const normalizedOutput = unwrapNativeDeepReadStructuredAnswerEnvelope(output);
  const shots = Array.isArray(normalizedOutput.shots) ? normalizedOutput.shots : [];
  for (let index = 0; index < shots.length; index += 1) {
    const row = shots[index];
    if (row?.evidenceRole === "non_story_ad") continue;
    const hint = typeof row?.hintZh === "string" ? row.hintZh.trim() : "";
    const spans = sources.filter(source => String(source.hintZh).trim() === hint).map(source => ({
      startSec: Number(source.startSec) - NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC,
      endSec: Number(source.endSec) + NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC,
    }));
    const coverage = measureNativeDeepReadSegmentCoverage({
      shots: spans, startSec: Number(row?.startSec), endSec: Number(row?.endSec),
    });
    if (!hint || !spans.length || coverage.durationSec <= 0 || coverage.coverageRatio < 1 - 1e-9) {
      throw new Error(`整集第${index + 1}镜hintZh丢失、改写或超出来源镜头时间，停止消费；已保存原稿，不自动重发`);
    }
  }
}

function assertRawShotFieldPresence(raw: Record<string, unknown>, labelZh: string): void {
  const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
  const keyMomentSecs = nativeDeepReadKeyMomentSecs(raw);
  for (let index = 0; index < rawShots.length; index += 1) {
    const shot = rawShots[index];
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) continue;
    const row = shot as Record<string, unknown>;
    const role = row.evidenceRole;
    if (role !== "story" && role !== "non_story_ad") {
      throw gateError(`${labelZh}第${index + 1}镜 evidenceRole 缺失或无效`);
    }
    /**
     * 🔴 按 evidenceRole 分支（0830 晚用户定稿）：
     * · story —— 完整 17 字段全部必填，一项不缺；
     * · non_story_ad —— 只保存时间轴与分类标记，仅需 startSec/endSec/evidenceRole。
     * 不得靠全局取消必填来放宽 story 的完整性要求。
     */
    // 0905 解冻：只有重点镜（keyMoment ±6 秒）要求 18 字段齐全，其余镜按简写镜校验
    const keyShot = role === "story" && isNativeDeepReadKeyShot(row, keyMomentSecs);
    const requiredFields: ReadonlyArray<string> = role === "non_story_ad"
      ? NATIVE_DEEP_READ_REQUIRED_AD_SHOT_FIELDS
      : keyShot ? NATIVE_DEEP_READ_REQUIRED_SHOT_FIELDS : NATIVE_DEEP_READ_REQUIRED_BRIEF_SHOT_FIELDS;
    const missingFields = requiredFields.filter(
      (field) => !Object.prototype.hasOwnProperty.call(row, field),
    );
    if (missingFields.length > 0) {
      throw gateError(`${labelZh}第${index + 1}镜字段不完整：缺 ${missingFields.join("、")}`);
    }
    if (role === "story" && keyShot) {
      const unitTypeZh = row.unitTypeZh;
      if (unitTypeZh !== "剪辑镜头" && unitTypeZh !== "拆分镜证据段") {
        throw gateError(`${labelZh}第${index + 1}镜 unitTypeZh 缺失或无效`);
      }
    }
  }
}

/**
 * 将「真实切镜」与「同一长镜的证据拆分」分开计数。
 * 后者只是在同一物理镜头内增加观察颗粒，不得被误算成多个真实长镜，
 * 拆分最短时长只约束带长镜续接标记的证据段，真实短切镜照实保留。
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

/**
 * 长镜数量与拆分连续性只出 advisory；单条证据超过33秒必须独立重试。
 *
 * **>15 秒长镜的数量限额已彻底删除**：真实长定场不该被数量门禁重买；长度信息
 * 只作提示。30秒要求与10%拦截容差来自用户实测，不得以单项放行绕过。
 */
function collectLongTakeAdvisories(input: {
  shots: ReadonlyArray<NativeDeepReadShotTiming>;
  labelZh: string;
  segmentIndex: number;
}): NativeDeepReadAdvisory[] {
  const out: NativeDeepReadAdvisory[] = [];
  const evidenceDurations = input.shots.map((shot) => shot.endSec - shot.startSec);
  /**
   * 🔴 出错必须定位到具体镜头（0831 用户令）。
   *
   * 旧文案只说「有 N 个超过 33 秒，最长 X 秒」——排查时还得手动去 GCS 捞原始响应
   * 才知道是哪几条、在哪个秒位。今天为查一次重试原因就撈了三轮证据。
   * 现在直接把**镜号与秒位**写进错误：拿到报错就能定位，不必回头翻证据。
   */
  const overlongShots = input.shots
    .map((shot, index) => ({ index, shot, lenSec: shot.endSec - shot.startSec }))
    .filter((row) => row.lenSec > NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC)
    .sort((a, b) => b.lenSec - a.lenSec);
  if (overlongShots.length > 0) {
    // 最多列 5 条：够定位，又不至于把错误信息撑爆（拒因还要塞进下一轮提示词，上限 300 字）。
    const detail = overlongShots.slice(0, 5)
      .map((row) => `第${row.index + 1}镜 ${Math.round(row.shot.startSec * 10) / 10}—${
        Math.round(row.shot.endSec * 10) / 10} 秒（${Math.round(row.lenSec)} 秒）`)
      .join("、");
    const more = overlongShots.length > 5 ? `，另有 ${overlongShots.length - 5} 条` : "";
    // 硬门禁（0829 用户令：超过 30 秒必须拆）：单条证据段不得超过硬上限。
    throw new NativeDeepReadRequiredEvidenceError("shot_evidence_too_long",
      `${input.labelZh}有 ${overlongShots.length} 个超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC} 秒的镜头证据段`
      + `（要求 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒 + 10% 容差）：${detail}${more}；`
      + `这几条必须按镜内变化拆成连续证据段，禁止截断尾部`,
    );
  }
  let physicalDurations: number[] = [];
  try {
    physicalDurations = groupPhysicalShotDurations(input.shots);
  } catch (error) {
    out.push({
      code: "long_take_split_discontinuous",
      detailZh: (error instanceof Error ? error.message : String(error))
        .replace(`${NATIVE_DEEP_READ_GATE_PREFIX}：`, "")
        .slice(0, 500),
      segmentIndex: input.segmentIndex,
    });
    physicalDurations = evidenceDurations;
  }
  const physicalLongTakes = physicalDurations
    .filter((shotLen) => shotLen > NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC);
  if (physicalLongTakes.length > NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE) {
    out.push({
      code: "long_take_count",
      detailZh: `${input.labelZh}有 ${physicalLongTakes.length} 个超过 ${NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC} 秒的真实长镜（最长 ${Math.round(Math.max(...physicalLongTakes))} 秒），仅提示不拒收`,
      segmentIndex: input.segmentIndex,
    });
  }
  return out;
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
    // 空档与重叠必须分开报（0829 晚拆分）：两者的修法相反——空档要补，重叠要合。
    // 报同一句话，修复轮拿到的原因就是含混的，模型只能猜该补还是该合。
    // v11「通过版 + 标记版一起喂」之后，重叠是可预期的高频失败形态，更不能含混。
    if (shot.startSec > cursor + tolerance) {
      throw gateError(
        `${labelZh}镜头时间轴存在空档：${cursor.toFixed(1)}–${shot.startSec.toFixed(1)} 秒无覆盖`,
      );
    }
    if (shot.startSec < cursor - tolerance) {
      throw gateError(
        `${labelZh}镜头时间轴存在重叠：${shot.startSec.toFixed(1)} 秒处与上一条`
        + `（结束于 ${cursor.toFixed(1)} 秒）相交，同一秒只能由一条 story 记录覆盖`,
      );
    }
    cursor = shot.endSec;
  }
  if (Math.abs(cursor - endSec) > tolerance) {
    throw gateError(`${labelZh}镜头未覆盖到 ${endSec} 秒`);
  }
}

/* ────────────────── 整集卡广告剔除（段卡→整集卡合并层） ────────────────── */

export type NativeDeepReadExcludedAdRange = { startSec: number; endSec: number };

/** 相邻/重叠区间合并（±0.5s 容差与时间轴门禁同口径）。 */
function mergeAdjacentAdRanges(
  ranges: ReadonlyArray<NativeDeepReadExcludedAdRange>,
): NativeDeepReadExcludedAdRange[] {
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const merged: NativeDeepReadExcludedAdRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.startSec <= last.endSec + NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC) {
      last.endSec = Math.max(last.endSec, range.endSec);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * 段卡合并成整集卡时整行剔除 evidenceRole=non_story_ad 的镜头，只留区间账目。
 *
 * - 原始分段卡（Gemini 产物 / raw 证据 / 段门禁）一律不动：完整时间轴是模型
 *   完整性验证与审计需要，本函数只产整集卡视图的新副本。
 * - 被剔除区间合并相邻后写入该行的顶层可选字段 excludedAdRanges；无广告时
 *   行原样返回，字段缺省不出现。
 * - 被剔除镜头行内的画面字幕同属广告内容，一并不入整集卡。
 */
export function stripNonStoryAdShotsForEpisodeCard(
  rows: ReadonlyArray<Record<string, unknown>>,
): { rows: Array<Record<string, unknown>>; excludedAdRanges: NativeDeepReadExcludedAdRange[] } {
  const collected: NativeDeepReadExcludedAdRange[] = [];
  const strippedRows = rows.map((raw) => {
    const shots = Array.isArray(raw.shots) ? raw.shots : [];
    const adRanges: NativeDeepReadExcludedAdRange[] = [];
    const storyShots = shots.filter((shot) => {
      const row = (shot || {}) as Record<string, unknown>;
      if (row.evidenceRole !== "non_story_ad") return true;
      const startSec = Number(row.startSec);
      const endSec = Number(row.endSec);
      if (Number.isFinite(startSec) && Number.isFinite(endSec) && startSec >= 0 && endSec > startSec) {
        adRanges.push({ startSec, endSec });
      }
      return false;
    });
    if (adRanges.length === 0) return raw;
    const rowRanges = mergeAdjacentAdRanges(adRanges);
    collected.push(...rowRanges);
    const copy: Record<string, unknown> = { ...raw, shots: storyShots, excludedAdRanges: rowRanges };
    if (Array.isArray(copy.subtitles)) {
      copy.subtitles = copy.subtitles.filter((subtitle) => {
        const atSec = Number((subtitle as Record<string, unknown> | null)?.atSec);
        return !rowRanges.some((range) => atSec >= range.startSec && atSec < range.endSec);
      });
    }
    return copy;
  });
  return { rows: strippedRows, excludedAdRanges: mergeAdjacentAdRanges(collected) };
}

/**
 * 给整集卡/快照行注入 audioResolution 各 chunk 的**真实**段界（chunkSpans）。
 *
 * 音轨局部秒 → 全片绝对秒的唯一合法换算依据来自 segments spec（粗读拆段的
 * startSec/endSec，全片绝对秒），不是从镜头 startSec 猜、更不是 chunkIndex*300。
 * chunkIndex 找不到对应段规格视为身份损坏，关闭式失败。
 * 无音轨行（audioResolution 空）原样返回，不注入空字段。
 */
export function attachAudioChunkSpans(
  rows: ReadonlyArray<Record<string, unknown>>,
  segments: readonly NativeDeepReadSegmentSpec[],
  episodeIndex: number,
): Array<Record<string, unknown>> {
  return rows.map((raw) => {
    const audioRows = Array.isArray(raw.audioResolution) ? raw.audioResolution : [];
    if (audioRows.length === 0) return raw;
    const chunkSpans = audioRows.map((entry) => {
      const chunkIndex = Number((entry as { chunkIndex?: unknown } | null)?.chunkIndex);
      const spec = Number.isInteger(chunkIndex) && chunkIndex >= 0 ? segments[chunkIndex] : undefined;
      if (!spec) {
        throw new Error(
          `第${episodeIndex}集 audioResolution chunkIndex=${String(chunkIndex)} 没有对应段规格，无法换算真实段界，整集拒绝入库`,
        );
      }
      return { chunkIndex, startSec: spec.startSec, endSec: spec.endSec };
    });
    return { ...raw, chunkSpans };
  });
}

/** 整集卡上的区间账目校验与汇总：startSec/endSec 非负有限且 end>start，否则整集拒收。 */

/**
 * GLM 路的广告区间不可自证：必须与确定性剥离（真实 non_story_ad 行推出的区间）
 * 在 ±0.5s 容差内逐一对上，否则 GLM 丢 story 镜头再谎报为广告区间即可骗过覆盖门禁。
 */
/**
 * 广告区间**不问 GLM，直接写确定性结果**（0830 晚用户拍板）。
 *
 * 用户原话：「知道真相你還故意問他是耍他好嗎」「你耍得開心，買單的是我」。
 *
 * 真值本来就不来自 GLM——它由读片侧各段自报的 `evidenceRole === "non_story_ad"`
 * 确定性汇总而来（collectEpisodeExcludedAdRanges）。先让 GLM 复述一遍、再回头
 * 校对它复述得对不对、对不上就拒收整集，是自找的三重浪费：
 *   ① 白花输出 token 让它复述已知答案
 *   ② 复述错了就杀掉整集已付费证据（v27 实锤：六片广告镜全 0、确定性算出 0 段，
 *      GLM 自报 1 段 → 旧逻辑整集拒收，¥21.76 六片读片全废）
 *   ③ 还要为此维护一道对账门禁
 * 现在：GLM 提示词里不再要求这个字段，落库时由本函数直接覆盖为确定性值。
 */
function applyDeterministicAdRanges(
  structuredRaw: Record<string, unknown>,
  expected: NativeDeepReadExcludedAdRange[],
): void {
  if (expected.length === 0) {
    delete (structuredRaw as { excludedAdRanges?: unknown }).excludedAdRanges;
    return;
  }
  (structuredRaw as { excludedAdRanges: unknown }).excludedAdRanges =
    expected.map((range) => ({ startSec: range.startSec, endSec: range.endSec }));
}

function collectEpisodeExcludedAdRanges(
  rawSegments: ReadonlyArray<Record<string, unknown>>,
  episodeIndex: number,
): NativeDeepReadExcludedAdRange[] {
  const ranges: NativeDeepReadExcludedAdRange[] = [];
  for (const raw of rawSegments) {
    const value = raw.excludedAdRanges;
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      throw new Error(`第${episodeIndex}集 excludedAdRanges 不是数组，整集拒绝入库`);
    }
    for (const item of value) {
      const row = (item || {}) as Record<string, unknown>;
      const startSec = Number(row.startSec);
      const endSec = Number(row.endSec);
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
        throw new Error(`第${episodeIndex}集 excludedAdRanges 区间无效，整集拒绝入库`);
      }
      ranges.push({ startSec, endSec });
    }
  }
  return mergeAdjacentAdRanges(ranges);
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
      "hintZh",
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
 * 不达标＝该段被标记（带原因重试由调用方负责；被标记的产出不丢，一并交 GLM）。
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

/**
 * 覆盖与空档转 advisory：**必须写出具体秒位**（用户 0829 明文）。
 * 截断段天生覆盖不到段尾，不写清缺口就等于没保留证据。
 */
function collectShotCoverageAdvisories(
  shots: ReadonlyArray<{ startSec: number; endSec: number }>,
  startSec: number,
  endSec: number,
  segmentIndex: number,
  labelZh: string,
): NativeDeepReadAdvisory[] {
  const tolerance = NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC;
  const out: NativeDeepReadAdvisory[] = [];
  const round = (v: number) => Math.round(v * 10) / 10;
  // 覆盖类的偏差 = 缺口秒数 / 段长（0830 晚三项线 20% 判据用它）
  const lenSec = Math.max(1, endSec - startSec);
  const gapRatio = (sec: number) => Math.min(1, Math.max(0, sec) / lenSec);
  if (!shots.length) {
    out.push({
      code: "coverage_missing",
      detailZh: `${labelZh}没有任何可用镜头行，缺 ${round(startSec)}–${round(endSec)} 秒`,
      segmentIndex,
      deviationRatio: 1,
    });
    return out;
  }
  if (Math.abs(shots[0]!.startSec - startSec) > tolerance) {
    out.push({
      code: "coverage_head_gap",
      detailZh: `${labelZh}镜头未从 ${round(startSec)} 秒开始，缺 ${round(startSec)}–${round(shots[0]!.startSec)} 秒`,
      segmentIndex,
      deviationRatio: gapRatio(shots[0]!.startSec - startSec),
    });
  }
  const gaps: string[] = [];
  let gapTotalSec = 0;
  const overlaps: string[] = [];
  let cursor = shots[0]!.startSec;
  for (const shot of shots) {
    if (shot.startSec > cursor + tolerance) {
      gaps.push(`${round(cursor)}–${round(shot.startSec)}`);
      gapTotalSec += shot.startSec - cursor;
    }
    if (shot.startSec < cursor - tolerance) overlaps.push(`${round(shot.startSec)}–${round(cursor)}`);
    cursor = Math.max(cursor, shot.endSec);
  }
  if (gaps.length) {
    out.push({
      code: "timeline_gap",
      detailZh: `${labelZh}镜头时间轴存在 ${gaps.length} 处空档：${gaps.join("、")} 秒`,
      segmentIndex,
      // 🔴 必须带偏差：它在 20% 判据白名单里，缺了就恒取 0、永远触发不了重跑＝死码。
      deviationRatio: gapRatio(gapTotalSec),
    });
  }
  if (overlaps.length) {
    out.push({
      code: "timeline_overlap",
      detailZh: `${labelZh}镜头时间轴存在 ${overlaps.length} 处重叠：${overlaps.join("、")} 秒`,
      segmentIndex,
    });
  }
  if (cursor < endSec - tolerance) {
    out.push({
      code: "coverage_tail_gap",
      detailZh: `${labelZh}镜头未覆盖到 ${round(endSec)} 秒，缺 ${round(cursor)}–${round(endSec)} 秒`,
      segmentIndex,
      deviationRatio: gapRatio(endSec - cursor),
    });
  }
  return out;
}

/** 把原本抛错的段级校验降级成 advisory：抛出的中文原因原样进 detailZh。 */
function advisoryFromThrow(
  code: string,
  segmentIndex: number,
  run: () => void,
): NativeDeepReadAdvisory[] {
  try {
    run();
    return [];
  } catch (error) {
    const detailZh = (error instanceof Error ? error.message : String(error))
      .replace(`${NATIVE_DEEP_READ_GATE_PREFIX}：`, "")
      .slice(0, 500);
    return [{ code, detailZh, segmentIndex }];
  }
}

/**
 * 段级证据检查：结构不可用关闭式失败；正常输出覆盖不足与超长证据段独立重试。
 * 其余建议交 evaluateNativeDeepReadSegmentAcceptance 按家族与偏差统一裁决。
 *
 * 注意：**>15 秒长镜数量限额已彻底删除**（0829），长度信息只转 advisory。
 */
export function assertNativeDeepReadSegmentDensity(input: {
  episodeIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio: boolean;
  raw: Record<string, unknown>;
  /**
   * 上游 finishReason=MAX_TOKENS：本段响应被截断，只保留了可解析前缀。
   * 截断段走豁免通道（见下方 classification 分支），其余硬门一视同仁。
   */
  truncated?: boolean;
}): { raw: Record<string, unknown>; advisories: NativeDeepReadAdvisory[] } {
  const lenSec = Math.max(1, Math.round(input.endSec - input.startSec));
  const labelZh = `第${input.segmentIndex + 1}段`;
  const segmentIndex = input.segmentIndex;
  const truncated = input.truncated === true;
  const advisories: NativeDeepReadAdvisory[] = [];
  const note = (code: string, detailZh: string, deviationRatio?: number) =>
    advisories.push({ code, detailZh, segmentIndex, ...(deviationRatio === undefined
      ? {}
      : { deviationRatio }) });
  /** 偏离门槛的比例 = |实际 − 门槛| / 门槛。门槛为 0 时不产生偏差值。 */
  const deviation = (actual: number, threshold: number) =>
    threshold > 0 ? Math.abs(actual - threshold) / threshold : undefined;

  // 先证实结构可用，再检查独立证据门；分类/必填字段的早抛不得掩盖覆盖或超长问题。
  const parsed = nativeDeepReadSegmentSchema.safeParse(input.raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const issueZh = firstIssue
      ? `（${firstIssue.path.join(".") || "根"}: ${firstIssue.message}）`
      : "";
    throw schemaGateError(`${labelZh}结构不合原生逐镜 schema${issueZh}`);
  }
  const shots = sortedShots(input.raw);
  const coverage = measureNativeDeepReadSegmentCoverage({
    shots, startSec: input.startSec, endSec: input.endSec,
  });
  if (!truncated && coverage.coverageRatio < NATIVE_DEEP_READ_SEGMENT_COVERAGE_RETRY_RATIO) {
    throw new NativeDeepReadRequiredEvidenceError("coverage_below_90",
      `${labelZh}镜头覆盖率 ${(coverage.coverageRatio * 100).toFixed(1)}%`
      + `（覆盖 ${coverage.coveredSec.toFixed(1)} 秒 / 本片 ${coverage.durationSec.toFixed(1)} 秒），`
      + `低于重跑线 ${(NATIVE_DEEP_READ_SEGMENT_COVERAGE_RETRY_RATIO * 100).toFixed(0)}%：整片没读完`,
    );
  }
  const storyShots = shots.filter((shot) => shot.evidenceRole === "story");
  /**
   * 🔴 广告标注不得成为偷懒出口（0831 用户点出）。
   * 广告镜只需三个字段、且会被整行剔除，是这条链路上**最省力**的偷懒方式：
   * 比写「剧情推进」这种通用词还省——连编都不用编。
   * 这里按**时长占比**而非条数判：一条 300 秒的「广告」比十条 3 秒的更可疑。
   */
  const adDurationSec = shots
    .filter((shot) => shot.evidenceRole === "non_story_ad")
    .reduce((total, shot) => total + Math.max(0, Number(shot.endSec) - Number(shot.startSec)), 0);
  const adRatio = lenSec > 0 ? adDurationSec / lenSec : 0;
  const longestAdSec = shots
    .filter((shot) => shot.evidenceRole === "non_story_ad")
    .reduce((max, shot) => Math.max(max, Number(shot.endSec) - Number(shot.startSec)), 0);
  const longestAdRatio = lenSec > 0 ? longestAdSec / lenSec : 0;
  /**
   * 三条同时成立才判，缺一不可——判据要抓的是**具体形态**不是「广告多」：
   *   ① 广告总占比超线：真实广告（片头版权卡＋贴片＋中插）通常在 30% 以内
   *   ② 单条广告吞掉大半段：偷懒是写一行 {0, 300, non_story_ad} 交差，
   *      真实广告是多段短区间
   *   ③ story 镜头稀少：广告占大半却还认真写了正片的，不是偷懒
   *
   * 第③条是关键分野。有些正当用例（如只测覆盖率的单元测试、或真的整段是
   * 招商内容的片段）会满足①②，但只要 story 侧有正常密度就不该判。
   */
  const storyDensityOk = storyShots.length
    >= Math.ceil(lenSec / NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC) / 2;
  /**
   * ④ 段内**完全没有** story 镜时不由本条报——那种情况 `no_story_shots` 已经在管，
   * 同一件事不出两条 advisory（用户立过「同一判断只能一个函数」）。
   * 真正要本条抓的是「标大半为广告、留几镜装样子」：story 侧不为零但明显偏薄，
   * 单看 no_story_shots 抓不到，单看镜数地板也抓不到（地板只数 story，
   * 广告镜不计入分母，标成广告反而让地板更容易过）。
   */
  if (storyShots.length > 0
    && adRatio > NATIVE_DEEP_READ_AD_RATIO_MAX
    && longestAdRatio > NATIVE_DEEP_READ_AD_SINGLE_MAX_RATIO
    && !storyDensityOk) {
    note(
      "ad_ratio_suspicious",
      `${labelZh}有 ${Math.round(adDurationSec)} 秒被标为商业广告，占本段 `
      + `${(adRatio * 100).toFixed(1)}%（上限 ${NATIVE_DEEP_READ_AD_RATIO_MAX * 100}%）；`
      + `其中单条最长 ${Math.round(longestAdSec)} 秒（占 ${(longestAdRatio * 100).toFixed(1)}%）；`
      + `广告镜只需三个字段且会被整行剔除，一条大广告吞掉整段是把正片当广告跳过的典型形态`,
      deviation(adRatio, NATIVE_DEEP_READ_AD_RATIO_MAX),
    );
  }
  const longTakeAdvisories = collectLongTakeAdvisories({ shots: storyShots, labelZh, segmentIndex });

  /**
   * 硬门禁（0829 用户裁决，不转 advisory）：五维分类五键齐全。
   *
   * 🔓 截断段豁免（0829 晚）：`classification` 在 responseSchema 里排在**最末**，
   * MAX_TOKENS 一截必然先截掉它——拿这道门去卡截断段，等于「保留截断前缀」这条
   * 从来没生效过（0829 实证 6 片截 2 片，一集 4–8 片，截断是常态不是意外）。
   * 豁免只对 classification / beatStructureZh 这两个「段尾才产出」的栏位生效；
   * 逐镜 17 字段、30 秒上限、zod 结构对截断段照样硬拒——镜头证据本身必须完整。
   * 兜底在集级：GLM 收口按 story 输入并集重算五维，集级仍严格校验五键齐全。
   */
  const rawClassification = input.raw.classification;
  const classificationMissing = !rawClassification
    || typeof rawClassification !== "object"
    || Array.isArray(rawClassification);
  if (classificationMissing) {
    if (!truncated) throw gateError(`${labelZh} classification 缺失`);
    note(
      "truncated_classification_missing",
      `${labelZh}因输出截断缺 classification，已保留镜头证据（五维由整集卡按并集重算）`,
    );
  } else if (!hasManhuaTemplateClassificationFields(rawClassification)) {
    const row = rawClassification as Record<string, unknown>;
    const key = MANHUA_TEMPLATE_CLASSIFICATION_KEYS.find((candidate) =>
      !Object.prototype.hasOwnProperty.call(row, candidate) || !Array.isArray(row[candidate]));
    if (!truncated) throw gateError(`${labelZh} classification.${key || "字段"} 缺失或不是数组`);
    note(
      "truncated_classification_partial",
      `${labelZh}因输出截断，classification.${key || "字段"} 不完整，已保留镜头证据`,
    );
  }
  if (input.hasAudio) {
    const rawAudioRows = Array.isArray(input.raw.audioResolution)
      ? (input.raw.audioResolution as unknown[])
      : [];
    const rawAudioEntry = rawAudioRows[0];
    if (rawAudioRows.length > 0 && rawAudioEntry && typeof rawAudioEntry === "object" && !Array.isArray(rawAudioEntry)) {
      advisories.push(...advisoryFromThrow("audio_field_missing", segmentIndex, () =>
        assertRawAudioAnalysisFieldPresence(
          (rawAudioEntry as Record<string, unknown>).analysis,
          labelZh,
        )));
    }
  }
  // 硬门禁（0829 用户裁决）：逐镜 17 字段/unitTypeZh/evidenceRole 必填，缺则标记并重试（内容仍留给 GLM）。
  assertRawShotFieldPresence(input.raw, labelZh);

  /**
   * 🔴 越界镜＝编造（0831 实弹发现）。
   *
   * run probe_douyin_20260831030601_bc672813 attempt1：本片只有 319 秒，
   * 模型却给出 95 镜、秒位一路写到 **519 秒**，其中 34 镜整段落在片长之外，
   * 内容具体到「小女孩举起紫色令牌召唤影七」——那 200 秒的画面根本不存在。
   * keyMoments 7/23、字幕 7/50 同样越界。
   *
   * 覆盖率计算虽然把越界区间 clamp 回段界（不会虚增覆盖率），
   * 但越界镜本身此前**没有任何检查**，会照常入库并污染整集时间轴。
   * 这类不是「密度不够」而是「凭空捏造」，必须当场可见。
   *
   * 容差取 1 秒：模型给整数秒、段界可能是小数（如 160.1），
   * 边界镜多出零点几秒是舍入不是编造，不该误报。
   */
  const outOfRange = shots.filter((shot) =>
    Number(shot.startSec) < input.startSec - 1 || Number(shot.endSec) > input.endSec + 1);
  if (outOfRange.length) {
    const farthest = Math.max(...outOfRange.map((shot) => Number(shot.endSec) || 0));
    note(
      "shot_out_of_segment_range",
      `${labelZh}有 ${outOfRange.length} 个镜头的秒位落在本段 ${Math.round(input.startSec)}—${
        Math.round(input.endSec)} 秒范围之外（最远 ${Math.round(farthest)} 秒）；`
      + `本段素材不存在这些画面，属凭空捏造`,
      deviation(farthest, input.endSec),
    );
  }

  advisories.push(...advisoryFromThrow("clock_text", segmentIndex, () =>
    assertVisualTextNoClock(input.raw, labelZh)));
  advisories.push(...collectShotCoverageAdvisories(
    shots,
    Math.round(input.startSec),
    Math.round(input.endSec),
    segmentIndex,
    labelZh,
  ));
  const storyDurationSec = storyShots.reduce(
    (total, shot) => total + Math.max(0, shot.endSec - shot.startSec),
    0,
  );
  if (storyShots.length === 0 || storyDurationSec < 1) {
    note("no_story_shots", `${labelZh}没有可学习的剧情镜头（招商广告已排除）`);
  }
  // storyFloors（按模型产出的 storyDurationSec 算镜数地板）已随 0830 删除镜数门禁一并作废——
  // 那正是「回得越少地板越低、越容易过」的洞。音轨 advisory 用**计划片长** lenSec 当分母。
  const audioFloors = resolveNativeDeepReadSegmentFloors(lenSec);
  // 0829「尾片不设镜数门禁」的开关已无消费者：0830 镜数门禁整条删除后，
  // 长片尾片走的是同一套（上限＋覆盖），不再需要按 300 秒分流。

  /**
   * 镜数「离谱地板」：0830 删除，**0831 用户拍板加回**。两段历史都留着，别再来回翻。
   *
   * 0830 删除的理由（仍然成立，所以这次没有恢复原样）：真人剧那轮 10 片有 5 片因这条
   * 被拦、每次重试都要重付一整片视频输入（¥37.50 里相当一部分花在这上面），
   * 而重试回来的产出并不比首发更「对」——它只是把镜头切得更碎去满足一个
   * 按漫剧节奏定的数字。下限本质上是在替模型规定「该看到多少东西」。
   *
   * 0831 加回的理由：删掉之后**模型少写没有任何代价**。实测
   * run probe_douyin_20260831035500_86a2a69d attempt1 给出 9 镜 / 319 秒
   * ＝ 35.4 秒一镜，输出只用 3,689 token（上限 65,536 的 5.6%）。
   * 319 秒的漫剧不可能只有 9 个镜头，这是躺平不是「诚实地少写」。
   * 提示词里的自检基准（每 2—6 秒一次切换）是软的，模型可以不理，那一发就是不理。
   *
   * 这次与 0830 被删那版的关键差别，正是为了不重蹈真人剧那轮的覆辙：
   *   · 地板用**离谱线 10 秒/镜**（319 秒＝32 镜），不是 v11 的建议线 6 秒/镜（53 镜）。
   *     目的是让「只写 9 镜」有代价，不是逼它写够 53 镜。
   *   · 只出 advisory，**不硬拒收**；靠偏差 >20% 单独触发一次重试。
   *     39 镜这种略低于地板的照常放行，不会像真人剧那轮把半数分片拦下来。
   *   · 分母用**计划片长**，不用模型自报的 storyDurationSec——
   *     后者正是「回得越少地板越低、越容易过」的洞。
   *
   * 上限与覆盖这两条与体裁无关的硬约束照旧：
   *   · 单条证据段 ≤30 秒（用户三十余次实测拍板，不得放宽）
   *   · 段级覆盖率地板（整片必须读完，回 3 秒即拒）
   */
  const shotFloor = resolveNativeDeepReadDensityContract(lenSec).referenceShots;
  if (storyShots.length > 0 && storyShots.length < shotFloor) {
    note(
      "shot_density_low",
      `${labelZh}只有 ${storyShots.length} 个剧情镜头，低于离谱地板 ${shotFloor}`
      + `（${NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC} 秒/镜 × ${lenSec} 秒）；`
      + `平均 ${Math.round((lenSec / storyShots.length) * 10) / 10} 秒记录一镜，请对照原片核对是否漏记真实切换`,
      deviation(storyShots.length, shotFloor),
    );
  }

  /**
   * 🔴 平均镜长门禁：接回 0826 就存在、后来被架空的那条线。
   *
   * 0826 代码注释原话：「温度只管发挥不管密度，密度必须靠代码门禁：
   * 镜头数 ≥ ceil(段时长/6) · 平均每镜 ≤6s · 单镜 ≤15s（超了=合并了多次切镜）」。
   * `NATIVE_DEEP_READ_SHOT_AVG_MAX_SEC = 6` 常量一直在，但 0830 删镜数门禁时
   * 连它的消费者一起删了——常量成了死代码，全仓 grep `shot_avg_too_long` 零结果。
   *
   * 旧样本7c6a6b0a的32镜合计319秒，实际均长9.96875秒，不会触发下方>10判断。
   * 均长与条数只能提示复查，不能据此证明模型采用了固定步长或合并了真实切镜。
   *
   * 阈值用**离谱口径 10 秒**而非原来的 6 秒：0827 实测健康值 4–5 秒/镜，
   * 留一倍余量；真人剧 0830 实测 6.55 秒/镜也照样放行，不重蹈那轮误杀半数分片的覆辙。
   * 只出 advisory 不硬拒收，靠偏差 >20% 单独触发一次重试。
   */
  if (storyShots.length > 0) {
    const storySec = storyShots.reduce(
      (total, shot) => total + Math.max(0, shot.endSec - shot.startSec), 0);
    const avgSec = storySec / storyShots.length;
    if (avgSec > NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC) {
      note(
        "shot_avg_too_long",
        `${labelZh}平均镜长 ${Math.round(avgSec * 10) / 10} 秒，超过离谱线 `
        + `${NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC} 秒；`
        + `请对照原片核对是否漏记真实切换，秒位以实际画面边界为准`,
        deviation(avgSec, NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC),
      );
    }
  }

  if (storyDurationSec > NATIVE_DEEP_READ_SHOT_MICRO_SEGMENT_SEC) {
    // ❌ 镜数密度 advisory 同批删除（0830）：它与离谱地板同源，同样是按漫剧节奏定的下限。
    /**
     * ❌「平均每镜 ≤6 秒」这条已删除（0830 用户令）。
     *
     * 6 秒是按**漫剧**节奏定的（知识库实测 2.8–4.3 秒/镜），而真人剧与电影镜头天然更长、
     * 导演手法更多。0830 实弹：真人剧整集平均 6.55 秒、膨胀倍数 0.99（几乎零合并），
     * 这条却照样报「粒度偏粗」——用一个体裁的尺子去量另一个体裁，只会制造噪音 advisory。
     * 真正能跨体裁用的判据是**膨胀倍数**（输出平均镜长 ÷ 输入平均镜长），
     * 它比的是模型有没有把输入合并掉，与体裁无关。
     */
    advisories.push(...longTakeAdvisories);
  }
  const emptyActionCount = (Array.isArray(input.raw.shots) ? input.raw.shots : [])
    .filter((shot) =>
      !String((shot as Record<string, unknown>).actionZh || "").trim()).length;
  if (emptyActionCount > 0) {
    note("empty_action", `${labelZh}有 ${emptyActionCount} 个镜头 actionZh 为空（落库会被丢弃）`);
  }
  if (!String((input.raw as Record<string, unknown>).beatStructureZh || "").trim()) {
    note("empty_beat_structure", `${labelZh} beatStructureZh 为空（落库整段镜头会被丢弃）`);
  }
  if (!hasUsableManhuaTemplateClassification(parsed.data.classification)) {
    note("classification_thin", `${labelZh}五维特征标签不足两个有效维度`);
  }
  const audioResolution = parsed.data.audioResolution;
  if (!input.hasAudio) {
    if (audioResolution.length > 0) {
      note("audio_unexpected", `${labelZh}素材无音轨却返回了 audioResolution`);
    }
    return { raw: input.raw, advisories };
  }
  if (audioResolution.length !== 1 || audioResolution[0]!.chunkIndex !== input.segmentIndex) {
    note(
      "audio_chunk_shape",
      `${labelZh} audioResolution 应恰好为 [{chunkIndex:${input.segmentIndex}}]，实际 ${audioResolution.length} 条`,
    );
    return { raw: input.raw, advisories };
  }
  const analysisParsed = manhuaNativeAudioChunkAnalysisSchema.safeParse(audioResolution[0]!.analysis);
  if (!analysisParsed.success) {
    note("audio_schema_invalid", `${labelZh}音轨 analysis 不合 schema，已原样保留`);
    return { raw: input.raw, advisories };
  }
  const analysis = analysisParsed.data;
  // 环境音也算一段：安静段落只有 1 段音轨、0 条 cue 是合法产出，只记 advisory。
  if (analysis.audioTrack.length < audioFloors.minAudioTracks) {
    note(
      "audio_track_thin",
      `${labelZh}音轨仅 ${analysis.audioTrack.length} 段，低于建议地板 ${audioFloors.minAudioTracks}`,
      deviation(analysis.audioTrack.length, audioFloors.minAudioTracks),
    );
  }
  const cueCount = analysis.audioTrack.reduce((sum, track) => sum + track.cues.length, 0);
  if (cueCount < audioFloors.minAudioCues) {
    note(
      "audio_cue_thin",
      `${labelZh}声音事件仅 ${cueCount} 条，低于建议地板 ${audioFloors.minAudioCues}`,
      deviation(cueCount, audioFloors.minAudioCues),
    );
  }
  advisories.push(...advisoryFromThrow("audio_timeline_invalid", segmentIndex, () => {
    normalizeManhuaNativeAudioChunkAnalysis({
      raw: audioResolution[0]!.analysis,
      chunk: { index: input.segmentIndex, startSec: 0, endSec: lenSec },
    });
  }));
  return { raw: input.raw, advisories };
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
  /**
   * 整形**之前**的输入镜头总数（去重前）。给了它就启用镜头留存率闸。
   * 0830 事故：GLM 把 426 镜压成 99 镜（平均镜长 3.6s→15.4s），而覆盖秒数
   * 一秒不差、无重叠、无编造——**当时所有门禁全绿**。提示词写得再红也只是概率，
   * 机器算得出的东西必须由代码把关。
   */
  inputShotCount?: number;
}): NativeDeepReadAdvisory[] {
  const episodeAdvisories: NativeDeepReadAdvisory[] = [];
  const noteEpisode = (code: string, detailZh: string) =>
    episodeAdvisories.push({ code, detailZh });
  if (!input.rawSegments.length) {
    throw new Error(`第${input.episodeIndex}集没有分段产出，整集拒绝入库`);
  }

  /* ── 🔒 确定性闸一：单镜时长上限（整集卡层，纯算术）── */
  const episodeShots = input.rawSegments.flatMap((raw) =>
    (Array.isArray(raw.shots) ? raw.shots as Array<Record<string, unknown>> : []));
  const overlongShots = episodeShots
    .map((shot) => ({
      startSec: Number(shot.startSec),
      endSec: Number(shot.endSec),
      lenSec: Number(shot.endSec) - Number(shot.startSec),
    }))
    .filter((row) => Number.isFinite(row.lenSec)
      && row.lenSec > NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC);
  if (overlongShots.length > 0) {
    throw gateError(
      `第${input.episodeIndex}集整集卡有 ${overlongShots.length} 条证据超过`
      + ` ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC} 秒（${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒 + 10% 容差）（最长`
      + ` ${Math.max(...overlongShots.map((r) => r.lenSec)).toFixed(1)} 秒，起于`
      + ` ${overlongShots[0]!.startSec.toFixed(1)} 秒）：必须按镜内真实变化拆成连续证据段，`
      + `不许靠丢弃证据满足`,
    );
  }

  /* ── 🔒 确定性闸二：镜头留存率（防「合并到只剩壳」）── */
  const inputShots = Math.max(0, Math.floor(Number(input.inputShotCount) || 0));
  if (inputShots > 0 && episodeShots.length > 0) {
    const keepRate = episodeShots.length / inputShots;
    if (keepRate < NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_REJECT) {
      throw gateError(
        `第${input.episodeIndex}集镜头留存率仅 ${(keepRate * 100).toFixed(1)}%`
        + `（输入 ${inputShots} 镜 → 输出 ${episodeShots.length} 镜，`
        + `低于拒收线 ${(NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_REJECT * 100).toFixed(0)}%`
        + `＝地板 ${(NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_FLOOR * 100).toFixed(0)}% 减 10% 容差）：`
        + `相邻但秒位不重叠的镜头不许合并，只有同一物理镜头的重复记录才能合并`,
      );
    }
  }
  // 门禁在 GLM 之后重跑：整形/修复产物同样零秒位（assertNoClockText 口径）。
  for (const raw of input.rawSegments) {
    try {
      assertRawShotFieldPresence(raw, `第${input.episodeIndex}集`);
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
  // 整集卡不得再出现任何 non_story_ad 镜头行：广告只能以 excludedAdRanges 区间账目存在。
  // （分段卡门禁行为不变——本门禁只吃合并层产物。）
  const residualAdShots = allShots.filter((shot) => shot.evidenceRole === "non_story_ad");
  if (residualAdShots.length > 0) {
    throw new Error(
      `第${input.episodeIndex}集整集卡仍含 ${residualAdShots.length} 个 non_story_ad 镜头行（应整行剔除并写入 excludedAdRanges），整集拒绝入库`,
    );
  }
  // 含 excludedAdRanges 的整集卡：覆盖校验把这些区间视为合法缺口（±0.5s 容差与现行一致）。
  const excludedAdRanges = collectEpisodeExcludedAdRanges(input.rawSegments, input.episodeIndex);
  const coverageIntervals = excludedAdRanges.length
    ? [
      ...allShots.map((shot) => ({ startSec: shot.startSec, endSec: shot.endSec })),
      ...excludedAdRanges,
    ].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
    : allShots;
  /**
   * 🔴 整集覆盖只出 advisory，**不再拒收整集**（0830 用户拍板）。
   *
   * 用户原话：「GLM 就是整形用的，还让他拒绝，有毛病吗」。
   * 段级门禁 v11 已经改成「贴标记不拒收」，集级这条却还留着「整集拒绝入库」——
   * 同一个逻辑没走完。而且代价严重不对等：段级拒收只重买一片视频；
   * **集级拒收是把整集已付费的段证据全部挡在门外**。
   * 0830 实锤：2817 秒的整集，GLM 合并时在分段边界掉了 **6 秒**（0.2%），
   * 整集就被判死——为 0.2% 丢掉 ¥37 的证据，不成比例。
   *
   * 缺口照记 advisory（写明缺哪几秒），交给人看、交给下游决定，不在这里替他们拒。
   */
  try {
    assertShotCoverage(coverageIntervals, 0, Math.round(input.durationSec), "整集");
  } catch (error) {
    noteEpisode(
      "episode_coverage_gap",
      `${error instanceof Error ? error.message : String(error)}（0830 起只记不拒：`
      + "GLM 是整形层，合并掉几秒不该让整集已付费证据全部作废)",
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
  /**
   * 🔓 集级密度门禁全部降 advisory（0829 晚用户拍板）。
   *
   * 一集切 4–8 片、每片 300 秒。集级这些密度闸**逐片**查一遍，等于给一集
   * 4–8 次机会把已付费的整集（¥50 上下）判死；而每一片在段级早已各自卡过一遍。
   *
   * 更硬的证据是算术：段级「尾片 <300 秒免镜数门禁」是用户明令，集级却把尾片
   * 算进分母——8 片实算，7 个满片各 30 镜 + 尾片 12 镜 = 222，集级地板
   * ceil(2278/10) = 228，**每片都合规，整集照死**。集级算的还是 GLM 去重之后的卡，
   * 3–7 个分片边界每个都会减镜，地板却按没去重的标准卡。这是重复计算，不是把关。
   *
   * 集级保留的硬闸只剩**跟切几片无关的结构完整性**：逐镜 17 字段、钟表秒位、
   * 残留 non_story_ad 行、覆盖空档、音轨分片连续、音轨字段缺失、音轨 zod 无效。
   * 密度类（镜数地板、音轨段数、cue 数）一律记 advisory 交人判断。
   */
  const sanityFloor = Math.ceil(
    Math.max(1, storyDurationSec) / NATIVE_DEEP_READ_SHOT_SANITY_FLOOR_INTERVAL_SEC,
  );
  if (storyShots.length < sanityFloor) {
    noteEpisode(
      "episode_shot_density_low",
      `第${input.episodeIndex}集剧情镜头 ${storyShots.length} 个，低于整集参考地板 ${sanityFloor}（招商广告不计入）；段级已逐片记明细，仅提示不拒收`,
    );
  }
  if (input.hasAudio) {
    const entries = input.rawSegments
      .flatMap((raw) => (Array.isArray(raw.audioResolution) ? raw.audioResolution : [])
        .map((row) => row as Record<string, unknown>))
      .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
    const chunkIndexes = entries.map((row) => Number(row.chunkIndex));
    const expected = input.segments.map((_, index) => index);
    // 结构闸（保持硬拒）：少一片音轨就是丢了证据，不是「密度低」。
    if (JSON.stringify(chunkIndexes) !== JSON.stringify(expected)) {
      throw new Error(`第${input.episodeIndex}集音轨分段不完整，整集拒绝入库`);
    }
    for (const entry of entries) {
      const chunkIndex = Number(entry.chunkIndex);
      const segment = input.segments[chunkIndex]!;
      const lenSec = Math.max(1, Math.round(segment.endSec - segment.startSec));
      const floors = resolveNativeDeepReadSegmentFloors(lenSec);
      // 结构闸（保持硬拒）：字段缺失与 zod 无效＝数据不可用。
      try {
        assertRawAudioAnalysisFieldPresence(
          entry.analysis,
          `第${input.episodeIndex}集第${chunkIndex + 1}段`,
        );
      } catch (presenceError) {
        throw new Error(
          `${presenceError instanceof Error ? presenceError.message : presenceError}，整集拒绝入库`,
        );
      }
      const parsed = manhuaNativeAudioChunkAnalysisSchema.safeParse(entry.analysis);
      if (!parsed.success) {
        throw new Error(`第${input.episodeIndex}集第${chunkIndex + 1}段音轨结构无效，整集拒绝入库`);
      }
      // 密度闸 → advisory：环境音也算一段，安静段落只有 1 段是**真实状态**。
      // 用户 0829 明令「音轨侧不设任何拒收线」；这里曾是那条令唯一没落实到的地方。
      const cueCount = parsed.data.audioTrack.reduce((sum, track) => sum + track.cues.length, 0);
      if (parsed.data.audioTrack.length < floors.minAudioTracks) {
        noteEpisode(
          "episode_audio_track_thin",
          `第${chunkIndex + 1}段音轨仅 ${parsed.data.audioTrack.length} 段，低于建议地板 ${floors.minAudioTracks}（安静段落属正常，仅提示）`,
        );
      }
      if (cueCount < floors.minAudioCues) {
        noteEpisode(
          "episode_audio_cue_thin",
          `第${chunkIndex + 1}段声音事件仅 ${cueCount} 条，低于建议地板 ${floors.minAudioCues}（仅提示）`,
        );
      }
    }
  }
  return dedupeNativeDeepReadAdvisories(episodeAdvisories);
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
 * 64 镜动作与原卡逐字一致零虚构）。
 *
 * 0829 统一收口：**每集装配都走 GLM 5.3 结构化整形**，不再分主线/降级两条路。
 * 理由：段边界的重复镜头与截断段的残尾是确定性代码拼不掉的——代码只会把重复原样
 * 拼进整集卡，或因为一段截断整集拒收。GLM 的职责因此明确为「去重 + 结构化」，
 * 输入是本集全部分段卡（合规段 + 带 advisory 段 + truncated 段），一份不丢。
 * 成本：≈$0.3/集（实弹 $0.134 起，长集多段翻倍），相对每段视觉调用 ¥1.2 上下可接受；
 * 0829 实证反面账：一集 6 段因密度拒收重买 3 段白烧 ¥20.5，远贵于每集一次整形。
 * 确定性拼接不再作为快速路，只保留一份用于产出 excludedAdRanges 真值（0830 晚起直接覆盖进整集卡，不再问 GLM）。
 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE = "openrouter_glm_structuring" as const;
/**
 * 整形档**链路标签**（仅用于尚不知道会由哪一档交卷的 "started" 回执）。
 * 0829 改线后主档是 EvoLink `glm-5.3`，兜底才是 OpenRouter `z-ai/glm-5.3`——
 * completed/failed 回执一律记 `structured.model` 真值，不用本常量。
 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL = `${EVOLINK_GLM_MODEL}→${OPENROUTER_GLM_MODEL}`;
/** 开始/失败回执的人话链路标签（0905：用户看了几百次「z-ai/glm-5.3」以为一直走 OpenRouter）。 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_STARTED_LABEL = "GLM-5.3 EvoLink → OpenRouter → Qwen 北京 → 新加坡 → OpenRouter（每档 30 分钟）";
/** 完成回执按实际网关写人话名，面板一眼看出这一发走的是哪家。 */
/** 整形链可接受的网关集合（缓存校验与通道锁共用）。 */
export const STRUCTURING_GATEWAYS: ReadonlySet<string> = new Set<string>([
  ...Array.from(GLM_MODEL_GATEWAYS), ...STRUCTURING_CHAIN_GATEWAYS, ...STRUCTURING_CHAIN_QWEN_FIRST_GATEWAYS,
]);
export function glmGatewayDisplayLabel(gateway: string): string {
  switch (gateway) {
    case "evolink_glm": return "EvoLink";
    case "openrouter": return "OpenRouter";
    case "plan_bj_qwen": return "Qwen北京套餐";
    case "plan_sg_qwen": return "Qwen新加坡套餐";
    case "openrouter_qwen": return "OpenRouter-Qwen";
    case "evolink_qwen": return "EvoLink-Qwen";
    default: return gateway || "未知网关";
  }
}
/**
 * 0905 实弹推翻 262K：EvoLink 400（范围 [1,131072]）、OpenRouter Z.AI 档 404 无端点，两档 GLM 秒败全落 Qwen。
 * 官方表（百炼 GLM-5.3）最大输出 131,072，按此定死。
 */
const GLM_STRUCTURING_MAX_TOKENS = 131_072;
/**
 * 🔒 整形链采样温度（0829 晚用户拍板 0.8）。
 * 不传＝EvoLink 默认 1.0（太飘）；0.2 又太死板，会变成照抄不敢取舍——
 * 而整形的核心动作恰恰是「同秒位多版本里取信息更全的那条」，需要判断力。
 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE = 0.8;
/**
 * 🔒 整形链思考档位（0901 用户拍板恢复 **high**）。
 *
 * 下调依据是 0830 的实弹算术——GLM 的思考与正文**共吃同一个 131,072 预算**：
 *   GLM  effort=high：思考 85,513 → 正文只剩 45,559 → 输出 99 镜（99×455≈45,045，
 *                     几乎一格不剩）→ 平均镜长 15.4 秒，镜头留存率仅 23%
 *   Qwen 思考独立额度：正文拿满 131,072 → 输出 332 镜 → 平均 4.6 秒，留存率 78%
 * 两边喂的是同一份提示词（sha 27c09dc9a68c8e86）。GLM 很可能不是「觉得该合并」，
 * 而是**装不下**——一路合并压缩来适配剩余预算。降档＝把预算从思考挪回正文。
 *
 * 0901 官方契约复核：GLM-5.3 仅接受 low/high/max，medium 不是合法档位；
 * 因此共享常量和两条供应商请求体都统一为 high，避免一条 400、一条被网关隐式映射。
 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT = MANHUA_NATIVE_GLM_REASONING_EFFORT;
/** 四个 300 秒分片的真实组装曾在 12 分钟边界被本地中止；只放宽等待，不自动重提。 */
// 0829 曾放宽到 6 小时（15 分钟硬顶曾在 900,005ms 掐断成 network_error）。
// 0905 用户令：**每一档 30 分钟**，超时自动切下一档——
// EvoLink GLM → OpenRouter GLM → Qwen 北京套餐 → Qwen 新加坡套餐 → OpenRouter Qwen；
// 五档全失败才走本地确定性整形兜底，不重读片。
const GLM_STRUCTURING_TIMEOUT_MS = 30 * 60_000;
const OPENROUTER_USD_TO_CNY_EQUIVALENT = 7.2;

/** GLM结构化的完整冻结参数；调用方只能由调度器指定首选通道，不能覆盖这些值。 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_CONFIG = deepFreezeNativeContract({
  maxTokens: GLM_STRUCTURING_MAX_TOKENS,
  gatewayPolicy: "structuring_chain" as const,
  timeoutMs: GLM_STRUCTURING_TIMEOUT_MS,
  temperature: NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE,
  reasoningEffort: NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT,
  requireParameters: true,
  requireFinishReasonStop: true,
} as const);

/**
 * 0905 用户令（推翻 0902「恒定 EvoLink 首发」）：并发批次必须分到不同通道真并行——
 * 同通道有租约，两批都首发 EvoLink 就是排队＝串行（0904 夜实测第二批 21 分钟即此）。
 * 按整形开关取链首两档轮流首发；失败仍由网关层按链序逐档切换，GLM 两档败即到 Qwen（反之亦然）。
 */
const structuringRoundRobin = new Map<string, number>();
export function nextNativeDeepReadGlmPreferredGateway(
  policy: "structuring_chain" | "structuring_chain_qwen_first" = "structuring_chain",
): GlmGatewayName {
  const pair = (policy === "structuring_chain_qwen_first"
    ? STRUCTURING_CHAIN_QWEN_FIRST_GATEWAYS
    : STRUCTURING_CHAIN_GATEWAYS).slice(0, 2);
  const next = (structuringRoundRobin.get(policy) ?? 0) % pair.length;
  structuringRoundRobin.set(policy, next + 1);
  return pair[next]!;
}

/**
 * 🔒 0902 用户三次当场授权的解冻均已改毕，**现已重新冻结**：
 *   ① 新增 classificationProseZh 五维连贯判词 + shots[].craftReadZh 逐镜解读
 *   ② craftReadZh 收紧为全集最多 30 条最有价值镜头（16 分钟→省回一半产出）
 *   ③ 新增 templateTitleZh 卡名（「多维标签·原生第N集节奏」罐头名太水，用户令模板卡名必须写主线与特色）
 * 任何再改动必须由用户在当前任务重新授权，禁止以任何理由自行调整。
 */
export function buildNativeDeepReadGlmStructuringPrompt(input: {
  episodeIndex: number;
  durationSec: number;
  segments: readonly NativeDeepReadSegmentSpec[];
  hasAudio: boolean;
  rawSegments: ReadonlyArray<Record<string, unknown>>;
  rejectedReasonZh?: string;
  coverageStartSec?: number;
  coverageEndSec?: number;
  segmentIndexes?: readonly number[];
  scopeZh?: "批次" | "整集";
}): { system: string; user: string } {
  const coverageStartSec = Number.isFinite(input.coverageStartSec)
    ? Number(input.coverageStartSec)
    : 0;
  const coverageEndSec = Number.isFinite(input.coverageEndSec)
    ? Number(input.coverageEndSec)
    : input.durationSec;
  const scopeZh = input.scopeZh || "整集";
  return {
    system: `你是影视模板卡的「结构化整形师」，擅长把零碎的片段整理成有参考价值的内容。输入是同一集的多份证据卡，你并成一张${scopeZh}卡。
职责是在输入内容范围内取舍与归并：可润色文句、不必统一文风，每条产出都要能在输入里找到出处。

**一、镜头**
判准只有一条：输出的 shots 是**一组互不重叠、首尾相接的区间**，连续覆盖整段（广告秒位除外），任何一秒恰好由一条 story 记录覆盖。
· 能并的只有**秒位重叠的重复记录**（同一物理镜头记了两遍，来自段边界或多版本）。
· 秒位不重叠的两条镜头各自保留——哪怕表演连续、同场景同机位。
· 真实剪辑镜头按输入边界保留，短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒或相邻时长相同也各自保留；${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒下限仅适用于同一长镜的拆分证据段。
· 单次合并跨度 ≤ ${NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC} 秒；单条记录跨度 ≤ ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒。更长的长镜按镜内真实变化切成首尾相接的证据段，每段 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}–${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，unitTypeZh 写「拆分镜证据段」，第二段起 transitionInZh 写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。
· 唯一合法手段是**调整切分**。hintZh/unitTypeZh/shotSizeZh/angleZh/compositionZh/cameraMoveZh/blockingZh/bodyActionZh/limbPropActionZh/microExpressionZh/gazeBreathZh/relationshipReactionZh/lightingZh/actionZh/transitionInZh 逐项随记录保留；**输入里没有的字段不要补写**（简写镜只有 startSec/endSec/evidenceRole/hintZh/actionZh，保持原样）。

**二、多版本裁决**
同段可能同时喂来通过版与被标记版，通过的未必更好。**记录去重、信息取并集**：同一物理镜头只留一条，但吸收所有版本对它的观察。
顺序（保证同输入同结果）：① 以未标记未截断那版作骨架，没有则取 attemptNumber 最大的 ② 切分粗细不同时以更细的为准 ③ 秒位重叠的合并、字段取更具体那版原文，秒位不重叠的全保留。
truncated / advisories / gateMarked / gateMarkedZh / attemptNumber 标注的都是真实产出，已写出的照常采纳；截断段尾部缺失就保持缺失。标记字段本身跳过。

**三、其余字段**
· 广告镜：evidenceRole=non_story_ad 整行剔除。
· subtitles：story 区间并集去重，按全片绝对秒位排序；条数多寡不作要求。
· audioResolution：保留完整听觉证据；audioBeatStructureZh/mixNotesZh/reusableAudioZh/genAudioHintZh 只从 story 提炼。
· shots[].hintZh：逐镜原样保留，和来源起止范围绑定；不同观察各自保留，历史输入缺该字段时保持缺省。
· keyMoments：原样保留，同秒同类留一条取说明更具体的，不同秒或不同类全保留；atSec 只来自输入。
· classification：五个数组显式输出，有证据就写，无证据写 []。
· shots[].craftReadZh：可选新字段，**全集最多写 30 条，只挑手法价值最高的镜头**（剧情转折处的运镜、罕见的剪辑技巧、景别陡跳、站位改写、情绪极性翻转、昼夜跨场——按参考价值排序取前 30）。中选的镜写一句 6–20 字的「手法·用意与预期效果」解读（例「怼至大特写·情绪显微镜」「夜转日跨场·时间跳进」「合围站位·困局成型」）；判读只能以该镜与前镜**已记录的字段**为据，不许虚构画面；其余镜头一律写 "" 或省略该字段（0902 拍板：全量逐镜写解读把产出撑到 5.7 万 token、整形拖到 16 分钟，收紧到 30 条换回速度，未中选镜头由渲染端词典兜底）。同类手法反复出现时必须换不同措辞点出当次的具体用意，不许复读同一句。
· templateTitleZh：顶层新字段，给这张模板卡起 **10–20 字的卡名**，格式「主线一句话·特色型」（例「杂役捡宝炼丹逆袭·金手指验证型」「寒门修士步步登阶·隐忍蓄力型」）。必须点出**本集独有**的剧情主线与手法特色；🚫 禁止出现「多维标签」「原生」「第N集」「节奏」「模板」「系列」这类放之任何剧都成立的通用词。
· classificationProseZh：顶层新对象，五键 emotionZh/narrativeZh/performanceZh/audiovisualZh/audienceZh，分别对应情绪/叙事特色/表演/视听/观众体验。把该维标签织成**一到两句连贯陈述**，点出这一集独有的组合与用意（例：「情绪线以紧张、愤怒打底，中段被角色牺牲翻入绝望，收在决绝的反击里」），不许罗列词条式排比、不许写放之任何剧都成立的空话；每句都要能在证据里找到出处，无证据的维度写空字符串 ""。
· 秒位只进数字字段。描述里写时长（如「1.2 秒内推近」），钟表式（01:23）留给数字字段。

**四、输出**：只返回一个 JSON 对象，无 Markdown 围栏、无解释。

**五、三条红线**
1. 不虚构输入里没有的镜头、字幕、声音或描述（craftReadZh 与 classificationProseZh 是仅有的两处**推导**字段，允许解读但同样只能以输入为据）。
2. 不为了精简而合并不重叠的镜头。
3. 不新增 keyMoments 的 atSec。`,
    user: `把以下同一集的 ${input.rawSegments.length} 份证据卡整形合并成**一张${scopeZh}原生证据卡**（单个 JSON 对象，字段 schema 与分段卡完全相同：shots/subtitles/audioResolution/beatStructureZh/moodArcZh/classification/reusableZh/genPromptHintZh，另加顶层可选 excludedAdRanges、classificationProseZh 与 templateTitleZh）。
要求：
1. story 镜头连续无空档覆盖除 excludedAdRanges 外的全时间轴 ${Math.round(coverageStartSec)}..${Math.round(coverageEndSec)} 秒（绝对秒位），每镜保留 evidenceRole；🔴 **只有秒位重叠的重复记录可以合并；相邻不重叠的镜头一律各自保留**——${scopeZh}输出的镜头条数应与输入去重后的真实切分相当，**镜头数大幅变少、平均镜长明显拉长即为错误产出**。non_story_ad 必须整行剔除并把 {startSec,endSec} 区间记入顶层 excludedAdRanges，不得混入 story。🔒 一次合并的总跨度不得超过 ${NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC} 秒；真实剪辑镜头按输入边界保留，短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒或相邻时长相同也各自保留；超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒的同一长镜按镜内真实变化拆成连续证据段，每段 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}—${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，且不得删除仍需保留的「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」续接标记或丢失覆盖。
2. audioResolution 保留全部 [{chunkIndex,analysis}] 条目（chunkIndex 即段号，analysis 内为该段局部秒），逐段齐全${input.hasAudio ? "" : "；本集素材无音轨，audioResolution 保持空数组"}。
3. beatStructureZh/moodArcZh/reusableZh/genPromptHintZh 只整合 story 证据，可加「第X段」标注；classification 五维标签只取 story 输入并集，不得补猜；另按 system 要求输出顶层 classificationProseZh 五句连贯判词（每维一到两句、只依据证据）。
3.9 subtitles 按 keyMoments 解析：每条字幕对应其秒位附近的重点时刻，**不设条数多寡的判断**。照原文合并去重即可，不得补写输入里没有的台词。
4. 输入是本集**全部**产出：合规段、带 advisories 的段、truncated 截断段、被门禁标记（gateMarked）的版本都在其中，一份都不许丢。**同一段可能有多个版本**，按秒位合并去重后取信息更全的；截断段照常采纳已有内容、不补写尾部；段边界的重复镜头/字幕/声音事件同样按秒位合并。
${scopeZh}元数据：${JSON.stringify({
      episodeIndex: input.episodeIndex,
      durationSec: Math.round(input.durationSec),
      coverageStartSec,
      coverageEndSec,
      segments: input.segments.map((segment, index) => ({
        segmentIndex: input.segmentIndexes?.[index] ?? index,
        startSec: Math.round(segment.startSec),
        endSec: Math.round(segment.endSec),
      })),
    })}
${input.rejectedReasonZh ? `【上一轮门禁被拒原因】${String(input.rejectedReasonZh).slice(0, 300)}\n` : ""}分段卡 JSON：${JSON.stringify(input.rawSegments)}`,
  };
}

/** 两条GLM通道都不可用时的零模型兜底；只做排序、同键去重和字段并集，不创作内容。 */
/** 字幕只保留落在任一 keyMoment.atSec ±windowSec 内的条目；没有 keyMoments 时原样返回（不敢清空）。 */
export function filterNativeDeepReadSubtitlesToKeyMoments(
  raw: Record<string, unknown>,
  windowSec = 2,
): Record<string, unknown> {
  const keyMoments = Array.isArray(raw.keyMoments)
    ? (raw.keyMoments as unknown[])
        .map((row) => Number((row as { atSec?: unknown })?.atSec))
        .filter((value) => Number.isFinite(value))
    : [];
  if (!keyMoments.length || !Array.isArray(raw.subtitles)) return raw;
  const subtitles = (raw.subtitles as unknown[]).filter((row) => {
    const atSec = Number((row as { atSec?: unknown })?.atSec);
    return Number.isFinite(atSec) && keyMoments.some((moment) => Math.abs(moment - atSec) <= windowSec);
  });
  if (subtitles.length === (raw.subtitles as unknown[]).length) return raw;
  return { ...raw, subtitles };
}

export function deterministicallyMergeNativeDeepReadRawSegments(
  rawSegments: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  const normalizedRawSegments = rawSegments.map(unwrapNativeDeepReadStructuredAnswerEnvelope);
  const records = (key: string): Record<string, unknown>[] => normalizedRawSegments.flatMap((raw) =>
    Array.isArray(raw[key])
      ? (raw[key] as unknown[]).filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      : []);
  const chooseMoreSpecific = (rows: Record<string, unknown>[], keyOf: (row: Record<string, unknown>) => string) => {
    const selected = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const current = selected.get(key);
      if (!current || JSON.stringify(row).length > JSON.stringify(current).length) selected.set(key, row);
    }
    return Array.from(selected.values());
  };
  const allShots = records("shots");
  const excludedAdRanges = chooseMoreSpecific(
    allShots.filter((shot) => shot.evidenceRole === "non_story_ad"),
    (shot) => `${Number(shot.startSec)}:${Number(shot.endSec)}`,
  ).map((shot) => ({ startSec: Number(shot.startSec), endSec: Number(shot.endSec) }))
    .filter((span) => Number.isFinite(span.startSec) && Number.isFinite(span.endSec) && span.endSec > span.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const shots = chooseMoreSpecific(
    allShots.filter((shot) => shot.evidenceRole !== "non_story_ad"),
    (shot) => `${Number(shot.startSec)}:${Number(shot.endSec)}:${String(shot.evidenceRole || "story")}`,
  ).sort((a, b) => Number(a.startSec) - Number(b.startSec) || Number(a.endSec) - Number(b.endSec));
  const keyMoments = chooseMoreSpecific(records("keyMoments"),
    (row) => `${Number(row.atSec)}:${String(row.kindZh || "")}`)
    .sort((a, b) => Number(a.atSec) - Number(b.atSec));
  const subtitles = chooseMoreSpecific(records("subtitles"),
    (row) => `${Number(row.atSec)}:${String(row.textZh || "")}`)
    .sort((a, b) => Number(a.atSec) - Number(b.atSec));
  const audioResolution = chooseMoreSpecific(records("audioResolution"),
    (row) => String(Number(row.chunkIndex)))
    .sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
  const classification = Object.fromEntries(MANHUA_TEMPLATE_CLASSIFICATION_KEYS.map((key) => [
    key,
    Array.from(new Set(normalizedRawSegments.flatMap((raw) => {
      const value = (raw.classification as Record<string, unknown> | undefined)?.[key];
      return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
    }))),
  ]));
  const joinText = (key: string) => normalizedRawSegments.map((raw, index) => {
    const text = String(raw[key] || "").trim();
    return text ? `第${index + 1}段：${text}` : "";
  }).filter(Boolean).join("\n");
  return {
    shots,
    keyMoments,
    subtitles,
    audioResolution,
    beatStructureZh: joinText("beatStructureZh"),
    moodArcZh: joinText("moodArcZh"),
    reusableZh: joinText("reusableZh"),
    genPromptHintZh: joinText("genPromptHintZh"),
    classification,
    excludedAdRanges,
    structuringFallback: {
      kind: "deterministic_local",
      reasonZh: "两条GLM-5.3正式整形通道均未交付可消费结果；仅按输入原文确定性去重合并",
    },
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
    system: `你是影视模板卡的「JSON 语法修复师」。只修语法不创作：
1. 输入是一份 JSON 语法损坏的分段卡原文；你的唯一任务是恢复成合法 JSON。
2. 禁止虚构原文里没有的镜头、字幕、声音或描述；禁止删减原文已有的内容。shots 内 hintZh/unitTypeZh/shotSizeZh/angleZh/compositionZh/cameraMoveZh/blockingZh/bodyActionZh/limbPropActionZh/microExpressionZh/gazeBreathZh/relationshipReactionZh/lightingZh/actionZh/transitionInZh 必须逐项原样恢复，不能压回 actionZh；**原文没有的字段不要补写**（简写镜本就只有 startSec/endSec/evidenceRole/hintZh/actionZh）。
3. 原文若被截断，保留能恢复的完整条目，丢弃最后一条残缺条目，不要补写。
4. shots 中的 evidenceRole 只能原样恢复为 story 或 non_story_ad，禁止猜测、改写或把 non_story_ad 混入 story；原文缺失该字段则修复失败。
5. 所有中文描述文本【禁止】出现钟表式秒位（如 01:23）或「在第X秒」定位——秒位只进数字字段。
6. classification 必须显式输出 emotionTagsZh/narrativeFeatureTagsZh/performanceTagsZh/audiovisualTagsZh/audienceExperienceTagsZh 五个数组；**有证据就写，原文没有的维度写 []**；🔴 不得为了凑数量而编造标签。
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
  videoFps?: number;
  hintZh?: string;
  /** 0903 双模型：缺省＝3.1 Pro，与历史指纹一致；换模型＝新指纹，不吃错缓存。 */
  model?: ManhuaNativeDeepReadModelId;
}): string {
  const fps = resolveNativeDeepReadRequestFps(input.segment.endSec - input.segment.startSec, input.videoFps);
  const prompt = buildGeminiNativeDeepReadSegmentPrompt({
    episodeDurationSec: input.episodeDurationSec,
    startSec: input.segment.startSec,
    endSec: input.segment.endSec,
    segmentIndex: input.segmentIndex,
    segmentCount: input.segmentCount,
    hasAudio: input.hasAudio,
    videoFps: fps,
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
    model: input.model ?? NATIVE_DEEP_READ_MODEL,
    glmRepairModel: NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL,
    responseSchema: buildNativeDeepReadResponseSchema({ ...input.segment, segmentIndex: input.segmentIndex, hasAudio: input.hasAudio }),
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
  evidence?: NativeDeepReadGlmEvidence;
  /** true 表示复用了历史已付费永久证据；本轮不得重复记账或伪造模型运行回执。 */
  recoveredPaidEvidence?: boolean;
  /** 实际交卷网关与模型 id（回执记真值，不用常量硬写）。 */
  gateway: GlmGatewayName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** OpenRouter 返回的 usage.cost 直记（USD） */
  costUsd: number;
  provider?: string;
  providerRequestId?: string;
  finishReason?: string;
};

export type NativeDeepReadStructuredBatchCacheEntry = {
  schemaVersion: 1;
  frozenContractSha256: string;
  seriesKey: string;
  sourceDigest: string;
  episodeIndex: number;
  segmentIndexes: number[];
  inputDigest: string;
  raw: Record<string, unknown>;
  evidence?: NativeDeepReadGlmEvidence;
  gateway: GlmGatewayName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  savedAtIso: string;
  source: "formal" | "manual_import";
};

function nativeDeepReadStructuredBatchInputDigest(
  rawSegments: ReadonlyArray<Record<string, unknown>>,
): string {
  return crypto.createHash("sha256").update(JSON.stringify(rawSegments), "utf8").digest("hex");
}

function nativeDeepReadStructuredBatchObjectName(input: {
  seriesKey: string;
  sourceDigest: string;
  episodeIndex: number;
  segmentIndexes: readonly number[];
  inputDigest: string;
}): string {
  if (!/^[0-9A-Za-z_-]{1,40}$/.test(input.seriesKey)) throw new Error("整形批次seriesKey无效");
  if (!/^[a-f0-9]{64}$/.test(input.sourceDigest) || !/^[a-f0-9]{64}$/.test(input.inputDigest)) {
    throw new Error("整形批次来源或输入摘要无效");
  }
  if (!Number.isSafeInteger(input.episodeIndex) || input.episodeIndex < 1) throw new Error("整形批次集号无效");
  if (!input.segmentIndexes.length || input.segmentIndexes.some((index) => !Number.isSafeInteger(index) || index < 0)) {
    throw new Error("整形批次段号无效");
  }
  return `manhua-template-learn/native-structuring-cache/${input.seriesKey}/${input.sourceDigest}`
    + `/ep-${String(input.episodeIndex).padStart(3, "0")}/segments-${input.segmentIndexes.join("-")}`
    + `/${NATIVE_DEEP_READ_FROZEN_CONTRACT_SHA256}-${input.inputDigest}.json`;
}

export function nativeDeepReadStructuredBatchCallId(input: {
  seriesKey: string;
  sourceDigest: string;
  episodeIndex: number;
  segmentIndexes: readonly number[];
  rawSegments: ReadonlyArray<Record<string, unknown>>;
}): string {
  const inputDigest = nativeDeepReadStructuredBatchInputDigest(input.rawSegments);
  const objectName = nativeDeepReadStructuredBatchObjectName({ ...input, inputDigest });
  return `native-structuring-${crypto.createHash("sha256").update(objectName, "utf8").digest("hex")}`;
}

export async function readNativeDeepReadStructuredBatchCache(input: {
  seriesKey: string;
  sourceDigest: string;
  episodeIndex: number;
  segmentIndexes: readonly number[];
  rawSegments: ReadonlyArray<Record<string, unknown>>;
}): Promise<NativeDeepReadStructuredBatchCacheEntry | null> {
  const inputDigest = nativeDeepReadStructuredBatchInputDigest(input.rawSegments);
  const objectName = nativeDeepReadStructuredBatchObjectName({ ...input, inputDigest });
  let buffer: Buffer;
  try {
    ({ buffer } = await downloadGcsObject({
      gcsUri: `gs://mv-studio-pro-vertex-video-temp/${objectName}`,
    }));
  } catch (error) {
    if (/gcs_download_failed:404/.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
  const parsed = JSON.parse(buffer.toString("utf8")) as NativeDeepReadStructuredBatchCacheEntry;
  if (
    parsed.schemaVersion !== 1
    || parsed.frozenContractSha256 !== NATIVE_DEEP_READ_FROZEN_CONTRACT_SHA256
    || parsed.seriesKey !== input.seriesKey
    || parsed.sourceDigest !== input.sourceDigest
    || parsed.episodeIndex !== input.episodeIndex
    || parsed.inputDigest !== inputDigest
    || JSON.stringify(parsed.segmentIndexes) !== JSON.stringify(input.segmentIndexes)
    || !parsed.raw || typeof parsed.raw !== "object" || Array.isArray(parsed.raw)
    || !STRUCTURING_GATEWAYS.has(parsed.gateway)
  ) throw new Error("整形批次缓存身份或契约不一致，停止复用");
  return parsed;
}

export async function writeNativeDeepReadStructuredBatchCache(
  entry: NativeDeepReadStructuredBatchCacheEntry,
): Promise<NativeDeepReadStructuredBatchCacheEntry> {
  if (
    entry.schemaVersion !== 1
    || entry.frozenContractSha256 !== NATIVE_DEEP_READ_FROZEN_CONTRACT_SHA256
    || !entry.raw || typeof entry.raw !== "object" || Array.isArray(entry.raw)
    || !STRUCTURING_GATEWAYS.has(entry.gateway)
    || !Number.isFinite(entry.inputTokens) || entry.inputTokens < 0
    || !Number.isFinite(entry.outputTokens) || entry.outputTokens < 0
    || !Number.isFinite(entry.reasoningTokens) || entry.reasoningTokens < 0
    || !Number.isFinite(entry.costUsd) || entry.costUsd < 0
    || Number.isNaN(Date.parse(entry.savedAtIso))
    || (entry.source !== "formal" && entry.source !== "manual_import")
  ) {
    throw new Error("整形批次缓存内容或冻结契约无效，禁止写入");
  }
  const objectName = nativeDeepReadStructuredBatchObjectName(entry);
  const buffer = Buffer.from(JSON.stringify(entry), "utf8");
  const written = await uploadBufferToGcsIfAbsent({
    bucket: "mv-studio-pro-vertex-video-temp",
    objectName,
    buffer,
    contentType: "application/json",
  });
  if (!written.created) {
    const { buffer: existingBuffer } = await downloadGcsObject({
      gcsUri: `gs://mv-studio-pro-vertex-video-temp/${objectName}`,
    });
    const existing = JSON.parse(existingBuffer.toString("utf8")) as NativeDeepReadStructuredBatchCacheEntry;
    const { savedAtIso: _existingSavedAtIso, ...existingIdentity } = existing;
    const { savedAtIso: _entrySavedAtIso, ...entryIdentity } = entry;
    if (JSON.stringify(existingIdentity) !== JSON.stringify(entryIdentity)) {
      throw new Error("整形批次缓存已存在但内容不同，禁止覆盖");
    }
    return existing;
  }
  return entry;
}

export async function invokeNativeDeepReadGlmStructuring(
  prompt: { system: string; user: string },
  abortSignal?: AbortSignal,
  context?: NativeDeepReadGlmEvidenceContext,
  deps?: { invoke?: typeof invokeGlmJsonChatWithGatewayFallback; evidence?: NativeDeepReadGlmEvidenceDeps },
): Promise<NativeDeepReadGlmStructuringResult> {
  const requestWithoutPreferredGateway = {
    system: prompt.system,
    user: prompt.user,
    ...NATIVE_DEEP_READ_GLM_STRUCTURING_CONFIG,
    // 整形开关只改链序（首发哪家），其余冻结参数原样
    gatewayPolicy: context?.gatewayPolicy ?? NATIVE_DEEP_READ_GLM_STRUCTURING_CONFIG.gatewayPolicy,
  };
  if (context?.recoverExisting) {
    const recovered = await readNativeDeepReadGlmRecoveredEvidence({
      context,
      expectedRequestWithoutPreferredGateway: requestWithoutPreferredGateway,
      deps: deps?.evidence,
    });
    if (recovered) {
      const usage = recovered.response.usage;
      return {
        raw: recovered.parsed,
        evidence: recovered.evidence,
        recoveredPaidEvidence: true,
        gateway: recovered.response.gateway,
        model: recovered.response.model,
        inputTokens: Math.max(0, Number(usage?.prompt_tokens) || 0),
        outputTokens: Math.max(0, Number(usage?.completion_tokens) || 0),
        reasoningTokens: Math.max(0, Number(usage?.completion_tokens_details?.reasoning_tokens) || 0),
        costUsd: Math.max(0, Number(usage?.cost) || 0),
        provider: String(recovered.response.provider || "").trim() || undefined,
        providerRequestId: String(recovered.response.providerRequestId || "").trim() || undefined,
        finishReason: String(recovered.response.finishReason || "").trim() || undefined,
      };
    }
  }
  const preferredGlmGateway = (context?.preferredGlmGateway
    || nextNativeDeepReadGlmPreferredGateway(context?.gatewayPolicy)) as GlmGatewayName;
  const store = createNativeDeepReadGlmEvidenceStore({ ...context, preferredGlmGateway }, deps?.evidence);
  let raw: Record<string, unknown> | undefined;
  const request = { ...requestWithoutPreferredGateway, preferredGlmGateway };
  // 请求先永久留存；回调在bailian解析SSE/JSON前await，保存失败不得另烧备用。
  await store.writeRequest(request);
  await context?.onBeforePaidCall?.();
  const response = await (deps?.invoke ?? invokeGlmJsonChatWithGatewayFallback)({
    ...request,
    abortSignal,
    onRawResponse: async (response) => { await store.writeRawResponse(response); },
    validateContent: (content) => {
      store.assertRawResponseSaved();
      raw = parseJsonObject(content);
    },
    onGatewayFallback: context?.onGatewayFallback,
  });
  // 通道锁：只接受整形链五档（GLM 两档 + Qwen 三档）；判据复用 bailianChat 的单一真源。
  if (!STRUCTURING_GATEWAYS.has(response.gateway) || !raw) {
    throw new Error("GLM 结构化整形通道锁失效或未返回 JSON");
  }
  const result: NativeDeepReadGlmStructuringResult = {
    raw,
    gateway: response.gateway,
    model: response.model,
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
  try {
    // 解析原稿在任何广告处理、映射和门禁消费前独立保存，绝不覆盖原始响应。
    result.evidence = await store.writeParsed(raw, {
      gateway: response.gateway,
      model: response.model,
      provider: result.provider,
      providerRequestId: result.providerRequestId,
      finishReason: result.finishReason,
      usage: response.usage,
      gatewayTrace: response.gatewayTrace,
    });
  } catch {
    // 该请求已付费：保存失败仍带出已知用量，但不能重发GLM或消费未留存对象。
    throw new GlmGatewayError("整集GLM解析证据保存失败，已停止消费且不再调用模型", response.gatewayTrace, {
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens, costUsd: result.costUsd,
    });
  }
  return result;
}

/* ────────────────── 主执行：每段一次调用 + EvoLink 兜底 ────────────────── */

export type NativeDeepReadBatchRunnerDeps = {
  prepareVideos: typeof prepareEpisodeVideos;
  remove: typeof deleteGcsObject;
  postVertex: (body: unknown, signal?: AbortSignal, context?: NativeDeepReadSegmentContext, model?: ManhuaNativeDeepReadModelId) => Promise<NativeDeepReadModelResponse>;
  postEvolink: (body: unknown, signal?: AbortSignal, context?: NativeDeepReadSegmentContext, model?: ManhuaNativeDeepReadModelId) => Promise<NativeDeepReadModelResponse>;
  signReadUrl: typeof signGsUriV4ReadUrl;
  invokeGlmStructuring: typeof invokeNativeDeepReadGlmStructuring;
  selectAttemptWithQwen: typeof selectNativeDeepReadAttemptWithQwen;
  readSegmentCache: typeof readNativeDeepReadSegmentCacheEntry;
  writeSegmentCache: typeof writeNativeDeepReadSegmentCacheEntry;
  readRawAttemptEvidence: typeof readNativeDeepReadRawAttemptEvidence;
  writeRawAttemptEvidence: typeof writeNativeDeepReadRawAttemptEvidence;
  writeParsedAttemptEvidence: typeof writeNativeDeepReadParsedAttemptEvidence;
  readStructuredBatchCache: typeof readNativeDeepReadStructuredBatchCache;
  writeStructuredBatchCache: typeof writeNativeDeepReadStructuredBatchCache;
  waitForRetry: typeof waitForNativeDeepReadRetry;
};

const defaultBatchRunnerDeps: NativeDeepReadBatchRunnerDeps = {
  prepareVideos: prepareEpisodeVideos,
  remove: deleteGcsObject,
  postVertex: postVertexNativeDeepRead,
  postEvolink: postEvolinkNativeDeepRead,
  signReadUrl: signGsUriV4ReadUrl,
  invokeGlmStructuring: invokeNativeDeepReadGlmStructuring,
  selectAttemptWithQwen: selectNativeDeepReadAttemptWithQwen,
  readSegmentCache: readNativeDeepReadSegmentCacheEntry,
  writeSegmentCache: writeNativeDeepReadSegmentCacheEntry,
  readRawAttemptEvidence: readNativeDeepReadRawAttemptEvidence,
  writeRawAttemptEvidence: writeNativeDeepReadRawAttemptEvidence,
  writeParsedAttemptEvidence: writeNativeDeepReadParsedAttemptEvidence,
  readStructuredBatchCache: readNativeDeepReadStructuredBatchCache,
  writeStructuredBatchCache: writeNativeDeepReadStructuredBatchCache,
  waitForRetry: waitForNativeDeepReadRetry,
};

/** 探针复用生产通道；返回副本，注入审计或已有分片时不污染生产默认依赖。 */
export function createNativeDeepReadRunnerDeps(
  overrides: Partial<NativeDeepReadBatchRunnerDeps> = {},
): NativeDeepReadBatchRunnerDeps {
  return { ...defaultBatchRunnerDeps, ...overrides };
}

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

/** 从段卡 raw 里读回持久化的 advisory（缓存命中/断点恢复路径用）。 */
function readSegmentAdvisories(
  raw: Record<string, unknown>,
  segmentIndex: number,
): NativeDeepReadAdvisory[] {
  const rows = Array.isArray(raw.advisories) ? raw.advisories : [];
  return rows.flatMap((row) => {
    const record = (row || {}) as Record<string, unknown>;
    const code = String(record.code || "").trim();
    const detailZh = String(record.detailZh || "").trim();
    if (!code || !detailZh) return [];
    return [{
      code,
      detailZh,
      segmentIndex: Number.isInteger(record.segmentIndex)
        ? Number(record.segmentIndex)
        : segmentIndex,
    }];
  });
}

export const NATIVE_DEEP_READ_QWEN_SELECTION_CODE = "qwen_three_attempts_pick_one";

type SegmentAttemptResult = {
  raw: Record<string, unknown>;
  /** 段门禁收集到的改进建议（0829 起只贴标记，不丢内容）。 */
  advisories: NativeDeepReadAdvisory[];
  /** 上游 MAX_TOKENS 截断但已保留可解析前缀。 */
  truncated?: boolean;
  inputTokens: number;
  outputTokens: number;
  audioInputTokens: number;
  reasoningTokens: number;
  visualRoute: NativeDeepReadVisualRoute;
  finishReason?: string;
  providerRequestId?: string;
  rawAttemptEvidenceObjectName?: string;
  requestFingerprint?: string;
};

type NativeDeepReadQwenSelectionMarker = {
  status: "qwen_selected_after_three_attempts";
  selectorContractSha256: string;
  selectedAttemptNumber: number;
  selectedTemperature: number;
  selectedPassedGate: boolean;
  reasonZh: string;
  selectorCallId: string;
  selectorRequestObjectName: string;
  selectorRawObjectNames: string[];
  selectorParsedObjectName: string;
};

export function readCurrentQwenAttemptSelection(
  raw: Record<string, unknown>,
): NativeDeepReadQwenSelectionMarker | null {
  const value = raw.attemptSelection as Partial<NativeDeepReadQwenSelectionMarker> | undefined;
  if (
    !value
    || value.status !== "qwen_selected_after_three_attempts"
    || value.selectorContractSha256 !== NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONTRACT_SHA256
    || !Number.isInteger(value.selectedAttemptNumber)
    || value.selectedTemperature !== NATIVE_DEEP_READ_RETRY_TEMPERATURES[Number(value.selectedAttemptNumber) - 1]
    || typeof value.selectedPassedGate !== "boolean"
    || !String(value.reasonZh || "").trim()
    || !String(value.selectorCallId || "").startsWith("native-segment-selection-")
    || !String(value.selectorRequestObjectName || "").startsWith("manhua-template-learn/segment-selection-evidence/")
    || !Array.isArray(value.selectorRawObjectNames) || value.selectorRawObjectNames.length < 1
    || !String(value.selectorParsedObjectName || "").startsWith("manhua-template-learn/segment-selection-evidence/")
  ) return null;
  return value as NativeDeepReadQwenSelectionMarker;
}

/** 收到明确 HTTP 失败响应的错误（结果确定），可按路由铁律换通道重试。 */
type HttpFailure = Error & { nativeDeepReadHttpStatus?: number };

function isNativeDeepReadResourceExhausted(error: unknown): boolean {
  const status = Number((error as HttpFailure | undefined)?.nativeDeepReadHttpStatus);
  const provider = nativeProviderReceiptFromError(error);
  const text = `${error instanceof Error ? error.message : String(error)} ${provider?.code || ""} ${provider?.message || ""}`;
  return status === 503 || status === 429 || /RESOURCE_EXHAUSTED|resource exhausted/i.test(text);
}

/** 路由标签必须反映本次任务实际读片模型，不得写死（0904：选 flash 曾显示 3.1 Pro）。 */
function routeLabelZh(route: NativeDeepReadVisualRoute, readModel: ManhuaNativeDeepReadModelId): string {
  const model = MANHUA_NATIVE_DEEP_READ_MODEL_LABELS[readModel] ?? readModel;
  return route === NATIVE_DEEP_READ_ROUTE_EVOLINK
    ? `EvoLink ${model} 视频精读（兜底）`
    : `Vertex ${model} 视频精读`;
}

/**
 * 一次请求读取一集（逐段调用），回传后按段合并成集卡。
 * 只有门禁失败才按 0.7→0.65→0.6 降档，每档间隔 60 秒（RETRY_INTERVAL_MS）；
 * 503/429/RESOURCE_EXHAUSTED 走另一条线：隔 30 秒（RESOURCE_RETRY_INTERVAL_MS）
 * 保持当前温度重试，最多 4 次（RESOURCE_RETRY_MAX），不消耗降档次数。
 * 用户中止、证据保存失败和其他传输错误立即终止。
 */
export type NativeDeepReadBatchRunParams = {
  episodes: readonly NativeDeepReadBatchRunEpisode[];
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>;
  /** 传入即启用段级恢复与永久证据；生产 execution 和单集入口都必须传稳定 seriesKey。 */
  segmentCacheSeriesKey?: string;
  /** 0903 双模型：读片主模型；缺省＝3.1 Pro。 */
  readModel?: ManhuaNativeDeepReadModelId;
  /** 仅获授权证据探针使用：保留 GCS 视频分片，不执行 finally 清理。 */
  preservePreparedVideos?: boolean;
  /**
   * 调用方可以调低并发；分片模型扇出的生产硬上限为 5。
   * 省略即用模块默认：切段 10 / 上传 4 / 模型扇出 5。
   */
  mediaCutConcurrency?: number;
  mediaUploadConcurrency?: number;
  segmentModelConcurrency?: number;

  /**
   * 段缓存可靠落盘后的强回调。失败必须阻止下一次模型调用，避免出现“钱已花、卡不可见”。
   * 最后一段由整集门禁/正式 ingest 接管，避免在整集结构尚未验收前冒充 4/4 完成卡。
   */
  onSegmentSnapshotCommitted?: (
    snapshot: NativeDeepReadSegmentSnapshot,
  ) => void | Promise<void>;
  /** 媒体备料（整片拉取）进度中文行，旁路写面板；不影响模型链。 */
  onMediaProgressZh?: (zh: string) => void | Promise<void>;
  /** 0905 整形开关：glm-5.3（默认）或 qwen3.8-max，只改首发链序。 */
  structuringModel?: ManhuaNativeStructuringModelId;
};

type NativeDeepReadBatchExecutionResult = {
  batch: NativeDeepReadBatchRunResult;
  diagnostic?: NativeDeepReadSelectedSegmentsResult;
};

function validateSelectedSegmentIndexes(indexes: readonly number[], segmentCount: number): number[] {
  if (!Array.isArray(indexes) || indexes.length < 1 || indexes.length > 3) {
    throw new Error("选段诊断必须显式选择1至3个原始段索引");
  }
  const values = Array.from(indexes);
  if (values.some((index) => !Number.isInteger(index) || index < 0 || index >= segmentCount)
    || new Set(values).size !== values.length) {
    throw new Error("选段诊断含非法、重复或超出完整计划的原始段索引");
  }
  return values.sort((a, b) => a - b);
}

/** 生产与诊断共用请求、解析、计费回执及重试执行器；诊断只改变调度范围与装配终点。 */
async function executeNativeDeepReadBatch(
  params: NativeDeepReadBatchRunParams,
  deps: NativeDeepReadBatchRunnerDeps,
  diagnosticSelection?: readonly number[],
): Promise<NativeDeepReadBatchExecutionResult> {
  const readModel = parseNativeDeepReadModel(params.readModel);
  if (!params.episodes.length) throw new Error("多视频精读批次为空");
  if (diagnosticSelection && (params.episodes.length !== 1 || !params.preservePreparedVideos
    || !params.segmentCacheSeriesKey || params.onSegmentSnapshotCommitted)) {
    throw new Error("选段诊断只允许单集、永久证据与保留已有媒体，禁止部分提案回调");
  }
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
    return { ...episode, segments, videoFps: parseNativeDeepReadVideoFps(episode.videoFps) };
  });
  const selectedSegmentIndexes = diagnosticSelection
    ? validateSelectedSegmentIndexes(diagnosticSelection, validated[0]!.segments.length)
    : undefined;

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
      if (params.segmentCacheSeriesKey && !selectedSegmentIndexes) {
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
            videoFps: episode.videoFps,
            hintZh: episode.hintZh,
          });
          if (
            entry.sourceDigest !== episode.cacheSourceDigest
            || entry.fingerprint !== expectedFingerprint
            || Math.abs(entry.startSec - segment.startSec) > 0.01
            || Math.abs(entry.endSec - segment.endSec) > 0.01
            || Math.abs(
              entry.requestedFps
              - resolveNativeDeepReadRequestFps(segment.endSec - segment.startSec, episode.videoFps),
            ) > 0.001
          ) {
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存契约已换代，按 miss 处理`,
            );
            continue;
          }
          // 门禁代码收紧时，即使指纹未变，旧段也必须按当前标准复验；未过即 miss。
          // 判据与入库口共用同一个函数——两把尺子会导致「放行入库→复验拒绝→重读」死循环。
          const reusableQwenSelection = readCurrentQwenAttemptSelection(entry.raw);
          if (!reusableQwenSelection && !nativeDeepReadSegmentMeetsThreeItemLine({
            episodeIndex: episode.episodeIndex,
            segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            hasAudio: entry.hasAudio,
            raw: entry.raw,
            requireShotObservations: true,
            truncated: entry.raw?.truncated === true,
          })) {
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存未过三项线，按 miss 重学`,
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
          undefined,
          {
            cutConcurrency: params.mediaCutConcurrency,
            uploadConcurrency: params.mediaUploadConcurrency,
            onSourceFetchProgress: params.onMediaProgressZh,
          },
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

      const pendingIndexes = (selectedSegmentIndexes ?? episode.segments.map((_, index) => index))
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
      const diagnosticSegments = new Map<number, NativeDeepReadSelectedSegmentsResult["segments"][number]>();
      const committedEntries = new Map<number, NativeDeepReadSegmentCacheEntry>();
      const committedIndexes: number[] = [];
      let episodeInput = 0;
      let episodeOutput = 0;
      let episodeCost = 0;
      let episodeAudioInput = 0;
      let episodeReasoning = 0;
      const routesUsed = new Set<NativeDeepReadVisualRoute>();
      const rawAttemptEvidenceObjectNames = new Set<string>();
      /** 段级 advisory 的集级汇总（按段号聚合）；provenance 与面板都读这份。 */
      const advisoriesBySegment = new Map<number, NativeDeepReadAdvisory[]>();
      /** 每个已解析尝试的完整返回元数据；跑满三档时交 Qwen 3.8 Max 三选一。 */
      const parsedAttemptsBySegment = new Map<number, Map<number, SegmentAttemptResult>>();
      const collectAdvisories = (): NativeDeepReadAdvisory[] =>
        Array.from(advisoriesBySegment.keys())
          .sort((a, b) => a - b)
          .flatMap((index) => advisoriesBySegment.get(index) || []);
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
        // 快照行注入各 chunk 真实段界，音频广告过滤只认真实段界换算。
        const snapshotRows = attachAudioChunkSpans(
          sortedIndexes.map((index) => rawSegments[index]!),
          episode.segments,
          episode.episodeIndex,
        );
        const requiresWholeEpisodeStructuring = sortedIndexes.some((index) => {
          const marker = readCurrentQwenAttemptSelection(committedEntries.get(index)!.raw);
          return marker?.selectedPassedGate === false;
        });
        // Qwen 已在三份未过 schema/内容门禁的原稿中必选一份时，
        // 该原稿的可消费结构由后续整集 GLM 负责修复；这里只构建证据身份，
        // 不得用部分快照 mapper 提前拒绝并迫使用户再烧一轮视频。
        const mapped = requiresWholeEpisodeStructuring
          ? { ...mapNativeDeepReadSegments([]), segmentCount: sortedIndexes.length }
          : mapNativeDeepReadSegments(snapshotRows.map((raw) => ({
              startSec: 0,
              endSec: episode.sourceDurationSec,
              finish: "stop",
              text: JSON.stringify(raw),
            })));
        if (!requiresWholeEpisodeStructuring && mapped.segmentCount !== sortedIndexes.length) {
          throw new Error(`第${episode.episodeIndex}集已成段无法确定性装配，拒绝生成部分提案`);
        }
        const entries = sortedIndexes.map((index) => committedEntries.get(index)!);
        // provenance 唯一生产点：证据名严格按 segmentIndex 排序、不得重复、
        // 数量必须与本快照段数一致；整集快照还必须补齐到 attemptedSegments。
        // 任何一条不满足都说明证据身份或装配已损坏，关闭式失败，不写假账。
        const segmentEvidenceObjectNames = entries
          .slice()
          .sort((a, b) => a.segmentIndex - b.segmentIndex)
          .map((entry) => nativeDeepReadSegmentEvidenceObjectName(entry));
        if (new Set(segmentEvidenceObjectNames).size !== segmentEvidenceObjectNames.length) {
          throw new Error(`第${episode.episodeIndex}集段证据对象名出现重复，拒绝写入 provenance`);
        }
        if (segmentEvidenceObjectNames.length !== sortedIndexes.length) {
          throw new Error(`第${episode.episodeIndex}集段证据对象名数量与已成段不一致，拒绝写入 provenance`);
        }
        if (
          sortedIndexes.length === segmentCount
          && segmentEvidenceObjectNames.length !== segmentCount
        ) {
          throw new Error(`第${episode.episodeIndex}集段证据对象名未覆盖全部尝试段，拒绝写入 provenance`);
        }
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
            advisories: (() => {
              const rows = sortedIndexes.flatMap((index) => advisoriesBySegment.get(index) || []);
              return rows.length ? rows : undefined;
            })(),
            segmentCount: sortedIndexes.length,
            failedSegmentCount: segmentCount - sortedIndexes.length,
            attemptedSegments: segmentCount,
            model: readModel,
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
            segmentEvidenceObjectNames,
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
        committedEntry: NativeDeepReadSegmentCacheEntry,
      ): Promise<void> => {
        // 0905 用户令：字幕只取 keyMoments 前后 2 秒——只过滤送整形/入卡的那份 raw；
        // committedEntries 必须保持原样：证据对象名由原始 raw 的指纹算出（0905 实锤：拿过滤后的
        // raw 算名字，provenance 指向不存在的对象，导出 404）。
        const entry = committedEntry;
        committedEntries.set(segmentIndex, entry);
        proposalCommitChain = proposalCommitChain.then(async () => {
          while (committedIndexes.length < segmentCount) {
            const nextIndex = committedIndexes.length;
            const nextEntry = committedEntries.get(nextIndex);
            if (!nextEntry) break;
            rawSegments[nextIndex] = filterNativeDeepReadSubtitlesToKeyMoments(nextEntry.raw);
            committedIndexes.push(nextIndex);
            // 末片由后面的整集门禁写入；这里只生成中间快照。
            // Qwen 在三份未过门禁数据中选出的结果只是该分片的终态，
            // 必须等全部分片齐备后交整集 GLM 处理，不能让部分入库门禁提前终止其他分片。
            const hasQwenSelectedGateFailure = committedIndexes.some((index) => {
              const marker = readCurrentQwenAttemptSelection(committedEntries.get(index)!.raw);
              return marker?.selectedPassedGate === false;
            });
            if (
              params.onSegmentSnapshotCommitted
              && committedIndexes.length < segmentCount
              && !proposalCommitFailure
              && !hasQwenSelectedGateFailure
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
        let callId: string = crypto.randomUUID();
        const startedAt = Date.now();
        const degraded = input.route === NATIVE_DEEP_READ_ROUTE_EVOLINK;
        let modelCallStarted = false;
        let recoveredPaidEvidence = false;
        let evidenceBatchRequestId: string = episodeRequestId;
        const segmentContext = { startSec: segment.startSec, endSec: segment.endSec, segmentIndex: input.segmentIndex, hasAudio };
        const body = buildGeminiNativeDeepReadSegmentRequest({
          segmentContext,
          fileUri: input.fileUri,
          fps: input.fps,
          attemptIndex: (input.attemptNumber - 1) as 0 | 1 | 2,
          prompt: buildGeminiNativeDeepReadSegmentPrompt({
            episodeDurationSec: episode.sourceDurationSec,
            startSec: segment.startSec,
            endSec: segment.endSec,
            segmentIndex: input.segmentIndex,
            segmentCount,
            hasAudio,
            hintZh: segment.hintZh || episode.hintZh,
            videoFps: input.fps,
            rejectedReasonZh: input.rejectedReasonZh,
          }),
        });
        let requestFingerprint: string | undefined;
        if (params.segmentCacheSeriesKey && episode.cacheSourceDigest) {
          requestFingerprint = nativeDeepReadSegmentCacheFingerprint({
            model: readModel,
            sourceDigest: episode.cacheSourceDigest,
            episodeIndex: episode.episodeIndex,
            episodeDurationSec: episode.sourceDurationSec,
            segment,
            segmentIndex: input.segmentIndex,
            segmentCount,
            hasAudio,
            hintZh: episode.hintZh,
            videoFps: episode.videoFps,
          });
        }
        try {
          let response: NativeDeepReadModelResponse | undefined;
          let rawAttemptEvidenceObjectName: string | undefined;
          let rawAttemptEvidence: Awaited<ReturnType<typeof writeNativeDeepReadRawAttemptEvidence>> | undefined;
          if (!selectedSegmentIndexes && params.segmentCacheSeriesKey && episode.cacheSourceDigest && requestFingerprint) {
            const recovered = await deps.readRawAttemptEvidence({
              seriesKey: params.segmentCacheSeriesKey,
              episodeIndex: episode.episodeIndex,
              segmentIndex: input.segmentIndex,
              segmentCount,
              sourceDigest: episode.cacheSourceDigest,
              requestFingerprint,
              attemptNumber: input.attemptNumber,
              temperature: input.temperature,
              visualRoute: input.route,
            });
            if (recovered) {
              recoveredPaidEvidence = true;
              callId = recovered.callId;
              evidenceBatchRequestId = recovered.batchRequestId;
              response = {
                status: recovered.httpStatus,
                text: recovered.responseText,
                requestId: recovered.providerRequestId,
              };
              rawAttemptEvidence = {
                objectName: recovered.objectName,
                bytes: recovered.responseBytes,
                sha256: recovered.responseSha256,
              };
              rawAttemptEvidenceObjectName = recovered.objectName;
              rawAttemptEvidenceObjectNames.add(recovered.objectName);
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `命中已付费原始尝试证据，本次模型调用 0：${recovered.objectName}`,
              );
            }
          }
          if (!recoveredPaidEvidence) {
            await emitVisualModelReceipt({
              callId,
              model: readModel,
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
            modelCallStarted = true;
            response = await (input.route === NATIVE_DEEP_READ_ROUTE_EVOLINK
              ? deps.postEvolink(body, params.abortSignal, segmentContext, readModel)
              : deps.postVertex(body, params.abortSignal, segmentContext, readModel));
          }
          if (!response) throw new Error("原生精读响应缺失，已停止且不得自动重试");
          if (response.status >= 300) {
            const providerError = parseNativeProviderErrorReceipt({
              httpStatus: response.status,
              responseText: response.text,
              requestId: response.requestId,
            });
            const failure = errorWithNativeProviderReceipt(
              formatNativeProviderErrorZh(routeLabelZh(input.route, readModel), providerError),
              providerError,
            ) as HttpFailure;
            failure.nativeDeepReadHttpStatus = response.status;
            throw failure;
          }
          if (!recoveredPaidEvidence && params.segmentCacheSeriesKey && episode.cacheSourceDigest && requestFingerprint) {
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
                repeatableDiagnostic: Boolean(selectedSegmentIndexes),
                httpStatus: response.status,
                providerRequestId: response.requestId,
                responseText: response.text,
              });
              rawAttemptEvidence = evidence;
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
          const prices = routePrices(input.route, readModel);
          const attemptCost =
            (attemptInput * prices.inPerM) / 1e6 + (attemptOutput * prices.outPerM) / 1e6;
          // 恢复旧付费证据时只重建段级历史用量，不伪装成本次外呼或本批新增费用。
          if (!recoveredPaidEvidence) {
            inputTokens += attemptInput;
            outputTokens += attemptOutput;
            costCny += attemptCost;
            episodeInput += attemptInput;
            episodeOutput += attemptOutput;
            episodeCost += attemptCost;
            episodeReasoning += attemptReasoning;
          }
          episodeAudioInput += attemptAudioInput;
          routesUsed.add(input.route);
          addPaidUsage(input.segmentIndex, {
            inputTokens: attemptInput,
            outputTokens: attemptOutput,
            audioInputTokens: attemptAudioInput,
            reasoningTokens: attemptReasoning,
            costCny: attemptCost,
          });
          const candidate = envelope.candidates?.[0];
          const emitCompleted = async () => {
            if (recoveredPaidEvidence) return;
            await emitVisualModelReceipt({
              callId,
              model: readModel,
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
          };
          // 0829：MAX_TOKENS 不再直接判失败——先试着保留可解析前缀（钱已花，
          // 前半是完整有效证据），解析成功即打 truncated 标记留段，不再重试重买。
          const truncated = candidate?.finishReason === "MAX_TOKENS";
          if (candidate?.finishReason && candidate.finishReason !== "STOP" && !truncated) {
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
            raw = truncated ? parseTruncatedJsonObject(text) : parseJsonObject(text);
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
          // 解析原稿先永久落盘，再跑schema/覆盖/长镜门禁或添加标记；拒收不是删除付费证据的理由。
          if (params.segmentCacheSeriesKey && episode.cacheSourceDigest) {
            try {
              if (!rawAttemptEvidence || !requestFingerprint) throw new Error("缺少已保存原始响应的身份回执");
              const evidence = await deps.writeParsedAttemptEvidence({
                seriesKey: params.segmentCacheSeriesKey,
                episodeIndex: episode.episodeIndex,
                segmentIndex: input.segmentIndex,
                segmentCount,
                sourceDigest: episode.cacheSourceDigest,
                requestFingerprint,
                batchRequestId: evidenceBatchRequestId,
                callId,
                attemptNumber: input.attemptNumber,
                temperature: input.temperature,
                visualRoute: input.route,
                repeatableDiagnostic: Boolean(selectedSegmentIndexes),
                providerRequestId: response.requestId,
                model: readModel,
                startSec: segment.startSec,
                endSec: segment.endSec,
                fps: input.fps,
                hasAudio,
                finishReason: candidate?.finishReason,
                truncated,
                rawAttemptEvidenceObjectName: rawAttemptEvidence.objectName,
                rawResponseBytes: rawAttemptEvidence.bytes,
                rawResponseSha256: rawAttemptEvidence.sha256,
                parsed: raw,
              });
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `解析原稿已永久取证：${evidence.objectName} · 正文 ${evidence.bytes} bytes`
                + ` · sha256=${evidence.sha256}`,
              );
            } catch (error) {
              const failure = new Error(
                `原生精读解析证据落盘失败，已停止且不得自动重试：${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              );
              failure.name = "NativeDeepReadEvidencePersistenceError";
              throw failure;
            }
          }
          const parsedAttempts = parsedAttemptsBySegment.get(input.segmentIndex) || new Map<number, SegmentAttemptResult>();
          parsedAttempts.set(input.attemptNumber, {
            raw,
            advisories: [],
            truncated,
            inputTokens: attemptInput,
            outputTokens: attemptOutput,
            audioInputTokens: attemptAudioInput,
            reasoningTokens: attemptReasoning,
            visualRoute: input.route,
            finishReason: candidate?.finishReason,
            providerRequestId: response.requestId,
            rawAttemptEvidenceObjectName,
            requestFingerprint,
          });
          parsedAttemptsBySegment.set(input.segmentIndex, parsedAttempts);
          let gated: ReturnType<typeof assertNativeDeepReadSegmentDensity>;
          try {
            const decision = evaluateNativeDeepReadSegmentAcceptance({
              episodeIndex: episode.episodeIndex,
              segmentIndex: input.segmentIndex,
              startSec: segment.startSec,
              endSec: segment.endSec,
              hasAudio,
              raw,
              truncated,
              requireShotObservations: true,
            });
            gated = decision;
            const passedWithNotice = gated.advisories.find((row) => row.code === "gate_passed_under_threshold");
            if (passedWithNotice) raw.gateMarkedZh = passedWithNotice.detailZh;
            // 截断豁免、家族计数和20%白名单只在共享判据定义；这里仅执行结果并记账。
            const countableFailures = truncated ? [] : gated.advisories;
            const {
              failureCount,
              twoItemOverDeviation,
              coverageSoloRetry,
              requiredValidationRetry,
              families,
            } = decision;
            if (decision.retry) {
              /**
               * 两份文本，用途不同，**不得合并成一份**：
               * · accountedReasonZh＝全部 advisory，进段卡与 console。用户明令
               *   「每一个有错误的卡点都要吐出原因」，不可执行不等于不用记。
               * · modelReasonZh＝只留「模型能改且应该改」的项，仅此一份发给模型。
               * 早先写成同一个变量，等于把音轨那族从段卡本体也抹掉了（观测性倒退）。
               */
              const accountedReasonZh = countableFailures.length
                ? countableFailures.map((row) => row.detailZh).join("；").slice(0, 500)
                : "";
              const actionable = countableFailures.filter(
                (row) => !NATIVE_DEEP_READ_NON_ACTIONABLE_RETRY_CODES.has(row.code),
              );
              /**
               * actionable 为空是**可达**的：audio_track_thin 既在偏差重跑名单里、
               * 又被过滤出拒因文本，它和 long_take_count 凑够两项就会触发重跑而无一可发。
               * 这时**不发拒因段**（留空串，下游据此传 undefined），本轮只换温度重掷。
               * 早先在这里填「上一轮整体证据密度不足」是编造：真正触发的是音轨段数，
               * 而且那句话的落点恰好是「密度」——正是实测中诱导模型降密度的那个词。
               */
              const modelReasonZh = actionable.length
                ? actionable.map((row) => row.detailZh).join("；").slice(0, 500)
                : "";
              raw.gateMarked = true;
              raw.gateMarkedZh = accountedReasonZh || modelReasonZh;
              raw.attemptNumber = input.attemptNumber;
              raw.advisories = dedupeNativeDeepReadAdvisories(decision.advisories);
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `第${input.attemptNumber}发 ${failureCount} 项不合标准`
                + `（${families.join("/")}）`
                + (coverageSoloRetry
                  ? `（覆盖缺口超 ${NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO * 100}% 单独触发）`
                  : requiredValidationRetry
                    ? "（下游必拒的结构错误单独触发）"
                  : twoItemOverDeviation
                    ? `（2 项且偏差超 ${NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO * 100}%）`
                    : `（≥${NATIVE_DEEP_READ_SEGMENT_RETRY_MIN_FAILURES}）`)
                // 日志走完整版：排障时要看得见被过滤掉的那几族，否则只剩缩写。
                + `，重试一发：${accountedReasonZh || "（无可记项）"}`
                + (accountedReasonZh !== modelReasonZh
                  ? `；实发模型：${modelReasonZh || "（不附拒因，仅换温度重掷）"}` : ""),
              );
              // 抛完整版供日志与最终失败记录；发模型的那份单独随行。
              throw gateError(accountedReasonZh || modelReasonZh || "证据未通过当前判据", modelReasonZh);
            }
          } catch (gateFailure) {
            /** 覆盖与超长证据段使用类型化异常；尾片与普通片执行同一套重试。 */
            const requiredEvidenceFailure = gateFailure instanceof NativeDeepReadRequiredEvidenceError;
            const alreadyMarked = raw.gateMarked === true;
            if (requiredEvidenceFailure && !alreadyMarked) {
              const detailZh = gateFailure.message.replace(`${NATIVE_DEEP_READ_GATE_PREFIX}：`, "").slice(0, 500);
              raw.gateMarked = true;
              raw.gateMarkedZh = detailZh;
              raw.attemptNumber = input.attemptNumber;
              raw.advisories = [{ code: gateFailure.code, detailZh, segmentIndex: input.segmentIndex }];
            }
            throw gateFailure;
          }
          // 截断标记必须落进段卡本体：只留在外层信封里，缓存命中/断点恢复后就没了。
          if (truncated) raw.truncated = true;
          const segmentAdvisories = dedupeNativeDeepReadAdvisories([
            ...(truncated
              ? [{
                code: "truncated",
                detailZh:
                  `第${input.segmentIndex + 1}段上游 finishReason=MAX_TOKENS，已保留可解析前缀并跳过重试`,
                segmentIndex: input.segmentIndex,
              }]
              : []),
            ...gated.advisories,
          ]);
          /**
           * 🔴 逐片實時打印（0830 用户令：「出一分片就打印一份資料，不要給我搞黑箱」）。
           *
           * 此前探针只印阶段行与最终验收结论，跑完之前用户看不到任何一片的实况——
           * 出了问题只能事后翻日志。这里在**每片落地的当下**打印全部关键计数与用量，
           * 不聚合、不延后、不等整集完成。
           */
          {
            const arr = (key: string): Array<Record<string, unknown>> => {
              const v = (raw as Record<string, unknown>)[key];
              return Array.isArray(v) ? v as Array<Record<string, unknown>> : [];
            };
            const shots = arr("shots");
            const adShots = shots.filter((x) => x.evidenceRole === "non_story_ad");
            const audioChunks = arr("audioResolution");
            let audioTracks = 0;
            let audioCues = 0;
            for (const chunk of audioChunks) {
              const analysis = chunk.analysis as { audioTrack?: Array<{ cues?: unknown[] }> } | undefined;
              const tracks = Array.isArray(analysis?.audioTrack) ? analysis!.audioTrack! : [];
              audioTracks += tracks.length;
              for (const t of tracks) audioCues += Array.isArray(t.cues) ? t.cues.length : 0;
            }
            const { coveredSec, durationSec: lenSec, coverageRatio } = measureNativeDeepReadSegmentCoverage({
              shots: sortedShots(raw), startSec: segment.startSec, endSec: segment.endSec,
            });
            console.info(
              `[逐片] 第${episode.episodeIndex}集 第${input.segmentIndex + 1}/${episode.segments.length}片`
              + ` ${segment.startSec}–${segment.endSec}s`
              + ` │ 镜头 ${shots.length}（广告 ${adShots.length}）`
              + ` │ 字幕 ${arr("subtitles").length}`
              + ` │ 重点时刻 ${arr("keyMoments").length}`
              + ` │ 音轨 ${audioTracks} 段/${audioCues} 事件`
              + ` │ 覆盖 ${coveredSec.toFixed(1)}/${lenSec}s（${(coverageRatio * 100).toFixed(1)}%）`
              + ` │ token 入 ${attemptInput} 出 ${attemptOutput}（思考 ${attemptReasoning}）`
              + ` │ ¥${attemptCost.toFixed(4)}`
              + ` │ 第 ${input.attemptNumber} 发`
              + ` │ 不合标准 ${segmentAdvisories.length} 项`
              + (truncated ? " │ ⚠️ 截断" : "")
              + (segmentAdvisories.length
                ? ` │ ${segmentAdvisories.map((a) => a.code).join(",")}`
                : ""),
            );
          }
          // advisory 的真实生产点：写进段卡 raw（随缓存/证据持久化）、发段级回执、
          // 再由 buildCommittedSnapshot / 整集装配汇总进 provenance。
          if (segmentAdvisories.length) raw.advisories = segmentAdvisories;
          await emitVisualModelReceipt({
            callId: `${episodeRequestId}:segment-${input.segmentIndex}:gate-${input.attemptNumber}`,
            model: readModel,
            route: "local_schema_gate",
            stage: "visual_parse",
            status: "completed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            chunkIndex: input.segmentIndex,
            segmentCount: episode.segments.length,
            videoCount: 1,
            attemptNumber: input.attemptNumber,
            advisoryCodes: segmentAdvisories.length ? segmentAdvisories.map((row) => row.code) : undefined,
            advisoriesZh: segmentAdvisories.length
              ? segmentAdvisories.map((row) => row.detailZh).join("；").slice(0, 2_000)
              : undefined,
          }, params.onModelReceipt);
          return {
            raw,
            advisories: segmentAdvisories,
            truncated,
            inputTokens: attemptInput,
            outputTokens: attemptOutput,
            audioInputTokens: attemptAudioInput,
            reasoningTokens: attemptReasoning,
            visualRoute: input.route,
            finishReason: candidate?.finishReason,
            providerRequestId: response.requestId,
            rawAttemptEvidenceObjectName,
            requestFingerprint,
          };
        } catch (error) {
          const schemaGateFailure = error instanceof Error
            && (error.name === NATIVE_DEEP_READ_SCHEMA_ERROR_NAME || error.name === "ZodError");
          if (modelCallStarted && !isNativeDeepReadGateFailure(error) && !schemaGateFailure) {
            const providerError = nativeProviderReceiptFromError(error);
            await emitVisualModelReceipt({
              callId,
              model: readModel,
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

      const accountAttemptSelectionUsage = (
        segmentIndex: number,
        usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number },
      ) => {
        const selectorCostCny = usage.costUsd * 7;
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        costCny += selectorCostCny;
        episodeInput += usage.inputTokens;
        episodeOutput += usage.outputTokens;
        episodeReasoning += usage.reasoningTokens;
        episodeCost += selectorCostCny;
        paidUsageBySegment[segmentIndex]!.inputTokens += usage.inputTokens;
        paidUsageBySegment[segmentIndex]!.outputTokens += usage.outputTokens;
        paidUsageBySegment[segmentIndex]!.reasoningTokens += usage.reasoningTokens;
        paidUsageBySegment[segmentIndex]!.costCny += selectorCostCny;
      };

      const selectOneOfThreeAttempts = async (input: {
        segmentIndex: number;
        passedAttemptNumber?: number;
      }): Promise<SegmentAttemptResult> => {
        const parsedAttempts = parsedAttemptsBySegment.get(input.segmentIndex);
        if (!parsedAttempts || parsedAttempts.size !== NATIVE_DEEP_READ_RETRY_TEMPERATURES.length) {
          throw new Error("Qwen 三选一缺少0.7/0.65/0.6三份完整解析数据");
        }
        const candidates = ([1, 2, 3] as const).map((attemptNumber) => {
          const result = parsedAttempts.get(attemptNumber)!;
          return {
            attemptNumber,
            temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[attemptNumber - 1],
            passedGate: input.passedAttemptNumber === attemptNumber,
            gateReasonZh: String(result.raw.gateMarkedZh || "").trim() || undefined,
            raw: result.raw,
          };
        });
        const receiptCallId = `${episodeRequestId}:segment-${input.segmentIndex}:qwen-selection`;
        let selection: NativeDeepReadAttemptSelectionResult;
        try {
          selection = await deps.selectAttemptWithQwen({
            seriesKey: params.segmentCacheSeriesKey!,
            sourceDigest: episode.cacheSourceDigest!,
            episodeIndex: episode.episodeIndex,
            segmentIndex: input.segmentIndex,
            batchRequestId: episodeRequestId,
            candidates,
            abortSignal: params.abortSignal,
            onBeforePaidCall: async () => {
              await emitVisualModelReceipt({
                callId: receiptCallId,
                model: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL,
                route: "qwen_segment_selection",
                stage: "visual_parse",
                status: "started",
                batchRequestId: episodeRequestId,
                episodeIndexes: [episode.episodeIndex],
                chunkIndex: input.segmentIndex,
                segmentCount,
                videoCount: 0,
              }, params.onModelReceipt);
            },
          });
          if (!selection.recoveredPaidEvidence) accountAttemptSelectionUsage(input.segmentIndex, selection);
        } catch (error) {
          const failedUsage = nativeDeepReadAttemptSelectionUsageFromError(error);
          if (failedUsage) accountAttemptSelectionUsage(input.segmentIndex, failedUsage);
          await emitVisualModelReceipt({
            callId: receiptCallId,
            model: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL,
            route: "qwen_segment_selection",
            stage: "visual_parse",
            status: "failed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            chunkIndex: input.segmentIndex,
            segmentCount,
            videoCount: 0,
            errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
          }, params.onModelReceipt);
          throw error;
        }
        const selected = parsedAttempts.get(selection.selectedAttemptNumber)!;
        const selectedTemperature = NATIVE_DEEP_READ_RETRY_TEMPERATURES[selection.selectedAttemptNumber - 1]!;
        const detailZh = `第${input.segmentIndex + 1}片三档均已取得完整数据；Qwen 3.8 Max 三选一采用第${selection.selectedAttemptNumber}发（temperature ${selectedTemperature}）：${selection.reasonZh}`;
        const marker: NativeDeepReadQwenSelectionMarker = {
          status: "qwen_selected_after_three_attempts",
          selectorContractSha256: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONTRACT_SHA256,
          selectedAttemptNumber: selection.selectedAttemptNumber,
          selectedTemperature,
          selectedPassedGate: input.passedAttemptNumber === selection.selectedAttemptNumber,
          reasonZh: selection.reasonZh,
          selectorCallId: selection.evidence.callId,
          selectorRequestObjectName: selection.evidence.requestObjectName,
          selectorRawObjectNames: selection.evidence.rawObjectNames,
          selectorParsedObjectName: selection.evidence.parsedObjectName,
        };
        selected.raw.attemptSelection = marker;
        selected.raw.gateMarked = input.passedAttemptNumber !== selection.selectedAttemptNumber;
        selected.raw.gateMarkedZh = detailZh;
        selected.raw.advisories = dedupeNativeDeepReadAdvisories([
          ...readSegmentAdvisories(selected.raw, input.segmentIndex),
          { code: NATIVE_DEEP_READ_QWEN_SELECTION_CODE, detailZh, segmentIndex: input.segmentIndex },
        ]);
        selected.advisories = readSegmentAdvisories(selected.raw, input.segmentIndex);
        await emitVisualModelReceipt({
          callId: receiptCallId,
          model: selection.model,
          route: selection.recoveredPaidEvidence ? "qwen_segment_selection_recovered" : "qwen_segment_selection",
          stage: "visual_parse",
          status: "completed",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          chunkIndex: input.segmentIndex,
          segmentCount,
          videoCount: 0,
          inputTokens: selection.recoveredPaidEvidence ? undefined : selection.inputTokens,
          outputTokens: selection.recoveredPaidEvidence ? undefined : selection.outputTokens,
          reasoningTokens: selection.recoveredPaidEvidence ? undefined : selection.reasoningTokens,
          costUsd: selection.recoveredPaidEvidence ? undefined : selection.costUsd,
          advisoryCodes: [NATIVE_DEEP_READ_QWEN_SELECTION_CODE],
          advisoriesZh: detailZh,
        }, params.onModelReceipt);
        console.warn(`[nativeDeepRead] ${detailZh}`);
        return selected;
      };

      /** 同一片最多三次，跑满三份后由 Qwen 3.8 Max 三选一；不把另外两份送入整集合成。 */
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
            const retryReasonZh = rejectedReasonZh || "上一档门禁未通过";
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
              + `门禁未通过，60 秒后降到 temperature ${temperature} 重试：${retryReasonZh}`,
            );
            await emitVisualModelReceipt({
              callId: `${episodeRequestId}:segment-${input.segmentIndex}:retry-${attemptIndex + 1}`,
              model: readModel,
              route: "gate_retry_pending",
              stage: "visual_parse",
              status: "started",
              batchRequestId: episodeRequestId,
              episodeIndexes: [episode.episodeIndex],
              chunkIndex: input.segmentIndex,
              segmentCount,
              videoCount: 1,
              attemptNumber: attemptIndex + 1,
              temperature,
              errorZh: retryReasonZh,
            }, params.onModelReceipt);
            await deps.waitForRetry(NATIVE_DEEP_READ_RETRY_INTERVAL_MS, params.abortSignal);
            params.abortSignal?.throwIfAborted();
          }
          let resourceRetryCount = 0;
          while (true) {
            try {
              const accepted = await attemptSegment({
                ...input,
                attemptNumber: attemptIndex + 1,
                temperature,
                rejectedReasonZh,
              });
              return attemptIndex === NATIVE_DEEP_READ_RETRY_TEMPERATURES.length - 1
                ? await selectOneOfThreeAttempts({ segmentIndex: input.segmentIndex, passedAttemptNumber: attemptIndex + 1 })
                : accepted;
            } catch (error) {
              if (params.abortSignal?.aborted) throw error;
              if (error instanceof Error && error.name === "NativeDeepReadEvidencePersistenceError") throw error;
              if (isNativeDeepReadResourceExhausted(error)) {
                if (resourceRetryCount >= NATIVE_DEEP_READ_RESOURCE_RETRY_MAX) throw error;
                resourceRetryCount += 1;
                const errorZh = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
                await emitVisualModelReceipt({
                  callId: `${episodeRequestId}:segment-${input.segmentIndex}:resource-retry-${attemptIndex + 1}-${resourceRetryCount}`,
                  model: readModel,
                  route: "resource_retry_pending",
                  stage: "visual_parse",
                  status: "started",
                  batchRequestId: episodeRequestId,
                  episodeIndexes: [episode.episodeIndex],
                  chunkIndex: input.segmentIndex,
                  segmentCount,
                  videoCount: 1,
                  attemptNumber: attemptIndex + 1,
                  temperature,
                  resourceRetryNumber: resourceRetryCount,
                  resourceRetryMax: NATIVE_DEEP_READ_RESOURCE_RETRY_MAX,
                  errorZh,
                }, params.onModelReceipt);
                console.warn(
                  `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段资源拥堵，`
                  + `30 秒后保持 temperature ${temperature} 重试`
                  + `（第 ${resourceRetryCount}/${NATIVE_DEEP_READ_RESOURCE_RETRY_MAX} 次）：${errorZh}`,
                );
                await deps.waitForRetry(NATIVE_DEEP_READ_RESOURCE_RETRY_INTERVAL_MS, params.abortSignal);
                params.abortSignal?.throwIfAborted();
                continue;
              }
              const schemaGateFailure = error instanceof Error
                && (error.name === NATIVE_DEEP_READ_SCHEMA_ERROR_NAME || error.name === "ZodError");
              if (!isNativeDeepReadGateFailure(error) && !schemaGateFailure) throw error;
              await emitVisualModelReceipt({
                callId: `${episodeRequestId}:segment-${input.segmentIndex}:gate-${attemptIndex + 1}`,
                model: readModel,
                route: "local_schema_gate",
                stage: "visual_parse",
                status: "failed",
                batchRequestId: episodeRequestId,
                episodeIndexes: [episode.episodeIndex],
                chunkIndex: input.segmentIndex,
                segmentCount,
                videoCount: 1,
                attemptNumber: attemptIndex + 1,
                temperature,
                errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
              }, params.onModelReceipt);
              lastError = error;
              const carried = (error as { modelReasonZh?: string }).modelReasonZh;
              const raw = carried ?? (error instanceof Error ? error.message : String(error));
              rejectedReasonZh = raw.trim() ? raw.slice(0, 300) : undefined;
              break;
            }
          }
        }

        const retryError = lastError || new Error("分片三次尝试均未完成");
        const parsedAttempts = parsedAttemptsBySegment.get(input.segmentIndex);
        if (parsedAttempts?.size === NATIVE_DEEP_READ_RETRY_TEMPERATURES.length) {
          return selectOneOfThreeAttempts({ segmentIndex: input.segmentIndex });
        }
        // 三次 Vertex 尝试就是付费上限；坏 JSON 也不得自动切到 GLM 形成第四次调用。
        logFinalGateFailure(input.segmentIndex, retryError);
        throw retryError;
      };

      const processSegment = async (segmentIndex: number): Promise<void> => {
        params.abortSignal?.throwIfAborted();
        const segment = episode.segments[segmentIndex]!;
        let cachedEntry = cachedSegments.get(segmentIndex);
        /**
         * 🔒 缓存命中也要过一遍**当前**门禁（0830 用户令「重跑没成功的」）。
         *
         * 「已验缓存」这四个字的前提是「被验过」——但历史条目是被**当时那版**门禁验的。
         * 0830 实锤：v10 的离谱地板有洞（判据用「模型回了多长」而非「本片多长」），
         * 10 片里 6 片只回 3–52 秒却全部过关入缓存；门禁补好后若仍无条件复用缓存，
         * 那 6 片会被当「已验」原样带走，新闸永远看不到它们，洞等于没补。
         * 不过就当没命中、重新读——好片照旧命中不花钱，只有真坏的那几片才重买。
        */
        if (cachedEntry) {
          const reusableQwenSelection = readCurrentQwenAttemptSelection(cachedEntry.raw);
          // 与入库口共用判据：独立证据门不豁免，其余按家族与偏差判断。
          if (!reusableQwenSelection && !nativeDeepReadSegmentMeetsThreeItemLine({
            episodeIndex: episode.episodeIndex,
            segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            hasAudio,
            raw: cachedEntry.raw,
            requireShotObservations: true,
            truncated: cachedEntry.raw?.truncated === true,
          })) {
            console.warn(
              `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存未过三项线，按未命中重读`,
            );
            cachedEntry = undefined;
          }
        }
        if (cachedEntry) {
          // 缓存命中不是模型外呼，禁止伪造 ManhuaNativeModelReceipt；历史 token 只作听觉证据。
          // 旧缓存可能早于永久 evidence 机制；先幂等补写不可变原始证据，再允许装卡。
          // 写入返回的 canonical entry 是唯一真值；此后不再引用闭包里的预读变量。
          const written = await deps.writeSegmentCache(cachedEntry);
          const canonicalEntry = written.entry;
          if (canonicalEntry.rawAttemptEvidenceObjectName) {
            rawAttemptEvidenceObjectNames.add(canonicalEntry.rawAttemptEvidenceObjectName);
          }
          episodeAudioInput += Math.max(0, Number(canonicalEntry.paidUsage.audioInputTokens) || 0);
          routesUsed.add(canonicalEntry.visualRoute);
          if (canonicalEntry.degraded) degradedFpsSegmentIndexes.push(segmentIndex);
          console.info(
            `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段命中已验缓存，本次模型调用 0`,
          );
          // 旧缓存段卡里已持久化的 advisory 同样进集级汇总，别让重启后提示凭空消失。
          const cachedAdvisories = readSegmentAdvisories(canonicalEntry.raw, segmentIndex);
          if (cachedAdvisories.length) advisoriesBySegment.set(segmentIndex, cachedAdvisories);
          rawSegments[segmentIndex] = canonicalEntry.raw;
          await commitSegmentToProposal(segmentIndex, canonicalEntry);
          return;
        }
        const video = videosBySegment.get(segmentIndex);
        if (!video) {
          throw new Error(`第${episode.episodeIndex}集第${segmentIndex + 1}段缺少对应备料，已停止`);
        }
        const fps = resolveNativeDeepReadRequestFps(video.endSec - video.startSec, episode.videoFps);
        const result = await attemptWithSegmentRetry({
          route: NATIVE_DEEP_READ_ROUTE_VERTEX,
          fileUri: video.gsUri,
          segmentIndex,
          fps,
        });
        if (result.advisories.length) advisoriesBySegment.set(segmentIndex, result.advisories);
        if (selectedSegmentIndexes) {
          // 每发 raw/parsed 已由共用尝试器永久保存；诊断不写 active 缓存、不建部分或整集卡。
          if (!result.requestFingerprint || !result.rawAttemptEvidenceObjectName) {
            throw new Error("选段诊断缺少已保存原始响应的请求身份");
          }
          rawSegments[segmentIndex] = result.raw;
          diagnosticSegments.set(segmentIndex, {
            ...result, segmentIndex, startSec: segment.startSec, endSec: segment.endSec,
            hasAudio, requestFingerprint: result.requestFingerprint,
            rawAttemptEvidenceObjectName: result.rawAttemptEvidenceObjectName,
            paidUsage: { ...paidUsageBySegment[segmentIndex]! },
          });
          return;
        }
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
              videoFps: episode.videoFps,
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
          // 装提案/rawSegments 一律用返回的 canonical entry，杜绝缓存 A / 提案 B。
          const written = await deps.writeSegmentCache(entry);
          rawSegments[segmentIndex] = written.entry.raw;
          await commitSegmentToProposal(segmentIndex, written.entry);
          return;
        }
        rawSegments[segmentIndex] = result.raw;
      };

      const segmentFailures: Array<{ segmentIndex: number; error: unknown }> = [];
      const scheduledSegmentIndexes = selectedSegmentIndexes ?? episode.segments.map((_, index) => index);
      let nextSegmentIndex = 0;
      // 0904 用户令：最多同时 4 片（原 5，为压 503 下调）；调用方只能调低，不能抬高生产上限。
      const segmentModelCap = Math.min(
        NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
        Math.max(1, Math.floor(Number(params.segmentModelConcurrency)
          || NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY)),
      );
      const segmentConcurrency = Math.min(segmentModelCap, scheduledSegmentIndexes.length);
      console.info(
        `[nativeDeepRead] 第${episode.episodeIndex}集模型扇出并发 ${segmentConcurrency}/${scheduledSegmentIndexes.length} 片`
        + (selectedSegmentIndexes ? `（诊断原索引 ${selectedSegmentIndexes.join(",")}，全片共${segmentCount}段）` : ""),
      );
      const segmentWorkers = Array.from({ length: segmentConcurrency }, async () => {
        while (!stopSchedulingSegments) {
          const position = nextSegmentIndex;
          nextSegmentIndex += 1;
          if (position >= scheduledSegmentIndexes.length) return;
          const segmentIndex = scheduledSegmentIndexes[position]!;
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
      if (selectedSegmentIndexes) {
        if (selectedSegmentIndexes.some((index) => !diagnosticSegments.has(index))) {
          throw new Error("选段诊断缺少选中原索引的完整返回，已停止");
        }
        const usage = { inputTokens, outputTokens, costCny };
        return {
          batch: { episodes, usage, usingPlanQuota: false, model: readModel, batchRequestId },
          diagnostic: {
            mode: "gemini_selected", assemblyComplete: false, glmStatus: "not_run", productAcceptance: "not_run",
            sourceDigest: episode.cacheSourceDigest!, sourceDurationSec: episode.sourceDurationSec,
            totalSegmentCount: segmentCount, selectedSegmentIndexes: [...selectedSegmentIndexes],
            episodeIndex: episode.episodeIndex, batchRequestId: episodeRequestId, model: readModel,
            segments: selectedSegmentIndexes.map((index) => diagnosticSegments.get(index)!),
            usage, rawAttemptEvidenceObjectNames: Array.from(rawAttemptEvidenceObjectNames),
          },
        };
      }
      if (rawSegments.some((raw) => !raw)) {
        throw new Error(`第${episode.episodeIndex}集并发精读结果不完整，已停止`);
      }
      const completeRawSegments = rawSegments as Array<Record<string, unknown>>;
      const glmStructuringInputs = completeRawSegments;

      // 段卡合并成集卡：0829 起**每集一律走 GLM 5.3 结构化整形**（去重 + 结构化），
      // 每片只输入最终采用的一份；三档跑满时由 Qwen 先完成三选一，另外两份留在永久证据区。
      // 确定性拼接降为交叉校验用（只取 excludedAdRanges 对账，不入库）。
      // 门禁仍在 GLM 之后跑一遍——GLM 只管结构干净与去重，结论仍由门禁/advisory 层给。
      let glmEvidence: NativeDeepReadGlmEvidence | undefined;
      const glmEvidenceCallIds: string[] = [];
      const canCacheStructuring = Boolean(params.segmentCacheSeriesKey && episode.cacheSourceDigest);
      const structuringGatewayPolicy = params.structuringModel === "qwen3.8-max"
        ? "structuring_chain_qwen_first" as const
        : "structuring_chain" as const;
      const glmStructure = async (input: {
        prompt: ReturnType<typeof buildNativeDeepReadGlmStructuringPrompt>;
        videoCount: number;
        segmentIndexes: readonly number[];
        rows: ReadonlyArray<Record<string, unknown>>;
        /** 面板标签：第几批整形，让用户看得出是第几次 */
        labelZh?: string;
      }): Promise<NativeDeepReadGlmStructuringResult> => {
        const callId = canCacheStructuring
          ? nativeDeepReadStructuredBatchCallId({
            seriesKey: params.segmentCacheSeriesKey!,
            sourceDigest: episode.cacheSourceDigest!,
            episodeIndex: episode.episodeIndex,
            segmentIndexes: input.segmentIndexes,
            rawSegments: input.rows,
          })
          : crypto.randomUUID();
        let startedAt: number | undefined;
        const emitPaidCallStarted = async () => {
          if (startedAt !== undefined) return;
          const now = Date.now();
          await emitVisualModelReceipt({
            callId,
            // 0905：开始行明说链路顺序；完成/失败行改记实际网关，面板不再把 EvoLink 显示成 OpenRouter
            model: NATIVE_DEEP_READ_GLM_STRUCTURING_STARTED_LABEL,
            route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
            stage: "visual_parse",
            status: "started",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            videoCount: input.videoCount,
            labelZh: input.labelZh,
          }, params.onModelReceipt);
          startedAt = now;
        };
        try {
          const structured = await deps.invokeGlmStructuring(
            input.prompt,
            params.abortSignal,
            { seriesKey: params.segmentCacheSeriesKey, sourceDigest: episode.cacheSourceDigest,
              episodeIndex: episode.episodeIndex, batchRequestId: episodeRequestId, callId,
              recoverExisting: canCacheStructuring, onBeforePaidCall: emitPaidCallStarted,
              gatewayPolicy: structuringGatewayPolicy,
              // 0905：换档也要在面板看得见——同 callId 再发一条 started 回执，行文改成「X 档失败，切下一档」
              onGatewayFallback: async (info) => {
                if (startedAt === undefined) return;
                await emitVisualModelReceipt({
                  callId,
                  model: `${glmGatewayDisplayLabel(info.gateway)} 失败（${String(info.detail || info.outcome).slice(0, 60)}），切下一档重跑`,
                  route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
                  stage: "visual_parse",
                  status: "started",
                  batchRequestId: episodeRequestId,
                  episodeIndexes: [episode.episodeIndex],
                  videoCount: input.videoCount,
                  labelZh: input.labelZh,
                }, params.onModelReceipt);
              } },
          );
          glmEvidence = structured.evidence;
          if (structured.evidence?.callId && !glmEvidenceCallIds.includes(structured.evidence.callId)) {
            glmEvidenceCallIds.push(structured.evidence.callId);
          }
          if (structured.recoveredPaidEvidence) {
            console.info(`[nativeDeepRead] 第${episode.episodeIndex}集整形命中永久付费证据，模型调用0`);
            return structured;
          }
          // 测试或替换依赖若没有执行回调，仍保持回执完整；正式实现会在网络调用前执行。
          if (startedAt === undefined) await emitPaidCallStarted();
          const structuringCostCny = structured.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT;
          inputTokens += structured.inputTokens;
          outputTokens += structured.outputTokens;
          costCny += structuringCostCny;
          episodeInput += structured.inputTokens;
          episodeOutput += structured.outputTokens;
          episodeCost += structuringCostCny;
          await emitVisualModelReceipt({
            callId,
            model: `${glmGatewayDisplayLabel(structured.gateway)}·${structured.model}`,
            route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
            stage: "visual_parse",
            status: "completed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            videoCount: input.videoCount,
            labelZh: input.labelZh,
            elapsedMs: Date.now() - startedAt!,
            inputTokens: structured.inputTokens,
            outputTokens: structured.outputTokens,
            reasoningTokens: structured.reasoningTokens || undefined,
            costUsd: structured.costUsd,
            priceEquivalentCny: structuringCostCny,
            provider: structured.provider,
            providerRequestId: structured.providerRequestId,
            finishReason: structured.finishReason,
          }, params.onModelReceipt);
          return structured;
        } catch (error) {
          // request/parsed恢复证据损坏或缺失会在任何上游调用之前关闭式失败。
          // 这类错误不得伪造一条模型失败回执，也不得把历史用量记入本轮。
          if (startedAt === undefined) throw error;
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
            model: NATIVE_DEEP_READ_GLM_STRUCTURING_STARTED_LABEL,
            route: NATIVE_DEEP_READ_GLM_STRUCTURING_ROUTE,
            stage: "visual_parse",
            status: "failed",
            batchRequestId: episodeRequestId,
            episodeIndexes: [episode.episodeIndex],
            videoCount: input.videoCount,
            labelZh: input.labelZh,
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
      /**
       * 整形**之前**的镜头总数，作为留存率闸的分母。
       *
       * 🔴 必须先剔除 non_story_ad 再数（0830 审查 P0）：分子是整集卡，而整集卡按
       * 提示词规则 3 **整行剔除广告镜**。分母若含广告就是拿「含广告」比「不含广告」，
       * 广告占比一高就会把**一镜没压的诚实产出**判死。实测公式：健康去重留存 0.78 时，
       * 广告占比 >36% 即误杀——真人剧有片头版权卡与贴片，正中这个区间。
       *
       * 只数通过版（completeRawSegments），不数被标记版：标记版是同一时间区间的另一个
       * 版本，计进分母会把分母抬高、闸变得更严，可能误杀；漏杀比误杀可接受。
       */
      const preStructuringShotCount = stripNonStoryAdShotsForEpisodeCard(completeRawSegments)
        .rows.reduce((sum, raw) => sum + (Array.isArray(raw.shots) ? raw.shots.length : 0), 0);
      const gateEpisode = (payloads: ReadonlyArray<Record<string, unknown>>) =>
        assertNativeDeepReadEpisodeEvidence({
          episodeIndex: episode.episodeIndex,
          durationSec: episode.sourceDurationSec,
          segments: episode.segments,
          hasAudio,
          rawSegments: payloads,
          inputShotCount: preStructuringShotCount,
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
      const structuringFallbackAdvisories: NativeDeepReadAdvisory[] = [];
      const runStructuringOrLocalFallback = async (input: {
        prompt: ReturnType<typeof buildNativeDeepReadGlmStructuringPrompt>;
        videoCount: number;
        segmentIndexes: readonly number[];
        rows: ReadonlyArray<Record<string, unknown>>;
        fallbackRows: ReadonlyArray<Record<string, unknown>>;
        labelZh: string;
      }): Promise<NativeDeepReadGlmStructuringResult | { raw: Record<string, unknown>; localFallback: true }> => {
        try {
          return await glmStructure({
            prompt: input.prompt,
            videoCount: input.videoCount,
            segmentIndexes: input.segmentIndexes,
            rows: input.rows,
            labelZh: input.labelZh,
          });
        } catch (error) {
          // 只有“两条供应商都没有交付可消费结果”才能走本地整形。
          // 任一网关已经交卷（trace=ok）后才发生的解析证据落盘失败，不是供应商故障；
          // 这类错误必须关闭式停止，不能用 fallback 掩盖已付费但未可靠留存的结果。
          if (
            !(error instanceof GlmGatewayError)
            || error.code !== "glm_gateway_all_failed"
            || error.gatewayTrace.some((row) => row.outcome === "ok" || row.outcome === "evidence_persistence_failed")
          ) throw error;
          const detailZh = `${input.labelZh}整形链五档均未交付可消费结果，已使用确定性本地整形fallback；未新增或改写证据`;
          structuringFallbackAdvisories.push({
            code: "glm_structuring_local_fallback",
            detailZh,
            segmentIndex: 0,
          });
          console.warn(`[nativeDeepRead] ${detailZh}`);
          return { raw: deterministicallyMergeNativeDeepReadRawSegments(input.fallbackRows), localFallback: true };
        }
      };
      const readCachedStructuring = async (
        segmentIndexes: readonly number[],
        rows: ReadonlyArray<Record<string, unknown>>,
        labelZh: string,
      ): Promise<Record<string, unknown> | null> => {
        if (!canCacheStructuring) return null;
        const cached = await deps.readStructuredBatchCache({
          seriesKey: params.segmentCacheSeriesKey!,
          sourceDigest: episode.cacheSourceDigest!,
          episodeIndex: episode.episodeIndex,
          segmentIndexes,
          rawSegments: rows,
        });
        if (!cached) return null;
        console.info(`[nativeDeepRead] 第${episode.episodeIndex}集${labelZh}命中GCS缓存，模型调用0`);
        assertNativeDeepReadShotObservationsPreserved(rows, cached.raw);
        if (cached.evidence) {
          glmEvidence = cached.evidence;
          if (!glmEvidenceCallIds.includes(cached.evidence.callId)) {
            glmEvidenceCallIds.push(cached.evidence.callId);
          }
        }
        return cached.raw;
      };
      const writeCachedStructuring = async (
        segmentIndexes: readonly number[],
        rows: ReadonlyArray<Record<string, unknown>>,
        result: NativeDeepReadGlmStructuringResult | { raw: Record<string, unknown>; localFallback: true },
      ): Promise<void> => {
        if (!canCacheStructuring || "localFallback" in result) return;
        await deps.writeStructuredBatchCache({
          schemaVersion: 1,
          frozenContractSha256: NATIVE_DEEP_READ_FROZEN_CONTRACT_SHA256,
          seriesKey: params.segmentCacheSeriesKey!,
          sourceDigest: episode.cacheSourceDigest!,
          episodeIndex: episode.episodeIndex,
          segmentIndexes: [...segmentIndexes],
          inputDigest: nativeDeepReadStructuredBatchInputDigest(rows),
          raw: result.raw,
          evidence: result.evidence,
          gateway: result.gateway,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          reasoningTokens: result.reasoningTokens,
          costUsd: result.costUsd,
          savedAtIso: new Date().toISOString(),
          source: "formal",
        });
      };
      const structuredEpisodeRaw = async (): Promise<Record<string, unknown>> => {
        // 0905 用户拍板 5：29 片＝6 组 6 次 GLM；5 片一批实测输出 120K，131K 内也安全，不依赖 262K 是否真生效
        const maxRawSegmentsPerBatch = 5;
        const allSegmentIndexes = episode.segments.map((_, index) => index);
        if (segmentCount <= maxRawSegmentsPerBatch) {
          const cached = await readCachedStructuring(allSegmentIndexes, glmStructuringInputs, "最终整形");
          if (cached) return unwrapNativeDeepReadStructuredAnswerEnvelope(cached);
          const result = await runStructuringOrLocalFallback({
            prompt: buildNativeDeepReadGlmStructuringPrompt({
              episodeIndex: episode.episodeIndex,
              durationSec: episode.sourceDurationSec,
              segments: episode.segments,
              hasAudio,
              rawSegments: glmStructuringInputs,
              coverageStartSec: 0,
              coverageEndSec: episode.sourceDurationSec,
              scopeZh: "整集",
            }),
            videoCount: segmentCount,
            segmentIndexes: allSegmentIndexes,
            rows: glmStructuringInputs,
            fallbackRows: annotateSegmentRows(),
            labelZh: `第${episode.episodeIndex}集整集整形（一次）`,
          });
          result.raw = unwrapNativeDeepReadStructuredAnswerEnvelope(result.raw);
          assertNativeDeepReadShotObservationsPreserved(glmStructuringInputs, result.raw);
          await writeCachedStructuring(allSegmentIndexes, glmStructuringInputs, result);
          return result.raw;
        }

        // 0905 用户令：批次要均分，不是「前面塞满、尾巴一小撮」——8 片＝4+4、9 片＝5+4、29 片＝5×5+4，
        // 两路并发才真正对半分担；批次数仍按每批上限（5）决定。
        const groupCount = Math.ceil(segmentCount / maxRawSegmentsPerBatch);
        const baseSize = Math.floor(segmentCount / groupCount);
        const extra = segmentCount % groupCount;
        const groups: number[][] = [];
        for (let g = 0, start = 0; g < groupCount; g += 1) {
          const size = baseSize + (g < extra ? 1 : 0);
          groups.push(Array.from({ length: size }, (_, offset) => start + offset));
          start += size;
        }
        const groupRows = await Promise.all(groups.map(async (segmentIndexes) => {
          // 单片无需再做一次中间GLM；直接作为一张已结构化分段卡进入确定性拼接。
          if (segmentIndexes.length === 1) return completeRawSegments[segmentIndexes[0]!]!;
          const groupInputs = segmentIndexes.map((index) => completeRawSegments[index]!);
          const annotatedRows = annotateSegmentRows();
          const groupCanonicalRows = segmentIndexes.map((index) => annotatedRows[index]!);
          const cached = await readCachedStructuring(
            segmentIndexes,
            groupInputs,
            `整形批次 ${segmentIndexes.join(",")} `,
          );
          if (cached) return cached;
          const groupSegments = segmentIndexes.map((index) => episode.segments[index]!);
          const result = await runStructuringOrLocalFallback({
            prompt: buildNativeDeepReadGlmStructuringPrompt({
              episodeIndex: episode.episodeIndex,
              durationSec: episode.sourceDurationSec,
              segments: groupSegments,
              segmentIndexes,
              hasAudio,
              rawSegments: groupInputs,
              coverageStartSec: groupSegments[0]!.startSec,
              coverageEndSec: groupSegments.at(-1)!.endSec,
              scopeZh: "批次",
            }),
            videoCount: segmentIndexes.length,
            segmentIndexes,
            rows: groupInputs,
            fallbackRows: groupCanonicalRows,
            labelZh: `第${episode.episodeIndex}集第${segmentIndexes[0]! + 1}—${segmentIndexes.at(-1)! + 1}片批次整形`,
          });
          result.raw = unwrapNativeDeepReadStructuredAnswerEnvelope(result.raw);
          assertNativeDeepReadShotObservationsPreserved(groupInputs, result.raw);
          await writeCachedStructuring(segmentIndexes, groupInputs, result);
          return result.raw;
        }));
        // 0905 用户令「不归并，分上下集」：批次各自整形完，按秒位确定性拼成整集卡，
        // 省掉第三次 GLM（实测归并一发 49 分钟、输入 212K）。批次边界的重复镜头由
        // deterministicallyMerge 的「同秒位取信息更全」规则收口，零模型调用。
        const finalRaw = deterministicallyMergeNativeDeepReadRawSegments(groupRows);
        assertNativeDeepReadShotObservationsPreserved(groupRows, finalRaw);
        finalRaw.structuringBatches = groups.map((segmentIndexes) => ({ segmentIndexes }));
        // 这不是兜底，是正式路径：不许烙「本地兜底」标记
        delete finalRaw.structuringFallback;
        // 0902 用户令字段从批次卡合并回来：标题取最长的非空一条，五维判词逐维取非空并拼接
        const batchCards = groupRows.map(unwrapNativeDeepReadStructuredAnswerEnvelope);
        const titles = batchCards.map((card) => String(card.templateTitleZh || "").trim()).filter(Boolean);
        if (titles.length) finalRaw.templateTitleZh = titles.sort((x, y) => y.length - x.length)[0];
        const proseByKey: Record<string, string[]> = {};
        for (const card of batchCards) {
          const prose = card.classificationProseZh;
          if (!prose || typeof prose !== "object" || Array.isArray(prose)) continue;
          for (const [key, value] of Object.entries(prose as Record<string, unknown>)) {
            const text = String(value || "").trim();
            if (text) (proseByKey[key] ||= []).push(text);
          }
        }
        if (Object.keys(proseByKey).length) {
          finalRaw.classificationProseZh = Object.fromEntries(
            Object.entries(proseByKey).map(([key, texts]) => [key, Array.from(new Set(texts)).join("；")]),
          );
        }
        // 整集级 GLM 证据不存在（没有归并这一发）：报告导出走分段卡拼装，不许指向某一半批次卡
        glmEvidence = undefined;
        return finalRaw;
      };
      const parseCallId = `${episodeRequestId}:parse`;
      await emitVisualModelReceipt({
        callId: parseCallId,
        model: readModel,
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
        // 每集必走 GLM：EvoLink 降级路与 Vertex 主线走同一条装配线，不再按路由分叉。
        // 确定性拼接只算一次，取 excludedAdRanges 给 GLM 产物对账（防 GLM 私吞/改写广告区间）。
        const deterministicAdRanges =
          stripNonStoryAdShotsForEpisodeCard(annotateSegmentRows()).excludedAdRanges;
        const structuredRaw = unwrapNativeDeepReadStructuredAnswerEnvelope(await structuredEpisodeRaw());
        applyDeterministicAdRanges(structuredRaw, deterministicAdRanges);
        /**
         * 🔒 集级**镜头留存率闸**——0830 晚用户拍板「加回」的唯一一条集级判定。
         *
         * 拿掉整套集级门禁是对的（差 6 秒锯掉整集），但这条判的不是「差一点」，
         * 而是**证据被 GLM 整个吞掉**：0830 P0 实锤 426 镜压成 99 镜、平均镜长
         * 3.6s→15.4s，而覆盖秒数一秒不差、所有门禁全绿——机器算得出的东西
         * 不能只靠提示词。低于留存率拒收线即拒，不转 advisory（用户：「不要什麼advisory了」）。
         */
        {
          const keptShots = Array.isArray(structuredRaw.shots)
            ? (structuredRaw.shots as unknown[]).length
            : 0;
          if (preStructuringShotCount > 0 && keptShots > 0) {
            const keepRate = keptShots / preStructuringShotCount;
            if (keepRate < NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_REJECT) {
              throw gateError(
                `第${episode.episodeIndex}集镜头留存率仅 ${(keepRate * 100).toFixed(1)}%`
                + `（输入 ${preStructuringShotCount} 镜 → 整形后 ${keptShots} 镜，`
                + `低于拒收线 ${(NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_REJECT * 100).toFixed(0)}%）：`
                + `相邻但秒位不重叠的镜头不许合并，只有同一物理镜头的重复记录才能合并`,
              );
            }
          }
        }
        /**
         * 🔴 除上面那条留存率闸外，GLM 之后**不再设集级门禁、不再重整、也不再转 advisory**（0830 用户拍板）。
         *
         * 用户原话：「GLM 就是整形用的，还让他拒绝，有毛病吗」「3.4 都拿掉」
         * 「不要什么 advisory 了」「一次就都让他入库」「不想搞什么重试了」。
         *
         * 拿掉的两样：
         *   ③ 整形未过门禁时「带拒因重整一次」——多烧一发 GLM，还常常只是补几秒
         *   ④ GLM 之后的整集门禁——它把**已付费的整集段证据**挡在门外
         * 实锤代价：2817 秒的整集，GLM 合并掉 6 秒（0.2%）就重整一发；
         * 重整后覆盖过了，又倒在音轨分段完整性上，整集判死——
         * 10 片视觉证据全好、钱全花完，最后一片都没入库。
         *
         * 段级门禁保持不变（那里拦的是模型读片本身，重试是重读一片，代价小且有效：
         * 0830 实测被拦的片重试后 100% 救回）。集级这一道拦的是**整形层**，
         * 而整形层出了偏差不该让整集证据陪葬。
         */
        const episodeGateAdvisories: NativeDeepReadAdvisory[] = [];
        /**
         * ⑤ provenance（0830 晚用户拍板「加上」）：整集卡自报出身。
         *
         * 实锤教训：0830 手上那份漫剧整集卡没有任何运行元数据，隔一天就没人说得清
         * 它是哪次跑的、什么温度跑的——只能靠「连 keyMoments 字段都没有」反推版本。
         * 机器 /tmp 一清，段级证据也没了，来历就永久丢失。
         */
        structuredRaw.provenance = {
          planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
          model: readModel,
          temperature: NATIVE_DEEP_READ_GENERATION_CONFIG.temperature,
          thinkingLevel: NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig.thinkingLevel,
          // 输入规格入档（0830 晚）：隔天复盘时能说清这份产物是用什么画质读出来的。
          maxFps: NATIVE_DEEP_READ_MAX_FPS,
          requestedFps: episode.videoFps,
          // 0831 起不再发送 mediaResolution，走上游默认（Gemini 3 视频默认＝70 token/帧）。
          // 仍然入档，是为了让旧卡（显式 MEDIUM）与新卡（默认）在溯源上能一眼分开。
          mediaResolution: "unspecified_default",
          retryTemperatures: [...NATIVE_DEEP_READ_RETRY_TEMPERATURES],
          segmentCount: episode.segments.length,
          sourceDurationSec: episode.sourceDurationSec,
          batchRequestId: episodeRequestId,
          inputShotCount: preStructuringShotCount,
          structuringBatchSize: 4,
          glmEvidenceCallIds,
          structuringFallbackCodes: structuringFallbackAdvisories.map((row) => row.code),
        };
        const episodeRows: Array<Record<string, unknown>> = [structuredRaw];
        // 确定性拼接路与 GLM 整形路统一在此注入 chunkSpans：整集卡携带
        // audioResolution 各 chunk 的真实段界（来自 episode.segments spec），
        // mapper 的音频广告过滤只认它换算，绝不从镜头秒位猜 chunk 起点。
        const mapped = mapNativeDeepReadSegments(attachAudioChunkSpans(
          episodeRows,
          episode.segments,
          episode.episodeIndex,
        ).map((raw) => ({
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
        const episodeAdvisories = dedupeNativeDeepReadAdvisories([
          ...collectAdvisories(),
          ...episodeGateAdvisories,
          ...structuringFallbackAdvisories,
        ]);
        if (episodeAdvisories.length) {
          console.info(
            `[nativeDeepRead] 第${episode.episodeIndex}集改进建议 ${episodeAdvisories.length} 条：`
            + episodeAdvisories.map((row) => row.code).join("、"),
          );
        }
        episodes.push({
          episodeIndex: episode.episodeIndex,
          result: {
            ...mapped,
            // provenance 里的 advisory 真值：整集卡合并（含 GLM 整形）可能不带段卡
            // 的 advisories 字段，这里用段级汇总覆盖，保证面板一定看得到。
            advisories: episodeAdvisories.length ? episodeAdvisories : undefined,
            // 同理：整集卡是 GLM 产物，本身没有 truncated 标记。本集只要有任何一片
            // 被截断过，整集就必须如实标 truncated，否则「完整」与「缺了尾」长得一样。
            truncated: mapped.truncated
              || episodeAdvisories.some((row) => row.code.startsWith("truncated")),
            segmentCount,
            failedSegmentCount: 0,
            attemptedSegments: segmentCount,
            model: readModel,
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
            glmEvidence,
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
          model: readModel,
          route: "local_schema_gate",
          stage: "visual_parse",
          status: "completed",
          batchRequestId: episodeRequestId,
          episodeIndexes: [episode.episodeIndex],
          videoCount: segmentCount,
          inputTokens: episodeInput,
          outputTokens: episodeOutput,
          advisoryCodes: episodeAdvisories.length
            ? episodeAdvisories.map((row) => row.code)
            : undefined,
          advisoriesZh: episodeAdvisories.length
            ? episodeAdvisories.map((row) => row.detailZh).join("；").slice(0, 2_000)
            : undefined,
        }, params.onModelReceipt);
      } catch (error) {
        await emitVisualModelReceipt({
          callId: parseCallId,
          model: readModel,
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

    return { batch: {
      episodes,
      usage: { inputTokens, outputTokens, costCny },
      usingPlanQuota: false,
      model: readModel,
      batchRequestId,
    } };
  } catch (error) {
    const wrapped = (error instanceof Error ? error : new Error(String(error))) as NativeDeepReadRunError;
    wrapped.nativeDeepReadCostCny = costCny;
    wrapped.nativeDeepReadUsage = {
      inputTokens,
      outputTokens,
      costCny,
      usingPlanQuota: false,
      // 中止/失联时在途请求可能尚无回执，不能把已知部分冒充完整账单。
      receiptComplete: (inputTokens > 0 || outputTokens > 0)
        && !("currentAttemptUsageUnavailable" in wrapped && wrapped.currentAttemptUsageUnavailable === true),
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

/** 生产批处理保持原有公开契约；不向生产调用方暴露诊断分支或半集结果。 */
export async function runManhuaNativeDeepReadBatch(
  params: NativeDeepReadBatchRunParams,
  deps: NativeDeepReadBatchRunnerDeps = defaultBatchRunnerDeps,
): Promise<NativeDeepReadBatchRunResult> {
  return (await executeNativeDeepReadBatch(params, deps)).batch;
}

/**
 * 已推源码探针专用：从完整计划选择1至3个原索引，只读取调用方已验真的现有GCS片。
 * 共用生产尝试器和三档重试；不恢复旧缓存、不生成提案、不调用GLM、不删除输入片。
 */
export async function runManhuaNativeDeepReadSelectedSegments(
  params: NativeDeepReadSelectedSegmentsParams,
  deps: NativeDeepReadBatchRunnerDeps,
): Promise<NativeDeepReadSelectedSegmentsResult> {
  if (!params.seriesKey?.trim() || !/^[0-9a-f]{64}$/.test(params.sourceDigest)) {
    throw new Error("选段诊断缺少运行标识或稳定来源摘要");
  }
  if (!Number.isFinite(params.sourceDurationSec) || params.sourceDurationSec <= 0) {
    throw new Error("选段诊断缺少完整原集时长");
  }
  const segments = validateNativeDeepReadSegments(params.segments);
  const selectedSegmentIndexes = validateSelectedSegmentIndexes(params.selectedSegmentIndexes, segments.length);
  if (!Array.isArray(params.preparedVideos) || params.preparedVideos.length !== selectedSegmentIndexes.length) {
    throw new Error("选段诊断已有媒体数量与选中原索引不一致");
  }
  const preparedVideos: readonly PreparedNativeVideo[] = params.preparedVideos;
  const preparedByIndex = new Map<number, PreparedNativeVideo>();
  for (const video of Array.from(preparedVideos)) {
    const segmentIndex = selectedSegmentIndexes.find((index) => video
      && video.startSec === segments[index]!.startSec && video.endSec === segments[index]!.endSec);
    if (segmentIndex === undefined || preparedByIndex.has(segmentIndex)) {
      throw new Error("选段诊断媒体与原计划范围不匹配或重复");
    }
    if (!Number.isSafeInteger(video.bytes) || video.bytes <= 0 || typeof video.hasAudio !== "boolean"
      || !/^gs:\/\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9/_\-.]+$/.test(video.gsUri)
      || video.gsUri.split("/").some((part) => part === "." || part === "..")
      || !video.temporaryGcs || video.gsUri !== `gs://${video.temporaryGcs.bucket}/${video.temporaryGcs.objectName}`) {
      throw new Error("选段诊断已有媒体身份或验真元数据无效");
    }
    // 复制身份标量，避免调用方后续修改数组或对象造成审计和真正输入不一致。
    preparedByIndex.set(segmentIndex, { ...video, temporaryGcs: { ...video.temporaryGcs } });
  }
  const rejectUnexpected = async (): Promise<never> => {
    throw new Error("选段诊断禁止解析片源、旧缓存、提案装配、GLM或删除已有媒体");
  };
  const diagnosticDeps: NativeDeepReadBatchRunnerDeps = {
    ...deps,
    prepareVideos: async (episode) => {
      if (episode.cacheSourceDigest !== params.sourceDigest || episode.sourceDurationSec !== params.sourceDurationSec
        || episode.segments.length !== selectedSegmentIndexes.length) {
        throw new Error("选段诊断备料身份或选择范围发生变化");
      }
      return episode.segments.map((segment) => {
        const index = selectedSegmentIndexes.find((selected) => segment.startSec === segments[selected]!.startSec
          && segment.endSec === segments[selected]!.endSec);
        const video = index === undefined ? undefined : preparedByIndex.get(index);
        if (!video) throw new Error("选段诊断请求了未获授权的原索引媒体");
        return video;
      });
    },
    remove: rejectUnexpected,
    invokeGlmStructuring: rejectUnexpected,
    readSegmentCache: rejectUnexpected,
    writeSegmentCache: rejectUnexpected,
    postEvolink: rejectUnexpected,
  };
  const executed = await executeNativeDeepReadBatch({
    episodes: [{
      episodeIndex: params.episodeIndex ?? 1,
      resolveNodes: rejectUnexpected,
      segments,
      sourceDurationSec: params.sourceDurationSec,
      videoFps: params.videoFps,
      hintZh: params.hintZh,
      cacheSourceDigest: params.sourceDigest,
    }],
    abortSignal: params.abortSignal,
    onModelReceipt: params.onModelReceipt,
    segmentCacheSeriesKey: params.seriesKey,
    preservePreparedVideos: true,
    segmentModelConcurrency: params.segmentModelConcurrency,
  }, diagnosticDeps, selectedSegmentIndexes);
  if (!executed.diagnostic) throw new Error("选段诊断未返回独立段证据结果");
  return executed.diagnostic;
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
  videoFps?: number;
  hintZh?: string;
  abortSignal?: AbortSignal;
  /** 仅获授权证据探针使用：保留 GCS 视频分片。 */
  preservePreparedVideos?: boolean;
  /**
   * 🔓 并发上限三件（用户令「上限应该是我来定的，不是写死的」）。
   * 省略即用模块默认：切段 10 / 上传 4 / 模型扇出 10。
   */
  mediaCutConcurrency?: number;
  mediaUploadConcurrency?: number;
  segmentModelConcurrency?: number;

  /**
   * 逐段/整集模型回执。**必须转发给 batch**——此前单集入口没声明也没转发，
   * 走这条路的调用方（含验收探针）一条回执都拿不到，只能去翻 result 里的私有字段。
   */
  onModelReceipt?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>;
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
      videoFps: params.videoFps,
      hintZh: params.hintZh,
      cacheSourceDigest: params.sourceDigest,
    }],
    abortSignal: params.abortSignal,
    segmentCacheSeriesKey: params.seriesKey,
    preservePreparedVideos: params.preservePreparedVideos,
    onModelReceipt: params.onModelReceipt,
    // 并发上限必须一路转发——单集入口不转发＝探针设了也不生效（空壳参数）。
    mediaCutConcurrency: params.mediaCutConcurrency,
    mediaUploadConcurrency: params.mediaUploadConcurrency,
    segmentModelConcurrency: params.segmentModelConcurrency,
  }, deps);
  const only = batch.episodes[0];
  if (!only) throw new Error("原生精读没有返回集卡");
  return only.result;
}

export type { NativeDeepReadOutput };
export type { ManhuaNativeAudioDirectRoute };
export type { ManhuaNativeProviderErrorReceipt };
