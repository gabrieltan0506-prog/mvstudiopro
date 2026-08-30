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
  MANHUA_NATIVE_DEEP_READ_MODEL,
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
  EVOLINK_GLM_MODEL,
  GLM_MODEL_GATEWAYS,
  GlmGatewayError,
  OPENROUTER_GLM_MODEL,
  invokeGlmJsonChatWithGatewayFallback,
} from "./bailianChat.js";
import type { GlmGatewayName } from "./bailianChat.js";
import {
  createNativeDeepReadGlmEvidenceStore,
  type NativeDeepReadGlmEvidence,
  type NativeDeepReadGlmEvidenceContext,
  type NativeDeepReadGlmEvidenceDeps,
} from "./manhuaNativeDeepReadGlmEvidence.js";
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
  writeNativeDeepReadParsedAttemptEvidence,
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
          unitTypeZh: {
            type: "STRING",
            enum: ["剪辑镜头", "拆分镜证据段"],
            description: "真实剪辑切换写剪辑镜头；同一长镜内部由可观察变化触发的细分写拆分镜证据段。",
          },
          shotSizeZh: { type: "STRING", maxLength: 28 },
          angleZh: { type: "STRING", maxLength: 28 },
          compositionZh: {
            type: "STRING",
            maxLength: 80,
            description: "画面构图、主体位置、前中后景关系、视线方向与空间层次。",
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
            description: "角色四肢或等效附肢动作，以及持物方式、道具状态与交互。",
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
          actionZh: { type: "STRING", maxLength: 60 },
          transitionInZh: { type: "STRING", maxLength: 50 },
          evidenceRole: {
            type: "STRING",
            enum: ["story", "non_story_ad"],
            description: "story=推动剧情因果的镜头；non_story_ad=与剧情无关的商业广告。non_story_ad 镜头只保存时间轴，严禁写入任何内容。",
          },
        },
        /**
         * 🔴 Schema 分支（0830 晚用户定稿）：responseSchema 无法按 evidenceRole 条件必填，
         * 故此处只列两类镜头共有的三项；**story 的 17 字段完整性由 assertRawShotFieldPresence
         * 按 evidenceRole 分支强制**，绝非放宽 story 要求。
         * non_story_ad 只保存时间轴与分类标记，多列必填会逼模型给广告镜编描述。
         */
        required: ["startSec", "endSec", "evidenceRole"],
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
} as const;

/**
 * 首发与历史重试温度候选（2026-08-31 用户授权），待实测，不是已验收冻结值。
 *
 * 首发按用户指定由 0.70 调为 0.65；后两次复用 b948d7c 的 0.65、0.60，下限恢复 0.60。
 * 首发请求只改温度；整轮同时调整重试档位与下限，不能视为只改首发的单变量实验。
 * 保持 maxOutputTokens 65_536 · candidateCount 1 ·
 * audioTimestamp true · responseMimeType/responseSchema ·
 * thinkingConfig { thinkingLevel: "MEDIUM", includeThoughts: false } 及其余请求内容不变。
 *
 * 早期的 thinkingBudget 与禁止 thinkingLevel 口径已被本次 MEDIUM 定稿替代。
 * 变更流程见知识库《schema动刀纪律》：改一字＝新版本＝旧缓存作废＝需重新探针实测。
 * 首发请求字节边界与历史重试档位由 manhuaNativeDeepReadRunner.test.ts 分别检查。
 */
export const NATIVE_DEEP_READ_GENERATION_CONFIG = {
  // 待验首发候选；重试温度仍以 NATIVE_DEEP_READ_RETRY_TEMPERATURES 为准。
  temperature: 0.65,
  maxOutputTokens: 65_536,
  candidateCount: 1,
  audioTimestamp: true,
  responseMimeType: "application/json",
  responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  /**
   * 0830 晚用户拍板：**去掉 thinkingBudget，改用 thinkingLevel**。
   *
   * 实测依据：thinkingBudget 从来不是硬上限——设 18K 实跑 39,024，设 12K 实跑 24,674。
   * Google 对 Gemini 3 系列保留旧 thinkingBudget 兼容但推荐 thinkingLevel；
   * ⚠️ 官方同时说明**思考等级也是相对控制，不保证固定 token 数**，
   * 所以改成 MEDIUM 同样不承诺「绝不超过某个值」，只是换一种更受支持的控制方式。
   *
   * 🔒 两者不得同时发送。此处只保留 thinkingLevel。
   * includeThoughts:false 只关闭思考摘要回显，不关闭思考本身，也不消除其用量。
   * 实际消耗一律以回执里的 thoughtsTokenCount 为准，不拿配置值当实际值。
   */
  thinkingConfig: { thinkingLevel: "MEDIUM", includeThoughts: false },
  /**
   * 使用 generationConfig 的全局枚举。Part 级字段是另一种对象结构，不能传裸字符串。
   * Google Gemini 3 视频文档：默认、LOW、MEDIUM 均为 70 token/帧，HIGH 为 280。
   * 因此约 210K 输入不能证明 MEDIUM 被忽略；也不能把 MEDIUM 误称为四倍画质。
   * https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/video-understanding#video_tokenization
   * 保持用户冻结值不变，真实请求由探针序列化审计，上游处理效果须另做实证。
   */
  mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
} as const;

/**
 * 待验候选同一 Vertex 分片至多三次：0.65 → 0.65 → 0.60；后两档复用 b948d7c。
 * 是否重试由统一段级判据决定；截断前缀保留、不因覆盖重复购买，用户中止不重试。
 */
export const NATIVE_DEEP_READ_RETRY_TEMPERATURES = [0.65, 0.65, 0.6] as const;

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
 * 排除：`audio_cue_thin`（声音事件条数≈音轨长度密度）与 `audio_timeline_invalid`——
 * 安静段落声音事件天然少，拿它推重买等于为「本来就没声音」付钱。
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
export const NATIVE_DEEP_READ_COVERAGE_SOLO_RETRY_CODES: ReadonlySet<string> = new Set([
  "coverage_missing", "coverage_head_gap", "coverage_tail_gap", "timeline_gap",
]);

