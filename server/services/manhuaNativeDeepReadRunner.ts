/**
 * 原生视频精读 · 生产执行器。
 *
 * 0826 拍板换代：视觉学习整体从新加坡 Qwen 3.8 Max 换到 **Vertex Gemini 3.1 Pro
 * 从 GCS 直读**，连音轨一次调用产出完整逐镜、角色调度与表演证据（不再有 Gemini 3.6 Flash 双声道取证 +
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
  dedupeNativeDeepReadAdvisories,
  mapNativeDeepReadSegments,
  nativeDeepReadSegmentSchema,
  type NativeDeepReadAdvisory,
  type NativeDeepReadOutput,
} from "../../shared/manhuaNativeDeepRead.js";
import { MANHUA_NATIVE_DEEP_READ_MODEL } from "../../shared/manhuaNativeDeepReadJob.js";
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
          unitTypeZh: {
            type: "STRING",
            enum: ["剪辑镜头", "拆分镜证据段"],
            description: "真实剪辑切换写剪辑镜头；同一长镜内部由可观察变化触发的细分写拆分镜证据段。",
          },
          shotSizeZh: { type: "STRING", maxLength: 32 },
          angleZh: { type: "STRING", maxLength: 32 },
          compositionZh: {
            type: "STRING",
            maxLength: 160,
            description: "画面构图、主体位置、前中后景关系、视线方向与空间层次。",
          },
          cameraMoveZh: {
            type: "STRING",
            maxLength: 220,
            description: "完整运镜轨迹：起点、方向、速度或节奏、幅度与落点。",
          },
          blockingZh: {
            type: "STRING",
            maxLength: 220,
            description: "角色站位、朝向、距离、进退路径、遮挡关系与群像调度变化。",
          },
          bodyActionZh: {
            type: "STRING",
            maxLength: 220,
            description: "角色整体姿态、躯体重心、移动方式、结构形变与动作阶段变化。",
          },
          limbPropActionZh: {
            type: "STRING",
            maxLength: 220,
            description: "角色四肢或等效附肢动作，以及持物方式、道具状态与交互。",
          },
          microExpressionZh: {
            type: "STRING",
            maxLength: 220,
            description: "面部或等效表情器官的可见细微变化，只写画面证据。",
          },
          gazeBreathZh: {
            type: "STRING",
            maxLength: 180,
            description: "视线或感知指向、眨眼、呼吸、能量节奏及其可见变化。",
          },
          relationshipReactionZh: {
            type: "STRING",
            maxLength: 200,
            description: "角色之间的动作因果、反应顺序、感知回应与距离变化。",
          },
          lightingZh: { type: "STRING", maxLength: 220 },
          actionZh: { type: "STRING", maxLength: 280 },
          transitionInZh: { type: "STRING", maxLength: 140 },
          evidenceRole: {
            type: "STRING",
            enum: ["story", "non_story_ad"],
            description: "story=推动剧情因果的镜头；non_story_ad=与剧情无关的商业广告、贴片、带货、商品展示、品牌口播、招商植入及一切商业推广/营销性内容（关注引导、点赞催更、解锁下集、平台导流、二维码等）。non_story_ad 镜头只保存时间轴，其内容严禁写入任何摘要、分类、音轨结论或生成提示字段。",
          },
        },
        required: [
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
        ],
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
            description: "该重点时刻的**精确抓帧秒位**（全片绝对秒），不是镜头区间中点。",
          },
          kindZh: {
            type: "STRING",
            enum: ["切镜", "情绪", "灯光", "剧情", "音轨"],
          },
          noteZh: { type: "STRING", maxLength: 120 },
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
                            enum: MANHUA_NATIVE_AUDIO_CUE_KINDS,
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
 * 0829 拍板：temperature 0.65 首发、maxOutputTokens 65_536、单候选、
 * responseSchema、thinkingBudget 18K（0829 用户令：thinkingConfig 只留数值预算）。
 *
 * thinkingBudget 18_000 的依据（0829 订正 0826 的误推）：知识库《原生视频读取-CDN
 * 串流定案》记载「thinkingBudget 写法也通」；0826 那句「禁止传 thinkingBudget」是
 * 把「不能关思考（budget=0）」误推成全称禁令。18K 只作成本封顶——实测单段思考量
 * 4.2k–39.7k tok，封顶后长尾段不再靠思考吃光 maxOutputTokens 把正文挤成坏 JSON。
 */
/**
 * 🔒 参数冻结（2026-08-29 用户拍板，非用户明确允许不得变更）
 *
 * 冻结项：temperature 0.65 · maxOutputTokens 65_536 · candidateCount 1 ·
 * audioTimestamp true · responseMimeType/responseSchema ·
 * thinkingConfig { thinkingBudget: 18_000, includeThoughts: false } ·
 * 重试梯度 [0.65, 0.6] · PLAN_VERSION。
 *
 * 用户原话：「改好冻结参数，非我允许不可再变，我从没有加上 thinking level 为 high 的指令。」
 * thinkingLevel 系 0826 PR #1314 由 agent 自行加入，0829 已按用户令移除，不得以任何理由加回。
 * 变更流程见知识库《schema动刀纪律》：改一字＝新版本＝旧缓存作废＝需重新探针实测。
 * 冻结由 manhuaNativeDeepReadRunner.test.ts「参数冻结锁」逐字段断言看守。
 */
