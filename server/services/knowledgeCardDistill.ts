/**
 * 图文知识卡片：上传/长文 → 读文/读图 OCR + 提炼 → Markdown。
 * 四档并列：Claude Opus 5（超凡）/ Evolink GPT-5.6 Sol / OpenRouter Kimi K3 / Evolink Qwen3.8 Max。
 * 长书超过阈值时后台分段提炼再合并（避免上游 524）；产品面仍是一次上传写框。
 * 提炼/OCR 成本含在页费中，本模块不单独扣积分。
 *
 * @see https://evolink.ai/gpt-5-6
 * @see https://evolink.ai/docs/cn/api-manual/language-series/qwen3.8-max/qwen3.8-max-chat
 */
import { extractFirstChoicePlainText, invokeLLM, type MessageContent } from "../_core/llm.js";
import { shouldSkipKnowledgeCardDistill } from "../../shared/knowledgeCardPagination.js";
import { suggestKnowledgeCardMinSections } from "../../shared/knowledgeCardDistillSections.js";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE,
  KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
  isKnowledgeCardDistillEvolinkModel,
  resolveKnowledgeCardDistillModel,
  type KnowledgeCardDistillModelId,
} from "../../shared/knowledgeCardDistillModels.js";
import {
  getEvolinkApiKey,
  getOpenRouterChatHeaders,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from "./gpt56CopywritingGateway.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import { extractDocumentText } from "../growth/documentExtract.js";

export const KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE = "算力紧张，请稍后再试";
/** Evolink/OR 网关 524 或本端 Abort：长书一气呵成常见 */
export const KNOWLEDGE_CARD_DISTILL_TIMEOUT_MESSAGE =
  "文档较长，提炼超时，请稍后重试；超长书会自动分段提炼后再合并";

/** @deprecated 用 resolveKnowledgeCardDistillModel */
export const KNOWLEDGE_CARD_DISTILL_MODEL = resolveKnowledgeCardDistillModel(
  process.env.KNOWLEDGE_CARD_DISTILL_MODEL || KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
);

const DISTILL_MAX_TOKENS = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_MAX_TOKENS) || 32_768, 4096),
  65_536,
);

/**
 * 三档分别调参（2026-08-05 实测 FDE PDF 前 25k 字 / 3 段）：
 *
 * | 档 | 25k×3 段耗时 | 输出 | 结论 |
 * |---|---|---|---|
 * | Kimi K3 | 43s | 7443 字 / 39 节 | 最快；段可放大、并发可高 |
 * | Sol | 194s | 10129 字 / 64 节 | 最详细但慢；分段降中档 |
 * | Qwen | 287s | 3904 字 / 33 节 | 最慢且压缩过度；段切小、抬最少小节 |
 *
 * `effortChunk` 只用于分段抽要点，`effortFinal` 用于短文直出与合并稿统稿。
 * Kimi 官方档位只有 low|high|max（无 xhigh / medium）；
 * Qwen 只有 low|medium|xhigh（无 max），且勿与 `thinking_budget` 同传；
 * Sol 顶档为 xhigh。
 *
 * @see https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
 * @see https://evolink.ai/qwen-3-8-max
 * @see https://docs.qwencloud.com/developer-guides/text-generation/thinking
 */
type KnowledgeCardDistillProfile = {
  /** 源文超过此长度才切段 */
  chunkThreshold: number;
  /** 每段字数 */
  chunkChars: number;
  /** 同时在跑的段数 */
  concurrency: number;
  effortChunk: string;
  effortFinal: string;
  /** 单次上游请求墙钟 */
  requestTimeoutMs: number;
  /** 单段失败重试次数（退避）；仍失败再对半细切 */
  chunkRetries: number;
  /** 每段 `##` 小节数下限；实际值由总目标节数分摊，此项只兜底防某模型压成一节 */
  minSectionsPerChunk: number;
  /** 单次统稿的输入字数上限；超出则先按 `##` 分组压一层（0 = 不分组）。统稿本身绝不跳过 */
  refineMaxChars: number;
  /**
   * 每个 `##` 小节要写多少条要点。
   *
   * 三档拿的是同一个目标节数，丰度差别全在节内：实测同一份 25k 源文，
   * Kimi 每节约 191 字、Sol 约 158 字，而 Qwen 只有约 118 字（3904 字 / 33 节），
   * 同样的「5–9 条」它总往下限压。轻量档单价最低，用户 2026-08-05 明文「便宜可以放宽点」，
   * 因此给 Qwen 抬高条数区间，把节内写满，而不是靠多切节来凑字数。
   */
  bulletsPerSection: { min: number; max: number };
};

function envNum(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(raw, min), max);
}

function envStr(key: string, fallback: string): string {
  const raw = String(process.env[key] || "").trim();
  return raw || fallback;
}

