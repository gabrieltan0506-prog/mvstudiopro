/**
 * 图文知识卡片：上传/长文 → 读文/读图 OCR + 提练 → Markdown。
 * 三档并列：Evolink GPT-5.6 Sol / OpenRouter Kimi K3 / Evolink Qwen3.8 Max。
 * 长书超过阈值时后台分段提练再合并（避免上游 524）；产品面仍是一次上传写框。
 * 提练/OCR 成本含在页费中，本模块不单独扣积分。
 *
 * @see https://evolink.ai/gpt-5-6
 * @see https://evolink.ai/docs/cn/api-manual/language-series/qwen3.8-max/qwen3.8-max-chat
 */
import { extractFirstChoicePlainText, type MessageContent } from "../_core/llm.js";
import { shouldSkipKnowledgeCardDistill } from "../../shared/knowledgeCardPagination.js";
import {
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
  "文档较长，提练超时，请稍后重试；超长书会自动分段提练后再合并";

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
  /** 每段最少 `##` 小节下限（压缩过度的模型抬高） */
  minSectionsPerChunk: number;
  /** 合并稿超过此长度就跳过顶档统稿（统稿本身会撞超时） */
  refineMaxChars: number;
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
  // 精细：输出最全但每段慢，段中等 + 分段降中档
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_THRESHOLD", 12_000, 6_000, 40_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_CHARS", 12_000, 4_000, 24_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CONCURRENCY", 2, 1, 4),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_SOL_EFFORT_CHUNK", "medium"),
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_SOL_EFFORT_FINAL", "xhigh"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_SOL_TIMEOUT_MS", 180_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_SOL_MIN_SECTIONS", 4, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_SOL_REFINE_MAX_CHARS", 24_000, 0, 120_000),
  },
  // 均衡：最快，段放大到 18k、并发 3，统稿用 max
  [KNOWLEDGE_CARD_DISTILL_MODEL_KIMI]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CHUNK_THRESHOLD", 20_000, 6_000, 60_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CHUNK_CHARS", 18_000, 4_000, 32_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CONCURRENCY", 3, 1, 5),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_KIMI_EFFORT_CHUNK", "high"),
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_KIMI_EFFORT_FINAL", "max"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_TIMEOUT_MS", 180_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_MIN_SECTIONS", 5, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_KIMI_REFINE_MAX_CHARS", 40_000, 0, 120_000),
  },
  // 轻量：最慢且压缩过度，段切小到 8k、抬最少小节，统稿门槛压低
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_THRESHOLD", 9_000, 4_000, 40_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_CHARS", 8_000, 3_000, 20_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CONCURRENCY", 2, 1, 4),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_QWEN_EFFORT_CHUNK", "medium"),
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_QWEN_EFFORT_FINAL", "xhigh"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_TIMEOUT_MS", 240_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_MIN_SECTIONS", 6, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_REFINE_MAX_CHARS", 14_000, 0, 120_000),
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
 * 按源文字长度建议最少 `##` 小节数，防止整本书被压成 1 页。
 * 约每 1400 字源文 ≥1 节；上限 80。
 */
export function suggestKnowledgeCardMinSections(sourceChars: number): number {
  const n = Math.max(0, Math.floor(Number(sourceChars) || 0));
  if (n < 80) return 1;
  if (n < 480) return 2;
  return Math.min(80, Math.max(4, Math.ceil(n / 1400)));
}

function buildDistillSystem(minSections: number): string {
  return `你是知识卡片内容主编。任务：把用户提供的文稿/幻灯片抽字/图片 OCR 结果，**一次性**提练成可直接做「疏朗图文知识卡片」的简体中文 Markdown（读图 OCR 与提练在同一次完成，不要只吐生文本）。

硬性要求：
1. 只保留可发表的知识点：定义、方法、数据、步骤、对比、结论、章节要点；去掉重复段落、口头禅、聊天寒暄、问答客套、广告水词。
2. 结构：以 \`# 总标题\` 开头，下文用若干 \`## 小节\`。每个小节 3–8 条要点短句（约 12–36 字），便于一页一节疏朗排版。
3. **覆盖密度（硬）**：本批素材至少输出 **${minSections}** 个 \`##\` 小节；长书/长文禁止压成两三节总括，也禁止把整本 OCR 原文原样倒进输出。
4. 页数不人为砍到 12：内容该有多少精华小节就保留多少；禁止注水扩写，也禁止过度摘要。
5. 禁止输出与素材无关的模板标题；禁止「首先其次综上所述」公文腔。
6. 只输出 Markdown 正文，不要 JSON、不要前言后记。`;
}

