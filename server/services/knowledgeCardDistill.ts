/**
 * 图文知识卡片：上传/长文 → 读文/读图 + 提炼 → Markdown。
 *
 * 2026-09-08 用户拍板：
 * - 两档并列：Evolink GPT-5.6 Sol（精细）/ Evolink Qwen3.8 Max（轻量）；
 *   Sol 失败 → OpenAI 官方同模型；Qwen 失败 → 百炼新加坡套餐同模型。
 * - PDF / EPUB（后台转 PDF）逐页渲染成图随文字一起给模型看，模型在小节末尾标
 *   「〔参考原页 docKey:pNN〕」，出图时按标记取原页图当参考。
 * - 页数、文件大小、附图张数不设上限；长书按页对齐分段提炼再合并。
 *
 * 提炼/读图成本含在页费中，本模块不单独扣积分。
 *
 * @see https://evolink.ai/gpt-5-6
 * @see https://evolink.ai/docs/cn/api-manual/language-series/qwen3.8-max/qwen3.8-max-chat
 */
import { extractFirstChoicePlainText } from "../_core/llm.js";
import { shouldSkipKnowledgeCardDistill } from "../../shared/knowledgeCardPagination.js";
import {
  resolveKnowledgeCardDetailLevel,
  suggestKnowledgeCardMinSections,
  type KnowledgeCardDetailLevel,
} from "../../shared/knowledgeCardDistillSections.js";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
  resolveKnowledgeCardDistillModel,
  type KnowledgeCardDistillModelId,
} from "../../shared/knowledgeCardDistillModels.js";
import {
  getEvolinkApiKey,
  getOfficialOpenAiApiKey,
  OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL,
} from "./gpt56CopywritingGateway.js";
import { extractDocumentText } from "../growth/documentExtract.js";
import {
  formatKnowledgeCardPageRef,
  prepareKnowledgeCardDocumentPages,
  type KnowledgeCardContactSheet,
  type KnowledgeCardDocumentPageSet,
  type KnowledgeCardPageSelection,
} from "./knowledgeCardDocumentPages.js";
import { convertEpubToPdf, isEpubFile } from "./knowledgeCardEpubToPdf.js";

