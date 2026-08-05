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

/** 超过此长度则后台分段提练再合并（对用户仍是一次上传→写框） */
const DISTILL_CHUNK_THRESHOLD = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_CHUNK_THRESHOLD) || 12_000, 6_000),
  40_000,
);
const DISTILL_CHUNK_CHARS = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_CHUNK_CHARS) || 10_000, 4_000),
  20_000,
);
/** 分段并发；单机 Fly 用 2，避免把健康检查拖死 */
const DISTILL_CHUNK_CONCURRENCY = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_CHUNK_CONCURRENCY) || 2, 1),
  3,
);

/** GPT-5.6 Sol（Evolink）：`reasoning_effort` = xhigh */
const DISTILL_REASONING_EFFORT_GPT = "xhigh" as const;
/**
 * Kimi K3 官方档位只有 low|high|max（顶层 `reasoning_effort`），无 xhigh。
 * @see https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
 */
const DISTILL_REASONING_EFFORT_KIMI = "high" as const;
/**
 * Evolink Qwen3.8 Max：档位 low|medium|xhigh（无 max）；顶档 xhigh。
 * 勿与 thinking_budget 同传。
 * @see https://evolink.ai/qwen-3-8-max
 * @see https://docs.qwencloud.com/developer-guides/text-generation/thinking
 */
const DISTILL_REASONING_EFFORT_QWEN = "xhigh" as const;

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
export function splitSourceTextForDistill(text: string, chunkChars = DISTILL_CHUNK_CHARS): string[] {
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

function distillFetchTimeoutMs(): number {
  return Math.min(Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_TIMEOUT_MS) || 180_000, 60_000), 480_000);
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
}): Array<Record<string, unknown>> {
  const textBlock = [
    `请一次性完成：读文/读图 OCR + 提练。输出疏朗知识卡片 Markdown；至少 ${params.minSections} 个 ## 小节（不要输出未经提练的长原文）：`,
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
}): Promise<string> {
  const key = getEvolinkApiKey();
  if (!key) throw new Error("提练通道未配置，请稍后重试");

  const userContent = buildDistillUserContent(params);
  const body: Record<string, unknown> = {
    model: params.modelName,
    messages: [
      { role: "system", content: buildDistillSystem(params.minSections) },
      { role: "user", content: userContent },
    ],
    max_tokens: DISTILL_MAX_TOKENS,
  };
  if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) {
    // Evolink Qwen：顶档 xhigh（无 max）；勿与 thinking_budget 同传
    body.enable_thinking = true;
    body.reasoning_effort = DISTILL_REASONING_EFFORT_QWEN;
    body.max_completion_tokens = DISTILL_MAX_TOKENS;
    delete body.max_tokens;
  } else {
    body.reasoning_effort = DISTILL_REASONING_EFFORT_GPT;
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
      signal: AbortSignal.timeout(distillFetchTimeoutMs()),
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

/** OpenRouter Kimi K3：顶层 reasoning_effort=high。 */
async function invokeOpenRouterKimiDistill(params: {
  sourceText: string;
  imageDataUrls: string[];
  minSections: number;
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
      signal: AbortSignal.timeout(distillFetchTimeoutMs()),
      body: JSON.stringify({
        model: KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
        messages: [
          { role: "system", content: buildDistillSystem(params.minSections) },
          { role: "user", content: userContent },
        ],
        max_tokens: DISTILL_MAX_TOKENS,
        reasoning_effort: DISTILL_REASONING_EFFORT_KIMI,
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

/** 短文一次；长文分段并发提练后合并（产品面仍是「上传→自动写框」一次完成）。 */
async function invokeDistillLlmPossiblyChunked(params: {
  sourceText: string;
  imageDataUrls: string[];
  modelName: KnowledgeCardDistillModelId;
  minSectionsTotal: number;
}): Promise<string> {
  const text = String(params.sourceText || "").trim();
  const urls = params.imageDataUrls;
  if (!text || text.length <= DISTILL_CHUNK_THRESHOLD) {
    return invokeDistillLlm({
      sourceText: text,
      imageDataUrls: urls,
      modelName: params.modelName,
      minSections: params.minSectionsTotal,
    });
  }

  const chunks = splitSourceTextForDistill(text, DISTILL_CHUNK_CHARS);
  console.info(
    `[knowledgeCardDistill] long doc ${text.length} chars → ${chunks.length} chunks (threshold=${DISTILL_CHUNK_THRESHOLD}, model=${params.modelName})`,
  );

  const outputs: string[] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += DISTILL_CHUNK_CONCURRENCY) {
    const batchIdx = chunks.slice(i, i + DISTILL_CHUNK_CONCURRENCY).map((_, j) => i + j);
    await Promise.all(
      batchIdx.map(async (idx) => {
        const chunk = chunks[idx]!;
        const minSec = Math.max(2, Math.min(24, suggestKnowledgeCardMinSections(chunk.length)));
        outputs[idx] = await invokeDistillLlm({
          sourceText: chunk,
          // 附图只挂第一段，避免每段重复烧视觉
          imageDataUrls: idx === 0 ? urls : [],
          modelName: params.modelName,
          minSections: minSec,
        });
      }),
    );
  }
  return mergeDistilledMarkdownChunks(outputs);
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