export type KnowledgeCardUploadFile = {
  fileBase64: string;
  mimeType: string;
  fileName?: string;
};

function hasDistillGateway(modelName: KnowledgeCardDistillModelId): boolean {
  if (isKnowledgeCardDistillEvolinkModel(modelName)) return Boolean(getEvolinkApiKey());
  return Boolean(getOpenRouterApiKey());
}

function normalizeImageDataUrl(fileBase64: string, mimeType: string): string | null {
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
    if (isImageFile(file.mimeType, file.fileName)) {
      const url = normalizeImageDataUrl(file.fileBase64, file.mimeType);
      if (url) {
        imageDataUrls.push(url);
        methods.push(`${name}:image_ocr_pending`);
      }
      continue;
    }
    const buffer = Buffer.from(
      String(file.fileBase64 || "").replace(/^data:[^;]+;base64,/, ""),
      "base64",
    );
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

/** 长书分段提练：按段落边界切开，避免 Evolink/OR 单请求 524。 */
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

/** 合并多段提练 Markdown：保留首个 # 标题，后续只拼 ## 小节。 */
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
    return new Error("提练账户额度不足，请稍后重试或联系管理员");
  }
  if (status === 404 && /guardrail|privacy|data policy|No endpoints/i.test(t)) {
    return new Error("当前提练通道不可用，请改用其他提练档位后重试");
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

function distillFetchTimeoutMs(modelName: KnowledgeCardDistillModelId): number {
  const override = Number(process.env.KNOWLEDGE_CARD_DISTILL_TIMEOUT_MS);
  if (Number.isFinite(override) && override >= 60_000) return Math.min(override, 480_000);
  return DISTILL_PROFILES[modelName].requestTimeoutMs;
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
  /** 本次只提练整本中的一段（分段模式） */
  chunkLabel?: string;
}): Array<Record<string, unknown>> {
  const textBlock = [
    params.chunkLabel
      ? `本次只处理长文档的${params.chunkLabel}，请只就本段内容提练，不要复述其它章节、不要写「本段/以上」这类过渡语。输出疏朗知识卡片 Markdown；至少 ${params.minSections} 个 ## 小节（不要输出未经提练的长原文）：`
      : `请一次性完成：读文/读图 OCR + 提练。输出疏朗知识卡片 Markdown；至少 ${params.minSections} 个 ## 小节（不要输出未经提练的长原文）：`,
    params.sourceText.trim() || "（无纯文本，请主要依据附图 OCR 提练）",
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
}): Promise<string> {
  const key = getEvolinkApiKey();
  if (!key) throw new Error("提练通道未配置，请稍后重试");

  const userContent = buildDistillUserContent(params);
  const body: Record<string, unknown> = {
    model: params.modelName,
    messages: [
      { role: "system", content: params.systemOverride || buildDistillSystem(params.minSections) },
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
      signal: AbortSignal.timeout(distillFetchTimeoutMs(params.modelName)),
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
      signal: AbortSignal.timeout(distillFetchTimeoutMs(KNOWLEDGE_CARD_DISTILL_MODEL_KIMI)),
      body: JSON.stringify({
        model: KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
        messages: [
          {
            role: "system",
            content: params.systemOverride || buildDistillSystem(params.minSections),
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

async function invokeDistillLlm(params: {
  sourceText: string;
  imageDataUrls: string[];
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
  effort: string;
  chunkLabel?: string;
  systemOverride?: string;
}): Promise<string> {
  if (!hasDistillGateway(params.modelName)) {
    throw new Error("提练通道未配置，请稍后重试");
  }
  if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_KIMI) {
    return invokeOpenRouterKimiDistill(params);
  }
  if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) {
    return invokeEvolinkDistill({ ...params, modelName: KNOWLEDGE_CARD_DISTILL_MODEL_QWEN });
  }
  return invokeEvolinkDistill({ ...params, modelName: KNOWLEDGE_CARD_DISTILL_MODEL_SOL });
}

/** 提练无法靠重试救回的错（额度/配置/通道），不必再退避。 */
function isFatalDistillError(message: string): boolean {
  return /额度不足|通道不可用|未配置|请先输入|未能从文件/.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 单段提练：失败退避重试，仍失败则把该段对半细切分别提再拼。
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

function buildRefineSystem(minSections: number): string {
  return `你是知识卡片内容主编。下面这份 Markdown 由同一份长文档**分段提练后机械拼接**而成，请统稿成一份连贯的疏朗知识卡片 Markdown。

硬性要求：
1. 只做统稿，**不得丢弃知识点**：合并重复小节、统一措辞与粒度、按主题重排顺序。
2. 结构：\`# 总标题\` 开头，下文若干 \`## 小节\`，每节 3–8 条要点短句（约 12–36 字）。
3. 保留至少 **${minSections}** 个 \`##\` 小节；禁止压成几节总括。
4. 去掉分段痕迹：「本段 / 以上 / 续上」这类过渡语、重复标题、空节。
5. 只输出 Markdown 正文，不要前言后记。`;
}

/**
 * 合并稿顶档统稿（用户口径 B+C：分段用中档，合并稿再用顶档润一次）。
 * 统稿本身也可能超时 → 失败或过长时降级返回原合并稿，绝不因润色丢掉已提练内容。
 */
async function refineMergedDistill(params: {
  merged: string;
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
}): Promise<string> {
  const profile = DISTILL_PROFILES[params.modelName];
  const merged = params.merged.trim();
  if (!merged) return merged;
  if (profile.refineMaxChars <= 0 || merged.length > profile.refineMaxChars) {
    console.info(
      `[knowledgeCardDistill] skip refine (${merged.length} chars > ${profile.refineMaxChars}, model=${params.modelName})`,
    );
    return merged;
  }

  try {
    const refined = await invokeDistillLlm({
      sourceText: merged,
      imageDataUrls: [],
      modelName: params.modelName,
      minSections: params.minSections,
      effort: profile.effortFinal,
      systemOverride: buildRefineSystem(params.minSections),
    });
    // 统稿把内容砍掉一半以上视为跑偏，宁可用合并稿
    if (refined.length < merged.length * 0.45) {
      console.warn(
        `[knowledgeCardDistill] refine shrank ${merged.length} → ${refined.length}, keep merged`,
      );
      return merged;
    }
    return refined;
  } catch (err) {
    console.warn(
      `[knowledgeCardDistill] refine failed, keep merged: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`,
    );
    return merged;
  }
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
  let done = 0;
  await params.onProgress?.({ doneChunks: 0, totalChunks: chunks.length, phase: "distilling" });

  for (let i = 0; i < chunks.length; i += profile.concurrency) {
    const batchIdx = chunks.slice(i, i + profile.concurrency).map((_, j) => i + j);
    await Promise.all(
      batchIdx.map(async (idx) => {
        const chunk = chunks[idx]!;
        const minSec = Math.max(
          profile.minSectionsPerChunk,
          Math.min(24, suggestKnowledgeCardMinSections(chunk.length)),
        );
        outputs[idx] = await distillOneChunkWithRetry({
          chunk,
          // 附图只挂第一段，避免每段重复烧视觉
          imageDataUrls: idx === 0 ? urls : [],
          modelName: params.modelName,
          minSections: minSec,
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
 * 合并文本框 + 上传 → OCR/提练 → 可分页 Markdown。
 * 短贴文且无上传：跳过提练。
 * 长书（>~12k 字）后台分段提练再合并；产品面仍是一次上传自动写框。
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
      throw new Error("提练结果过短，疑似过度压缩，请重试");
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