export const NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES: ReadonlySet<string> = new Set([
  "audio_track_thin",
  "coverage_missing",
  "coverage_head_gap",
  "coverage_tail_gap",
  "timeline_gap",
]);
export const NATIVE_DEEP_READ_RETRY_INTERVAL_MS = 60_000;
export const NATIVE_DEEP_READ_TEMPERATURE_MIN = 0.6;

/** 第二次尝试参数；保留导出供既有调用方与缓存指纹使用。 */
export const NATIVE_DEEP_READ_RETRY_GENERATION_CONFIG = {
  ...NATIVE_DEEP_READ_GENERATION_CONFIG,
  temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[1],
} as const;

/** 第三次（末次）尝试参数：收口到温度下限。 */
export const NATIVE_DEEP_READ_FINAL_RETRY_GENERATION_CONFIG = {
  ...NATIVE_DEEP_READ_GENERATION_CONFIG,
  temperature: NATIVE_DEEP_READ_RETRY_TEMPERATURES[NATIVE_DEEP_READ_RETRY_TEMPERATURES.length - 1],
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
export const NATIVE_DEEP_READ_VISUAL_PLAN_VERSION = "time-custom-v25-first065-experiment" as const;

/** 分片时长和采样率独立配置；默认 10fps，不按长短片自动降档。 */
export function resolveNativeDeepReadRequestFps(totalDurationSec: number, requestedFps?: number): number {
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    throw new Error("原生精读采样时长必须为有限正数");
  }
  return parseNativeDeepReadVideoFps(requestedFps);
}
/** 官方视频输入 fps 上限。 */
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
/** 整片长度：达到该长度才算完整分片；不足的尾片按实际取值入库，不设镜数门禁。 */
export const NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC = 300;
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
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC = 30;

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
/** 长镜证据拆分点之间至少相隔 1 秒，禁止用同秒空切凑过 30 秒门禁。 */
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
   * 0826 用户拍板：硬约束只留「错了会污染入库数据」的红线。
   * 0829 提示词软化：密度不再以「至少 N 镜 / 至少 N 段 / 至少 N 条 cue」的数字下达——
   * 数字目标只会逼模型编造凑数（0826 实弹：安静段落被逼出不存在的声音事件）。
   * 密度改为软引导 + 诚实优先声明；结构化层负责整理，门禁只贴标记不再当拒收线。
   */
  const audioHardRule = input.hasAudio
    ? `6. audioResolution 固定为 [{"chunkIndex":${input.segmentIndex},"analysis":{…}}]，由你**亲耳所听**产出，禁止凭画面编造声音；audioTrack 与 cues 内时间用**本段局部秒**（0..${lenSec}），这是全 JSON 唯一的局部秒例外。`
    : `6. 本段素材没有音轨：audioResolution 必须返回空数组 []，禁止凭画面编造声音。`;
  const audioSoftRules = input.hasAudio
    ? `b. 音轨按声音性质切段、连续覆盖本段：**有几段写几段——环境音、静场氛围同样算一段；安静段落只有 1 段是正常的，禁止为凑数编造不存在的声音事件。** 每条 audioTrack 必须完整输出 emotionArcZh/toneZh/sfxZh/bgmZh/atmosphereZh/silenceZh 与 cues 七栏，禁止省略字段；确实没有某类声音时对应文本写「无」，cues 仍必须是数组。cues 记录每一次可听见的独立声音事件（音效、配乐进出与变化、留白转换、语气突变），听见几次记几次，没听见就不记。analysis 的 audioBeatStructureZh/mixNotesZh/reusableAudioZh/genAudioHintZh 四栏也必须完整输出。
c. 输出预算紧张时优先压缩 subtitles，尽量保全镜头表与音轨栏的密度。`
    : "";
  const base = `【必须遵守】

1. 时间坐标
所附视频文件只有本段 ${lenSec} 秒，文件 00:00 对应全片 ${Math.round(input.startSec)} 秒。先定位原帧，再将文件内 MM:SS 或 HH:MM:SS 换算为本段累计秒 t = 小时×3600 + 分钟×60 + 秒；全片秒位 = ${Math.round(input.startSec)} + t，音轨局部秒位 = t。例如文件 ${fileClock(exampleLocalSec)} 对应本段 ${exampleLocalSec} 秒、全片 ${Math.round(input.startSec) + exampleLocalSec} 秒；文件末尾 ${fileClock(lenSec)} 对应本段 ${lenSec} 秒、全片 ${Math.round(input.endSec)} 秒。
shots.startSec/endSec、subtitles.atSec 一律使用全片绝对整数秒；keyMoments.atSec 使用全片绝对秒，可保留一位小数。本段范围为 ${Math.round(input.startSec)} 至 ${Math.round(input.endSec)} 秒，shots 按时间排序，连续覆盖整段。
audioResolution 内的 fromSec/toSec、cues.atSec 使用本段局部整数秒，以本段起点为 0；chunkIndex 使用传入原值。
位置写入数字字段；中文描述里可以写动作持续时长，如「1.2 秒内推近」。

2. 镜头记录与长镜拆分
真实剪辑切换的 unitTypeZh 写「剪辑镜头」。
同一物理长镜持续超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒时，按镜内真实发生的构图、运镜、角色调度、动作、表演或光影变化，拆成至少两个连续证据段。每段 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}—${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，完整覆盖原镜头。
拆分后的 unitTypeZh 写「拆分镜证据段」；第二段及后续段的 transitionInZh 固定写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。

3. 统一适用范围
以下逐镜内容、抓帧、字幕、音轨与总结要求均适用于 story；其他类别按末尾的统一分类与 Schema 分支规则处理。

4. 完整性与密度
如实记录全部可见、可听的证据。每次真实画面切换，包括机位、景别或场景切换，都记录为新的一镜。
镜头密度属于建议项，不作为拒收依据。真实发生多少就记录多少。

5. 输出格式
返回一个 JSON 对象，字段名、类型、枚举及必填项遵循对应的 Schema 分支。各描述字段遵守下列字数上限；镜头条数由真实内容决定。

【任务与输入】

你是影视成片的导演手法分析师。重点分析拍法：镜头、构图、运镜、角色调度、动作、表演、灯光与声音，以及这些要素形成的节奏和情绪变化。
逐镜字段记录直接观察到的事实；总结字段根据这些证据提炼可复用手法。真人、动画及非人角色采用同一观察原则。

全片时长：${Math.round(input.episodeDurationSec)} 秒。
当前片段：第 ${Math.round(input.startSec)} 至 ${Math.round(input.endSec)} 秒。
分段序号：第 ${input.segmentIndex + 1}/${input.segmentCount} 段。
音轨段号：${input.segmentIndex}。${hint ? `\n补充信息：${hint}。` : ""}

【正向要求一：逐镜分析 shots】

每条 story 镜头填写以下 17 字段：
- startSec：起始秒位。
- endSec：结束秒位。
- unitTypeZh：剪辑镜头／拆分镜证据段。
- shotSizeZh：实际景别，如极特写、特写、近景、中景、全景、大远景。
- angleZh：实际机位，如平视、仰拍、俯拍、过肩、主观。
- compositionZh：主体位置、前中后景、视线方向与空间层次，≤80字。
- cameraMoveZh：运镜起点、方向、速度或节奏、幅度与落点；静止画面写「固定机位」，≤80字。
- blockingZh：角色站位、朝向、距离、进退路径、遮挡与群像调度变化，≤70字。
- bodyActionZh：整体姿态、躯体重心、移动方式、结构形变与动作阶段，≤70字。
- limbPropActionZh：四肢或等效附肢动作、持物方式、道具状态与交互，≤70字。
- microExpressionZh：面部或等效表情器官的可见细微变化，≤58字。
- gazeBreathZh：视线或感知指向、眨眼、呼吸及可见节律变化，≤58字。
- relationshipReactionZh：角色动作先后、彼此回应与距离变化，≤60字。
- lightingZh：主辅光位、色调、明暗关系、轮廓光与环境光变化，≤58字。
- actionZh：本镜可见动作过程、信息变化、结果与辨识特征，≤60字。
- transitionInZh：进入本镜的实际转场方式；长镜续段使用规定标记。
- evidenceRole：按统一分类规则填写。

【正向要求二：关键抓帧 keyMoments】

keyMoments 是由你选定的抓帧秒位表。下游会按 atSec 去原片抓取对应画面，因此应选事件最有代表性的实际发生秒位。
五类选点依据：
- 切镜：景别或机位发生突变后，画面清晰落定的代表帧，例如中景切到特写的瞬间。
- 情绪：微表情的峰值时刻，例如眉头锁紧、眼神变化最明确的那一秒。
- 灯光：氛围切换前后各一条，例如暖光转为面部阴影加深时，分别记录变化前后的代表帧。
- 剧情：推动因果的关键节点，例如字幕点明冲突、关键道具亮相。
- 音轨：声音事件发生秒，例如配乐转折、关键音效或声音分段切换。
密度跟着戏走：重点镜头可选多条；固定机位、表演和光影均无明显变化的平淡镜头，可以一条都不给。
每条包含：
- atSec：全片绝对秒，可保留一位小数（如 673.6）。输入按 ${videoFps}fps 抽帧，采样间隔约 ${sampleIntervalSec} 秒；取事件真正发生的那一帧的秒位。
- kindZh：切镜／情绪／灯光／剧情／音轨。
- noteZh：一句话说明该时刻发生的事件，≤60字。
keyMoments 为必填字段；本段没有合适抓帧点时输出 []。

【正向要求三：关键时刻字幕 subtitles】

仅收录 atSec 落在任一 keyMoment.atSec 前后 2 秒范围内的真实剧情字幕。
每条包含：
- atSec：字幕实际出现的全片绝对整数秒。
- textZh：画面中该条字幕的原文，逐字照抄。
命中几条记录几条；附近没有字幕时留空。不可辨部分标记为「[不可辨]」。keyMoments 为空时，subtitles 输出 []。

【正向要求四：声音解析 audioResolution】

按照实际声音状态及其变化组织 audioTrack。数组形状遵循传入的音轨条件和 Schema。
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
安静、持续不变或事件较少时，按真实情况填写。
${audioHardRule}

【正向要求五：节奏、情绪与手法总结】

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
标签来自本段真实证据。证据充分时覆盖至少两个维度；没有依据的维度填写 []。

【统一分类与 Schema 分支规则】

shots 条目按 evidenceRole 区分两种结构：
1. story —— 推动剧情因果的镜头。使用完整 17 字段结构，全部 17 字段保持必填。
2. non_story_ad —— 与剧情无关的商业广告。仅保留 startSec、endSec、evidenceRole 三个字段，用于保存时间轴与分类标记；其他描述及衍生内容严禁写入。

【禁止事项】

1. 编造不存在的镜头或声音，漏记真实发生的切镜。为凑密度、分类维度、抓帧点或声音事件数量补造内容。
2. 为节省字数合并镜头、减少条数、跳过对应分支的必填字段，或截断长镜、丢弃尾部、伪造剪辑切换。
3. 把镜头区间中点机械当作 keyMoment；视觉选点落在过渡帧、运动模糊或无代表性的空镜上。
4. 字幕从声音猜字、按剧情想像补全或添加画面中不存在的台词。
5. 中文描述字段出现「01:23」「在第X秒」等时间定位。
6. 用题材词代替手法分类，将未呈现的人物动机或推测当作观察事实。
${audioSoftRules}`;
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
 * 单集媒体备料并发上限（0829 晚用户拍板 4→10：「单集有多少就发多少，十发之内都一次发走」）。
 * 跨集仍由 execution 串行，避免批量任务打满机器。
 * ⚠️ 这只是**上限**，实际并发仍被 /tmp 可用空间公式二次夹紧（切片会落地本地文件）。
 * 🔓 上限由调用方入参覆盖（用户令「上限应该是我来定的，不是写死的」）。
 */
