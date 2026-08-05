/**
 * 图文知识卡片：上传/长文 → 一次完成读文/读图 OCR + 提练 → Markdown。
 * 默认 Evolink GPT-5.6 Sol；备用 OpenRouter Kimi K3；备选 Evolink Qwen3.8 Max。
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

/** @deprecated 用 resolveKnowledgeCardDistillModel */
export const KNOWLEDGE_CARD_DISTILL_MODEL = resolveKnowledgeCardDistillModel(
  process.env.KNOWLEDGE_CARD_DISTILL_MODEL || KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
);

const DISTILL_MAX_TOKENS = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_MAX_TOKENS) || 32_768, 4096),
  65_536,
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

/** 多模态（含图 OCR）走 api；纯文本也可走 direct，统一用 api 更稳 */
const EVOLINK_CHAT_URL = String(
  process.env.EVOLINK_CHAT_COMPLETIONS_URL ||
    (process.env.EVOLINK_API_BASE
      ? `${String(process.env.EVOLINK_API_BASE).replace(/\/$/, "")}/v1/chat/completions`
      : "") ||
    "https://api.evolink.ai/v1/chat/completions",
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

/** @deprecated 产品改为一气呵成，不再对外分块提练；测试仍可引用。 */
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

function mapDistillUpstreamError(status: number, body: string): Error {
  const t = String(body || "");
  if (status === 402 || /insufficient|credit|余额|积分不足|quota/i.test(t)) {
    return new Error("提练账户额度不足，请稍后重试或联系管理员");
  }
  if (status === 404 && /guardrail|privacy|data policy|No endpoints/i.test(t)) {
    return new Error("当前提练通道不可用，请改用提练·主力后重试");
  }
  if (status === 429 || /rate.?limit/i.test(t)) {
    return new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  if (status >= 500) {
    return new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  return new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
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

/** Evolink：GPT-5.6 Sol / Qwen3.8 Max（含图 OCR 走 api.evolink.ai）。 */
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

  const res = await fetch(EVOLINK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(
      Math.min(Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_TIMEOUT_MS) || 240_000, 60_000), 480_000),
    ),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.warn(`[knowledgeCardDistill] Evolink ${params.modelName} HTTP ${res.status}: ${raw.slice(0, 400)}`);
    throw mapDistillUpstreamError(res.status, raw);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
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
  const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...getOpenRouterChatHeaders(),
    },
    signal: AbortSignal.timeout(
      Math.min(Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_TIMEOUT_MS) || 240_000, 60_000), 480_000),
    ),
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
  const raw = await res.text();
  if (!res.ok) {
    console.warn(`[knowledgeCardDistill] OpenRouter Kimi HTTP ${res.status}: ${raw.slice(0, 400)}`);
    throw mapDistillUpstreamError(res.status, raw);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
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

export type PrepareKnowledgeCardCopyResult = {
  distilledMarkdown: string;
  skippedDistill: boolean;
  extractionMethods: string[];
  sourceChars: number;
  distillModel: KnowledgeCardDistillModelId | null;
};

/**
 * 合并文本框 + 上传 → **一次** OCR/提练 → 可分页 Markdown。
 * 短贴文且无上传：跳过提练。
 * 不再分块/分批调用模型（用户要求一气呵成）。
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
  // 有上传时：以本次抽文+附图为准做一气呵成提练；文本框旧「生 OCR」不重复灌入（避免 100+ 页原文假分页）
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
    const distilled = await invokeDistillLlm({
      sourceText: mergedRaw,
      imageDataUrls: urls,
      modelName,
      minSections: minSectionsTotal,
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
    if (/过短|未能从文件|请先输入|额度不足|通道不可用|未配置/.test(msg)) {
      throw new Error(msg);
    }
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
}
