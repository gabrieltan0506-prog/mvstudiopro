/**
 * 图文知识卡片：上传/长文 → OCR（图）+ 大模型提练精华（去重、去聊天废话）→ Markdown。
 * 提练/OCR 成本含在页费中，本模块不单独扣积分。
 */
import {
  extractFirstChoicePlainText,
  invokeLLM,
  type MessageContent,
} from "../_core/llm.js";
import { shouldSkipKnowledgeCardDistill } from "../../shared/knowledgeCardPagination.js";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  resolveKnowledgeCardDistillModel,
  type KnowledgeCardDistillModelId,
} from "../../shared/knowledgeCardDistillModels.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import { extractDocumentText } from "../growth/documentExtract.js";

export const KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE = "算力紧张，请稍后再试";

/** @deprecated 用 resolveKnowledgeCardDistillModel；保留导出兼容旧测试 */
export const KNOWLEDGE_CARD_DISTILL_MODEL = resolveKnowledgeCardDistillModel(
  process.env.KNOWLEDGE_CARD_DISTILL_MODEL || KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
);

const DISTILL_MAX_TOKENS = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_MAX_TOKENS) || 16_384, 2048),
  65_536,
);

const DISTILL_SYSTEM = `你是知识卡片内容主编。任务：把用户提供的文稿/幻灯片抽字/图片 OCR 结果，提练成可直接做「疏朗图文知识卡片」的简体中文 Markdown。

硬性要求：
1. 只保留精华知识点：定义、方法、数据、步骤、对比、结论；去掉重复段落、口头禅、聊天寒暄、问答客套、广告水词。
2. 结构：以 \`# 总标题\` 开头，下文用若干 \`## 小节\`；每个小节 3–6 条要点短句（约 12–28 字），便于一页一节疏朗排版。
3. 页数不人为砍到 12：内容该有多少精华小节就保留多少；但禁止注水扩写。
4. 禁止输出与素材无关的模板标题；禁止「首先其次综上所述」公文腔。
5. 只输出 Markdown 正文，不要 JSON、不要前言后记。`;

export type KnowledgeCardUploadFile = {
  fileBase64: string;
  mimeType: string;
  fileName?: string;
};

function hasDistillGateway(): boolean {
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
    if (!buffer.length) continue;
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

async function invokeDistillLlm(params: {
  sourceText: string;
  imageDataUrls: string[];
  modelName: KnowledgeCardDistillModelId;
}): Promise<string> {
  if (!hasDistillGateway()) {
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  const textBlock = [
    "请提练以下素材为疏朗知识卡片 Markdown：",
    params.sourceText.trim() || "（无纯文本，请主要依据附图 OCR 提练）",
    params.imageDataUrls.length
      ? `\n附图 ${params.imageDataUrls.length} 张：请 OCR 提取文字与图表要点，并入精华，去掉重复。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userContent: MessageContent[] = [{ type: "text", text: textBlock }];
  // 控制单次视觉负载：最多 12 张（多文件不限上传，分批时由调用方再拼）
  for (const url of params.imageDataUrls.slice(0, 12)) {
    userContent.push({ type: "image_url", image_url: { url, detail: "high" } });
  }

  const response = await invokeLLM({
    provider: "openai",
    modelName: params.modelName,
    max_tokens: DISTILL_MAX_TOKENS,
    messages: [
      { role: "system", content: DISTILL_SYSTEM },
      { role: "user", content: userContent },
    ],
  });
  const out = extractFirstChoicePlainText(response).trim();
  if (!out || out.length < 20) {
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  return out;
}

export type PrepareKnowledgeCardCopyResult = {
  distilledMarkdown: string;
  skippedDistill: boolean;
  extractionMethods: string[];
  sourceChars: number;
  /** 实际用于提练/OCR 的模型（跳过提练时为空） */
  distillModel: KnowledgeCardDistillModelId | null;
};

/**
 * 合并文本框 + 上传 →（必要时）OCR/提练 → 返回可分页 Markdown。
 * 短贴文且无上传：跳过提练。
 */
export async function prepareKnowledgeCardCopy(input: {
  sourceText?: string;
  files?: KnowledgeCardUploadFile[];
  /** 强制提练（例如用户点了「重新提练」） */
  forceDistill?: boolean;
  /** 试对比：qwen/qwen3.8-max | moonshotai/kimi-k3 */
  distillModel?: string;
}): Promise<PrepareKnowledgeCardCopyResult> {
  const modelName = resolveKnowledgeCardDistillModel(input.distillModel);
  const files = Array.isArray(input.files) ? input.files : [];
  const extracted = files.length
    ? await extractKnowledgeCardUploads(files)
    : { documentText: "", imageDataUrls: [] as string[], methods: [] as string[] };

  const pasted = String(input.sourceText || "").trim();
  const mergedRaw = [pasted, extracted.documentText].filter(Boolean).join("\n\n").trim();
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

  // 图片超过 12 张时分批 OCR 提练再合并
  const urls = extracted.imageDataUrls;
  try {
    if (urls.length <= 12) {
      const distilled = await invokeDistillLlm({
        sourceText: mergedRaw,
        imageDataUrls: urls,
        modelName,
      });
      return {
        distilledMarkdown: distilled,
        skippedDistill: false,
        extractionMethods: extracted.methods,
        sourceChars: mergedRaw.length + urls.length * 500,
        distillModel: modelName,
      };
    }

    const chunks: string[] = [];
    for (let i = 0; i < urls.length; i += 12) {
      const batch = urls.slice(i, i + 12);
      const part = await invokeDistillLlm({
        sourceText: i === 0 ? mergedRaw : "（续批图片 OCR，请与前文去重后只输出新增精华小节）",
        imageDataUrls: batch,
        modelName,
      });
      chunks.push(part);
    }
    const merged = chunks.join("\n\n");
    const distilled = await invokeDistillLlm({
      sourceText: `请合并下列分批提练结果，去掉重复，输出最终知识卡片 Markdown：\n\n${merged}`,
      imageDataUrls: [],
      modelName,
    });
    return {
      distilledMarkdown: distilled,
      skippedDistill: false,
      extractionMethods: extracted.methods,
      sourceChars: mergedRaw.length + urls.length * 500,
      distillModel: modelName,
    };
  } catch (err) {
    console.warn(
      "[knowledgeCardDistill] failed:",
      err instanceof Error ? err.message.slice(0, 240) : err,
    );
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
}