const DISTILL_PROFILES: Record<KnowledgeCardDistillModelId, KnowledgeCardDistillProfile> = {
  // 超凡（Claude Opus 5）：质量顶档；分段架构保留（8/5 拍板：长书必须分段，单段内 max_tokens 开足）
  [KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_CLAUDE_CHUNK_THRESHOLD", 12_000, 6_000, 40_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_CLAUDE_CHUNK_CHARS", 12_000, 4_000, 24_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_CLAUDE_CONCURRENCY", 2, 1, 4),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_CLAUDE_EFFORT_CHUNK", "medium"),
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_CLAUDE_EFFORT_FINAL", "high"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_CLAUDE_TIMEOUT_MS", 300_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_CLAUDE_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_CLAUDE_MIN_SECTIONS", 3, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_CLAUDE_REFINE_MAX_CHARS", 24_000, 0, 120_000),
    bulletsPerSection: { min: 5, max: 9 },
  },
  // 精细：输出最全但每段慢，段中等 + 分段降中档
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_THRESHOLD", 12_000, 6_000, 40_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_CHARS", 12_000, 4_000, 24_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CONCURRENCY", 2, 1, 4),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_SOL_EFFORT_CHUNK", "medium"),
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_SOL_EFFORT_FINAL", "xhigh"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_SOL_TIMEOUT_MS", 180_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_SOL_MIN_SECTIONS", 3, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_SOL_REFINE_MAX_CHARS", 24_000, 0, 120_000),
    bulletsPerSection: { min: 5, max: 9 },
  },
  // 均衡：最快，段放大到 18k、并发 3，统稿用 max
  [KNOWLEDGE_CARD_DISTILL_MODEL_KIMI]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CHUNK_THRESHOLD", 20_000, 6_000, 60_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CHUNK_CHARS", 18_000, 4_000, 32_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CONCURRENCY", 3, 1, 5),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_KIMI_EFFORT_CHUNK", "high"),
    // 探针：max + 1.8 万字合并稿的统稿必定超时（顶档想太久），改用 high；
    // 分段阶段同样用 high 处理 1.8 万字从未超时，质量足够定主线。
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_KIMI_EFFORT_FINAL", "high"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_TIMEOUT_MS", 180_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_MIN_SECTIONS", 4, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_REFINE_MAX_CHARS", 40_000, 0, 120_000),
    bulletsPerSection: { min: 5, max: 9 },
  },
  // 轻量：单价最低，压缩倾向最强 → 段切小到 8k、抬每段节数下限与节内条数，单次统稿输入压到最小
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_THRESHOLD", 9_000, 4_000, 40_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_CHARS", 8_000, 3_000, 20_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CONCURRENCY", 2, 1, 4),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_QWEN_EFFORT_CHUNK", "medium"),
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_QWEN_EFFORT_FINAL", "xhigh"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_TIMEOUT_MS", 240_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_MIN_SECTIONS", 5, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_REFINE_MAX_CHARS", 14_000, 0, 120_000),
    // 轻量档便宜，放宽写满：节内条数比另两档各抬 2 条，别把一节压成三条干标题
    bulletsPerSection: { min: 7, max: 11 },
  },
};

export function knowledgeCardDistillProfile(
  modelName: KnowledgeCardDistillModelId,
): KnowledgeCardDistillProfile {
  return DISTILL_PROFILES[modelName];
}

/**
 * 超过此长度改走后台任务（前端轮询进度）：
 * 十余段串行要数分钟，压在一个同步 HTTP 里会被网关掐断，且已跑完的段全丢。
 * 约 3 万字以下仍同步直出（探针：Sol 2.5 万字 3 段约 194s），省去轮询。
 */
export function shouldRunKnowledgeCardDistillAsync(textLength: number): boolean {
  const threshold = envNum("KNOWLEDGE_CARD_DISTILL_ASYNC_THRESHOLD", 30_000, 8_000, 200_000);
  return Math.max(0, Number(textLength) || 0) > threshold;
}

/** 预估分段数，供前端提示「约 N 段」。 */
export function estimateKnowledgeCardDistillChunks(
  modelName: KnowledgeCardDistillModelId,
  textLength: number,
): number {
  const profile = DISTILL_PROFILES[modelName];
  const n = Math.max(0, Number(textLength) || 0);
  if (n <= profile.chunkThreshold) return 1;
  return Math.max(1, Math.ceil(n / profile.chunkChars));
}

/** 多模态（含图 OCR）走 api.evolink.ai */
const EVOLINK_CHAT_URL = String(
  process.env.EVOLINK_CHAT_COMPLETIONS_URL ||
    (process.env.EVOLINK_API_BASE
      ? `${String(process.env.EVOLINK_API_BASE).replace(/\/$/, "")}/v1/chat/completions`
      : "") ||
    "https://api.evolink.ai/v1/chat/completions",
).trim();

/**
 * 纯文本长连接优先 direct（Evolink 文档：长文/长推理更稳，减少 CF 524）。
 * 有附图时仍走 api。
 */
const EVOLINK_DIRECT_CHAT_URL = String(
  process.env.EVOLINK_DIRECT_CHAT_COMPLETIONS_URL || "https://direct.evolink.ai/v1/chat/completions",
).trim();

/**
 * 目标 `##` 小节数。实现已挪到 shared，前端要用同一份来预估提炼后的页数
 * （「要不要提炼」的弹窗靠它算账），两边算法必须一致。
 */
export { suggestKnowledgeCardMinSections };

/** 三档默认的节内条数（Qwen 会按 profile 抬高，见 `bulletsPerSection`） */
const DISTILL_DEFAULT_BULLETS = { min: 5, max: 9 } as const;

/**
 * 每小节要点条数与举例要求。
 *
 * 条数沿用 2026-06-27 定下的原始口径（详尽充实、宁详勿略、含定义/数字/方法/示例）；
 * 2026-08-05 曾被改成「有限要点 3–5 条 + 多留白」，与「详尽 + 条列 + 举例」相悖，已改回。
 * 区间按提炼档位取（轻量档抬高，避免它把每节压成三条干标题）。
 */
function distillSectionShape(bullets: { min: number; max: number }): string {
  return `每个 \`## 小节\` 内：
   - **${bullets.min}–${bullets.max} 条**要点短句（每条约 12–30 字，信息完整、一条只讲一件事，能独立读懂）
   - 每条尽量带上**定义 / 数字 / 方法步骤 / 示例**之一，不要写成空泛的概念名词
   - 该小节涉及方法/流程/判断标准时，**必须**至少一条以「例：」开头的具体例子（引用原文里的真实案例、数字、场景，不许编造）
   - 要点之间语意连贯，读完这一节就掌握一个完整概念；**不要为了简洁而删减关键信息**`;
}

function resolveDistillBullets(modelName?: string | null): { min: number; max: number } {
  const profile = modelName
    ? DISTILL_PROFILES[modelName as KnowledgeCardDistillModelId]
    : undefined;
  return profile?.bulletsPerSection ?? DISTILL_DEFAULT_BULLETS;
}