/** 百炼新加坡 Token Plan（Qwen 官方兜底）；与整形链 `plan_sg_qwen` 同一端点与密钥 */
const DASHSCOPE_SG_PLAN_CHAT_URL =
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
export function getDashscopeSgPlanKey(): string {
  return String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim();
}

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
 * 两档分别调参（2026-08-05 实测 FDE PDF 前 25k 字 / 3 段；Kimi 档已下架，数据留作对照）：
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
  // 精细：输出最全但每段慢，段中等 + 分段降中档
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_THRESHOLD", 12_000, 6_000, 40_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_CHARS", 12_000, 4_000, 24_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CONCURRENCY", 2, 1, 4),
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_SOL_EFFORT_CHUNK", "medium"),
    // 0908 用户令：Sol 只开 medium，high/xhigh 太慢
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_SOL_EFFORT_FINAL", "medium"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_SOL_TIMEOUT_MS", 180_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_SOL_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_SOL_MIN_SECTIONS", 3, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_SOL_REFINE_MAX_CHARS", 24_000, 0, 120_000),
    bulletsPerSection: { min: 2, max: 4 },
  },
  // 轻量：单价最低，压缩倾向最强 → 段切小到 8k、抬每段节数下限与节内条数，单次统稿输入压到最小
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: {
    chunkThreshold: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_THRESHOLD", 9_000, 4_000, 40_000),
    chunkChars: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_CHARS", 8_000, 3_000, 20_000),
    concurrency: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CONCURRENCY", 2, 1, 4),
    // 0909 用户令：Qwen 用 high，不上 xhigh（sg 套餐走 enable_thinking，档位只对 EvoLink 兜底生效）
    effortChunk: envStr("KNOWLEDGE_CARD_DISTILL_QWEN_EFFORT_CHUNK", "high"),
    effortFinal: envStr("KNOWLEDGE_CARD_DISTILL_QWEN_EFFORT_FINAL", "high"),
    requestTimeoutMs: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_TIMEOUT_MS", 240_000, 60_000, 480_000),
    chunkRetries: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_CHUNK_RETRIES", 2, 0, 4),
    minSectionsPerChunk: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_MIN_SECTIONS", 5, 2, 24),
    refineMaxChars: envNum("KNOWLEDGE_CARD_DISTILL_QWEN_REFINE_MAX_CHARS", 14_000, 0, 120_000),
    // 轻量档便宜，放宽写满：节内条数比另两档各抬 2 条，别把一节压成三条干标题
    bulletsPerSection: { min: 3, max: 5 },
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
const DISTILL_DEFAULT_BULLETS = { min: 2, max: 4 } as const;

/**
 * 每小节要点条数与举例要求。
 *
 * 条数沿用 2026-06-27 定下的原始口径（详尽充实、宁详勿略、含定义/数字/方法/示例）；
 * 2026-08-05 曾被改成「有限要点 3–5 条 + 多留白」，与「详尽 + 条列 + 举例」相悖，已改回。
 * 区间按提炼档位取（轻量档抬高，避免它把每节压成三条干标题）。
 */
function distillSectionShape(bullets: { min: number; max: number }): string {
  return `每个 \`## 小节\` 内（**先图后文、图重于文**，2026-09-08 用户定案）：
   - 第一行写 \`图：<要画什么>\`——从「分式图解 / 流程链（A→B→C）/ 对比表 / 思维导图 / 指标图标组 / 结构示意」里选一种，写清画面元素与它们的关系（例：\`图：扶阳操五式分式图解，五个人物小图按站桩→抱球→和合→归真→打圈排成一行，各配一句动作要领\`）。这一行是给绘图模型的指令，不是正文。
   - 然后 **${bullets.min}–${bullets.max} 条**要点，**每条 ≤16 字**，是结论不是解释，读一句就懂；数字、步骤、条件放进要点或图里。
   - 该小节涉及方法/流程/判断标准时，其中一条以「例：」开头，≤16 字，引用原文真实例子，不许编造。
   - 小节标题本身就是这一节的结论（≤14 字）。**不要把原文句子换个说法铺开**；多维内容直接写成 Markdown 表格（表头清楚、每格一句短语）。`;
}

function resolveDistillBullets(modelName?: string | null, detailLevel?: KnowledgeCardDetailLevel): { min: number; max: number } {
  const profile = modelName
    ? DISTILL_PROFILES[modelName as KnowledgeCardDistillModelId]
    : undefined;
  const base = profile?.bulletsPerSection ?? DISTILL_DEFAULT_BULLETS;
  // 高级版：内容靠表格/图表压实，要点条数与精简版同档（多出来的信息进表格，不进长列表）
  return base;
}

/** 模型旁白禁令：0908 探针里「第 17 页配对与前文冲突」「材料认为」这类审稿口吻被印上了卡片 */
const DISTILL_NO_META_ZH = `**不要写审稿旁白**：不得出现「材料认为 / 原文提到 / 第 N 页 / 与前文冲突 / 以前文为准 / 本段 / 以上」这类指向原稿或提炼过程的话；直接陈述知识本身。`;

function buildDistillSystem(minSections: number, modelName?: string | null, docKeys?: string[], detailLevel?: KnowledgeCardDetailLevel): string {
  const bullets = resolveDistillBullets(modelName, detailLevel);
  const levelRule = detailLevel === "full"
    ? `\n0. **成稿档：高级版（主要重点 + 次要重点都包含）**：本材料的每个章节、方法、表格/清单都要落进成稿，主要重点和次要重点一并保留，不因「取重点」舍弃次要内容；数字、步骤、条件全部保留。**能表格化的一律表格化**：分类/对比/参数/时辰-经脉-做法这类多维内容写成 Markdown 表格（表头清楚、每格一句短语，不超过 6 列）；步骤/流程写成「A → B → C」一行流程链；同类清单合并成一张表而不是散成多节。表格承载信息量，小节数量不要为了铺开而增加。`
    : "";
  const refRule = docKeys?.length
    ? `\n7. **参考原页标记**：用户会附上原稿中版式有特色的页（表格、思维导图、分式图解、左右对比），每张图前都标了「原稿 docKey 第 N 页」。某小节的内容对应这些页时，在该小节末尾单独一行写标记，格式 \`${docKeys.map((k) => formatKnowledgeCardPageRef(k, [1])).join("\` 或 \`")}\`（docKey 照抄该图前标注的那个，页码写该图标注的真实页码，多页用逗号）。只能引用本次附带的图；没有对应参考页的小节不写标记；不得编造 docKey 或页码。`
    : "";
  return `你是知识卡片内容主编。任务：把用户提供的文稿/幻灯片抽字/图片 OCR 结果，提炼成可直接做「疏朗图文知识卡片」的简体中文 Markdown（读图 OCR 与提炼同时完成，不要只吐生文本）。

**目标**：让没读过原文的人在几分钟内读懂这份材料**讲了什么、关键结论是什么、怎么用**。${detailLevel === "full" ? "是**主要与次要重点全收**：宁多勿漏，用表格压实。" : "是**精华版：只提炼主要重点**，不是逐段搬运。"}

硬性要求：${levelRule}
1. **抓主干**：优先保留核心论点、关键结论、可操作方法、决定性数据与对比、反直觉洞察。删掉铺垫、重复、寒暄、案例复述、广告水词、与主题无关的枝节。
2. 结构：以 \`# 总标题\` 开头（总标题要点出全文主旨，不是书名照抄），下文用 \`## 小节\` 承载重点；小节标题本身就是一句有信息量的判断，不用「概述 / 背景介绍」这类空标题。
3. ${distillSectionShape(bullets)}
4. **篇幅**：约 **${minSections}** 个 \`## 小节\`（可上下浮动 2 个）。宁可少而精，**禁止**为凑数把同一论点拆成多节，也禁止把整本压成两三节总括。
5. **不要**把原文长段落原样倒进输出；**不要**注水扩写；**不要**「首先其次综上所述」公文腔。
6. 只输出 Markdown 正文，不要 JSON、不要前言后记、不要解释你做了什么。
7. ${DISTILL_NO_META_ZH}${refRule.replace("\n7. ", "\n8. ")}`;
}

export type KnowledgeCardUploadFile = {
  /** 前端直传 GCS 后的对象地址（`gs://bucket/object`）；不论大小一律直传，不走 base64（媒体传输铁律） */
  gcsUri: string;
  mimeType: string;
  fileName?: string;
};

/** 主通道 EvoLink 或各档官方兜底任一可用即可发起。 */
function hasDistillGateway(modelName: KnowledgeCardDistillModelId): boolean {
  if (getEvolinkApiKey()) return true;
  return Boolean(officialFallbackKey(modelName));
}

function officialFallbackKey(modelName: KnowledgeCardDistillModelId): string {
  return modelName === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN ? getDashscopeSgPlanKey() : getOfficialOpenAiApiKey();
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
 * 从 GCS 取回直传的文件（文档抽字用；图片不下载，直接签名给模型）。
 * 所有上传不论大小一律前端直传 GCS（0908 用户令；媒体传输铁律禁止 base64 塞请求体）。
 */
async function readGcsUploadBuffer(gcsUri: string): Promise<Buffer> {
  const { signGsUriV4ReadUrl } = await import("./gcs.js");
  const url = await signGsUriV4ReadUrl(gcsUri, 3600);
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`读取上传文件失败（${res.status}）`);
  return Buffer.from(await res.arrayBuffer());
}

export type KnowledgeCardExtractProgress = {
  stage: "converting" | "reading" | "selecting" | "rendering";
  done: number;
  total: number;
  fileName: string;
  /** 第几个文件 / 共几个（0-based），进度折算用，避免多文件时百分比倒退 */
  fileIndex: number;
  fileTotal: number;
};

export type KnowledgeCardExtractResult = {
  documentText: string;
  /** 只含没有逐页备料的文档（docx/pptx/无 userId 的 pdf）；分段时作为「补充文字」，避免与逐页正文重复提炼 */
  nonPageDocumentText: string;
  /** 用户上传图片的签名 https（GCS），喂模型读图 */
  imageUrls: string[];
  methods: string[];
  /** PDF / EPUB 逐页备料（含选中页图）；docx/pptx 只有文字 */
  documents: KnowledgeCardDocumentPageSet[];
};

function isPdfFile(mimeType: string, fileName?: string): boolean {
  return String(mimeType || "").toLowerCase() === "application/pdf" || String(fileName || "").toLowerCase().endsWith(".pdf");
}

/**
 * 抽文档文本 + 原稿逐页备料。
 * - 图片：留给视觉读图，不在此解码为文字；
 * - PDF：逐页文字 + 目录页扫读挑页 + 选中页渲染；
 * - EPUB：后台转 PDF 后同 PDF；
 * - docx/pptx：只抽文字。
 * `selectPages` 不传（或无 userId）时不做逐页备料，退回纯抽字。
 */
export async function extractKnowledgeCardUploads(
  files: KnowledgeCardUploadFile[],
  options: {
    userId?: number;
    selectPages?: (sheets: KnowledgeCardContactSheet[], pageCount: number) => Promise<KnowledgeCardPageSelection[]>;
    onProgress?: (p: KnowledgeCardExtractProgress) => void | Promise<void>;
  } = {},
): Promise<KnowledgeCardExtractResult> {
  const docParts: string[] = [];
  const nonPageParts: string[] = [];
  const imageUrls: string[] = [];
  const methods: string[] = [];
  const documents: KnowledgeCardDocumentPageSet[] = [];
  const pagesEnabled = Boolean(options.selectPages && options.userId && options.userId > 0);
  const fileTotal = files.length;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]!;
    const name = String(file.fileName || "upload");
    const report = (stage: KnowledgeCardExtractProgress["stage"], done: number, total: number) =>
      options.onProgress?.({ stage, done, total, fileName: name, fileIndex, fileTotal });
    const gcsUri = String(file.gcsUri || "").trim();

    if (!gcsUri) {
      methods.push(`${name}:missing_gcs_uri`);
      continue;
    }
    if (isImageFile(file.mimeType, file.fileName)) {
      // 图片走视觉读图：签名 https 直接给模型，不下载不转 base64
      const { signGsUriV4ReadUrl } = await import("./gcs.js");
      imageUrls.push(signGsUriV4ReadUrl(gcsUri, 4 * 3600));
      methods.push(`${name}:image_vision_url`);
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await readGcsUploadBuffer(gcsUri);
      methods.push(`${name}:gcs_direct`);
    } catch (e) {
      methods.push(`${name}:gcs_read_failed`);
      console.warn(`[knowledgeCardDistill] 取回文档失败 ${gcsUri}:`, e);
      continue;
    }
    if (!buffer.length) {
      methods.push(`${name}:empty`);
      continue;
    }

    let pdfBuffer: Buffer | null = null;
    let mimeType = file.mimeType;
    if (isEpubFile(file.mimeType, file.fileName)) {
      await report("converting", 0, 1);
      const converted = await convertEpubToPdf(buffer);
      pdfBuffer = converted.pdf;
      mimeType = "application/pdf";
      methods.push(`${name}:epub_to_pdf(${converted.chapterCount} chapters)`);
      await report("converting", 1, 1);
    } else if (isPdfFile(file.mimeType, file.fileName)) {
      pdfBuffer = buffer;
    }

    if (pdfBuffer && pagesEnabled) {
      const set = await prepareKnowledgeCardDocumentPages({
        buffer: pdfBuffer,
        fileName: name,
        userId: options.userId!,
        selectPages: options.selectPages!,
        onProgress: async (stage, done, total) => {
          const mapped = stage === "text" ? "reading" : stage === "thumbs" ? "reading" : stage === "select" ? "selecting" : "rendering";
          await report(mapped, done, total);
        },
      });
      documents.push(set);
      const text = set.pages.map((pg) => pg.text).filter(Boolean).join("\n\n").trim();
      if (text) {
        docParts.push(`【文件·${name}】\n${text}`);
        methods.push(`${name}:pdf_pages(${set.pageCount}p, ref ${set.selectedPages.length}p)`);
      } else {
        methods.push(`${name}:pdf_pages_no_text`);
      }
      continue;
    }

    const extracted = await extractDocumentText({
      buffer: pdfBuffer || buffer,
      mimeType,
      fileName: pdfBuffer ? `${name}.pdf` : file.fileName,
    });
    if (extracted.text.trim()) {
      const part = `【文件·${name}】\n${extracted.text.trim()}`;
      docParts.push(part);
      nonPageParts.push(part);
      methods.push(`${name}:${extracted.method}`);
    } else {
      methods.push(`${name}:none`);
    }
  }

  return {
    documentText: docParts.join("\n\n").trim(),
    nonPageDocumentText: nonPageParts.join("\n\n").trim(),
    imageUrls,
    methods,
    documents,
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

export type DistillPageImage = { docKey: string; pageNumber: number; url: string; reason?: string };

function buildDistillUserContent(params: {
  sourceText: string;
  imageUrls: string[];
  pageImages?: DistillPageImage[];
  minSections: number;
  /** 本次只提炼整本中的一段（分段模式） */
  chunkLabel?: string;
}): Array<Record<string, unknown>> {
  const pageImages = params.pageImages || [];
  const textBlock = [
    params.chunkLabel
      ? `本次只处理长文档的${params.chunkLabel}。只就本段内容**挑出最值得记住的重点**（约 ${params.minSections} 个 ## 小节），次要枝节可以整段舍弃；不要复述其它章节、不要写「本段/以上」这类过渡语，不要输出未经提炼的长原文：`
      : `请一次性完成：读文/读图 + 提炼。输出疏朗知识卡片 Markdown，约 ${params.minSections} 个 ## 小节，取重点、不要输出未经提炼的长原文：`,
    params.sourceText.trim() || "（无纯文本，请主要依据附图提炼）",
    params.imageUrls.length
      ? `\n附图 ${params.imageUrls.length} 张：请提取文字与图表要点，并入精华，去掉重复。`
      : "",
    pageImages.length
      ? `\n原稿参考页 ${pageImages.length} 张（已标页码）：这些页的版式结构有特色（表格/导图/分式图解/对比）。提炼对应知识点时保留其结构关系（表头与行列、导图分支、步骤顺序、对比两侧），并在对应小节末尾单独一行写 ${formatKnowledgeCardPageRef(pageImages[0]!.docKey, [pageImages[0]!.pageNumber])} 这种标记（页码写真实参考页，可写多页）。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: textBlock }];
  for (const url of params.imageUrls) {
    userContent.push({ type: "image_url", image_url: { url, detail: "high" } });
  }
  for (const page of pageImages) {
    userContent.push({ type: "text", text: `【原稿 ${page.docKey} 第 ${page.pageNumber} 页${page.reason ? `：${page.reason}` : ""}】` });
    userContent.push({ type: "image_url", image_url: { url: page.url, detail: "high" } });
  }
  return userContent;
}

type DistillGateway = "evolink" | "openai_official" | "dashscope_sg";

function gatewayLabel(g: DistillGateway): string {
  return g === "evolink" ? "EvoLink" : g === "openai_official" ? "OpenAI 官方" : "百炼新加坡";
}

/**
 * 单通道一次请求（OpenAI 兼容 chat/completions）。
 * - EvoLink：有图走 api、纯文本走 direct（降 524）；
 * - OpenAI 官方：Sol 兜底，`max_completion_tokens`；
 * - 百炼新加坡 Token Plan：Qwen 兜底，`enable_thinking` + `max_tokens`（compatible-mode 不认 reasoning_effort）。
 */
async function invokeDistillViaGateway(params: {
  gateway: DistillGateway;
  sourceText: string;
  imageUrls: string[];
  pageImages?: DistillPageImage[];
  modelName: typeof KNOWLEDGE_CARD_DISTILL_MODEL_SOL | typeof KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  minSections: number;
  effort: string;
  chunkLabel?: string;
  systemOverride?: string;
  timeoutMs?: number;
  docKeys?: string[];
  detailLevel?: KnowledgeCardDetailLevel;
}): Promise<string> {
  const userContent = buildDistillUserContent(params);
  const hasImages = params.imageUrls.length > 0 || (params.pageImages?.length ?? 0) > 0;
  const body: Record<string, unknown> = {
    model: params.modelName,
    messages: [
      {
        role: "system",
        content: params.systemOverride || buildDistillSystem(params.minSections, params.modelName, params.docKeys, params.detailLevel),
      },
      { role: "user", content: userContent },
    ],
  };
  let url: string;
  let key: string;
  if (params.gateway === "evolink") {
    key = getEvolinkApiKey();
    url = hasImages ? EVOLINK_CHAT_URL : EVOLINK_DIRECT_CHAT_URL;
    if (params.modelName === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) {
      // Evolink Qwen：档位只认 low|medium|xhigh（无 high/max）；用户令不上 xhigh，high 映射为 medium
      body.enable_thinking = true;
      body.reasoning_effort = params.effort === "high" || params.effort === "max" ? "medium" : params.effort;
      body.max_completion_tokens = DISTILL_MAX_TOKENS;
    } else {
      body.reasoning_effort = params.effort;
      body.max_tokens = DISTILL_MAX_TOKENS;
    }
  } else if (params.gateway === "openai_official") {
    key = getOfficialOpenAiApiKey();
    url = OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL;
    body.reasoning_effort = params.effort;
    body.max_completion_tokens = DISTILL_MAX_TOKENS;
  } else {
    key = getDashscopeSgPlanKey();
    url = DASHSCOPE_SG_PLAN_CHAT_URL;
    body.enable_thinking = true;
    body.max_tokens = DISTILL_MAX_TOKENS;
  }
  if (!key) throw new Error(`提炼通道未配置（${gatewayLabel(params.gateway)}），请稍后重试`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(distillFetchTimeoutMs(params.modelName, params.timeoutMs)),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw mapFetchAbortError(err);
  }
  const raw = await res.text();
  if (!res.ok) {
    console.warn(
      `[knowledgeCardDistill] ${gatewayLabel(params.gateway)} ${params.modelName} HTTP ${res.status}: ${raw.slice(0, 400)}`,
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
  const finish = String(
    (json as { choices?: Array<{ finish_reason?: string | null }> })?.choices?.[0]?.finish_reason || "",
  );
  // 截断不当成功：半截稿会顺利通过下游长度检查并照常收费
  if (finish === "length" || finish === "max_tokens") throw new Error(KNOWLEDGE_CARD_DISTILL_TIMEOUT_MESSAGE);
  const out = extractFirstChoicePlainText(json as Parameters<typeof extractFirstChoicePlainText>[0]).trim();
  if (!out || out.length < 20) {
    throw new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
  }
  return out;
}

/**
 * 各档通道顺序（0909 用户拍板）：
 * - Sol：EvoLink 主 → OpenAI 官方兜底
 * - Qwen3.8 Max：百炼新加坡 token plan 主 → EvoLink 兜底
 */
export function distillGatewayChain(modelName: KnowledgeCardDistillModelId): DistillGateway[] {
  const chain: DistillGateway[] = [];
  if (modelName === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) {
    if (getDashscopeSgPlanKey()) chain.push("dashscope_sg");
    if (getEvolinkApiKey()) chain.push("evolink");
    return chain;
  }
  if (getEvolinkApiKey()) chain.push("evolink");
  if (getOfficialOpenAiApiKey()) chain.push("openai_official");
  return chain;
}

/** 测试可注入的单通道执行器 */
let distillGatewayInvoker = invokeDistillViaGateway;
export function __setKnowledgeCardDistillGatewayInvokerForTest(
  fn: typeof invokeDistillViaGateway | null,
): void {
  distillGatewayInvoker = fn || invokeDistillViaGateway;
}

async function invokeDistillLlm(params: {
  sourceText: string;
  imageUrls: string[];
  pageImages?: DistillPageImage[];
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
  effort: string;
  chunkLabel?: string;
  systemOverride?: string;
  timeoutMs?: number;
  docKeys?: string[];
  detailLevel?: KnowledgeCardDetailLevel;
}): Promise<string> {
  const chain = distillGatewayChain(params.modelName);
  if (!chain.length) throw new Error("提炼通道未配置，请稍后重试");
  let lastError: Error | null = null;
  for (let i = 0; i < chain.length; i++) {
    const gateway = chain[i]!;
    try {
      return await distillGatewayInvoker({ ...params, gateway, modelName: params.modelName });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 额度/配置/安全拒答等确定性失败不换通道（换了也一样，还可能双花）
      if (isFatalDistillError(lastError.message) && !/未配置/.test(lastError.message)) throw lastError;
      if (i < chain.length - 1) {
        console.warn(
          `[knowledgeCardDistill] ${gatewayLabel(gateway)} 失败 → 改走 ${gatewayLabel(chain[i + 1]!)}：${lastError.message.slice(0, 160)}`,
        );
      }
    }
  }
  throw lastError || new Error(KNOWLEDGE_CARD_DISTILL_CAPACITY_MESSAGE);
}

/** 提炼无法靠重试救回的错（额度/配置/通道），不必再退避。 */
function isFatalDistillError(message: string): boolean {
  // 401/403/安全拒答/未配置是确定性失败：重试+递归细切只会放大请求量
  return /额度不足|通道不可用|未配置|请先输入|未能从文件|HTTP 40[13]|安全分类器拒答/.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 单段提炼：失败退避重试，仍失败则把该段对半细切分别提再拼。
 * 用户口径：个别失败的重新提炼，然后合并写框（不接受半途整批废）。
 */
async function distillOneChunkWithRetry(params: {
  chunk: string;
  imageUrls: string[];
  pageImages?: DistillPageImage[];
  modelName: KnowledgeCardDistillModelId;
  minSections: number;
  chunkLabel: string;
  retries: number;
  effort: string;
  docKeys?: string[];
  detailLevel?: KnowledgeCardDetailLevel;
}): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= params.retries; attempt++) {
    try {
      return await invokeDistillLlm({
        sourceText: params.chunk,
        imageUrls: params.imageUrls,
        pageImages: params.pageImages,
        modelName: params.modelName,
        minSections: params.minSections,
        effort: params.effort,
        chunkLabel: params.chunkLabel,
        docKeys: params.docKeys,
        detailLevel: params.detailLevel,
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
            imageUrls: i === 0 ? params.imageUrls : [],
            pageImages: i === 0 ? params.pageImages : [],
            modelName: params.modelName,
            minSections: Math.max(2, Math.ceil(params.minSections / halves.length)),
            chunkLabel: `${params.chunkLabel}-${i + 1}`,
            retries: 1,
            effort: params.effort,
            // 只有带图的那一半才给标记规则
            docKeys: i === 0 && params.pageImages?.length ? params.docKeys : [],
            detailLevel: params.detailLevel,
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
  detailLevel?: KnowledgeCardDetailLevel,
): string {
  const bullets = resolveDistillBullets(modelName, detailLevel);
  if (detailLevel === "full" && stage !== "tighten") {
    // 高级版：只去重、理主线，不压缩（0908 探针 79 节被压到 60 节、字数少四成，用户判「比纯文字还少」）
    return `你是知识卡片内容主编。下面这份 Markdown 由同一份长文档**分段提炼后机械拼接**而成，段与段之间可能重复、粒度不齐、缺少全局主线。请把它整理成一份连贯的**完整版**知识卡片 Markdown。

硬性要求：
1. **不压缩**：这是高级版，内容要完整。只合并**讲同一件事**的重复小节，其余小节全部保留；合并后总节数不少于 ${Math.max(2, Math.floor((currentSections || minSections) * 0.9))} 个 \`## 小节\`（当前 ${currentSections || "?"} 个）。
2. **不删要点，但要压实**：每节的要点、数字、步骤、条件、例子一条不少；合并小节时把两边要点合在一起，不挑选。能表格化的一律改成 Markdown 表格（分类/对比/参数/时辰-经脉-做法等多维内容），步骤写成「A → B → C」流程链，同类清单并成一张表；用表格承载而不是拉长列表。
3. **理主线**：\`# 总标题\` 点出主旨，小节按「是什么 → 为什么 → 怎么做 → 边界与例外」之类的自然顺序重排，读下来是一条线。
4. ${distillSectionShape(bullets)}
5. 去掉分段痕迹：「本段 / 以上 / 续上」这类过渡语、重复标题、空节。${DISTILL_NO_META_ZH}
6. 已有的「〔参考原页 …〕」标记随所属小节保留（合并小节时把页码合到一行），不要新造、不要丢。
7. 只输出 Markdown 正文，不要前言后记、不要解释取舍过程。`;
  }
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
5. 已有的「〔参考原页 …〕」标记随所属小节保留（合并小节时把页码合到一行），不要新造、不要丢。
6. 只输出 Markdown 正文，不要前言后记、不要解释你删了什么。`;
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
5. 去掉分段痕迹：「本段 / 以上 / 续上」这类过渡语、重复标题、空节。${DISTILL_NO_META_ZH}
6. 已有的「〔参考原页 …〕」标记随所属小节保留（合并小节时把页码合到一行），不要新造、不要丢。
7. 只输出 Markdown 正文，不要前言后记、不要解释取舍过程。`;
}

/** 统稿要求大幅精选，只在「结构崩塌」时才回退输入稿。 */
function refinedOutputLooksBroken(refined: string, minSections: number, inputSections?: number): boolean {
  const body = refined.trim();
  if (body.length < 400) return true;
  const sections = (body.match(/^##\s+\S/gm) || []).length;
  // 高级版目标节数大（68–96），阈值同时受输入稿节数约束，正常压缩不会被误判为崩塌
  const byTarget = Math.floor(minSections / 2);
  const byInput = Number.isFinite(inputSections) && (inputSections as number) > 0 ? Math.floor((inputSections as number) * 0.3) : byTarget;
  return sections < Math.max(2, Math.min(byTarget, byInput));
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
  detailLevel?: KnowledgeCardDetailLevel;
}): Promise<string> {
  const profile = DISTILL_PROFILES[params.modelName];
  try {
    const refined = await invokeDistillLlm({
      sourceText: params.body,
      imageUrls: [],
      modelName: params.modelName,
      minSections: params.minSections,
      // 只有定全局主线的 final 值得顶档；分组压缩与收紧节数用分段档，否则又撞超时
      effort: params.stage === "final" ? profile.effortFinal : profile.effortChunk,
      systemOverride: buildRefineSystem(
        params.minSections,
        params.stage,
        countMarkdownSections(params.body),
        params.modelName,
        params.detailLevel,
      ),
      timeoutMs: distillRefineTimeoutMs(params.modelName),
    });
    if (refinedOutputLooksBroken(refined, params.minSections, countMarkdownSections(params.body))) {
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
  detailLevel?: KnowledgeCardDetailLevel;
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
            detailLevel: params.detailLevel,
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
    // 高级版：目标节数不低于合并稿节数（统稿不压缩）
    minSections: params.detailLevel === "full" ? Math.max(params.minSections, countMarkdownSections(current)) : params.minSections,
    stage: "final",
    detailLevel: params.detailLevel,
  });
  // 有些模型一次统稿只肯降一点（探针：Kimi 36 → 41 节）。超标就再压，压不动即停，不空烧。
  // 高级版要的是完整覆盖，不做收紧轮（统稿只负责去重复、理主线）
  const hardCap = params.detailLevel === "full" ? Number.MAX_SAFE_INTEGER : Math.ceil(params.minSections * 1.35);
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
      detailLevel: params.detailLevel,
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

type DistillChunk = { text: string; pageImages: DistillPageImage[]; label: string };

/**
 * 按页对齐分段：同一段里的文字与被选中的参考页图来自同一段页码，
 * 模型看得到图的同时也看得到该页文字，才能写出准确的「参考原页」标记。
 */
/** 单个请求最多挂几张参考页图（图多字少的书不把整本页图塞进一个请求） */
export const DISTILL_MAX_PAGE_IMAGES_PER_CALL = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_DISTILL_MAX_PAGE_IMAGES) || 8, 2),
  24,
);