export const NATIVE_DEEP_READ_GENERATION_CONFIG = {
  // 0829 晚用户拍板：首发温度回到 0.7。v10 定 0.65 时提示词刚软化，没有为软化后的
  // 提示词重新标定过温度；0826 实测 0.65+硬约束=28 镜躺平、0.75+软边界=100/102 镜。
  // 0830 用户拍板：首发 0.7 → 0.65。实弹依据：576p 那轮 10 片有 5 片首发违反
  // 30 秒硬约束（40/40/201/162/130 秒巨镜），而**全部 5 片在 0.65 那一发过关、零二次失败**。
  // 0.7 首发合格率 50%，0.65 是 100%——每次重试都要重付一整片视频输入，这一降直接省掉一半重试。
  temperature: 0.65,
  maxOutputTokens: 65_536,
  candidateCount: 1,
  audioTimestamp: true,
  responseMimeType: "application/json",
  responseSchema: NATIVE_DEEP_READ_RESPONSE_SCHEMA,
  // 0829 用户令：thinkingLevel 移除（0826 由 agent 加入，用户从未设定）；
  // 保留 includeThoughts:false——思考照跑照计费，但绝不混进输出 JSON（知识库定案）。
  thinkingConfig: { thinkingBudget: 18_000, includeThoughts: false },
} as const;

/**
 * 同一 Vertex 分片的固定三档尝试：0.70 首发、0.65 复议、0.60 收口；不得静默换供应商。
 *
 * 0829 晚用户拍板恢复三档（v10 一度收成两档）。语义仍是 0829 上午定的那套：
 * **只有真失败与硬门禁**才走这条梯度——密度、覆盖、音轨厚度类判定已转 advisory，
 * 不再重买（0829 实证：一集 6 段拒收重买 3 段，白烧 ¥20.5）。
 * 硬门禁（17 字段 / 五维五键 / 30 秒上限 / 离谱地板）保留重试：带拒因重试正是让模型
 * 把超长镜拆开的修复机制（0828《花开锦绣》seg1 吃一次门禁、重试即过）。
 * 用户主动中止不是失败，不进入重试。
 */
/**
 * 温度梯度（0830 用户拍板：首发 0.7 → 0.65）。
 * 实弹依据见 GENERATION_CONFIG.temperature 注释：0.7 首发合格率 50%，0.65 是 100%。
 * 下限仍是 0.6，三档变两档——第三档在实测中从未被用到过。
 */
export const NATIVE_DEEP_READ_RETRY_TEMPERATURES = [0.65, 0.6] as const;

/**
 * 段级重试触发线：**不合标准项达到 3 项才重试，1–2 项一律放行**（0830 用户拍板）。
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
 * v4（0826 拍板）：视觉调用换 Vertex Gemini 3.1 Pro 从 GCS 直读、每段一次调用、
 * 音轨同调直出、双密度门禁。计划口径与采样语义全变——旧确认码必须全废。
 */
export const NATIVE_DEEP_READ_VISUAL_PLAN_VERSION = "time-300s-v12-key-moments" as const;

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
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_ALLOWANCE = 1;
/** 同一物理长镜超过 30 秒时，后续证据段必须用此固定标记，避免把证据拆分谎报成真实切镜。 */
export const NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH = "同一长镜证据拆分（非切镜）";
/** 长镜证据拆分点之间至少相隔 1 秒，禁止用同秒空切凑过 30 秒门禁。 */
export const NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC = 1;
/**
 * 🔒 单次合并的总跨度硬上限（0830 用户拍板 59 秒）。
 * 59 = 两段各 30 秒、中间相隔 1 秒的上限形态：跨度超过 30 秒就必须表达成两段。
 * ⚠️ 这条管的是「一次合并能跨多远」，与单条证据 30 秒硬上限是两把不同的尺子，别合并。
 */
export const NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC = 59;
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
/**
 * 🔒 段级覆盖率地板（0830 用户拍板，建议值 0.5 可调）。
 *
 * 与 v10「覆盖缺口转 advisory」的分工：那条管**已读范围内的零星小缺口**（该转 advisory，
 * 免得诚实产出被误杀）；本条管**整片压根没读**。两者是不同的病。
 * 0830 实弹把两类分得很开——坏片覆盖率 1%–17%，好片 100%，线画在中间不会误伤。
 * 广告镜同样计入覆盖（用户明示：广告不是空洞，它留给之后的定义处理）。
 */
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
 * 🔒 单条证据段上限 **40 秒**（0830 用户拍板，取代此前的 30）。
 * 配合 10% 容差 ⇒ 实际拒收线 44 秒。用户原话：「上限四十秒，容错率 10%」。
 * 提示词仍写 30 秒作为**目标**（要模型往细里切），门禁按 44 拦——
 * 目标与拦截线分开，是为了「要求可以严，重买必须省」：
 * 每重试一片要重付一整片视频输入，为 41 秒去重买不划算。
 */
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_SOFT_MAX_SEC = 40;
/**
 * 🔒 单条证据段**实际拒收线 45 秒**（0830 用户拍板：「41 秒可以接受，不需要重试」）。
 *
 * 提示词仍写 30 秒（目标不放宽），门禁按 45 拦——容差只放在拦截侧。
 * 45 这条线是用当晚两轮实弹分出来的：
 *   temp 0.65：唯一违规 41 秒 —— 真长镜，用户判定可接受
 *   temp 0.70：违规 40 / 40 / 60 / 130 / 162 / 201 秒 —— 60 秒以上明显是没读完
 * 45 卡在「真长镜」与「偷懒」之间：放过 40–41，仍拦住 60+。
 * 每重试一片要重付一整片视频输入，为 41 秒去重买不划算。
 */