function buildDistillSystem(minSections: number, modelName?: string | null): string {
  const bullets = resolveDistillBullets(modelName);
  return `你是知识卡片内容主编。任务：把用户提供的文稿/幻灯片抽字/图片 OCR 结果，提炼成可直接做「疏朗图文知识卡片」的简体中文 Markdown（读图 OCR 与提炼同时完成，不要只吐生文本）。

**目标**：让没读过原文的人在几分钟内读懂这份材料**讲了什么、关键结论是什么、怎么用**。是**精选重点**，不是逐段搬运。

硬性要求：
1. **抓主干**：优先保留核心论点、关键结论、可操作方法、决定性数据与对比、反直觉洞察。删掉铺垫、重复、寒暄、案例复述、广告水词、与主题无关的枝节。
2. 结构：以 \`# 总标题\` 开头（总标题要点出全文主旨，不是书名照抄），下文用 \`## 小节\` 承载重点；小节标题本身就是一句有信息量的判断，不用「概述 / 背景介绍」这类空标题。
3. ${distillSectionShape(bullets)}
4. **篇幅**：约 **${minSections}** 个 \`## 小节\`（可上下浮动 2 个）。宁可少而精，**禁止**为凑数把同一论点拆成多节，也禁止把整本压成两三节总括。
5. **不要**把原文长段落原样倒进输出；**不要**注水扩写；**不要**「首先其次综上所述」公文腔。
6. 只输出 Markdown 正文，不要 JSON、不要前言后记、不要解释你做了什么。`;
}

export type KnowledgeCardUploadFile = {
  /** 小文件走请求体；大文件请改用 `gcsUri` 直传 */
  fileBase64?: string;
  /** 前端直传 GCS 后的对象地址（`gs://bucket/object`），不受请求体大小限制 */
  gcsUri?: string;
  mimeType: string;
  fileName?: string;
};

function hasDistillGateway(modelName: KnowledgeCardDistillModelId): boolean {
  if (modelName === KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE) {
    return Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim());
  }
  if (isKnowledgeCardDistillEvolinkModel(modelName)) return Boolean(getEvolinkApiKey());
  return Boolean(getOpenRouterApiKey());
}

function normalizeImageDataUrl(fileBase64: string | undefined, mimeType: string): string | null {
  const raw = String(fileBase64 || "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:image/")) return raw;
  const mime = mimeType.toLowerCase().includes("png")
    ? "image/png"
    : mimeType.toLowerCase().includes("webp")
      ? "image/webp"
      : "image/jpeg";
  const b64 = raw.replace(/^data:[^;]+;base64,/, "");
  if (b64.length < 32) return null;
  return `data:${mime};base64,${b64}`;
}

function isImageFile(mimeType: string, fileName?: string): boolean {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp")
  );
}

/** 抽文档文本；图片留给视觉 OCR，不在此解码为文字。 */
/**
 * 从 GCS 取回直传的文件。
 *
 * 大文档必须走这条：base64 塞进请求体最多约 13.5MB 原文件（`fileBase64` 限 18MB），
 * 再大就传不完——用户 2026-08-06 传 42MB 的 PDF，base64 后 56MB，
 * 连接在读请求体阶段就被掐断，报错却显示「算力紧张」，误导他换了三个模型。
 * 直传还有两个附带好处：文件不经过这台 2 核机器，以及 GCS 原生支持断点续传。
 */
async function readGcsUploadBuffer(gcsUri: string): Promise<Buffer> {
  const { signGsUriV4ReadUrl } = await import("./gcs.js");
  const url = await signGsUriV4ReadUrl(gcsUri, 3600);
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`读取上传文件失败（${res.status}）`);
  return Buffer.from(await res.arrayBuffer());
}

export async function extractKnowledgeCardUploads(files: KnowledgeCardUploadFile[]): Promise<{
  documentText: string;
  imageDataUrls: string[];
  methods: string[];
}> {
  const docParts: string[] = [];
  const imageDataUrls: string[] = [];
  const methods: string[] = [];

  for (const file of files) {
    const name = String(file.fileName || "upload");
    const gcsUri = String(file.gcsUri || "").trim();

    if (isImageFile(file.mimeType, file.fileName)) {
      // 图片走 OCR，需要 data URL；直传的先取回再转
      let url = normalizeImageDataUrl(file.fileBase64, file.mimeType);
      if (!url && gcsUri) {
        try {
          const buf = await readGcsUploadBuffer(gcsUri);
          url = `data:${file.mimeType};base64,${buf.toString("base64")}`;
        } catch (e) {
          methods.push(`${name}:gcs_read_failed`);
          console.warn(`[knowledgeCardDistill] 取回图片失败 ${gcsUri}:`, e);
        }
      }
      if (url) {
        imageDataUrls.push(url);
        methods.push(`${name}:image_ocr_pending`);
      }
      continue;
    }

    let buffer: Buffer;
    if (gcsUri) {
      try {
        buffer = await readGcsUploadBuffer(gcsUri);
        methods.push(`${name}:gcs_direct`);
      } catch (e) {
        methods.push(`${name}:gcs_read_failed`);
        console.warn(`[knowledgeCardDistill] 取回文档失败 ${gcsUri}:`, e);
        continue;
      }
    } else {
      buffer = Buffer.from(
        String(file.fileBase64 || "").replace(/^data:[^;]+;base64,/, ""),
        "base64",
      );
    }
    if (!buffer.length) {
      methods.push(`${name}:empty`);
      continue;
    }
    const extracted = await extractDocumentText({
      buffer,
      mimeType: file.mimeType,
      fileName: file.fileName,
    });
    if (extracted.text.trim()) {
      docParts.push(`【文件·${name}】\n${extracted.text.trim()}`);
      methods.push(`${name}:${extracted.method}`);
    } else {
      methods.push(`${name}:none`);
    }
  }

  return {
    documentText: docParts.join("\n\n").trim(),
    imageDataUrls,
    methods,
  };
}