export function buildPageAlignedChunks(
  documents: KnowledgeCardDocumentPageSet[],
  extraText: string,
  chunkChars: number,
  maxImagesPerChunk: number = DISTILL_MAX_PAGE_IMAGES_PER_CALL,
): DistillChunk[] {
  const chunks: DistillChunk[] = [];
  let current: { parts: string[]; chars: number; images: DistillPageImage[]; from: string } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.parts.join("\n\n").trim();
    if (text || current.images.length) chunks.push({ text, pageImages: current.images, label: current.from });
    current = null;
  };
  for (const doc of documents) {
    for (const page of doc.pages) {
      const text = page.text ? `【${doc.fileName} 第 ${page.pageNumber} 页】\n${page.text}` : "";
      const overflowByChars = current && current.chars + text.length > chunkChars && (current.chars > 0 || current.images.length);
      const overflowByImages = current && page.imageUrl && current.images.length >= maxImagesPerChunk;
      if (overflowByChars || overflowByImages) flush();
      if (!current) current = { parts: [], chars: 0, images: [], from: `${doc.fileName} p${page.pageNumber}` };
      if (text) {
        current.parts.push(text);
        current.chars += text.length;
      }
      if (page.imageUrl) {
        current.images.push({ docKey: doc.docKey, pageNumber: page.pageNumber, url: page.imageUrl, reason: page.reason });
      }
    }
    flush();
  }
  const extra = String(extraText || "").trim();
  if (extra) {
    for (const piece of splitSourceTextForDistill(extra, chunkChars)) chunks.push({ text: piece, pageImages: [], label: "补充文字" });
  }
  return chunks;
}