export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC =
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_SOFT_MAX_SEC * (1 + NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO);
/** 覆盖率实际拒收线 = 0.5 × 0.9 = 0.45（同上）。 */
/**
 * 整集镜头留存率**实际拒收线** = 0.5 × 0.9 = 0.45（0830 用户令「容错率改为上下百分之十」：
 * 每条数值门禁按方向各让 10%——上限 +10%，下限 −10%）。此前这条漏了容差。
 */
export const NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_REJECT =
  NATIVE_DEEP_READ_EPISODE_SHOT_KEEP_RATE_FLOOR * (1 - NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO);
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
  const base = `你是漫剧成片的「导演手法」分析师。当前视频是全片（共 ${Math.round(input.episodeDurationSec)} 秒）的第 ${Math.round(input.startSec)}–${Math.round(input.endSec)} 秒（第 ${input.segmentIndex + 1}/${input.segmentCount} 段）${hint ? `（${hint}）` : ""}。

**重点是拍法，不是剧情。** 只返回一个 JSON，不要 Markdown 围栏：
{
 "shots":[{"startSec":整数,"endSec":整数,
   "unitTypeZh":"剪辑镜头 或 拆分镜证据段",
   "shotSizeZh":"景别：极特写/特写/近景/中景/全景/大远景",
   "angleZh":"机位：平视/仰拍/俯拍/过肩/主观",
   "compositionZh":"构图、主体位置、前中后景、视线方向与空间层次",
   "cameraMoveZh":"完整运镜轨迹：起点、方向、速度或节奏、幅度、落点；无运动写固定机位及构图作用",
   "blockingZh":"角色站位、朝向、距离、进退路径、遮挡关系与群像调度变化",
   "bodyActionZh":"角色整体姿态、躯体重心、移动方式、结构形变与动作阶段变化",
   "limbPropActionZh":"角色四肢或等效附肢动作，以及持物方式、道具状态与交互",
   "microExpressionZh":"面部或等效表情器官的可见细微变化，只写画面证据",
   "gazeBreathZh":"视线或感知指向、眨眼、呼吸、能量节奏及其可见变化",
   "relationshipReactionZh":"角色之间的动作因果、反应顺序、感知回应与距离变化",
   "lightingZh":"主辅光位、色调、明暗关系、轮廓光、环境光与氛围变化",
   "actionZh":"本镜可见的故事动作过程、信息变化、表演结果与辨识特征",
   "transitionInZh":"进入这一镜的转场：硬切/闪白/黑场/遮挡转场/叠化；同一物理长镜的后续证据段写固定标记「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」",
   "evidenceRole":"story 或 non_story_ad；只有与剧情无关的招商广告才写 non_story_ad"}],
 "keyMoments":[{"atSec":整数,"kindZh":"切镜 或 情绪 或 灯光 或 剧情 或 音轨","noteZh":"这一秒发生了什么，一句话"}],
 "subtitles":[{"atSec":整数,"textZh":"画面上真实出现的字幕原文，逐字照抄"}],
 "audioResolution":[{"chunkIndex":${input.segmentIndex},"analysis":{"audioTrack":[{"fromSec":局部整数秒,"toSec":局部整数秒,"emotionArcZh":"情绪强度变化","toneZh":"怎么说，不写台词","sfxZh":"音效","bgmZh":"配乐","atmosphereZh":"气氛","silenceZh":"留白","cues":[{"atSec":局部整数秒,"kind":"source_change/voice_change/sfx/bgm_in/bgm_change/bgm_out/atmosphere_change/dynamics_change/mix_change/silence_in/silence_out","detailZh":"事件"}]}],"audioBeatStructureZh":"声音节奏","mixNotesZh":"混音","reusableAudioZh":"可复用声音手法","genAudioHintZh":"生成声音要素"}}],
 "beatStructureZh":"节奏结构：憋了几秒、第几秒爆、爆后怎么收",
 "moodArcZh":"情绪推进：起点→转折秒位→终点",
 "classification":{"emotionTagsZh":["从真证据提取的情绪标签"],"narrativeFeatureTagsZh":["叙事特色"],"performanceTagsZh":["表演特色"],"audiovisualTagsZh":["视听特色"],"audienceExperienceTagsZh":["观众体验"]},
 "reusableZh":"可复用手法（脱离本剧剧情，写成通用做法）",
 "genPromptHintZh":"若用 AI 生成类似片段，画面提示词该写哪几个要素"
}
硬约束（必须遵守）：
1. shots 与 subtitles 的 startSec/endSec/atSec **一律写全片绝对秒位**：本段即 ${Math.round(input.startSec)}..${Math.round(input.endSec)} 秒；shots 连续无空档覆盖整段。真实剪辑切换的 unitTypeZh 写「剪辑镜头」；若同一物理长镜持续超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，不得截断、丢弃尾部或伪造切镜，必须按镜内真实发生的构图、运镜、角色调度、动作、表演或光影变化拆成至少 2 个连续证据段，每个证据段至少 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒，unitTypeZh 写「拆分镜证据段」，第二段及后续段的 transitionInZh 固定写「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。
2. cameraMoveZh 只写真看到的运动，看不出运动就写「固定机位」，禁止套「镜头拉远」这类无依据说法。
3. 所有中文描述字段【禁止】出现钟表式时间（如 01:23、1:05:30）或「在第X秒」式秒位定位——秒位只进数字字段；描述动作时长（如「1.2秒内推近」）不在此限。
3.5 **keyMoments 是抓帧秒位表，由你来点**（v12 新增）。下游会**按你给的 atSec 去原片抓那一帧**，所以 atSec 必须是**那一瞬间最有代表性的那一秒**，不是镜头区间的中点，也不要落在转场、运动模糊或空镜上。五类各自的判据：
   · **切镜**——景别或机位发生突变的那一帧（如中景→特写落定的瞬间）
   · **情绪**——微表情的**峰值时刻**（眉头锁紧、眼神变化最明显的那一秒），不是这一镜的中点
   · **灯光**——氛围切换的**前后各一条**（如暖光转面部阴影加深，切换前一秒与切换后一秒）
   · **剧情**——推动因果的关键节点（台词点破冲突、关键道具亮相）
   · **音轨**——声音事件发生秒（BGM 转折、关键音效、分段切换）
   密度**跟着戏走**：重镜可多条，平淡镜（固定机位＋无表演＋无光变）可以一条都不给；
   evidenceRole=non_story_ad 的区间**一条都不许给**。宁可少给也不要为凑数硬点。
   🔴 **本段没有值得抓的秒位时（包括整段都是 non_story_ad），就输出空数组 keyMoments:[]**——
   这个字段是必填的，但**填空数组才是诚实答案**，绝不许为了让字段有内容而硬点，
   更不许拿广告里的切镜/打光/台词充数。
4. 无论画面是真人剧还是动画：出现明确与剧情无关的招商广告、贴片、带货、商品展示、购物引导、品牌口播、品牌落版，或任何商业推广/营销性内容（关注引导、点赞催更、解锁下集提示、平台导流、二维码推广等），仍用 shots 保持完整时间轴，但对应镜头 evidenceRole 必须写 non_story_ad；这类镜头不计学习密度，其画面与声音内容不得进入 subtitles、beatStructureZh、moodArcZh、classification、reusableZh、genPromptHintZh，也不得写入 audioResolution 各段的描述与 cues 结论。其余镜头一律写 story。
5. 分析描述不写外部平台剧名、商标或原台词；subtitles 是唯一例外——逐字照抄画面上真实出现的剧情字幕，看不清写「[不可辨]」，禁止按剧情补全或从声音猜字；广告字幕不要进入 subtitles。
${audioHardRule}
诚实优先（高于以下所有建议）：**你的产出会被完整保留并交由结构化层整理，不达密度不会被拒收——请如实记录：**编造不存在的镜头或声音是错误，漏记真实发生的切镜同样是错误**；宁可多记真实发生的，不可少记——每次机位/景别/场景变化都必须是新的一镜。**
建议（软边界，按素材实际情况尽量做到）：
a. 这类短剧（漫剧与真人剧同理）真实节奏通常 2–5 秒一镜——**这是整段平均节奏，不是单镜上限**；真实长镜头照实记录其完整时长，不要为凑平均把它切碎。按真实切换逐镜记录，**宁可少记也不要合并或编造**。一个剧情段落通常由多个镜头切换组成——**不要把「剧情段」当成一个镜头**，每次画面切换（机位/景别/场景变化）都是新的一镜。单个证据段不超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，真实长镜超过该长度时按硬约束 1 拆分证据，不得裁掉内容。
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
  } | undefined> = new Array(segments.length);
  try {
    // 分片只按时间切；每片独立上传 GCS、独立调用 Gemini。
    // 禁止把整集各片体积相加后预转码：那是旧的多片合包请求逻辑。
    // 单集最多四段并行；每个 worker 内仍保留三次 CDN 节点刷新，跨集不并行。
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
        hasAudio: episodeHasAudio,
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

function assertRawShotFieldPresence(raw: Record<string, unknown>, labelZh: string): void {
  const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
  for (let index = 0; index < rawShots.length; index += 1) {
    const shot = rawShots[index];
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) continue;
    const row = shot as Record<string, unknown>;
    const missingFields = NATIVE_DEEP_READ_REQUIRED_SHOT_FIELDS.filter(
      (field) => !Object.prototype.hasOwnProperty.call(row, field),
    );
    if (missingFields.length > 0) {
      throw gateError(`${labelZh}第${index + 1}镜字段不完整：缺 ${missingFields.join("、")}`);
    }
    const unitTypeZh = row.unitTypeZh;
    if (unitTypeZh !== "剪辑镜头" && unitTypeZh !== "拆分镜证据段") {
      throw gateError(`${labelZh}第${index + 1}镜 unitTypeZh 缺失或无效`);
    }
    const role = row.evidenceRole;
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

/**
 * 长镜证据的段级观察（0829 起只出 advisory，不影响入库）。
 *
 * **>15 秒长镜的数量限额已彻底删除**：真实长定场不该被数量门禁重买；长度信息
 * 只作提示。>30 秒证据段与拆分不连续同样降级成 advisory。
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
    throw gateError(
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
function assertGlmAdRangesMatchDeterministic(
  structuredRaw: Record<string, unknown>,
  expected: NativeDeepReadExcludedAdRange[],
  episodeIndex: number,
): void {
  const reported = Array.isArray((structuredRaw as { excludedAdRanges?: unknown }).excludedAdRanges)
    ? (structuredRaw as { excludedAdRanges: Array<{ startSec: number; endSec: number }> }).excludedAdRanges
    : [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
  const matches = reported.length === expected.length
    && expected.every((range) => reported.some((row) =>
      near(Number(row.startSec), range.startSec) && near(Number(row.endSec), range.endSec)))
    && reported.every((row) => expected.some((range) =>
      near(Number(row.startSec), range.startSec) && near(Number(row.endSec), range.endSec)));
  if (!matches) {
    throw new Error(
      `第${episodeIndex}集 GLM 整形卡的 excludedAdRanges 与确定性剥离区间不一致`
      + `（自报 ${reported.length} 段 / 应为 ${expected.length} 段），整集拒绝入库`,
    );
  }
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
  if (!shots.length) {
    out.push({
      code: "coverage_missing",
      detailZh: `${labelZh}没有任何可用镜头行，缺 ${round(startSec)}–${round(endSec)} 秒`,
      segmentIndex,
    });
    return out;
  }
  if (Math.abs(shots[0]!.startSec - startSec) > tolerance) {
    out.push({
      code: "coverage_head_gap",
      detailZh: `${labelZh}镜头未从 ${round(startSec)} 秒开始，缺 ${round(startSec)}–${round(shots[0]!.startSec)} 秒`,
      segmentIndex,
    });
  }
  const gaps: string[] = [];
  const overlaps: string[] = [];
  let cursor = shots[0]!.startSec;
  for (const shot of shots) {
    if (shot.startSec > cursor + tolerance) gaps.push(`${round(cursor)}–${round(shot.startSec)}`);
    if (shot.startSec < cursor - tolerance) overlaps.push(`${round(shot.startSec)}–${round(cursor)}`);
    cursor = Math.max(cursor, shot.endSec);
  }
  if (gaps.length) {
    out.push({
      code: "timeline_gap",
      detailZh: `${labelZh}镜头时间轴存在 ${gaps.length} 处空档：${gaps.join("、")} 秒`,
      segmentIndex,
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
 * 段级改进建议（0829 用户拍板：门禁贴标记，不拒收重买）。
 *
 * 硬失败只剩两条：JSON 解析不了（在调用方 parseJsonObject）、zod schema 解析失败——
 * 这两种情况数据本身不可用。其余密度、覆盖、字段、分类、音轨地板判定一律收集成
 * advisory 随卡返回，由 GLM 收口层与人工面板消费，绝不再触发重买。
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
  const note = (code: string, detailZh: string) =>
    advisories.push({ code, detailZh, segmentIndex });

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

  // 唯一保留的硬失败之一：zod schema 解析失败＝数据不可用，留不得。
  const parsed = nativeDeepReadSegmentSchema.safeParse(input.raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const issueZh = firstIssue
      ? `（${firstIssue.path.join(".") || "根"}: ${firstIssue.message}）`
      : "";
    throw schemaGateError(`${labelZh}结构不合原生逐镜 schema${issueZh}`);
  }

  advisories.push(...advisoryFromThrow("clock_text", segmentIndex, () =>
    assertVisualTextNoClock(input.raw, labelZh)));
  const shots = sortedShots(input.raw);
  advisories.push(...collectShotCoverageAdvisories(
    shots,
    Math.round(input.startSec),
    Math.round(input.endSec),
    segmentIndex,
    labelZh,
  ));
  const storyShots = shots.filter((shot) => shot.evidenceRole === "story");
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
  /* ── 🔒 段级覆盖闸（0830 用户拍板，纯算术）──
   * 「这一片真实长度 300 秒，模型回的镜头必须覆盖到 300 秒；回 3 秒 = 拒收重试。」
   *
   * 🔴 **广告区间照算进覆盖**（用户明示「不要加上广告区间」＝不要把广告从要求里扣掉）：
   * 广告不是空洞，它也是记录在时间轴上的镜头（evidenceRole=non_story_ad）。
   * 所以这里数的是**全部镜头**的覆盖，不是只数 story。
   *
   * 与密度闸的分工：密度管「切得够不够细」，覆盖管「有没有读完」。
   * 0830 实弹死的是后者——6 片只回 3–52 秒，而段级从来没有覆盖闸，
   * 一路带到整集才被拦，钱已花完。
   */
  {
    // 段级这里全部镜头的变量名是 shots（广告镜留在时间轴上，之后由整形层定义处理）
    const allSpans = shots
      .map((shot) => ({ startSec: Number(shot.startSec), endSec: Number(shot.endSec) }))
      .filter((x) => Number.isFinite(x.startSec) && Number.isFinite(x.endSec) && x.endSec > x.startSec)
      .sort((a, b) => a.startSec - b.startSec);
    let coveredSec = 0;
    let cursor = Number.NEGATIVE_INFINITY;
    for (const span of allSpans) {
      const from = Math.max(span.startSec, cursor);
      if (span.endSec > from) { coveredSec += span.endSec - from; cursor = span.endSec; }
    }
    // 10% 容差（0830 用户令）：0.5 → 实际拒收线 0.45
    const requiredSec = lenSec * NATIVE_DEEP_READ_SEGMENT_COVERAGE_REJECT_RATIO;
    if (coveredSec < requiredSec) {
      throw gateError(
        `${labelZh}镜头只覆盖了 ${coveredSec.toFixed(1)} 秒 / 本片真实长度 ${Math.round(lenSec)} 秒`
        + `（覆盖率 ${((coveredSec / Math.max(1, lenSec)) * 100).toFixed(1)}%，`
        + `低于地板 ${(NATIVE_DEEP_READ_SEGMENT_COVERAGE_FLOOR_RATIO * 100).toFixed(0)}%）：`
        + "整片没读完，广告镜同样计入覆盖",
      );
    }
  }

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
    advisories.push(...collectLongTakeAdvisories({
      shots: storyShots,
      labelZh,
      segmentIndex,
    }));
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
    );
  }
  const cueCount = analysis.audioTrack.reduce((sum, track) => sum + track.cues.length, 0);
  if (cueCount < audioFloors.minAudioCues) {
    note(
      "audio_cue_thin",
      `${labelZh}声音事件仅 ${cueCount} 条，低于建议地板 ${audioFloors.minAudioCues}`,
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
 * 确定性拼接不再作为快速路，只保留一份用于交叉校验 GLM 的 excludedAdRanges，不入库。
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
export const NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT = "medium" as const;
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
    system: `你是漫剧模板卡的「结构化整形师」。只整形不创作：