/** 长书分段提炼：按段落边界切开，避免 Evolink/OR 单请求 524。 */
export function splitSourceTextForDistill(text: string, chunkChars = 10_000): string[] {
  const s = String(text || "").trim();
  if (!s) return [];
  if (s.length <= chunkChars) return [s];
  const parts: string[] = [];
  let rest = s;
  while (rest.length > chunkChars) {
    const window = rest.slice(0, chunkChars);
    let cut = window.lastIndexOf("\n\n");
    if (cut < chunkChars * 0.45) cut = window.lastIndexOf("\n");
    if (cut < chunkChars * 0.45) cut = window.lastIndexOf("。");
    if (cut < chunkChars * 0.45) cut = chunkChars;
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** 合并多段提炼 Markdown：保留首个 # 标题，后续只拼 ## 小节。 */
export function mergeDistilledMarkdownChunks(parts: string[]): string {
  const cleaned = parts.map((p) => String(p || "").trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0]!;

  let title = "";
  const sections: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const raw = cleaned[i]!;
    const lines = raw.split("\n");
    let bodyStart = 0;
    if (lines[0]?.match(/^#\s+/)) {
      if (!title) title = lines[0]!.trim();
      bodyStart = 1;
      while (bodyStart < lines.length && !lines[bodyStart]!.trim()) bodyStart++;
    }
    const body = lines.slice(bodyStart).join("\n").trim();
    if (body) sections.push(body);
  }
  const head = title || "# 知识要点";
  return [head, "", ...sections].join("\n").trim();
}

function isTimeoutUpstream(status: number, body: string): boolean {
  if (status === 524 || status === 504 || status === 408) return true;
  return /524:\s*A timeout|timeout occurred|Gateway Time-out|Cloudflare/i.test(String(body || ""));
}

function mapDistillUpstreamError(status: number, body: string): Error {
  const t = String(body || "");
  if (status === 402 || /insufficient|credit|余额|积分不足|quota/i.test(t)) {
    return new Error("提炼账户额度不足，请稍后重试或联系管理员");
  }
  if (status === 404 && /guardrail|privacy|data policy|No endpoints/i.test(t)) {
    return new Error("当前提炼通道不可用，请改用其他提炼档位后重试");
  }
  if (isTimeoutUpstream(status, t)) {
    return new Error(KNOWLEDGE_CARD_DISTILL_TIMEOUT_MESSAGE);
  }
  if (status === 429 || /rate.?limit/i.test(t)) {
    return new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  if (status >= 500) {
    return new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  return new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
}

function distillFetchTimeoutMs(
  modelName: KnowledgeCardDistillModelId,
  timeoutOverrideMs?: number,
): number {
  const override = Number(process.env.KNOWLEDGE_CARD_DISTILL_TIMEOUT_MS);
  if (Number.isFinite(override) && override >= 60_000) return Math.min(override, 480_000);
  if (Number.isFinite(timeoutOverrideMs) && Number(timeoutOverrideMs) > 0) {
    return Math.min(Number(timeoutOverrideMs), 480_000);
  }
  return DISTILL_PROFILES[modelName].requestTimeoutMs;
}

/**
 * 统稿比单段慢得多（输入是整本的提炼稿、输出还要重排全局），
 * 探针里 Kimi 用分段档超时会直接 abort，把 32 节的中间稿留给用户。
 */
function distillRefineTimeoutMs(modelName: KnowledgeCardDistillModelId): number {
  return Math.min(480_000, Math.round(DISTILL_PROFILES[modelName].requestTimeoutMs * 1.8));
}

function mapFetchAbortError(err: unknown): Error {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "TimeoutError" || name === "AbortError" || /aborted due to timeout|The operation was aborted/i.test(msg)) {
    return new Error(KNOWLEDGE_CARD_DISTILL_TIMEOUT_MESSAGE);
  }
  return err instanceof Error ? err : new Error(msg);
}

function buildDistillUserContent(params: {
  sourceText: string;
  imageDataUrls: string[];
  minSections: number;
  /** 本次只提炼整本中的一段（分段模式） */
  chunkLabel?: string;
}): Array<Record<string, unknown>> {
  const textBlock = [
    params.chunkLabel
      ? `本次只处理长文档的${params.chunkLabel}。只就本段内容**挑出最值得记住的重点**（约 ${params.minSections} 个 ## 小节），次要枝节可以整段舍弃；不要复述其它章节、不要写「本段/以上」这类过渡语，不要输出未经提炼的长原文：`
      : `请一次性完成：读文/读图 OCR + 提炼。输出疏朗知识卡片 Markdown，约 ${params.minSections} 个 ## 小节，取重点、不要输出未经提炼的长原文：`,
    params.sourceText.trim() || "（无纯文本，请主要依据附图 OCR 提炼）",
    params.imageDataUrls.length
      ? `\n附图 ${params.imageDataUrls.length} 张：请 OCR 提取文字与图表要点，并入精华，去掉重复。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: textBlock }];
  for (const url of params.imageDataUrls.slice(0, 40)) {
    userContent.push({ type: "image_url", image_url: { url, detail: "high" } });
  }
  return userContent;
}

/** Evolink：GPT-5.6 Sol / Qwen3.8 Max（有图走 api；纯文本走 direct 降 524）。 */
async function invokeEvolinkDistill(params: {
  sourceText: string;
  imageDataUrls: string[];
  modelName: typeof KNOWLEDGE_CARD_DISTILL_MODEL_SOL | typeof KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  minSections: number;
  effort: string;
  chunkLabel?: string;
  systemOverride?: string;
  timeoutMs?: number;
}): Promise<string> {
  const key = getEvolinkApiKey();
  if (!key) throw new Error("提炼通道未配置，请稍后重试");

  const userContent = buildDistillUserContent(params);
  const body: Record<string, unknown> = {
    model: params.modelName,
    messages: [
      {
        role: "system",
        content: params.systemOverride || buildDistillSystem(params.minSections, params.modelName),
      },
      { role: "user", content: userContent },
    ],
    max_tokens: DISTILL_MAX_TOKENS,
  };
  if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) {
    // Evolink Qwen：档位 low|medium|xhigh（无 max）；勿与 thinking_budget 同传
    body.enable_thinking = true;
    body.reasoning_effort = params.effort;
    body.max_completion_tokens = DISTILL_MAX_TOKENS;
    delete body.max_tokens;
  } else {
    body.reasoning_effort = params.effort;
  }

  const url = params.imageDataUrls.length > 0 ? EVOLINK_CHAT_URL : EVOLINK_DIRECT_CHAT_URL;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(distillFetchTimeoutMs(params.modelName, params.timeoutMs)),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw mapFetchAbortError(err);
  }
  const raw = await res.text();
  if (!res.ok) {
    console.warn(
      `[knowledgeCardDistill] Evolink ${params.modelName} HTTP ${res.status} via ${url.includes("direct") ? "direct" : "api"}: ${raw.slice(0, 400)}`,
    );
    throw mapDistillUpstreamError(res.status, raw);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    if (isTimeoutUpstream(res.status, raw)) throw new Error(KNOWLEDGE_CARD_DISTILL_TIMEOUT_MESSAGE);
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  const out = extractFirstChoicePlainText(json as Parameters<typeof extractFirstChoicePlainText>[0]).trim();
  if (!out || out.length < 20) {
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  return out;
}

/** OpenRouter Kimi K3：顶层 reasoning_effort（low|high|max）。 */
async function invokeOpenRouterKimiDistill(params: {
  sourceText: string;
  imageDataUrls: string[];
  minSections: number;
  effort: string;
  chunkLabel?: string;
  systemOverride?: string;
  timeoutMs?: number;
}): Promise<string> {
  const key = getOpenRouterApiKey();
  if (!key) throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);

  const userContent = buildDistillUserContent(params) as MessageContent[];
  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...getOpenRouterChatHeaders(),
      },
      signal: AbortSignal.timeout(
        distillFetchTimeoutMs(KNOWLEDGE_CARD_DISTILL_MODEL_KIMI, params.timeoutMs),
      ),
      body: JSON.stringify({
        model: KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
        messages: [
          {
            role: "system",
            content:
              params.systemOverride ||
              buildDistillSystem(params.minSections, KNOWLEDGE_CARD_DISTILL_MODEL_KIMI),
          },
          { role: "user", content: userContent },
        ],
        max_tokens: DISTILL_MAX_TOKENS,
        reasoning_effort: params.effort,
      }),
    });
  } catch (err) {
    throw mapFetchAbortError(err);
  }
  const raw = await res.text();
  if (!res.ok) {
    console.warn(`[knowledgeCardDistill] OpenRouter Kimi HTTP ${res.status}: ${raw.slice(0, 400)}`);
    throw mapDistillUpstreamError(res.status, raw);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    if (isTimeoutUpstream(res.status, raw)) throw new Error(KNOWLEDGE_CARD_DISTILL_TIMEOUT_MESSAGE);
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  const out = extractFirstChoicePlainText(json as Parameters<typeof extractFirstChoicePlainText>[0]).trim();
  if (!out || out.length < 20) throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  return out;
}

/**
 * 超凡档（Claude Opus 5）：走 invokeLLM 的 anthropic 分支。
 * 图片拍板走 URL 不走 base64：dataUrl 先上 GCS（按内容哈希去重）再签名 https。
 */
async function invokeClaudeDistill(params: {
  sourceText: string;
  imageDataUrls: string[];
  minSections: number;
  effort: string;
  chunkLabel?: string;
  systemOverride?: string;
  timeoutMs?: number;
}): Promise<string> {
  const imageUrls: string[] = [];
  if (params.imageDataUrls.length) {
    if (params.imageDataUrls.length > 30) {
      console.warn(
        `[knowledgeCardDistill] claude 档图片超上限，截取前 30/${params.imageDataUrls.length} 张`,
      );
    }
    const { createHash } = await import("node:crypto");
    const { uploadBufferToGcs, signGsUriV4ReadUrl } = await import("./gcs.js");
    for (const dataUrl of params.imageDataUrls.slice(0, 30)) {
      const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(dataUrl || ""));
      if (!match) {
        console.warn("[knowledgeCardDistill] claude 档跳过非 data: 形态图片条目");
        continue;
      }
      const mime = match[1] || "image/jpeg";
      const buffer = Buffer.from(match[2]!, "base64");
      const ext = /png/i.test(mime) ? "png" : /webp/i.test(mime) ? "webp" : "jpg";
      const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 20);
      const uploaded = await uploadBufferToGcs({
        objectName: `knowledge-card-distill/images-tmp/${hash}.${ext}`,
        buffer,
        contentType: mime,
      });
      imageUrls.push(signGsUriV4ReadUrl(uploaded.gcsUri, 2 * 3600));
    }
  }

  const textBlock = buildDistillUserContent({ ...params, imageDataUrls: [] })
    .filter((p) => p.type === "text")
    .map((p) => String((p as { text?: string }).text || ""))
    .join("\n");
  const response = await invokeLLM({
    model: "pro",
    provider: "anthropic",
    modelName: KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE,
    reasoningEffort: params.effort as "low" | "medium" | "high" | "xhigh" | "max",
    max_tokens: DISTILL_MAX_TOKENS,
    // 档位超时旋钮接活（否则 KNOWLEDGE_CARD_DISTILL_CLAUDE_TIMEOUT_MS 是死配置）
    abortSignal: AbortSignal.timeout(
      distillFetchTimeoutMs(KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE, params.timeoutMs),
    ),
    messages: [
      {
        role: "system",
        content:
          params.systemOverride
          || buildDistillSystem(params.minSections, KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE),
      },
      {
        role: "user",
        content: [
          { type: "text", text: textBlock },
          ...imageUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "high" as const },
          })),
        ],
      },
    ],
  });
  const out = extractFirstChoicePlainText(response).trim();
  if (!out || out.length < 20) throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  return out;
}

async function invokeDistillLlm(params: {
  sourceText: string;
  imageDataUrls: string[];
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
  effort: string;
  chunkLabel?: string;
  systemOverride?: string;
  timeoutMs?: number;
}): Promise<string> {
  if (!hasDistillGateway(params.modelName)) {
    throw new Error("提炼通道未配置，请稍后重试");
  }
  if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE) {
    return invokeClaudeDistill(params);
  }
  if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_KIMI) {
    return invokeOpenRouterKimiDistill(params);
  }
  if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) {
    return invokeEvolinkDistill({ ...params, modelName: KNOWLEDGE_CARD_DISTILL_MODEL_QWEN });
  }
  return invokeEvolinkDistill({ ...params, modelName: KNOWLEDGE_CARD_DISTILL_MODEL_SOL });
}

/** 提炼无法靠重试救回的错（额度/配置/通道），不必再退避。 */
function isFatalDistillError(message: string): boolean {
  return /额度不足|通道不可用|未配置|请先输入|未能从文件/.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 单段提炼：失败退避重试，仍失败则把该段对半细切分别提再拼。
 * 用户口径：个别失败的重新提炼，然后合并写框（不接受半途整批废）。
 */
async function distillOneChunkWithRetry(params: {
  chunk: string;
  imageDataUrls: string[];
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
  chunkLabel: string;
  retries: number;
  effort: string;
}): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= params.retries; attempt++) {
    try {
      return await invokeDistillLlm({
        sourceText: params.chunk,
        imageDataUrls: params.imageDataUrls,
        modelName: params.modelName,
        minSections: params.minSections,
        effort: params.effort,
        chunkLabel: params.chunkLabel,
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isFatalDistillError(lastError.message)) throw lastError;
      console.warn(
        `[knowledgeCardDistill] ${params.chunkLabel} attempt ${attempt + 1}/${params.retries + 1} failed: ${lastError.message.slice(0, 160)}`,
      );
      if (attempt < params.retries) await sleep(2_000 * (attempt + 1));
    }
  }

  // 退避用尽：对半细切重提，小片更不容易撞上游超时
  if (params.chunk.length > 3_000) {
    const halves = splitSourceTextForDistill(params.chunk, Math.ceil(params.chunk.length / 2));
    if (halves.length > 1) {
      console.warn(
        `[knowledgeCardDistill] ${params.chunkLabel} retry exhausted → split into ${halves.length} finer parts`,
      );
      const finer: string[] = [];
      for (let i = 0; i < halves.length; i++) {
        finer.push(
          await distillOneChunkWithRetry({
            chunk: halves[i]!,
            imageDataUrls: i === 0 ? params.imageDataUrls : [],
            modelName: params.modelName,
            minSections: Math.max(2, Math.ceil(params.minSections / halves.length)),
            chunkLabel: `${params.chunkLabel}-${i + 1}`,
            retries: 1,
            effort: params.effort,
          }),
        );
      }
      return mergeDistilledMarkdownChunks(finer);
    }
  }

  throw lastError || new Error(KNOWLEDGE_CARD_DISTILL_TIMEOUT_MESSAGE);
}

type RefineStage = "group" | "final" | "tighten";

function buildRefineSystem(
  minSections: number,
  stage: RefineStage,
  currentSections?: number,
  modelName?: string | null,
): string {
  const bullets = resolveDistillBullets(modelName);
  if (stage === "tighten") {
    return `你是知识卡片内容主编。下面这份知识卡片 Markdown **小节太多了**${
      currentSections ? `（当前 ${currentSections} 个 \`##\` 小节）` : ""
    }，读者会读不完，等于回去读原文。

请重写成 **${minSections} 个 \`## 小节\`**（这是硬指标，最多 ${minSections + 2} 个）。

怎么删：
1. 把讲同一主题的多个小节**合并成一节**，标题取信息量最大的那句，正文只留最强的要点与例子。
2. 删掉枝节、重复举例、只在局部成立的细节、可由其它小节推出的内容。
3. 保住全局主线：\`# 总标题\` 点出主旨，小节按「是什么 → 为什么 → 怎么做 → 边界与例外」之类的自然顺序排列。
4. ${distillSectionShape(bullets)}
5. 只输出 Markdown 正文，不要前言后记、不要解释你删了什么。`;
  }

  const head =
    stage === "final"
      ? `你是知识卡片内容主编。下面这份 Markdown 由同一份长文档**分段提炼后机械拼接**而成，段与段之间重复、粒度不齐、缺少全局主线。请把它**精选统稿**成一份连贯的疏朗知识卡片 Markdown。

这一步是**取舍**，不是誊抄：读者要靠这份卡片在几分钟内读懂整份文档讲了什么、关键结论是什么、怎么用。`
      : `你是知识卡片内容主编。下面这份 Markdown 是一份长文档若干相邻章节的提炼稿拼接，小节偏多、粒度不齐、彼此重复。请**合并同类、只留最值得记住的重点**，压缩成更少的小节，供后续统稿使用。`;

  const mainline =
    stage === "final"
      ? `1. **先定主线**：判断全文真正的核心论点，用 \`# 总标题\` 点出主旨，再按「是什么 → 为什么 → 怎么做 → 边界与例外」之类的自然顺序重排小节，读下来是一条线，不是小节堆叠。`
      : `1. **同类合并**：把讲同一件事的小节并成一节（标题取信息量最大的写法），不同主题不要硬凑；本轮不必追求全局主线，但节内必须自洽。`;

  return `${head}

硬性要求：
${mainline}
2. **精选到 ${minSections} 个 \`## 小节\`**（硬指标，最多 ${minSections + 2} 个）：合并同义小节，删掉枝节、重复举例、只在原文局部成立的细节。**删内容是本步的职责**，不要为了「不丢东西」而堆节。
3. ${distillSectionShape(bullets)}
4. 小节标题写成有信息量的一句判断，不要「概述 / 其他 / 补充」这类空标题。
5. 去掉分段痕迹：「本段 / 以上 / 续上」这类过渡语、重复标题、空节。
6. 只输出 Markdown 正文，不要前言后记、不要解释取舍过程。`;
}

/** 统稿要求大幅精选，只在「结构崩塌」时才回退输入稿。 */
function refinedOutputLooksBroken(refined: string, minSections: number): boolean {
  const body = refined.trim();
  if (body.length < 400) return true;
  const sections = (body.match(/^##\s+\S/gm) || []).length;
  return sections < Math.max(2, Math.floor(minSections / 2));
}

function countMarkdownSections(md: string): number {
  return (md.match(/^##\s+\S/gm) || []).length;
}

/**
 * 按 `##` 边界把提炼稿分成 groupCount 组（组内保持原顺序，长度尽量均匀）。
 * 用于统稿前的中间归并：一次喂不完就分组各自压缩。
 */
function groupMarkdownSections(md: string, groupCount: number): string[] {
  const lines = md.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (/^##\s+\S/.test(l.trim())) starts.push(i);
  });
  if (starts.length < 2 || groupCount < 2) return [md];

  const blocks = starts.map((start, idx) =>
    lines.slice(start, idx + 1 < starts.length ? starts[idx + 1] : lines.length).join("\n").trim(),
  );
  const groups = Math.min(groupCount, blocks.length);
  const per = Math.ceil(blocks.length / groups);
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i += per) {
    out.push(blocks.slice(i, i + per).join("\n\n").trim());
  }
  return out.filter(Boolean);
}

/** 单次统稿；失败或结构崩塌则原样退回输入，绝不因这一步丢掉已提炼内容。 */
async function refineOnce(params: {
  body: string;
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
  stage: RefineStage;
}): Promise<string> {
  const profile = DISTILL_PROFILES[params.modelName];
  try {
    const refined = await invokeDistillLlm({
      sourceText: params.body,
      imageDataUrls: [],
      modelName: params.modelName,
      minSections: params.minSections,
      // 只有定全局主线的 final 值得顶档；分组压缩与收紧节数用分段档，否则又撞超时
      effort: params.stage === "final" ? profile.effortFinal : profile.effortChunk,
      systemOverride: buildRefineSystem(
        params.minSections,
        params.stage,
        countMarkdownSections(params.body),
        params.modelName,
      ),
      timeoutMs: distillRefineTimeoutMs(params.modelName),
    });
    if (refinedOutputLooksBroken(refined, params.minSections)) {
      console.warn(
        `[knowledgeCardDistill] refine(${params.stage}) output broken (${params.body.length} → ${refined.length} chars), keep input`,
      );
      return params.body;
    }
    return refined;
  } catch (err) {
    console.warn(
      `[knowledgeCardDistill] refine(${params.stage}) failed, keep input: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`,
    );
    return params.body;
  }
}

/** 统稿最多归并层数：每层把小节数压掉一半左右，三层足够把上百节收到目标区间。 */
const DISTILL_REDUCE_MAX_DEPTH = 3;
/** 统稿后仍超标时最多再压几轮（探针：Kimi 一次统稿只肯降到 41 节） */
const DISTILL_TIGHTEN_MAX_ROUNDS = 2;

/**
 * 树形归并统稿（用户 2026-08-05：可以浓缩重排，但不能出 68 页）。
 *
 * 旧实现「合并稿超过 refineMaxChars 就跳过统稿」会把拼接稿原样吐给用户
 * （Qwen 探针：14 段 × 4 节 = 56 节 → 56 页，等于看原书）。
 * 现在改为：喂不下就按 `##` 分组各自压缩，逐层收敛，最后必定做一次全局统稿。
 */
async function refineMergedDistill(params: {
  merged: string;
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
}): Promise<string> {
  const profile = DISTILL_PROFILES[params.modelName];
  let current = params.merged.trim();
  if (!current) return current;

  /**
   * 只按**字数**决定要不要先分组压一层：
   * 节数超标由后面的收紧轮解决，比多烧一整层归并快得多
   * （探针：Kimi 57 节能一次统稿到 28 节，先分组反而白等两层超时、多花约 10 分钟）。
   */
  const fitsOnePass = () =>
    profile.refineMaxChars <= 0 || current.length <= profile.refineMaxChars;

  for (let depth = 0; depth < DISTILL_REDUCE_MAX_DEPTH && !fitsOnePass(); depth += 1) {
    const sectionsBefore = countMarkdownSections(current);
    const byChars =
      profile.refineMaxChars > 0 ? Math.ceil(current.length / profile.refineMaxChars) : 1;
    const bySections = Math.ceil(sectionsBefore / (params.minSections * 2));
    const groups = groupMarkdownSections(current, Math.max(2, byChars, bySections));
    if (groups.length < 2) break;

    // 每组留出四成冗余，把最终取舍留给最后一次全局统稿
    const perGroupTarget = Math.max(3, Math.ceil((params.minSections * 1.4) / groups.length));
    console.info(
      `[knowledgeCardDistill] reduce depth=${depth} ${countMarkdownSections(current)} sections / ` +
        `${current.length} chars → ${groups.length} groups × ~${perGroupTarget} sections`,
    );

    const reduced: string[] = new Array(groups.length);
    for (let i = 0; i < groups.length; i += profile.concurrency) {
      const idxs = groups.slice(i, i + profile.concurrency).map((_, j) => i + j);
      await Promise.all(
        idxs.map(async (idx) => {
          reduced[idx] = await refineOnce({
            body: groups[idx]!,
            modelName: params.modelName,
            minSections: perGroupTarget,
            stage: "group",
          });
        }),
      );
    }
    const next = mergeDistilledMarkdownChunks(reduced);
    const sectionsAfter = countMarkdownSections(next);
    current = next;
    // 这一层没把节数压下来（模型不服从或整层降级退回）→ 别再空转烧一层，交给收紧轮
    if (sectionsAfter > sectionsBefore * 0.9) {
      console.info(
        `[knowledgeCardDistill] reduce stalled at ${sectionsAfter} sections (was ${sectionsBefore}), stop reducing`,
      );
      break;
    }
  }

  let final = await refineOnce({
    body: current,
    modelName: params.modelName,
    minSections: params.minSections,
    stage: "final",
  });

  // 有些模型一次统稿只肯降一点（探针：Kimi 36 → 41 节）。超标就再压，压不动即停，不空烧。
  const hardCap = Math.ceil(params.minSections * 1.35);
  for (let round = 0; round < DISTILL_TIGHTEN_MAX_ROUNDS; round += 1) {
    const before = countMarkdownSections(final);
    if (before <= hardCap) break;
    console.info(
      `[knowledgeCardDistill] tighten round ${round + 1}: ${before} sections > cap ${hardCap}`,
    );
    const tightened = await refineOnce({
      body: final,
      modelName: params.modelName,
      minSections: params.minSections,
      stage: "tighten",
    });
    if (countMarkdownSections(tightened) >= before) break;
    final = tightened;
  }

  console.info(
    `[knowledgeCardDistill] refined ${params.merged.length} chars / ` +
      `${countMarkdownSections(params.merged)} sections → ${final.length} chars / ` +
      `${countMarkdownSections(final)} sections (target ${params.minSections})`,
  );
  return final;
}

export type KnowledgeCardDistillProgress = {
  doneChunks: number;
  totalChunks: number;
  phase: "distilling" | "refining";
};

/** 短文一次直出（顶档）；长文按模型 profile 分段（中档）→ 合并 → 顶档统稿。 */
async function invokeDistillLlmPossiblyChunked(params: {
  sourceText: string;
  imageDataUrls: string[];
  modelName: KnowledgeCardDistillModelId;
  minSectionsTotal: number;
  onProgress?: (p: KnowledgeCardDistillProgress) => void | Promise<void>;
}): Promise<string> {
  const profile = DISTILL_PROFILES[params.modelName];
  const text = String(params.sourceText || "").trim();
  const urls = params.imageDataUrls;

  if (!text || text.length <= profile.chunkThreshold) {
    return invokeDistillLlm({
      sourceText: text,
      imageDataUrls: urls,
      modelName: params.modelName,
      minSections: params.minSectionsTotal,
      effort: profile.effortFinal,
    });
  }

  const chunks = splitSourceTextForDistill(text, profile.chunkChars);
  console.info(
    `[knowledgeCardDistill] long doc ${text.length} chars → ${chunks.length} chunks ` +
      `(model=${params.modelName} chunkChars=${profile.chunkChars} concurrency=${profile.concurrency} effort=${profile.effortChunk})`,
  );

  const outputs: string[] = new Array(chunks.length);
  // 分段只是给统稿备料：按总目标节数分摊 + 六成冗余留出取舍空间，
  // 不再让每段按自身字数各出十来节（拼接稿会膨胀到近百节，统稿反而读不动）。
  const minSectionsPerChunk = Math.max(
    profile.minSectionsPerChunk,
    Math.ceil((params.minSectionsTotal * 1.6) / chunks.length),
  );
  let done = 0;
  await params.onProgress?.({ doneChunks: 0, totalChunks: chunks.length, phase: "distilling" });

  for (let i = 0; i < chunks.length; i += profile.concurrency) {
    const batchIdx = chunks.slice(i, i + profile.concurrency).map((_, j) => i + j);
    await Promise.all(
      batchIdx.map(async (idx) => {
        const chunk = chunks[idx]!;
        outputs[idx] = await distillOneChunkWithRetry({
          chunk,
          // 附图只挂第一段，避免每段重复烧视觉
          imageDataUrls: idx === 0 ? urls : [],
          modelName: params.modelName,
          minSections: minSectionsPerChunk,
          chunkLabel: `第 ${idx + 1}/${chunks.length} 段`,
          retries: profile.chunkRetries,
          effort: profile.effortChunk,
        });
        done += 1;
      }),
    );
    await params.onProgress?.({ doneChunks: done, totalChunks: chunks.length, phase: "distilling" });
  }

  const merged = mergeDistilledMarkdownChunks(outputs);
  await params.onProgress?.({
    doneChunks: chunks.length,
    totalChunks: chunks.length,
    phase: "refining",
  });
  return refineMergedDistill({
    merged,
    modelName: params.modelName,
    minSections: params.minSectionsTotal,
  });
}

export type PrepareKnowledgeCardCopyResult = {
  distilledMarkdown: string;
  skippedDistill: boolean;
  extractionMethods: string[];
  sourceChars: number;
  distillModel: KnowledgeCardDistillModelId | null;
};

/**
 * 合并文本框 + 上传 → OCR/提炼 → 可分页 Markdown。
 * 短贴文且无上传：跳过提炼。
 * 长书（>~12k 字）后台分段提炼再合并；产品面仍是一次上传自动写框。
 */
export async function prepareKnowledgeCardCopy(input: {
  sourceText?: string;
  files?: KnowledgeCardUploadFile[];
  forceDistill?: boolean;
  distillModel?: string;
  onProgress?: (p: KnowledgeCardDistillProgress) => void | Promise<void>;
}): Promise<PrepareKnowledgeCardCopyResult> {
  const modelName = resolveKnowledgeCardDistillModel(input.distillModel);
  const files = Array.isArray(input.files) ? input.files : [];
  const extracted = files.length
    ? await extractKnowledgeCardUploads(files)
    : { documentText: "", imageDataUrls: [] as string[], methods: [] as string[] };

  const pasted = String(input.sourceText || "").trim();
  // 有上传时：以本次抽文+附图为准；文本框旧「生 OCR」不重复灌入（避免 100+ 页原文假分页）
  const mergedRaw = files.length
    ? [extracted.documentText, pasted.length <= 3200 ? pasted : ""].filter(Boolean).join("\n\n").trim() ||
      extracted.documentText ||
      pasted
    : pasted;
  const hasUploads = files.length > 0;
  const skip =
    !input.forceDistill &&
    shouldSkipKnowledgeCardDistill(mergedRaw, hasUploads) &&
    extracted.imageDataUrls.length === 0;

  if (skip) {
    return {
      distilledMarkdown: mergedRaw,
      skippedDistill: true,
      extractionMethods: extracted.methods,
      sourceChars: mergedRaw.length,
      distillModel: null,
    };
  }

  if (!mergedRaw && extracted.imageDataUrls.length === 0) {
    throw new Error("请先输入文案或上传文件/图片");
  }

  if (files.length > 0 && !mergedRaw && extracted.imageDataUrls.length === 0) {
    throw new Error("未能从文件抽出文字（扫描版 PDF 请改传可选中文字的 PDF，或上传关键页图片）");
  }

  const urls = extracted.imageDataUrls;
  const sourceChars = mergedRaw.length + urls.length * 500;
  const minSectionsTotal = suggestKnowledgeCardMinSections(Math.max(mergedRaw.length, sourceChars));

  try {
    const distilled = await invokeDistillLlmPossiblyChunked({
      sourceText: mergedRaw,
      imageDataUrls: urls,
      modelName,
      minSectionsTotal,
      onProgress: input.onProgress,
    });
    if (mergedRaw.length >= 8000 && distilled.length < Math.min(800, mergedRaw.length * 0.02)) {
      throw new Error("提炼结果过短，疑似过度压缩，请重试");
    }
    return {
      distilledMarkdown: distilled,
      skippedDistill: false,
      extractionMethods: extracted.methods,
      sourceChars,
      distillModel: modelName,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[knowledgeCardDistill] failed:", msg.slice(0, 320));
    if (/过短|未能从文件|请先输入|额度不足|通道不可用|未配置|超时/.test(msg)) {
      throw new Error(msg);
    }
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
}