/** 短文一次直出（顶档）；长文按模型 profile 分段（中档）→ 合并 → 顶档统稿。 */
async function invokeDistillLlmPossiblyChunked(params: {
  sourceText: string;
  /** 逐页文档之外的文字（docx/pptx 抽字 + 用户贴的文本）；有逐页文档时只把它当补充段，不与逐页正文重复 */
  extraText: string;
  imageUrls: string[];
  documents: KnowledgeCardDocumentPageSet[];
  modelName: KnowledgeCardDistillModelId;
  minSectionsTotal: number;
  detailLevel: KnowledgeCardDetailLevel;
  onProgress?: (p: KnowledgeCardDistillProgress) => void | Promise<void>;
}): Promise<string> {
  const profile = DISTILL_PROFILES[params.modelName];
  const text = String(params.sourceText || "").trim();
  const urls = params.imageUrls;
  const allPageImages: DistillPageImage[] = params.documents.flatMap((d) =>
    d.pages.filter((p) => p.imageUrl).map((p) => ({ docKey: d.docKey, pageNumber: p.pageNumber, url: p.imageUrl!, reason: p.reason })),
  );

  // 短文单发；但参考页图超过单请求上限时仍走分段，避免整本页图塞进一个请求
  if ((!text || text.length <= profile.chunkThreshold) && allPageImages.length <= DISTILL_MAX_PAGE_IMAGES_PER_CALL) {
    return invokeDistillLlm({
      sourceText: text,
      imageUrls: urls,
      pageImages: allPageImages,
      modelName: params.modelName,
      minSections: params.minSectionsTotal,
      effort: profile.effortFinal,
      docKeys: allPageImages.length ? Array.from(new Set(allPageImages.map((p) => p.docKey))) : [],
      detailLevel: params.detailLevel,
    });
  }

  // 有逐页备料的文档按页对齐分段（补充文字单独成段，不与逐页正文重复）；否则按字数切
  const pageDocs = params.documents.filter((d) => d.pages.length);
  const chunks: DistillChunk[] = pageDocs.length
    ? buildPageAlignedChunks(pageDocs, params.extraText, profile.chunkChars)
    : splitSourceTextForDistill(text, profile.chunkChars).map((piece, i) => ({ text: piece, pageImages: [], label: `第 ${i + 1} 段` }));
  console.info(
    `[knowledgeCardDistill] long doc ${text.length} chars → ${chunks.length} chunks ` +
      `(model=${params.modelName} chunkChars=${profile.chunkChars} concurrency=${profile.concurrency} effort=${profile.effortChunk} level=${params.detailLevel} refPages=${allPageImages.length} docs=${params.documents.length})`,
  );

  const outputs: string[] = new Array(chunks.length);
  // 分段只是给统稿备料：按总目标节数分摊 + 六成冗余留出取舍空间（高级版不留冗余，全部保留）
  const minSectionsPerChunk = Math.max(
    profile.minSectionsPerChunk,
    Math.ceil((params.minSectionsTotal * (params.detailLevel === "full" ? 1.1 : 1.6)) / chunks.length),
  );
  let done = 0;
  await params.onProgress?.({ doneChunks: 0, totalChunks: chunks.length, phase: "distilling" });

  for (let i = 0; i < chunks.length; i += profile.concurrency) {
    const batchIdx = chunks.slice(i, i + profile.concurrency).map((_, j) => i + j);
    await Promise.all(
      batchIdx.map(async (idx) => {
        const chunk = chunks[idx]!;
        outputs[idx] = await distillOneChunkWithRetry({
          chunk: chunk.text,
          // 用户附图只挂第一段；原稿参考页跟随所在段
          imageUrls: idx === 0 ? urls : [],
          pageImages: chunk.pageImages,
          modelName: params.modelName,
          minSections: minSectionsPerChunk,
          chunkLabel: `第 ${idx + 1}/${chunks.length} 段（${chunk.label}）`,
          retries: profile.chunkRetries,
          effort: profile.effortChunk,
          // 只有带参考页图的段才下发标记规则，没图的段不给模型编标记的口子
          docKeys: chunk.pageImages.length ? Array.from(new Set(chunk.pageImages.map((p) => p.docKey))) : [],
          detailLevel: params.detailLevel,
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
    detailLevel: params.detailLevel,
  });
}

export type PrepareKnowledgeCardCopyResult = {
  distilledMarkdown: string;
  skippedDistill: boolean;
  extractionMethods: string[];
  sourceChars: number;
  distillModel: KnowledgeCardDistillModelId | null;
  detailLevel: KnowledgeCardDetailLevel;
  /** 逐页备料摘要（不含图数据） */
  documents: Array<{ docKey: string; fileName: string; pageCount: number; selectedPages: number[] }>;
};

/** 目录页扫读回包 */
type PageTriageResponse = { pages: Array<{ page: number; reason?: string }> };

function buildPageTriageSystem(): string {
  return `你是知识卡片视觉主编。用户给你一本书按页缩略的目录页（每格左上角红标是页码 pN）。
任务：挑出**版式结构有特色、清晰、值得在知识卡片里重画**的页：表格、思维导图/树状图、分步图解（动作/流程分式）、左右对比、时间轴、流程图、带标注的示意图。
不要挑：纯大段文字页、封面/版权/目录/章节扉页、只有装饰插画没有知识结构的页、重复版式（同一种版式只挑最清楚的一两页）。
数量按内容定，通常占全书 3%–12%；没有就返回空数组。
只输出 JSON：{"pages":[{"page":41,"reason":"分式动作图解，两栏图文"},...]}，page 必须是目录页里真实出现的页码。`;
}

function parsePageTriage(raw: string): KnowledgeCardPageSelection[] {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as PageTriageResponse;
    return (Array.isArray(parsed.pages) ? parsed.pages : [])
      .map((item) => ({ pageNumber: Math.floor(Number(item?.page)), reason: typeof item?.reason === "string" ? item.reason.slice(0, 80) : undefined }))
      .filter((item) => Number.isInteger(item.pageNumber) && item.pageNumber > 0);
  } catch {
    return [];
  }
}

/** 每次扫读最多几张目录页（12 格/张 → 约 96 页一发） */
const TRIAGE_SHEETS_PER_CALL = 8;

/**
 * 目录页扫读挑页：用所选档位模型看缩略图目录，返回值得参考的页码。
 * 扫读失败不阻断整体提炼（退回无参考页）。
 */
export function makeKnowledgeCardPageSelector(modelName: KnowledgeCardDistillModelId) {
  return async (sheets: KnowledgeCardContactSheet[], pageCount: number): Promise<KnowledgeCardPageSelection[]> => {
    const picked: KnowledgeCardPageSelection[] = [];
    for (let i = 0; i < sheets.length; i += TRIAGE_SHEETS_PER_CALL) {
      const group = sheets.slice(i, i + TRIAGE_SHEETS_PER_CALL);
      const pageNumbers = group.flatMap((sheet) => sheet.pageNumbers);
      try {
        const raw = await invokeDistillLlm({
          sourceText: `全书共 ${pageCount} 页；本次目录页覆盖第 ${pageNumbers[0]}–${pageNumbers[pageNumbers.length - 1]} 页（共 ${group.length} 张目录页）。`,
          imageUrls: group.map((sheet) => sheet.imageUrl),
          modelName,
          minSections: 1,
          effort: envStr("KNOWLEDGE_CARD_PAGE_TRIAGE_EFFORT", "low"),
          systemOverride: buildPageTriageSystem(),
          timeoutMs: 180_000,
        });
        const allowed = new Set(pageNumbers);
        for (const item of parsePageTriage(raw)) if (allowed.has(item.pageNumber)) picked.push(item);
      } catch (err) {
        console.warn(`[knowledgeCardDistill] 目录页扫读失败（第 ${i + 1} 组），本组不选参考页：${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
      }
    }
    return picked;
  };
}

/**
 * 合并文本框 + 上传 → 读文/读图 + 提炼 → 可分页 Markdown。
 * 短贴文且无上传：跳过提炼。
 * 长书（>~12k 字）后台分段提炼再合并；产品面仍是一次上传自动写框。
 */
export async function prepareKnowledgeCardCopy(input: {
  sourceText?: string;
  files?: KnowledgeCardUploadFile[];
  forceDistill?: boolean;
  distillModel?: string;
  detailLevel?: string;
  /** 有 userId 才做原稿逐页备料（页图按用户前缀落 GCS） */
  userId?: number;
  /** 已备好的逐页资料（后台任务里先抽好再传进来，避免重复渲染） */
  extracted?: KnowledgeCardExtractResult;
  onProgress?: (p: KnowledgeCardDistillProgress) => void | Promise<void>;
  onExtractProgress?: (p: KnowledgeCardExtractProgress) => void | Promise<void>;
}): Promise<PrepareKnowledgeCardCopyResult> {
  const modelName = resolveKnowledgeCardDistillModel(input.distillModel);
  const detailLevel = resolveKnowledgeCardDetailLevel(input.detailLevel);
  const files = Array.isArray(input.files) ? input.files : [];
  const extracted: KnowledgeCardExtractResult =
    input.extracted ??
    (files.length
      ? await extractKnowledgeCardUploads(files, {
          userId: input.userId,
          selectPages: input.userId ? makeKnowledgeCardPageSelector(modelName) : undefined,
          onProgress: input.onExtractProgress,
        })
      : { documentText: "", nonPageDocumentText: "", imageUrls: [], methods: [], documents: [] });

  const pasted = String(input.sourceText || "").trim();
  // 有上传时：以本次抽文+附图为准；文本框旧「生 OCR」不重复灌入（避免 100+ 页原文假分页）
  const hasUploads = files.length > 0 || extracted.documents.length > 0 || extracted.imageUrls.length > 0 || Boolean(extracted.documentText);
  const mergedRaw = hasUploads
    ? [extracted.documentText, pasted.length <= 3200 ? pasted : ""].filter(Boolean).join("\n\n").trim() ||
      extracted.documentText ||
      pasted
    : pasted;
  const skip =
    !input.forceDistill &&
    shouldSkipKnowledgeCardDistill(mergedRaw, hasUploads) &&
    extracted.imageUrls.length === 0;
  const documentsSummary = extracted.documents.map((d) => ({ docKey: d.docKey, fileName: d.fileName, pageCount: d.pageCount, selectedPages: d.selectedPages }));

  if (skip) {
    return {
      distilledMarkdown: mergedRaw,
      skippedDistill: true,
      extractionMethods: extracted.methods,
      sourceChars: mergedRaw.length,
      distillModel: null,
      detailLevel,
      documents: documentsSummary,
    };
  }

  if (!mergedRaw && extracted.imageUrls.length === 0) {
    throw new Error("请先输入文案或上传文件/图片");
  }

  if (hasUploads && !mergedRaw && extracted.imageUrls.length === 0) {
    throw new Error("未能从文件抽出文字（扫描版 PDF 请改传可选中文字的 PDF，或上传关键页图片）");
  }

  const urls = extracted.imageUrls;
  const sourceChars = mergedRaw.length + urls.length * 500;
  const minSectionsTotal = suggestKnowledgeCardMinSections(Math.max(mergedRaw.length, sourceChars), detailLevel);

  try {
    const distilled = await invokeDistillLlmPossiblyChunked({
      sourceText: mergedRaw,
      extraText: [extracted.nonPageDocumentText, pasted.length <= 3200 ? pasted : ""].filter(Boolean).join("\n\n").trim(),
      imageUrls: urls,
      documents: extracted.documents,
      modelName,
      minSectionsTotal,
      detailLevel,
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
      detailLevel,
      documents: documentsSummary,
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