export const NATIVE_DEEP_READ_MEDIA_PREP_MAX_CONCURRENCY = 10;
/**
 * 分片上传 GCS 的并发上限。曾经是**严格串行**（一个 for 循环），是全链最明显的串行点。
 * 改并发但保留上限：uploadBufferToGcs 会复制 Buffer，10 路并行在极端片源下可放大到 GB 级内存。
 * 实测依据：300 秒 540p 分片约 15–20MB（知识库 3.6MB/分钟），4 路 ≈ 160MB，安全。
 * 🔓 同样可由入参覆盖。
 */
export const NATIVE_DEEP_READ_MEDIA_UPLOAD_MAX_CONCURRENCY = 4;
/**
 * 单集模型调用并发上限（0829 晚用户拍板 4→10）。
 * 原先写死 `Math.min(4, segmentCount)`：一集 6 片会被切成 4+2 两波，
 * 第 5、6 段要等前四段全部回来才发得出去——那是「批次串行」，不是并发。
 * 🔓 可由入参覆盖。
 */
export const NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY = 10;

function mediaHeaders(node: NativeDeepReadMediaNode): string[] {
  const referer = String(node.referer || "").trim();
  return [
    "-user_agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    ...(referer ? ["-headers", `Referer: ${referer}\r\n`] : []),
  ];
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
  for (const audio of audios) {
    const start = number(audio.start_time);
    const duration = number(audio.duration);
    // 真实音轨允许晚起或早停；不把无声区当截短，也不填造静默音频。
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0
      || start + duration > durationSec + 0.1 + 1e-6) {
      fail("音轨时间范围无效或超出实际视频");
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
  limits?: { cutConcurrency?: number; uploadConcurrency?: number },
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

function gateError(detailZh: string): Error {
  return new Error(`${NATIVE_DEEP_READ_GATE_PREFIX}：${detailZh}`);
}

/** 这两类证据缺陷不得被「硬门单项放行」吞掉；不要通过中文错误文案识别。 */
export class NativeDeepReadRequiredEvidenceError extends Error {
  constructor(
    readonly code: "coverage_below_90" | "shot_evidence_too_long",
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
};

/** 首发、缓存、同源迁移共用完整判据，不另按 advisory 条数造第二把尺子。 */
export function evaluateNativeDeepReadSegmentAcceptance(input: NativeDeepReadSegmentGateInput) {
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
  const countableFailures = input.truncated === true ? [] : gated.advisories;
  const families = Array.from(new Set(countableFailures.map((row) =>
    nativeDeepReadAdvisoryFamilyOf(row.code))));
  const failureCount = families.length;
  const twoItemOverDeviation = failureCount === 2 && countableFailures.some((row) =>
    NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_CODES.has(row.code)
      && (row.deviationRatio ?? 0) > NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO);
  const coverageSoloRetry = countableFailures.some((row) =>
    NATIVE_DEEP_READ_COVERAGE_SOLO_RETRY_CODES.has(row.code)
      && (row.deviationRatio ?? 0) > NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO);
  return {
    ...gated,
    families,
    failureCount,
    twoItemOverDeviation,
    coverageSoloRetry,
    retry: failureCount >= NATIVE_DEEP_READ_SEGMENT_RETRY_MIN_FAILURES
      || twoItemOverDeviation || coverageSoloRetry,
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

function assertRawShotFieldPresence(raw: Record<string, unknown>, labelZh: string): void {
  const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
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
    const requiredFields: ReadonlyArray<string> = role === "non_story_ad"
      ? NATIVE_DEEP_READ_REQUIRED_AD_SHOT_FIELDS
      : NATIVE_DEEP_READ_REQUIRED_SHOT_FIELDS;
    const missingFields = requiredFields.filter(
      (field) => !Object.prototype.hasOwnProperty.call(row, field),
    );
    if (missingFields.length > 0) {
      throw gateError(`${labelZh}第${index + 1}镜字段不完整：缺 ${missingFields.join("、")}`);
    }
    if (role === "story") {
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
  const hardOverlong = evidenceDurations.filter(
    // 10% 容差（0830 用户令）：提示词仍要求 30 秒，门禁按 33 秒拒——
    // 容差只放在拦截侧，不放在要求侧；擦边不值得重买一整片视频输入。
    (shotLen) => shotLen > NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC,
  );
  if (hardOverlong.length > 0) {
    // 硬门禁（0829 用户令：超过 30 秒必须拆）：单条证据段不得超过硬上限。
    throw new NativeDeepReadRequiredEvidenceError("shot_evidence_too_long",
      `${input.labelZh}有 ${hardOverlong.length} 个超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC} 秒的镜头证据段（要求 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒 + 10% 容差；最长 ${Math.round(Math.max(...hardOverlong))} 秒）；真实长镜必须按镜内变化拆成连续证据段，禁止截断尾部`,
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
  const storyFloors = resolveNativeDeepReadSegmentFloors(storyDurationSec);
  const audioFloors = resolveNativeDeepReadSegmentFloors(lenSec);
  // 0829 用户裁决：不足整片（<300 秒）的尾片按实际取值直接入库，不设镜数门禁——
  // 尾片长度天然不定，用同一把尺子卡它只会把真实产出判死。
  const isFullLengthSegment = lenSec >= NATIVE_DEEP_READ_SEGMENT_FULL_LENGTH_SEC;

  /**
   * ❌ 镜数「离谱地板」已整条删除（0830 用户令：「我都设好上限了，不要管下限了」）。
   *
   * 删除理由是实弹账：真人剧那轮 10 片有 5 片因这条被拦、每次重试都要重付一整片视频输入
   * （¥37.50 里相当一部分花在这上面），而重试回来的产出并不比首发更「对」——
   * 它只是把镜头切得更碎去满足一个按漫剧节奏定的数字。
   * 下限本质上是在替模型规定「该看到多少东西」，而不同体裁、不同片源本来就不一样。
   *
   * 留下的是**上限与覆盖**这两条与体裁无关的硬约束：
   *   · 单条证据段 ≤30 秒（用户三十余次实测拍板，不得放宽）
   *   · 段级覆盖率地板（整片必须读完，回 3 秒即拒）
   * 「切得够不够细」交给提示词软引导与整形层，不再由门禁下数字。
   */

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
const GLM_STRUCTURING_MAX_TOKENS = 131_072;
/**
 * 🔒 整形链采样温度（0829 晚用户拍板 0.8）。
 * 不传＝EvoLink 默认 1.0（太飘）；0.2 又太死板，会变成照抄不敢取舍——
 * 而整形的核心动作恰恰是「同秒位多版本里取信息更全的那条」，需要判断力。
 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE = 0.8;
/**
 * 🔒 整形链思考档位（0830 用户拍板 **medium**，从 high 下调）。
 *
 * 下调依据是 0830 的实弹算术——GLM 的思考与正文**共吃同一个 131,072 预算**：
 *   GLM  effort=high：思考 85,513 → 正文只剩 45,559 → 输出 99 镜（99×455≈45,045，
 *                     几乎一格不剩）→ 平均镜长 15.4 秒，镜头留存率仅 23%
 *   Qwen 思考独立额度：正文拿满 131,072 → 输出 332 镜 → 平均 4.6 秒，留存率 78%
 * 两边喂的是同一份提示词（sha 27c09dc9a68c8e86）。GLM 很可能不是「觉得该合并」，
 * 而是**装不下**——一路合并压缩来适配剩余预算。降档＝把预算从思考挪回正文。
 *
 * ⚠️ 这是**待实测验证**的推断，不是已证结论：降到 medium 后镜数若明显回升即证实；
 * 若不回升，说明是模型自身的合并倾向，那时该换整形模型而不是继续调档。
 */
export const NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT = MANHUA_NATIVE_GLM_REASONING_EFFORT;
/** 四个 300 秒分片的真实组装曾在 12 分钟边界被本地中止；只放宽等待，不自动重提。 */
// 0829 用户令：不设硬超时，跑出结果为止。全收进 GLM 后输入更大（六段卡 ~21.7 万 tok
// 再叠标记版），旧的 15 分钟硬顶在 900,005ms 处把调用掐断成 network_error。
const GLM_STRUCTURING_TIMEOUT_MS = 6 * 60 * 60_000;
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
    system: `你是影视模板卡的「结构化整形师」，擅长把零碎的片段整理成有参考价值的内容。输入是同一集的多份分段卡，你并成一张整集卡。
职责是在输入内容范围内取舍与归并：可润色文句、不必统一文风，每条产出都要能在输入里找到出处。

**一、镜头**
判准只有一条：输出的 shots 是**一组互不重叠、首尾相接的区间**，连续覆盖整段（广告秒位除外），任何一秒恰好由一条 story 记录覆盖。
· 能并的只有**秒位重叠的重复记录**（同一物理镜头记了两遍，来自段边界或多版本）。
· 秒位不重叠的两条镜头各自保留——哪怕表演连续、同场景同机位。
· 单次合并跨度 ≤ ${NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC} 秒；单条记录跨度 ≤ ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒。更长的长镜按镜内真实变化切成首尾相接的证据段，每段 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC}–${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，unitTypeZh 写「拆分镜证据段」，第二段起 transitionInZh 写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。
· 唯一合法手段是**调整切分**。unitTypeZh/shotSizeZh/angleZh/compositionZh/cameraMoveZh/blockingZh/bodyActionZh/limbPropActionZh/microExpressionZh/gazeBreathZh/relationshipReactionZh/lightingZh/actionZh/transitionInZh 逐项随记录保留。

**二、多版本裁决**
同段可能同时喂来通过版与被标记版，通过的未必更好。**记录去重、信息取并集**：同一物理镜头只留一条，但吸收所有版本对它的观察。
顺序（保证同输入同结果）：① 以未标记未截断那版作骨架，没有则取 attemptNumber 最大的 ② 切分粗细不同时以更细的为准 ③ 秒位重叠的合并、字段取更具体那版原文，秒位不重叠的全保留。
truncated / advisories / gateMarked / gateMarkedZh / attemptNumber 标注的都是真实产出，已写出的照常采纳；截断段尾部缺失就保持缺失。标记字段本身跳过。

**三、其余字段**
· 广告镜：evidenceRole=non_story_ad 整行剔除。
· subtitles：story 区间并集去重，按全片绝对秒位排序；条数多寡不作要求。
· audioResolution：保留完整听觉证据；audioBeatStructureZh/mixNotesZh/reusableAudioZh/genAudioHintZh 只从 story 提炼。
· keyMoments：原样保留，同秒同类留一条取说明更具体的，不同秒或不同类全保留；atSec 只来自输入。
· classification：五个数组显式输出，有证据就写，无证据写 []。
· 秒位只进数字字段。描述里写时长（如「1.2 秒内推近」），钟表式（01:23）留给数字字段。

**四、输出**：只返回一个 JSON 对象，无 Markdown 围栏、无解释。

**五、三条红线**
1. 不虚构输入里没有的镜头、字幕、声音或描述。
2. 不为了精简而合并不重叠的镜头。
3. 不新增 keyMoments 的 atSec。`,
    user: `把以下同一集的 ${input.rawSegments.length} 份分段卡整形合并成**一张整集原生证据卡**（单个 JSON 对象，字段 schema 与分段卡完全相同：shots/subtitles/audioResolution/beatStructureZh/moodArcZh/classification/reusableZh/genPromptHintZh，另加顶层可选 excludedAdRanges）。
要求：
1. story 镜头连续无空档覆盖除 excludedAdRanges 外的全时间轴 0..${Math.round(input.durationSec)} 秒（绝对秒位），每镜保留 evidenceRole；🔴 **只有秒位重叠的重复记录可以合并；相邻不重叠的镜头一律各自保留**——整集输出的镜头条数应与输入去重后的真实切分相当，**镜头数大幅变少、平均镜长明显拉长即为错误产出**。non_story_ad 必须整行剔除并把 {startSec,endSec} 区间记入顶层 excludedAdRanges，不得混入 story。🔒 一次合并的总跨度不得超过 ${NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC} 秒；超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒必须切成两段、每段不超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒、每段各自不短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒，且不得删除仍需保留的「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」续接标记或丢失覆盖。
2. audioResolution 保留全部 [{chunkIndex,analysis}] 条目（chunkIndex 即段号，analysis 内为该段局部秒），逐段齐全${input.hasAudio ? "" : "；本集素材无音轨，audioResolution 保持空数组"}。
3. beatStructureZh/moodArcZh/reusableZh/genPromptHintZh 只整合 story 证据，可加「第X段」标注；classification 五维标签只取 story 输入并集，不得补猜。
3.9 subtitles 按 keyMoments 解析：每条字幕对应其秒位附近的重点时刻，**不设条数多寡的判断**。照原文合并去重即可，不得补写输入里没有的台词。
4. 输入是本集**全部**产出：合规段、带 advisories 的段、truncated 截断段、被门禁标记（gateMarked）的版本都在其中，一份都不许丢。**同一段可能有多个版本**，按秒位合并去重后取信息更全的；截断段照常采纳已有内容、不补写尾部；段边界的重复镜头/字幕/声音事件同样按秒位合并。
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
    system: `你是影视模板卡的「JSON 语法修复师」。只修语法不创作：
1. 输入是一份 JSON 语法损坏的分段卡原文；你的唯一任务是恢复成合法 JSON。
2. 禁止虚构原文里没有的镜头、字幕、声音或描述；禁止删减原文已有的内容。shots 内 unitTypeZh/shotSizeZh/angleZh/compositionZh/cameraMoveZh/blockingZh/bodyActionZh/limbPropActionZh/microExpressionZh/gazeBreathZh/relationshipReactionZh/lightingZh/actionZh/transitionInZh 必须逐项原样恢复，不能压回 actionZh。
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
  evidence?: NativeDeepReadGlmEvidence;
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

export async function invokeNativeDeepReadGlmStructuring(
  prompt: { system: string; user: string },
  abortSignal?: AbortSignal,
  context?: NativeDeepReadGlmEvidenceContext,
  deps?: { invoke?: typeof invokeGlmJsonChatWithGatewayFallback; evidence?: NativeDeepReadGlmEvidenceDeps },
): Promise<NativeDeepReadGlmStructuringResult> {
  const store = createNativeDeepReadGlmEvidenceStore(context, deps?.evidence);
  let raw: Record<string, unknown> | undefined;
  const request = {
    system: prompt.system,
    user: prompt.user,
    maxTokens: GLM_STRUCTURING_MAX_TOKENS,
    gatewayPolicy: "glm_only" as const,
    timeoutMs: GLM_STRUCTURING_TIMEOUT_MS,
    // 🔒 整形链参数（0829 晚用户拍板，改任一项＝改成本与产出口径，改前先报）
    temperature: NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE,
    reasoningEffort: NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT,
    requireParameters: true,
    requireFinishReasonStop: true,
  };
  // 请求先永久留存；回调在bailian解析SSE/JSON前await，保存失败不得另烧备用。
  await store.writeRequest(request);
  const response = await (deps?.invoke ?? invokeGlmJsonChatWithGatewayFallback)({
    ...request,
    abortSignal,
    onRawResponse: async (response) => { await store.writeRawResponse(response); },
    validateContent: (content) => {
      store.assertRawResponseSaved();
      raw = parseJsonObject(content);
    },
  });
  // 通道锁：只接受仍然是 GLM-5.3 的两档（EvoLink / OpenRouter）。
  // 判据复用 bailianChat 的单一真源集合，不在这里再写一遍网关名。
  if (!GLM_MODEL_GATEWAYS.has(response.gateway) || !raw) {
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
  postVertex: typeof postVertexNativeDeepRead;
  postEvolink: typeof postEvolinkNativeDeepRead;
  signReadUrl: typeof signGsUriV4ReadUrl;
  invokeGlmStructuring: typeof invokeNativeDeepReadGlmStructuring;
  readSegmentCache: typeof readNativeDeepReadSegmentCacheEntry;
  writeSegmentCache: typeof writeNativeDeepReadSegmentCacheEntry;
  writeRawAttemptEvidence: typeof writeNativeDeepReadRawAttemptEvidence;
  writeParsedAttemptEvidence: typeof writeNativeDeepReadParsedAttemptEvidence;
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
  writeParsedAttemptEvidence: writeNativeDeepReadParsedAttemptEvidence,
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

/** 收到明确 HTTP 失败响应的错误（结果确定），可按路由铁律换通道重试。 */
type HttpFailure = Error & { nativeDeepReadHttpStatus?: number };

const ROUTE_LABEL_ZH: Record<NativeDeepReadVisualRoute, string> = {
  [NATIVE_DEEP_READ_ROUTE_VERTEX]: "Vertex Gemini 3.1 Pro 视频精读",
  [NATIVE_DEEP_READ_ROUTE_EVOLINK]: "EvoLink Gemini 3.1 Pro 视频精读（兜底）",
};

/**
 * 一次请求读取一集（逐段调用），回传后按段合并成集卡。
 * 可重试错误按共享温度常量在原通道最多尝试三次，每次间隔 60 秒；
 * 用户中止、证据保存失败或 Schema 失败立即终止，不进入后续重试。
 */
export type NativeDeepReadBatchRunParams = {
  episodes: readonly NativeDeepReadBatchRunEpisode[];
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: NativeDeepReadVisualModelReceipt) => void | Promise<void>;
  /** 传入即启用段级恢复与永久证据；生产 execution 和单集入口都必须传稳定 seriesKey。 */
  segmentCacheSeriesKey?: string;
  /** 仅获授权证据探针使用：保留 GCS 视频分片，不执行 finally 清理。 */
  preservePreparedVideos?: boolean;
  /**
   * 🔓 并发上限三件（用户令「上限应该是我来定的，不是写死的」）。
   * 省略即用模块默认：切段 10 / 上传 4 / 模型扇出 10。
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
          if (!nativeDeepReadSegmentMeetsThreeItemLine({
            episodeIndex: episode.episodeIndex,
            segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            hasAudio: entry.hasAudio,
            raw: entry.raw,
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
      /**
       * 被门禁**标记**的版本（0829 晚用户拍板：门禁是贴标签的，不是把门的）。
       *
       * 用户原话：「我就是要让所有的产出都进 GLM」「要不然我干嘛说标记」
       * 「模型每一次跑都会出来不一样的结果，不是说合格就一定是好的」。
       * 硬门仍触发重试（给模型改的机会），但**第一发不丢**——它同样是已付费产出，
       * 某几个镜头可能比通过那发写得更准。连同通过版一起交 GLM 按秒位去重合并。
       */
      const markedVersionsBySegment = new Map<number, Array<Record<string, unknown>>>();
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
            videoFps: input.fps,
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
          let rawAttemptEvidence: Awaited<ReturnType<typeof writeNativeDeepReadRawAttemptEvidence>> | undefined;
          let requestFingerprint: string | undefined;
          if (params.segmentCacheSeriesKey && episode.cacheSourceDigest) {
            requestFingerprint = nativeDeepReadSegmentCacheFingerprint({
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
                batchRequestId: episodeRequestId,
                callId,
                attemptNumber: input.attemptNumber,
                temperature: input.temperature,
                visualRoute: input.route,
                providerRequestId: response.requestId,
                model: NATIVE_DEEP_READ_MODEL,
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
            });
            gated = decision;
            const passedWithNotice = gated.advisories.find((row) => row.code === "gate_passed_under_threshold");
            if (passedWithNotice) raw.gateMarkedZh = passedWithNotice.detailZh;
            // 截断豁免、家族计数和20%白名单只在共享判据定义；这里仅执行结果并记账。
            const countableFailures = truncated ? [] : gated.advisories;
            const { failureCount, twoItemOverDeviation, coverageSoloRetry, families } = decision;
            if (decision.retry) {
              const reasonZh = countableFailures.map((row) => row.detailZh).join("；").slice(0, 500);
              raw.gateMarked = true;
              raw.gateMarkedZh = reasonZh;
              raw.attemptNumber = input.attemptNumber;
              // 标记版**只在这里推池一次**（审计必修④）：下面 catch 不再重复推，
              // 否则同一对象引用推两次就把上限 2 的池占满，第 2 发证据永远进不去。
              const pool = markedVersionsBySegment.get(input.segmentIndex) || [];
              if (pool.length < NATIVE_DEEP_READ_RETRY_TEMPERATURES.length) {
                pool.push(raw);
                markedVersionsBySegment.set(input.segmentIndex, pool);
              }
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `第${input.attemptNumber}发 ${failureCount} 项不合标准`
                + `（${families.join("/")}）`
                + (coverageSoloRetry
                  ? `（覆盖缺口超 ${NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO * 100}% 单独触发）`
                  : twoItemOverDeviation
                    ? `（2 项且偏差超 ${NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO * 100}%）`
                    : `（≥${NATIVE_DEEP_READ_SEGMENT_RETRY_MIN_FAILURES}）`)
                + `，重试一发：${reasonZh}`,
              );
              throw gateError(reasonZh);
            }
          } catch (gateFailure) {
            /**
             * 覆盖与超长证据段使用类型化异常，永不被单项放行吞掉。
             * 被拒的已付费解析稿也进入标记池，与原始响应一起保留。
             */
            const requiredEvidenceFailure = gateFailure instanceof NativeDeepReadRequiredEvidenceError;
            const alreadyMarked = (raw as Record<string, unknown>).gateMarked === true;
            if (requiredEvidenceFailure && !alreadyMarked) {
              raw.gateMarked = true;
              raw.gateMarkedZh = gateFailure.message.replace(`${NATIVE_DEEP_READ_GATE_PREFIX}：`, "").slice(0, 500);
              raw.attemptNumber = input.attemptNumber;
              const pool = markedVersionsBySegment.get(input.segmentIndex) || [];
              if (pool.length < NATIVE_DEEP_READ_RETRY_TEMPERATURES.length) {
                pool.push(raw);
                markedVersionsBySegment.set(input.segmentIndex, pool);
              }
            }
            // 放行已由共享判据处理；不能在此另设catch规则推翻它的拒收结论。
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
          if (segmentAdvisories.length) {
            raw.advisories = segmentAdvisories;
            await emitVisualModelReceipt({
              callId: crypto.randomUUID(),
              model: NATIVE_DEEP_READ_MODEL,
              route: "local_schema_gate",
              stage: "visual_parse",
              status: "completed",
              batchRequestId: episodeRequestId,
              episodeIndexes: [episode.episodeIndex],
              chunkIndex: input.segmentIndex,
              segmentCount: episode.segments.length,
              videoCount: 1,
              attemptNumber: input.attemptNumber,
              advisoryCodes: segmentAdvisories.map((row) => row.code),
              advisoriesZh: segmentAdvisories.map((row) => row.detailZh).join("；").slice(0, 2_000),
            }, params.onModelReceipt);
          }
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
       * 同一 Vertex 通道最多三次尝试，温度只读取共享常量，间隔固定 60 秒。
       * 下面明确列出的不可重试错误立即停止；三次后也不另发 GLM 修复请求。
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
            // 0829 重试语义收窄：只有真失败（HTTP 错误 / JSON 彻底解析不了）才降温重买。
            // schema 解析失败是「数据不可用」的关闭式失败，重买同样解决不了，直接抛。
            if (error instanceof Error && error.name === NATIVE_DEEP_READ_SCHEMA_ERROR_NAME) {
              logFinalGateFailure(input.segmentIndex, error);
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
          // 与入库口共用判据：独立证据门不豁免，其余按家族与偏差判断。
          if (!nativeDeepReadSegmentMeetsThreeItemLine({
            episodeIndex: episode.episodeIndex,
            segmentIndex,
            startSec: segment.startSec,
            endSec: segment.endSec,
            hasAudio,
            raw: cachedEntry.raw,
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
      // 0829 晚用户拍板：单集有多少片就发多少，十发之内一次发走。
      // 旧写法 Math.min(4, segmentCount) 会把一集 6 片切成 4+2 两波——那是批次串行。
      const segmentModelCap = Math.max(1, Math.floor(
        Number(params.segmentModelConcurrency) || NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
      ));
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
          batch: { episodes, usage, usingPlanQuota: false, model: NATIVE_DEEP_READ_MODEL, batchRequestId },
          diagnostic: {
            mode: "gemini_selected", assemblyComplete: false, glmStatus: "not_run", productAcceptance: "not_run",
            sourceDigest: episode.cacheSourceDigest!, sourceDurationSec: episode.sourceDurationSec,
            totalSegmentCount: segmentCount, selectedSegmentIndexes: [...selectedSegmentIndexes],
            episodeIndex: episode.episodeIndex, batchRequestId: episodeRequestId, model: NATIVE_DEEP_READ_MODEL,
            segments: selectedSegmentIndexes.map((index) => diagnosticSegments.get(index)!),
            usage, rawAttemptEvidenceObjectNames: Array.from(rawAttemptEvidenceObjectNames),
          },
        };
      }
      if (rawSegments.some((raw) => !raw)) {
        throw new Error(`第${episode.episodeIndex}集并发精读结果不完整，已停止`);
      }
      const completeRawSegments = rawSegments as Array<Record<string, unknown>>;

      // 段卡合并成集卡：0829 起**每集一律走 GLM 5.3 结构化整形**（去重 + 结构化），
      // 输入是本集全部分段卡（合规段 + 带 advisory 段 + truncated 段），装配前不丢任何
      // 已付费证据。确定性拼接降为交叉校验用（只取 excludedAdRanges 对账，不入库）。
      // 门禁仍在 GLM 之后跑一遍——GLM 只管结构干净与去重，结论仍由门禁/advisory 层给。
      let glmEvidence: NativeDeepReadGlmEvidence | undefined;
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
              // 全收进 GLM：通过版 + 被门禁标记版一起喂，GLM 按秒位去重合并。
              // 合格 ≠ 更好——同一段两发内容不同，让 GLM 取信息更全的那些镜头。
              rawSegments: [
                ...completeRawSegments,
                ...Array.from(markedVersionsBySegment.keys())
                  .sort((a, b) => a - b)
                  .flatMap((index) => markedVersionsBySegment.get(index) || []),
              ],
              rejectedReasonZh,
            }),
            params.abortSignal,
            { seriesKey: params.segmentCacheSeriesKey, sourceDigest: episode.cacheSourceDigest,
              episodeIndex: episode.episodeIndex, batchRequestId: episodeRequestId, callId },
          );
          glmEvidence = structured.evidence;
          const structuringCostCny = structured.costUsd * OPENROUTER_USD_TO_CNY_EQUIVALENT;
          inputTokens += structured.inputTokens;
          outputTokens += structured.outputTokens;
          costCny += structuringCostCny;
          episodeInput += structured.inputTokens;
          episodeOutput += structured.outputTokens;
          episodeCost += structuringCostCny;
          await emitVisualModelReceipt({
            callId,
            model: structured.model,
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
        // 每集必走 GLM：EvoLink 降级路与 Vertex 主线走同一条装配线，不再按路由分叉。
        // 确定性拼接只算一次，取 excludedAdRanges 给 GLM 产物对账（防 GLM 私吞/改写广告区间）。
        const deterministicAdRanges =
          stripNonStoryAdShotsForEpisodeCard(annotateSegmentRows()).excludedAdRanges;
        let structuredRaw = await glmStructure();
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
          model: NATIVE_DEEP_READ_MODEL,
          temperature: NATIVE_DEEP_READ_GENERATION_CONFIG.temperature,
          thinkingLevel: NATIVE_DEEP_READ_GENERATION_CONFIG.thinkingConfig.thinkingLevel,
          // 输入规格入档（0830 晚）：隔天复盘时能说清这份产物是用什么画质读出来的。
          maxFps: NATIVE_DEEP_READ_MAX_FPS,
          requestedFps: episode.videoFps,
          mediaResolution: NATIVE_DEEP_READ_GENERATION_CONFIG.mediaResolution,
          retryTemperatures: [...NATIVE_DEEP_READ_RETRY_TEMPERATURES],
          segmentCount: episode.segments.length,
          sourceDurationSec: episode.sourceDurationSec,
          batchRequestId: episodeRequestId,
          inputShotCount: preStructuringShotCount,
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
          model: NATIVE_DEEP_READ_MODEL,
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

    return { batch: {
      episodes,
      usage: { inputTokens, outputTokens, costCny },
      usingPlanQuota: false,
      model: NATIVE_DEEP_READ_MODEL,
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
