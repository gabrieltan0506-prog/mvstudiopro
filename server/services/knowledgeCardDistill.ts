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
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_MAX_TOKENS) || 32_768, 4096),
  65_536,
);

/** 长书分块：每块源文字上限（字符） */
const DISTILL_CHUNK_CHARS = 10_000;

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
  return `你是知识卡片内容主编。任务：把用户提供的文稿/幻灯片抽字/图片 OCR 结果，提练成可直接做「疏朗图文知识卡片」的简体中文 Markdown。

硬性要求：
1. 只保留可发表的知识点：定义、方法、数据、步骤、对比、结论、章节要点；去掉重复段落、口头禅、聊天寒暄、问答客套、广告水词。
2. 结构：以 \`# 总标题\` 开头，下文用若干 \`## 小节\`。每个小节 3–8 条要点短句（约 12–36 字），便于一页一节疏朗排版。
3. **覆盖密度（硬）**：本批素材至少输出 **${minSections}** 个 \`##\` 小节；长书/长文禁止压成两三节总括。宁可多节，禁止把整章揉成一句空话。
4. 页数不人为砍到 12：内容该有多少精华小节就保留多少；禁止注水扩写，也禁止过度摘要。
5. 禁止输出与素材无关的模板标题；禁止「首先其次综上所述」公文腔。
6. 只输出 Markdown 正文，不要 JSON、不要前言后记。`;
}

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

/** 按段落边界切块，避免超长一次提练被模型压扁。 */
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

async function invokeDistillLlm(params: {
  sourceText: string;
  imageDataUrls: string[];
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
  chunkLabel?: string;
}): Promise<string> {
  if (!hasDistillGateway()) {
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  const textBlock = [
    params.chunkLabel
      ? `请提练以下素材（${params.chunkLabel}）为疏朗知识卡片 Markdown；至少 ${params.minSections} 个 ## 小节：`
      : `请提练以下素材为疏朗知识卡片 Markdown；至少 ${params.minSections} 个 ## 小节：`,
    params.sourceText.trim() || "（无纯文本，请主要依据附图 OCR 提练）",
    params.imageDataUrls.length
      ? `\n附图 ${params.imageDataUrls.length} 张：请 OCR 提取文字与图表要点，并入精华，去掉重复。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userContent: MessageContent[] = [{ type: "text", text: textBlock }];
  for (const url of params.imageDataUrls.slice(0, 12)) {
    userContent.push({ type: "image_url", image_url: { url, detail: "high" } });
  }

  const response = await invokeLLM({
    provider: "openai",
    modelName: params.modelName,
    max_tokens: DISTILL_MAX_TOKENS,
    messages: [
      { role: "system", content: buildDistillSystem(params.minSections) },
      { role: "user", content: userContent },
    ],
  });
  const out = extractFirstChoicePlainText(response).trim();
  if (!out || out.length < 20) {
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  return out;
}

function countMarkdownH2(md: string): number {
  return (String(md || "").match(/^##\s+/gm) || []).length;
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

  if (files.length > 0 && !mergedRaw && extracted.imageDataUrls.length === 0) {
    throw new Error("未能从文件抽出文字（扫描版 PDF 请改传可选中文字的 PDF，或上传关键页图片）");
  }

  const urls = extracted.imageDataUrls;
  const sourceChars = mergedRaw.length + urls.length * 500;
  const minSectionsTotal = suggestKnowledgeCardMinSections(Math.max(mergedRaw.length, sourceChars));

  try {
    // 图片分批
    if (urls.length > 12) {
      const chunks: string[] = [];
      const batches = Math.ceil(urls.length / 12);
      for (let i = 0; i < urls.length; i += 12) {
        const batch = urls.slice(i, i + 12);
        const batchIdx = Math.floor(i / 12) + 1;
        const partMin = Math.max(2, Math.ceil(minSectionsTotal / batches));
        const part = await invokeDistillLlm({
          sourceText: i === 0 ? mergedRaw : "（续批图片 OCR，只输出本批新增 ## 小节，勿重复前文）",
          imageDataUrls: batch,
          modelName,
          minSections: partMin,
          chunkLabel: `图片批次 ${batchIdx}/${batches}`,
        });
        chunks.push(part);
      }
      const distilled = chunks.join("\n\n").trim();
      return {
        distilledMarkdown: distilled,
        skippedDistill: false,
        extractionMethods: extracted.methods,
        sourceChars,
        distillModel: modelName,
      };
    }

    const textChunks = splitSourceTextForDistill(mergedRaw);
    if (textChunks.length <= 1) {
      const distilled = await invokeDistillLlm({
        sourceText: mergedRaw,
        imageDataUrls: urls,
        modelName,
        minSections: minSectionsTotal,
      });
      if (mergedRaw.length >= 8000 && distilled.length < Math.min(1200, mergedRaw.length * 0.04)) {
        throw new Error("提练结果过短，疑似过度压缩，请重试或分段上传");
      }
      return {
        distilledMarkdown: distilled,
        skippedDistill: false,
        extractionMethods: extracted.methods,
        sourceChars,
        distillModel: modelName,
      };
    }

    // 长文分块提练后拼接（不再做二次「合并压扁」）
    const parts: string[] = [];
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i]!;
      const partMin = Math.max(
        2,
        Math.ceil((suggestKnowledgeCardMinSections(chunk.length) * minSectionsTotal) / Math.max(minSectionsTotal, 1)),
      );
      const perChunkMin = Math.max(2, Math.min(16, Math.ceil(minSectionsTotal / textChunks.length)));
      const part = await invokeDistillLlm({
        sourceText: chunk,
        imageDataUrls: i === 0 ? urls : [],
        modelName,
        minSections: Math.max(partMin, perChunkMin),
        chunkLabel: `文本块 ${i + 1}/${textChunks.length}`,
      });
      // 去掉后续块的重复 # 总标题，只留 ##
      if (i === 0) parts.push(part);
      else {
        const withoutH1 = part
          .split(/\r?\n/)
          .filter((line, idx) => !(idx < 3 && /^#\s+[^#]/.test(line.trim())))
          .join("\n")
          .trim();
        parts.push(withoutH1 || part);
      }
    }
    const distilled = parts.filter(Boolean).join("\n\n").trim();
    if (countMarkdownH2(distilled) < Math.min(4, minSectionsTotal) && mergedRaw.length >= 2000) {
      console.warn(
        `[knowledgeCardDistill] low H2 count=${countMarkdownH2(distilled)} sourceChars=${mergedRaw.length} minWanted=${minSectionsTotal}`,
      );
    }
    if (mergedRaw.length >= 8000 && distilled.length < Math.min(1200, mergedRaw.length * 0.04)) {
      throw new Error("提练结果过短，疑似过度压缩，请重试或分段上传");
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
    console.warn("[knowledgeCardDistill] failed:", msg.slice(0, 240));
    if (/过短|未能从文件|请先输入/.test(msg)) throw new Error(msg);
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
}