1. 禁止虚构输入卡里没有的镜头、字幕、声音或描述；每一条产出都必须能在输入卡里找到出处。
2. shots 已逐段通过付费前门禁。每镜的 unitTypeZh/shotSizeZh/angleZh/compositionZh/cameraMoveZh/blockingZh/bodyActionZh/limbPropActionZh/microExpressionZh/gazeBreathZh/relationshipReactionZh/lightingZh/actionZh/transitionInZh 都是不可丢失的原始证据。🔴 **镜头切分是模型逐秒看片得出的真实结果，不是可压缩的冗余**：相邻但秒位**不重叠**的两条镜头，哪怕表演连续、剧情连续、同一场景同一机位，**也一律各自保留，绝不许合并成一条**。唯一允许合并的是**同一物理镜头的重复记录**（秒位区间重叠，通常来自段边界重复或同段多版本）。🔒 **长度规则（0830 用户拍板）**：任何一次合并的总跨度**不得超过 ${NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC} 秒**；跨度超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒的，**必须切成两段、每段都不超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒，两段每段各自不短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒**。不得丢失时间轴覆盖。仍需拆分的同一物理长镜，其 unitTypeZh 必须保持「拆分镜证据段」，transitionInZh 必须保留「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」。
3. 整集卡必须**整行剔除**全部 evidenceRole=non_story_ad 的镜头，其 {startSec,endSec} 区间合并相邻后写入顶层可选字段 excludedAdRanges:[{startSec,endSec}]；不得把广告内容并入任何 story 镜头，广告的画面与声音也不得进入剧情字幕、节奏、情绪、分类、可复用手法或生成提示。输入没有 non_story_ad 镜头时不要输出 excludedAdRanges 字段。保留下来的每个 shot 必须原样保留 evidenceRole，剔除后其余镜头一律保持 story。完整原始时间轴由分段卡审计层保存，无需在整集卡复述广告镜头。
4. subtitles 只取 story 区间的并集去重，保持全片绝对秒位排序。
5. audioResolution 保留完整原始听觉证据；广告区间内声音只作审计证据，不得写入 audioBeatStructureZh/mixNotesZh/reusableAudioZh/genAudioHintZh 的可复用结论。
6. 所有中文描述文本【禁止】出现钟表式秒位（如 01:23）或「在第X秒」定位——秒位只进数字字段。
7. classification 必须显式输出 emotionTagsZh/narrativeFeatureTagsZh/performanceTagsZh/audiovisualTagsZh/audienceExperienceTagsZh 五个数组；**有证据就写，没有证据的维度写 []**；🔴 不得为了凑数量而编造标签（数量下限只会逼出假标签）。
8. 输入分段卡可能带这些**审计标记**：truncated: true（该段响应被截断，尾部可能缺失）、advisories（门禁提示）、gateMarked: true 与 gateMarkedZh（该版本被门禁标记）、attemptNumber（第几发）。**这些标记一律不是废弃理由**：标记版与通过版都是同一段的真实产出，已有内容照常采纳，不得因为带标记就丢弃或降权任何证据，也不得替截断段补写缺失的尾部；所有标记字段本身不要写进整集卡。
9. **同一段可能出现多个版本**（通过版与被门禁标记版都会喂给你）。模型每次产出不同，**通过不等于更好**。合并时请分清两件不同的事——**记录去重，信息取并集**：
   ·「去重」删的是**重复的记录**（同一个物理镜头被记了两遍），不是删信息；
   ·「不丢弃」保的是**每一版独有的观察**，这些观察要并进保留下来的那条记录里。
   两者不冲突：**同一个物理镜头只保留一条记录，但那条记录必须吸收所有版本对它的观察。**
   裁决顺序（保证同一份输入两次跑结果一致）：
   a. 以**未被标记、未截断**的那一版作骨架；没有这样的版本时，取 attemptNumber 最大的一版作骨架。
   b. 两版对同一时间范围的切分粗细不同时，**一律以切分更细的那一版为准**，粗的那版的信息分配进对应的细区间。
   c. 逐条比对：秒位区间重叠的记录合并成一条，字段逐个取**信息更具体的那一版的原文**；秒位不重叠的记录全部保留。
   d. **不改写、不扩写**；可以润色文句，也不必强求统一文风，但**必须忠于原文内容**——你的职责是在原文内容范围内取舍与归并，不是重写，更不许新增原文没有的信息。
10. **判定合并对不对只有一条尺子**：输出的 shots 在时间轴上必须是**一组互不重叠、首尾相接**的区间，连续覆盖除 excludedAdRanges 外的全时间轴。任何一秒只能被一条 story 记录覆盖——**出现两条区间重叠即为错误产出**。段边界处重复的同一镜头/字幕/声音事件按此合并（同秒同文的字幕只留一条，同秒同 kind 的 cue 只留一条）；单条合并后超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒时，必须按镜内真实变化拆成连续证据段（每段各自不短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒），🔴 **绝不许用丢弃证据的方式满足这条**。
11. **keyMoments 原样保留并按 atSec 合并去重**（v12）：这是模型看片时自报的抓帧秒位表，下游据此去原片抓帧。同秒同类只留一条，取说明更具体的；不同秒、不同类一律全保留；🔴 **不许自己新增 atSec，也不许因为"太多"而删减**——你没看过画面，点不出新的秒位。落在 excludedAdRanges 区间内的条目整条剔除。
12. 只返回一个 JSON 对象，不要 Markdown 围栏、不要解释。`,
    user: `把以下同一集的 ${input.rawSegments.length} 份分段卡整形合并成**一张整集原生证据卡**（单个 JSON 对象，字段 schema 与分段卡完全相同：shots/subtitles/audioResolution/beatStructureZh/moodArcZh/classification/reusableZh/genPromptHintZh，另加顶层可选 excludedAdRanges）。
要求：
1. story 镜头连续无空档覆盖除 excludedAdRanges 外的全时间轴 0..${Math.round(input.durationSec)} 秒（绝对秒位），每镜保留 evidenceRole；🔴 **只有秒位重叠的重复记录可以合并；相邻不重叠的镜头一律各自保留**——整集输出的镜头条数应与输入去重后的真实切分相当，**镜头数大幅变少、平均镜长明显拉长即为错误产出**。non_story_ad 必须整行剔除并把 {startSec,endSec} 区间记入顶层 excludedAdRanges，不得混入 story。🔒 一次合并的总跨度不得超过 ${NATIVE_DEEP_READ_MERGE_SPAN_HARD_MAX_SEC} 秒；超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒必须切成两段、每段不超过 ${NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC} 秒、每段各自不短于 ${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MIN_SEC} 秒，且不得删除仍需保留的「${NATIVE_DEEP_READ_LONG_TAKE_EVIDENCE_SPLIT_MARKER_ZH}」续接标记或丢失覆盖。
2. audioResolution 保留全部 [{chunkIndex,analysis}] 条目（chunkIndex 即段号，analysis 内为该段局部秒），逐段齐全${input.hasAudio ? "" : "；本集素材无音轨，audioResolution 保持空数组"}。
3. beatStructureZh/moodArcZh/reusableZh/genPromptHintZh 只整合 story 证据，可加「第X段」标注；classification 五维标签只取 story 输入并集，不得补猜。
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
    system: `你是漫剧模板卡的「JSON 语法修复师」。只修语法不创作：
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
    gatewayPolicy: "glm_only",
    timeoutMs: GLM_STRUCTURING_TIMEOUT_MS,
    // 🔒 整形链参数（0829 晚用户拍板，改任一项＝改成本与产出口径，改前先报）
    temperature: NATIVE_DEEP_READ_GLM_STRUCTURING_TEMPERATURE,
    reasoningEffort: NATIVE_DEEP_READ_GLM_STRUCTURING_REASONING_EFFORT,
    requireParameters: true,
    requireFinishReasonStop: true,
    validateContent: (content) => {
      raw = parseJsonObject(content);
    },
  });
  // 通道锁：只接受仍然是 GLM-5.3 的两档（EvoLink / OpenRouter）。
  // 判据复用 bailianChat 的单一真源集合，不在这里再写一遍网关名。
  if (!GLM_MODEL_GATEWAYS.has(response.gateway) || !raw) {
    throw new Error("GLM 结构化整形通道锁失效或未返回 JSON");
  }
  return {
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
          let gated: ReturnType<typeof assertNativeDeepReadSegmentDensity>;
          try {
            gated = assertNativeDeepReadSegmentDensity({
              episodeIndex: episode.episodeIndex,
              segmentIndex: input.segmentIndex,
              startSec: segment.startSec,
              endSec: segment.endSec,
              hasAudio,
              raw,
              truncated,
            });
            /**
             * 三项线（0830）：不合标准项 <3 就是放行，不重试、不标记。
             * 硬门抛出的那条在下面 catch 里按 1 项计——它抛在第一项就停，
             * 后面还有多少项无从得知，只能保守记 1，因此硬门单独命中必放行。
             */
            if (gated.advisories.length >= NATIVE_DEEP_READ_SEGMENT_RETRY_MIN_FAILURES) {
              const reasonZh = gated.advisories.map((row) => row.detailZh).join("；").slice(0, 500);
              raw.gateMarked = true;
              raw.gateMarkedZh = reasonZh;
              raw.attemptNumber = input.attemptNumber;
              if (truncated) raw.truncated = true;
              const pool = markedVersionsBySegment.get(input.segmentIndex) || [];
              if (pool.length < NATIVE_DEEP_READ_RETRY_TEMPERATURES.length) {
                pool.push(raw);
                markedVersionsBySegment.set(input.segmentIndex, pool);
              }
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `第${input.attemptNumber}发 ${gated.advisories.length} 项不合标准（≥`
                + `${NATIVE_DEEP_READ_SEGMENT_RETRY_MIN_FAILURES}），重试一发：${reasonZh}`,
              );
              throw gateError(reasonZh);
            }
          } catch (gateFailure) {
            /**
             * 硬门单独命中 = 1 项不合标准 → 按用户规则**放行**，原样入库。
             * 只有上面那条主动抛的「≥3 项」才继续往下走重试路径。
             */
            if (isNativeDeepReadGateFailure(gateFailure)
              && !String((raw as Record<string, unknown>).gateMarked)) {
              const markedZh = (gateFailure instanceof Error ? gateFailure.message : String(gateFailure))
                .replace(`${NATIVE_DEEP_READ_GATE_PREFIX}：`, "")
                .slice(0, 500);
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `仅 1 项不合标准，按三项线放行入库：${markedZh}`,
              );
              raw.gateMarkedZh = markedZh;
              gated = { raw, advisories: [] };
            } else {
            // 门禁是贴标签的：命中硬门仍然重试（给模型改的机会），但这一发**不丢**。
            // 打上标记留进版本池，稍后连同通过版一起交 GLM 去重合并。
            if (isNativeDeepReadGateFailure(gateFailure)) {
              const markedZh = (gateFailure instanceof Error ? gateFailure.message : String(gateFailure))
                .replace(`${NATIVE_DEEP_READ_GATE_PREFIX}：`, "")
                .slice(0, 500);
              raw.gateMarked = true;
              raw.gateMarkedZh = markedZh;
              raw.attemptNumber = input.attemptNumber;
              if (truncated) raw.truncated = true;
              const pool = markedVersionsBySegment.get(input.segmentIndex) || [];
              // 每段最多留 3 个标记版本（＝温度梯度上限），防异常路径撑爆 GLM 输入。
              if (pool.length < NATIVE_DEEP_READ_RETRY_TEMPERATURES.length) {
                pool.push(raw);
                markedVersionsBySegment.set(input.segmentIndex, pool);
              }
              console.info(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${input.segmentIndex + 1}段`
                + `第${input.attemptNumber}发被门禁标记，已留版本交 GLM：${markedZh}`,
              );
            }
            throw gateFailure;
            }
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
          try {
            assertNativeDeepReadSegmentDensity({
              episodeIndex: episode.episodeIndex,
              segmentIndex,
              startSec: segment.startSec,
              endSec: segment.endSec,
              hasAudio,
              raw: cachedEntry.raw,
              truncated: cachedEntry.raw?.truncated === true,
            });
          } catch (staleGateFailure) {
            if (isNativeDeepReadGateFailure(staleGateFailure)) {
              console.warn(
                `[nativeDeepRead] 第${episode.episodeIndex}集第${segmentIndex + 1}段缓存未过当前门禁，`
                + `按未命中重读：${staleGateFailure instanceof Error ? staleGateFailure.message : ""}`,
              );
              cachedEntry = undefined;
            } else {
              throw staleGateFailure;
            }
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
        const fps = resolveNativeDeepReadRequestFps(video.endSec - video.startSec);
        const result = await attemptWithSegmentRetry({
          route: NATIVE_DEEP_READ_ROUTE_VERTEX,
          fileUri: video.gsUri,
          segmentIndex,
          fps,
        });
        if (result.advisories.length) advisoriesBySegment.set(segmentIndex, result.advisories);
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
          // 装提案/rawSegments 一律用返回的 canonical entry，杜绝缓存 A / 提案 B。
          const written = await deps.writeSegmentCache(entry);
          rawSegments[segmentIndex] = written.entry.raw;
          await commitSegmentToProposal(segmentIndex, written.entry);
          return;
        }
        rawSegments[segmentIndex] = result.raw;
      };

      const segmentFailures: Array<{ segmentIndex: number; error: unknown }> = [];
      let nextSegmentIndex = 0;
      // 0829 晚用户拍板：单集有多少片就发多少，十发之内一次发走。
      // 旧写法 Math.min(4, segmentCount) 会把一集 6 片切成 4+2 两波——那是批次串行。
      const segmentModelCap = Math.max(1, Math.floor(
        Number(params.segmentModelConcurrency) || NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
      ));
      const segmentConcurrency = Math.min(segmentModelCap, segmentCount);
      console.info(
        `[nativeDeepRead] 第${episode.episodeIndex}集模型扇出并发 ${segmentConcurrency}/${segmentCount} 片`,
      );
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

      // 段卡合并成集卡：0829 起**每集一律走 GLM 5.3 结构化整形**（去重 + 结构化），
      // 输入是本集全部分段卡（合规段 + 带 advisory 段 + truncated 段），装配前不丢任何
      // 已付费证据。确定性拼接降为交叉校验用（只取 excludedAdRanges 对账，不入库）。
      // 门禁仍在 GLM 之后跑一遍——GLM 只管结构干净与去重，结论仍由门禁/advisory 层给。
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
        assertGlmAdRangesMatchDeterministic(structuredRaw, deterministicAdRanges, episode.episodeIndex);
        /**
         * 🔴 GLM 之后**不再设集级门禁、不再重整、也不再转 advisory**（0830 用户拍板）。
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
