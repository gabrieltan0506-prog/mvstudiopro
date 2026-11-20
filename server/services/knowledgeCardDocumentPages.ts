/**
 * 知识卡·原稿逐页备料（2026-09-08 用户要求第 8 条）：
 * 模型除了读文字，还要看原稿每一页的版式（图解、导图、表格），并在成稿里标出
 * 「参考原页」；出图时再把对应原页图作为参考喂给 gpt-image-2。
 *
 * 做法：
 * - `pdftotext` 一次拿到整本按页分隔（\f）的文字；
 * - `pdftoppm` 按页渲染成约 1000px 宽 JPEG（模型看版式够用，不烧大图）；
 * - 每页图上传 GCS（`knowledge-card-distill/pages/u{userId}/{docKey}/p-NNN.jpg`），
 *   出图阶段按「参考原页」标记签名取回；
 * - 不做「哪些页值得看」的启发式筛选：全书每页都给模型看，页数不设上限。
 *
 * 需要 poppler-utils（Fly 镜像已装）。
 */
import type { KnowledgeRouteEvidence } from "./knowledgePublicationRoutes";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { awaitKnowledgeCardAbort, execKnowledgeCardFile as execFileAsync } from "./knowledgeCardCancellation.js";

/** 选中页渲染宽度：横向 1000px 足以看清表格/导图结构 */
const PAGE_RENDER_WIDTH = Math.min(
  Math.max(Number(process.env.KNOWLEDGE_CARD_PAGE_RENDER_WIDTH) || 1000, 600),
  1600,
);
/** 目录页（contact sheet）单格宽度与每张目录页格数 */
const THUMB_WIDTH = 360;
const SHEET_COLS = 4;
const SHEET_ROWS = 3;
export const KNOWLEDGE_CARD_SHEET_CELLS = SHEET_COLS * SHEET_ROWS;
/** 缩略图分批渲染页数（4 张目录页一批） */
const THUMB_BATCH_PAGES = KNOWLEDGE_CARD_SHEET_CELLS * 4;
const PAGE_UPLOAD_CONCURRENCY = 6;
/**
 * 目录页提速（2026-11-19）：一次 pdftoppm 渲染一整组挑页（8 张目录页 = 96 页，与挑页一组对齐），最多 3 个进程并行；
 * 拼图走有界池；上传 7 路并行且不在渲染循环里逐张等待；进度最多每 5 秒回报一次。
 * 每页缩略图与逐张渲染逐字节相同（pdftoppm 按页独立栅格化，实测核对过），拼图输入与对象名不变。
 */
const THUMB_RENDER_SHEETS_PER_BATCH = 8;
const THUMB_RENDER_CONCURRENCY = 3;
const SHEET_MONTAGE_CONCURRENCY = 3;
const SHEET_UPLOAD_CONCURRENCY = 7;
/** 已渲染未上传的目录页上限：上传慢时渲染等一等，整本缩略图不驻留内存 */
const SHEET_PENDING_MAX = 48;
const THUMB_PROGRESS_THROTTLE_MS = 5_000;
/** 逐页文字：缺失的 48 页断点组合并成至多 4 段并行 pdftotext；断点后台写入 */
const TEXT_EXTRACT_CONCURRENCY = 4;
const TEXT_CHECKPOINT_CONCURRENCY = 8;

/** 有界并发：首个失败后不再领新活，等在途收尾后抛首个错误。 */
async function runKnowledgeCardPool<T>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { await fn(items[index]!, index); } catch (error) { if (!failed) { failed = true; firstError = error; } }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw firstError;
}

/** 信号量：释放时把名额直接交给排队者，并发上限不会被插队突破。 */
function createKnowledgeCardLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    else active += 1;
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

export type KnowledgeCardDocumentPage = {
  /** 1-based PDF 页码 */
  pageNumber: number;
  text: string;
  /** 只有被选为「值得参考」的页才有图：GCS 对象 + 签名 https（喂模型/出图参考），不走 base64 */
  imageUrl?: string;
  imageGcsUri?: string;
  /** 目录页扫读给出的选中理由 */
  reason?: string;
  /**
   * 0926 扫描版 OCR：没有文字层的页渲染成图只用来**读字**（与上面的参考页图严格分开：
   * 不写〔参考原页〕标记、出图不拿来重画），存在单独的 ocr/ 目录。已是参考页的扫描页不重复渲染。
   */
  ocrImageUrl?: string;
  ocrImageGcsUri?: string;
};

export type KnowledgeCardDocumentPageSet = {
  /** 文档身份：sha256(原件) 前 16 位；写进「参考原页」标记，出图时据此定位页图 */
  docKey: string;
  fileName: string;
  pageCount: number;
  pages: KnowledgeCardDocumentPage[];
  /** 被选中渲染的页码（升序） */
  selectedPages: number[];
};

/** 一张目录页：12 格缩略图，格内左上角印页码；已上传 GCS，模型读签名 https */
export type KnowledgeCardContactSheet = {
  index: number;
  pageNumbers: number[];
  imageUrl: string;
  gcsUri: string;
};

export type KnowledgeCardPageSelection = { pageNumber: number; reason?: string };

/**
 * 挑页流式入口（2026-11-19）：每凑齐一组目录页就开扫，不等全书目录页。
 * `add` 的 position 是目录页在全书中的 0 基序号（= index - 1）。
 */
export type KnowledgeCardPageSelectionStream = {
  add: (position: number, sheet: KnowledgeCardContactSheet) => void;
  /** 全部目录页已 add 后调用：等所有组收尾，返回与整本一次扫读同序的结果 */
  finish: () => Promise<KnowledgeCardPageSelection[]>;
  /** 目录页准备失败时调用：不再派发新组，等在途组收尾（成功组照常进缓存），不抛错 */
  abandon: () => Promise<void>;
  /** 挑页已遇到不可容错的失败（取消、安全拒绝、缓存读写失败）时返回该错误，渲染端据此提前收口 */
  failure: () => unknown;
};
export type KnowledgeCardPageSelectFn = (
  sheets: KnowledgeCardContactSheet[],
  pageCount: number,
  /** 每扫完一组目录页回报一次——用户要求每一步都有百分比 */
  onProgress?: (doneSheets: number, totalSheets: number) => void | Promise<void>,
) => Promise<KnowledgeCardPageSelection[]>;
export type KnowledgeCardPageSelector = KnowledgeCardPageSelectFn & {
  stream?: (
    pageCount: number,
    totalSheets: number,
    onProgress: (doneSheets: number, totalSheets: number) => void | Promise<void>,
    identities: Pick<KnowledgeCardContactSheet, "gcsUri" | "pageNumbers">[],
  ) => KnowledgeCardPageSelectionStream | Promise<KnowledgeCardPageSelectionStream | KnowledgeCardPageSelection[]>;
};

export function knowledgeCardDocumentKey(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/**
 * EPUB 转出的 PDF 的原稿身份：Chromium 每次打印都写入当次 CreationDate/ModDate，pdfunite 合并另写随机 /ID，
 * 同一本 EPUB 两次转换字节不同（2026-11-14 实测），按字节哈希会让页图、参考页与已付费分段全部换身份。
 * 只抹掉这三项元数据再哈希；版面、字体、图片任何实质变化仍得到新身份。前缀 e 与直接上传的 PDF 身份区分。
 */
export function knowledgeCardConvertedPdfKey(pdf: Buffer): string {
  const normalized = pdf.toString("latin1")
    .replace(/\/(CreationDate|ModDate)\s*\((?:\\.|[^\\)])*\)/g, "/$1()")
    .replace(/\/ID\s*\[\s*(?:<[0-9A-Fa-f]*>|\((?:\\.|[^\\)])*\))\s*(?:<[0-9A-Fa-f]*>|\((?:\\.|[^\\)])*\))\s*\]/g, "/ID[]");
  return `e${createHash("sha256").update(normalized, "latin1").digest("hex").slice(0, 15)}`;
}

export function knowledgeCardPageObjectName(userId: number, docKey: string, pageNumber: number): string {
  return `knowledge-card-distill/pages/u${userId}/${docKey}/p-${String(pageNumber).padStart(3, "0")}.jpg`;
}
/** 扫描版读字用的页图：与参考页分目录，参考页解析永远找不到它 */
export function knowledgeCardOcrPageObjectName(userId: number, docKey: string, pageNumber: number): string {
  return `knowledge-card-distill/pages/u${userId}/${docKey}/ocr/p-${String(pageNumber).padStart(3, "0")}.jpg`;
}

/** 这一页有没有文字层：扫描页 pdftotext 抽出来是空的 */
export function isKnowledgeCardScannedPage(page: Pick<KnowledgeCardDocumentPage, "text">): boolean {
  return !String(page.text || "").replace(/\s+/g, "");
}

/** 扫描页按连续页码成批渲染，一批不超过一次读图请求的页数（0926 用户定 8 页） */
export const KNOWLEDGE_CARD_OCR_RENDER_BATCH = 8;

export function knowledgeCardSheetObjectName(userId: number, docKey: string, sheetIndex: number): string {
  return `knowledge-card-distill/sheets/u${userId}/${docKey}/s-${String(sheetIndex).padStart(3, "0")}.jpg`;
}
/** 签名读链有效期：目录页扫读 + 分段提炼 + 统稿可能跑一两小时 */
const PAGE_URL_TTL_SECONDS = 4 * 3600;

/** `pdftotext` 输出按 \f 分页；末尾多一个 \f 需去掉。 */
export function splitPdfTextByPage(raw: string): string[] {
  const parts = String(raw || "").split("\f");
  if (parts.length && !parts[parts.length - 1]!.trim()) parts.pop();
  return parts.map((p) => p.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-pages-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function pdfPageCount(filePath: string, signal?: AbortSignal): Promise<number> {
  const { stdout } = await execFileAsync("pdfinfo", [filePath], { maxBuffer: 4 * 1024 * 1024, signal });
  const m = /^Pages:\s+(\d+)/m.exec(stdout);
  const n = m ? Number(m[1]) : 0;
  if (!Number.isFinite(n) || n <= 0) throw new Error("无法读取 PDF 页数");
  return n;
}

async function renderPdfPagesToJpeg(pdfPath: string, outDir: string, prefix: string, width: number, range?: { first: number; last: number }, signal?: AbortSignal): Promise<Map<number, Buffer>> {
  const args = ["-jpeg", "-jpegopt", "quality=78", "-scale-to-x", String(width), "-scale-to-y", "-1"];
  if (range) args.push("-f", String(range.first), "-l", String(range.last));
  args.push(pdfPath, path.join(outDir, prefix));
  await execFileAsync("pdftoppm", args, { maxBuffer: 16 * 1024 * 1024, signal });
  const out = new Map<number, Buffer>();
  for (const file of await fs.readdir(outDir)) {
    const m = new RegExp(`^${prefix}-(\\d+)\\.jpg$`).exec(file);
    if (!m) continue;
    out.set(Number(m[1]), await fs.readFile(path.join(outDir, file)));
    await fs.unlink(path.join(outDir, file)).catch(() => undefined);
  }
  return out;
}

/** 把缩略图按 4×3 拼成目录页，每格左上角印页码，供模型扫读挑页。 */
export async function buildContactSheets(thumbs: Map<number, Buffer>, indexOffset = 0): Promise<Array<{ index: number; pageNumbers: number[]; jpeg: Buffer }>> {
  const sharp = (await import("sharp")).default;
  const numbers = Array.from(thumbs.keys()).sort((a, b) => a - b);
  const sheets: Array<{ index: number; pageNumbers: number[]; jpeg: Buffer }> = [];
  const cellW = THUMB_WIDTH;
  for (let i = 0; i < numbers.length; i += KNOWLEDGE_CARD_SHEET_CELLS) {
    const group = numbers.slice(i, i + KNOWLEDGE_CARD_SHEET_CELLS);
    const metas = await Promise.all(group.map((n) => sharp(thumbs.get(n)!).metadata()));
    const cellH = Math.max(...metas.map((m) => Math.round(((m.height || 1) * cellW) / (m.width || 1))), 120);
    const pad = 8;
    const width = SHEET_COLS * (cellW + pad) + pad;
    const height = SHEET_ROWS * (cellH + pad) + pad;
    const composites: Array<{ input: Buffer; left: number; top: number }> = [];
    for (let j = 0; j < group.length; j++) {
      const n = group[j]!;
      const left = pad + (j % SHEET_COLS) * (cellW + pad);
      const top = pad + Math.floor(j / SHEET_COLS) * (cellH + pad);
      const cell = await sharp(thumbs.get(n)!).resize({ width: cellW, height: cellH, fit: "contain", background: "#ffffff" }).toBuffer();
      composites.push({ input: cell, left, top });
      const label = Buffer.from(
        `<svg width="96" height="34"><rect width="96" height="34" rx="6" fill="#d7263d"/><text x="48" y="24" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">p${n}</text></svg>`,
      );
      // 页码标签放左下角，不压住页眉标题
      composites.push({ input: label, left: left + 6, top: top + cellH - 34 - 6 });
    }
    const jpeg = await sharp({ create: { width, height, channels: 3, background: "#e9e9e9" } })
      .composite(composites)
      .jpeg({ quality: 80 })
      .toBuffer();
    sheets.push({ index: indexOffset + sheets.length + 1, pageNumbers: group, jpeg });
  }
  return sheets;
}

/**
 * 逐页备料：
 * 1. `pdftotext` 一次拿到整本按页分隔的文字；
 * 2. 全书低清缩略图拼目录页 → `selectPages`（模型扫读）挑出结构有特色的页；
 * 3. 只把选中页渲染成清晰图并上传 GCS。
 * `onProgress` 回报阶段与已处理数。页图上传失败不吞：出图阶段要靠它。
 */
export async function prepareKnowledgeCardDocumentPages(params: {
  buffer: Buffer;
  /** 原稿身份；不传按 PDF 字节哈希（EPUB 转出的 PDF 传 knowledgeCardConvertedPdfKey） */
  docKey?: string;
  fileName: string;
  userId: number;
  abortSignal?: AbortSignal;
  /** 带 `stream` 的挑页器会在每凑齐一组目录页时提前开扫（见 KnowledgeCardPageSelector） */
  selectPages: KnowledgeCardPageSelector;
  onProgress?: (stage: "text" | "thumbs" | "select" | "render", done: number, total: number) => void | Promise<void>;
  /**
   * 原文一读出就交给顾问：后台执行，不阻塞缩略图、选页与参考图渲染；备料末尾统一等待，
   * 失败则整次备料报错（不会报成功），错误不会成为未处理的 rejection。
   */
  onTextReady?: (document: KnowledgeCardDocumentPageSet) => Promise<void>;
  /** 测试注入：不传则真实上传 GCS 并返回 { gcsUri, url(签名 https) } */
  textCache?: KnowledgeRouteEvidence;
  existingSheets?: (prefix: string) => Promise<ReadonlyMap<string, { gcsUri: string; url: string }>>;
  uploadPage?: (objectName: string, jpeg: Buffer) => Promise<{ gcsUri: string; url: string }>;
  /** 测试注入：缩略图进度节流间隔（缺省 5 秒） */
  progressThrottleMs?: number;
}): Promise<KnowledgeCardDocumentPageSet> {
  params.abortSignal?.throwIfAborted();
  const docKey = params.docKey || knowledgeCardDocumentKey(params.buffer);
  const uploadPage =
    params.uploadPage ||
    (async (objectName: string, jpeg: Buffer) => {
      const { uploadBufferToGcsIfAbsent, getGcsBucketName, signGsUriV4ReadUrl } = await import("./gcs.js");
      // 同一原件重复上传时对象已存在（ifGenerationMatch=0 冲突），按已存在处理
      await uploadBufferToGcsIfAbsent({ objectName, buffer: jpeg, contentType: "image/jpeg", signal: params.abortSignal });
      const gcsUri = `gs://${getGcsBucketName()}/${objectName}`;
      return { gcsUri, url: signGsUriV4ReadUrl(gcsUri, PAGE_URL_TTL_SECONDS) };
    });

  return withTempDir(async (dir) => {
    const pdfPath = path.join(dir, "source.pdf");
    await fs.writeFile(pdfPath, params.buffer);
    const total = await pdfPageCount(pdfPath, params.abortSignal);

    // 进度回调串行交付：并行阶段也按调用顺序逐个回报，回调抛错（如取消）照样传给调用处
    let progressChain: Promise<void> = Promise.resolve();
    const report = (stage: "text" | "thumbs" | "select" | "render", done: number, all: number): Promise<void> => {
      const run = progressChain.then(() => params.onProgress?.(stage, done, all));
      progressChain = run.then(() => undefined, () => undefined);
      return run.then(() => undefined);
    };
    // 后台任务：文字断点写入与顾问原文写入。末尾统一等待；主流程失败时也先等它们收尾再抛
    const background: Promise<void>[] = [];
    const track = (task: Promise<void>) => { task.catch(() => undefined); background.push(task); return task; };
    let textReadyTask: Promise<void> | undefined;
    try {
      const result = await prepareDocumentPagesInDir(dir, pdfPath, total);
      await Promise.all(background);
      await textReadyTask;
      params.abortSignal?.throwIfAborted();
      return result;
    } catch (error) {
      await Promise.allSettled([...background, ...(textReadyTask ? [textReadyTask] : [])]);
      throw error;
    }

    async function extractTextRange(first: number, last: number): Promise<string[]> {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", "-f", String(first), "-l", String(last), pdfPath, "-"], {
        maxBuffer: 256 * 1024 * 1024, signal: params.abortSignal,
      });
      return splitPdfTextByPage(stdout);
    }

    async function readPageTexts(): Promise<string[]> {
      await report("text", 0, total);
      if (!params.textCache) {
        // 非手册（无断点存储）：整本一次抽取，与以前相同
        const extracted = await extractTextRange(1, total);
        if (extracted.length !== total) throw new Error(`原稿文字页数不符：1–${total}`);
        await report("text", total, total);
        return extracted;
      }
      const cache = params.textCache;
      // 断点键与以前完全一致：48 页一组 `page-text-v1/{docKey}/{total}-{first}-{last}.json`
      const groups: Array<{ first: number; last: number; key: string }> = [];
      for (let first = 1; first <= total; first += THUMB_BATCH_PAGES) {
        const last = Math.min(total, first + THUMB_BATCH_PAGES - 1);
        groups.push({ first, last, key: `${cache.prefix}/page-text-v1/${docKey}/${total}-${first}-${last}.json` });
      }
      const texts: Array<string[] | undefined> = new Array(groups.length);
      await runKnowledgeCardPool(groups, 16, async (group, i) => {
        params.abortSignal?.throwIfAborted();
        const saved: unknown = await cache.read(group.key).catch(() => {
          params.abortSignal?.throwIfAborted();
          console.warn("[knowledgeCard] 文字断点不可读，本批从原稿提取", group.first, group.last);
          return null;
        });
        if (Array.isArray(saved) && saved.length === group.last - group.first + 1 && saved.every((t) => typeof t === "string")) texts[i] = saved as string[];
      });
      let donePages = groups.reduce((n, g, i) => n + (texts[i] ? g.last - g.first + 1 : 0), 0);
      if (donePages) await report("text", donePages, total);

      // 缺失的组按连续段合并，切成至多 4 段并行抽取；每页文字与逐组抽取逐字相同（pdftotext 按页独立输出，已用真实 PDF 核对）
      const missing = groups.map((_, i) => i).filter((i) => !texts[i]);
      const perRange = Math.max(1, Math.ceil(missing.length / TEXT_EXTRACT_CONCURRENCY));
      const ranges: number[][] = [];
      for (const i of missing) {
        const current = ranges[ranges.length - 1];
        if (current && current.length < perRange && current[current.length - 1] === i - 1) current.push(i);
        else ranges.push([i]);
      }
      const saveCheckpoint = createKnowledgeCardLimiter(TEXT_CHECKPOINT_CONCURRENCY);
      const extractGroup = async (i: number): Promise<string[]> => {
        const group = groups[i]!;
        const extracted = await extractTextRange(group.first, group.last);
        if (extracted.length !== group.last - group.first + 1) throw new Error(`原稿文字页数不符：${group.first}–${group.last}`);
        return extracted;
      };
      await runKnowledgeCardPool(ranges, TEXT_EXTRACT_CONCURRENCY, async (range) => {
        params.abortSignal?.throwIfAborted();
        const first = groups[range[0]!]!.first;
        const last = groups[range[range.length - 1]!]!.last;
        let byGroup: string[][];
        const whole = range.length > 1 ? await extractTextRange(first, last) : undefined;
        if (whole && whole.length === last - first + 1) {
          byGroup = range.map((i) => whole.slice(groups[i]!.first - first, groups[i]!.last - first + 1));
        } else {
          // 整段分页数对不上（极少见）：退回逐组抽取，保持与以前完全相同的文字与报错
          if (whole) console.warn("[knowledgeCard] 整段抽取页数不符，退回逐组抽取", first, last);
          byGroup = [];
          for (const i of range) byGroup.push(await extractGroup(i));
        }
        range.forEach((i, k) => {
          const extracted = byGroup[k]!;
          texts[i] = extracted;
          const group = groups[i]!;
          // 断点后台写入：写失败只告警（与以前相同，本次继续用已提取文字）；取消照样上抛
          track(saveCheckpoint(() => cache.save(group.key, extracted)).catch(() => {
            params.abortSignal?.throwIfAborted();
            console.warn("[knowledgeCard] 文字断点保存失败，本批继续使用已提取文字", group.first, group.last);
          }));
        });
        donePages += last - first + 1;
        await report("text", donePages, total);
      });
      return texts.flatMap((t) => t!);
    }

    async function prepareDocumentPagesInDir(dir: string, pdfPath: string, total: number): Promise<KnowledgeCardDocumentPageSet> {
    const pages: KnowledgeCardDocumentPage[] = (await readPageTexts()).map((text, i) => ({ pageNumber: i + 1, text }));
    let textReadyFailure: { error: unknown } | undefined;

    if (params.onTextReady) {
      const onTextReady = params.onTextReady;
      const document: KnowledgeCardDocumentPageSet = { docKey, fileName: params.fileName, pageCount: total, pages: pages.map((p) => ({ ...p })), selectedPages: [] };
      textReadyTask = Promise.resolve().then(() => onTextReady(document));
      // 原文写入一失败（如原读档内容已改变）就收口：不再渲染目录页、不再开扫挑页，免得为注定失败的备料付模型费
      textReadyTask.catch((error) => { textReadyFailure ??= { error }; });
    }

    await report("thumbs", 0, total);
    // 分批渲染缩略图并即拼即弃，千页书也不把整本缩略图驻留内存
    const sheetCount = Math.ceil(total / KNOWLEDGE_CARD_SHEET_CELLS);
    const sheetRange = (index: number) => {
      const first = (index - 1) * KNOWLEDGE_CARD_SHEET_CELLS + 1;
      return { first, last: Math.min(total, first + KNOWLEDGE_CARD_SHEET_CELLS - 1) };
    };
    const sheets: KnowledgeCardContactSheet[] = new Array(sheetCount);
    const sheetPrefix = `knowledge-card-distill/sheets/u${params.userId}/${docKey}/`;
    const existing = await params.existingSheets?.(sheetPrefix).catch(() => {
      params.abortSignal?.throwIfAborted();
      console.warn("[knowledgeCard] 已存目录图列表暂时不可读，从原稿准备目录图");
      return undefined;
    });
    const missing: number[] = [];
    for (let index = 1; index <= sheetCount; index++) {
      const cached = existing?.get(knowledgeCardSheetObjectName(params.userId, docKey, index));
      const { first, last } = sheetRange(index);
      if (cached) sheets[index - 1] = { index, pageNumbers: Array.from({ length: last - first + 1 }, (_, i) => first + i), imageUrl: cached.url, gcsUri: cached.gcsUri };
      else missing.push(index);
    }

    // 挑页进度：目录页阶段结束前只记最新值，进入挑页阶段再回报，阶段不来回跳
    let selectLive = false;
    let pendingSelect: [number, number] | undefined;
    const selectProgress = async (doneSheets: number, totalSheets: number) => {
      const done = Math.min(doneSheets, totalSheets);
      if (!selectLive) { pendingSelect = [done, totalSheets]; return; }
      await report("select", done, totalSheets);
    };
    // 全部目录页都已存在（续做/旧书）时不必流式：整本一次交给挑页器，旧版整本挑页缓存照常命中
    // 目录图列表暂时不可读时不流式：可能是已扫完的旧书，流式会先把每组重扫（付费）再在末尾被 v1 整本缓存覆盖
    const listUnreadable = Boolean(params.existingSheets) && !existing;
    let stream: KnowledgeCardPageSelectionStream | undefined;
    let savedSelection: KnowledgeCardPageSelection[] | undefined;
    if (missing.length && !listUnreadable && params.selectPages.stream) {
      // 缩略图对象名和页号由原稿决定，补图之前就能检查整本旧回执。
      const { getGcsBucketName } = await import("./gcs.js");
      const bucket = getGcsBucketName();
      const identities = Array.from({ length: sheetCount }, (_, i) => {
        const { first, last } = sheetRange(i + 1);
        return {
          gcsUri: sheets[i]?.gcsUri ?? `gs://${bucket}/${knowledgeCardSheetObjectName(params.userId, docKey, i + 1)}`,
          pageNumbers: Array.from({ length: last - first + 1 }, (_, offset) => first + offset),
        };
      });
      const started = await params.selectPages.stream(total, sheetCount, selectProgress, identities);
      if (Array.isArray(started)) savedSelection = started;
      else stream = started;
    }
    if (stream) sheets.forEach((sheet, position) => { if (sheet) stream.add(position, sheet); });

    let readyPages = sheets.reduce((n, sheet) => n + (sheet ? sheet.pageNumbers.length : 0), 0);
    let lastThumbReport = Date.now();
    const throttleMs = params.progressThrottleMs ?? THUMB_PROGRESS_THROTTLE_MS;
    const montage = createKnowledgeCardLimiter(SHEET_MONTAGE_CONCURRENCY);
    const upload = createKnowledgeCardLimiter(SHEET_UPLOAD_CONCURRENCY);
    let pendingSheets = 0;
    let pendingWaiters: Array<() => void> = [];
    const wakeAll = () => { const waiters = pendingWaiters; pendingWaiters = []; for (const wake of waiters) wake(); };
    let failed = false;
    let firstFailure: unknown;
    const fail = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } wakeAll(); };
    const sheetTasks: Promise<void>[] = [];
    // 同一组挑页内连续缺失的目录页一次渲染（≤8 张 = 96 页）
    const batches: number[][] = [];
    for (const index of missing) {
      const current = batches[batches.length - 1];
      const tail = current?.[current.length - 1];
      if (current && tail === index - 1 && current.length < THUMB_RENDER_SHEETS_PER_BATCH
        && Math.floor((tail - 1) / THUMB_RENDER_SHEETS_PER_BATCH) === Math.floor((index - 1) / THUMB_RENDER_SHEETS_PER_BATCH)) current.push(index);
      else batches.push([index]);
    }
    const renderBatch = async (batch: number[]) => {
      while (!failed && pendingSheets >= SHEET_PENDING_MAX) await new Promise<void>((resolve) => pendingWaiters.push(resolve));
      if (failed) return;
      params.abortSignal?.throwIfAborted();
      const triageFailure = stream?.failure();
      if (triageFailure) throw triageFailure;
      if (textReadyFailure) throw textReadyFailure.error;
      const first = sheetRange(batch[0]!).first;
      const last = sheetRange(batch[batch.length - 1]!).last;
      // 每批独立子目录：并行的 pdftoppm 输出互不混读
      const batchDir = await fs.mkdtemp(path.join(dir, "t"));
      let thumbs: Map<number, Buffer>;
      try {
        thumbs = await renderPdfPagesToJpeg(pdfPath, batchDir, `t${first}`, THUMB_WIDTH, { first, last }, params.abortSignal);
      } finally {
        await fs.rm(batchDir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (thumbs.size !== last - first + 1) throw new Error(`原稿缩略图页数不符：${first}–${last}`);
      for (const index of batch) {
        const range = sheetRange(index);
        const subset = new Map<number, Buffer>();
        for (let n = range.first; n <= range.last; n++) {
          const jpeg = thumbs.get(n);
          if (!jpeg) throw new Error(`原稿缩略图页数不符：${range.first}–${range.last}`);
          subset.set(n, jpeg);
        }
        pendingSheets += 1;
        const task = (async () => {
          try {
            const [sheet] = await montage(() => awaitKnowledgeCardAbort(buildContactSheets(subset, index - 1), params.abortSignal));
            const uploaded = await upload(() => awaitKnowledgeCardAbort(uploadPage(knowledgeCardSheetObjectName(params.userId, docKey, index), sheet!.jpeg), params.abortSignal));
            const ready: KnowledgeCardContactSheet = { index, pageNumbers: sheet!.pageNumbers, imageUrl: uploaded.url, gcsUri: uploaded.gcsUri };
            sheets[index - 1] = ready;
            stream?.add(index - 1, ready);
            readyPages += ready.pageNumbers.length;
            if (Date.now() - lastThumbReport >= throttleMs) {
              lastThumbReport = Date.now();
              await report("thumbs", readyPages, total);
            }
          } finally {
            pendingSheets -= 1;
            pendingWaiters.shift()?.();
          }
        })();
        task.catch(fail);
        sheetTasks.push(task);
      }
    };
    await runKnowledgeCardPool(batches, THUMB_RENDER_CONCURRENCY, async (batch) => {
      try { await renderBatch(batch); } catch (error) { fail(error); throw error; }
    }).catch(() => undefined);
    await Promise.allSettled(sheetTasks);
    if (failed) {
      // 已上传的目录页留在原处（对象名不变），续做时列表命中、不再渲染
      await stream?.abandon();
      throw firstFailure;
    }
    if (sheets.some((sheet) => !sheet)) throw new Error("原稿目录页未全部就绪");
    await report("thumbs", total, total);

    if (textReadyFailure) { await stream?.abandon(); throw textReadyFailure.error; }
    await report("select", 0, sheets.length);
    selectLive = true;
    if (pendingSelect) await report("select", pendingSelect[0], pendingSelect[1]);
    params.abortSignal?.throwIfAborted();
    const picked = savedSelection ?? (stream ? await stream.finish() : await params.selectPages(sheets, total, selectProgress));
    const selectedMap = new Map<number, string | undefined>();
    params.abortSignal?.throwIfAborted();
    for (const item of picked) {
      const n = Math.floor(Number(item.pageNumber));
      if (Number.isInteger(n) && n >= 1 && n <= total && !selectedMap.has(n)) selectedMap.set(n, item.reason);
    }
    const selectedPages = Array.from(selectedMap.keys()).sort((a, b) => a - b);
    await params.onProgress?.("select", sheets.length, sheets.length);

    // 扫描页（无文字层、且不是参考页）要渲染成读字用的图；进度与参考页渲染合算，不倒退
    const scannedPages = pages.filter((p) => isKnowledgeCardScannedPage(p) && !selectedMap.has(p.pageNumber)).map((p) => p.pageNumber);
    const renderTotal = selectedPages.length + scannedPages.length;
    await params.onProgress?.("render", 0, renderTotal);
    let done = 0;
    for (let i = 0; i < selectedPages.length; i += PAGE_UPLOAD_CONCURRENCY) {
      params.abortSignal?.throwIfAborted();
      const batch = selectedPages.slice(i, i + PAGE_UPLOAD_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (pageNumber) => {
          const rendered = await renderPdfPagesToJpeg(pdfPath, dir, `r${pageNumber}`, PAGE_RENDER_WIDTH, { first: pageNumber, last: pageNumber }, params.abortSignal);
          const jpeg = rendered.get(pageNumber) ?? Array.from(rendered.values())[0];
          if (!jpeg) throw new Error(`原稿第 ${pageNumber} 页渲染失败`);
          params.abortSignal?.throwIfAborted();
          const uploaded = await awaitKnowledgeCardAbort(uploadPage(knowledgeCardPageObjectName(params.userId, docKey, pageNumber), jpeg), params.abortSignal);
          const page = pages[pageNumber - 1]!;
          page.imageUrl = uploaded.url;
          page.imageGcsUri = uploaded.gcsUri;
          page.reason = selectedMap.get(pageNumber);
          done += 1;
        }),
      );
      params.abortSignal?.throwIfAborted();
      for (const result of batchResults) if (result.status === "rejected") throw result.reason;
      await params.onProgress?.("render", done, renderTotal);
    }

    // 扫描页读字图：按连续页码一批最多 8 页渲染，渲完即传即弃，整本不驻留内存
    for (let i = 0; i < scannedPages.length; ) {
      params.abortSignal?.throwIfAborted();
      const first = scannedPages[i]!;
      let last = first;
      while (i + 1 < scannedPages.length && scannedPages[i + 1] === last + 1 && last - first + 1 < KNOWLEDGE_CARD_OCR_RENDER_BATCH) {
        i += 1;
        last = scannedPages[i]!;
      }
      i += 1;
      const rendered = await renderPdfPagesToJpeg(pdfPath, dir, `o${first}`, PAGE_RENDER_WIDTH, { first, last }, params.abortSignal);
      const runPages = Array.from({ length: last - first + 1 }, (_, k) => first + k);
      for (let j = 0; j < runPages.length; j += PAGE_UPLOAD_CONCURRENCY) {
        const batch = runPages.slice(j, j + PAGE_UPLOAD_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (pageNumber) => {
            const jpeg = rendered.get(pageNumber);
            if (!jpeg) throw new Error(`原稿第 ${pageNumber} 页（扫描页）渲染失败`);
            const uploaded = await awaitKnowledgeCardAbort(uploadPage(knowledgeCardOcrPageObjectName(params.userId, docKey, pageNumber), jpeg), params.abortSignal);
            const page = pages[pageNumber - 1]!;
            page.ocrImageUrl = uploaded.url;
            page.ocrImageGcsUri = uploaded.gcsUri;
            done += 1;
          }),
        );
        params.abortSignal?.throwIfAborted();
        for (const result of results) if (result.status === "rejected") throw result.reason;
      }
      await params.onProgress?.("render", done, renderTotal);
    }
    params.abortSignal?.throwIfAborted();
    return { docKey, fileName: params.fileName, pageCount: total, pages, selectedPages };
    }
  });
}

import { KNOWLEDGE_CARD_PAGE_REF_PATTERN, stripKnowledgeCardPageRefs } from "../../shared/knowledgeCardPageRefs.js";
export { KNOWLEDGE_CARD_PAGE_REF_PATTERN, stripKnowledgeCardPageRefs };

export type KnowledgeCardPageRef = { docKey: string; pageNumber: number };

export function parseKnowledgeCardPageRefs(text: string): KnowledgeCardPageRef[] {
  const out: KnowledgeCardPageRef[] = [];
  const seen = new Set<string>();
  for (const m of Array.from(String(text || "").matchAll(KNOWLEDGE_CARD_PAGE_REF_PATTERN))) {
    const docKey = m[1]!;
    for (const token of m[2]!.split(/[,，、]/)) {
      const n = Number(token.trim().replace(/^p/, ""));
      if (!Number.isInteger(n) || n <= 0) continue;
      const key = `${docKey}:${n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ docKey, pageNumber: n });
    }
  }
  return out;
}

export function formatKnowledgeCardPageRef(docKey: string, pageNumbers: number[]): string {
  return `〔参考原页 ${docKey}:${pageNumbers.map((n) => `p${n}`).join(",")}〕`;
}

/**
 * 出图阶段：从本页正文切片里解析「参考原页」标记，只认当前用户前缀下确实存在的页图，
 * 签名成可直接抓取的 https 供 gpt-image-2 当参考。最多 `limit` 张（按标记出现顺序）。
 */
export async function resolveKnowledgeCardReferencePageUrls(params: {
  userId: number;
  /** 本页切片（只用它解析标记）；传了 fullMarkdown 则改按小节归属收集，抗分页切断 */
  pageText: string;
  fullMarkdown?: string;
  limit?: number;
  /** 测试注入：返回签名 URL 或 null（对象不存在） */
  signIfExists?: (objectName: string) => Promise<string | null>;
}): Promise<Array<{ docKey: string; pageNumber: number; url: string }>> {
  const limit = Math.max(0, Math.min(16, Math.floor(params.limit ?? 4)));
  const refs = (params.fullMarkdown
    ? collectKnowledgeCardPageRefsForSlice(params.fullMarkdown, params.pageText)
    : parseKnowledgeCardPageRefs(params.pageText)).slice(0, limit);
  if (!refs.length) return [];
  const signIfExists =
    params.signIfExists ||
    (async (objectName: string) => {
      const { getGcsBucketName, signGsUriV4ReadUrl } = await import("./gcs.js");
      const url = signGsUriV4ReadUrl(`gs://${getGcsBucketName()}/${objectName}`, 3600);
      try {
        // V4 签名绑定 GET 动词，HEAD 会 SignatureDoesNotMatch；用 GET + Range 只取 1 字节判存在
        const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(5_000) });
        await res.arrayBuffer().catch(() => undefined);
        return res.status === 200 || res.status === 206 ? url : null;
      } catch {
        return null;
      }
    });
  // 并行探测（同步 HTTP 段内调用，最坏一次 5s）
  const signed = await Promise.all(refs.map((ref) => signIfExists(knowledgeCardPageObjectName(params.userId, ref.docKey, ref.pageNumber))));
  const out: Array<{ docKey: string; pageNumber: number; url: string }> = [];
  refs.forEach((ref, i) => { if (signed[i]) out.push({ ...ref, url: signed[i]! }); });
  return out;
}

/**
 * 按**小节归属**收集本页切片的参考页：标记写在小节末尾，但分页回退（按字数硬切）可能把标记
 * 切到相邻页，所以不看标记落在哪页，而看「这一节的正文有没有出现在本页切片里」。
 * 判定：小节标题行出现在切片，或该节任一 ≥12 字的正文行出现在切片。
 */
export function collectKnowledgeCardPageRefsForSlice(fullMarkdown: string, slice: string): KnowledgeCardPageRef[] {
  const full = String(fullMarkdown || "");
  const target = String(slice || "");
  if (!full.trim() || !target.trim()) return [];
  const lines = full.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((l, i) => { if (/^##\s+\S/.test(l.trim())) starts.push(i); });
  const blocks: string[] = [];
  if (starts.length === 0) blocks.push(full);
  else {
    if (lines.slice(0, starts[0]).join("\n").trim()) blocks.push(lines.slice(0, starts[0]).join("\n"));
    starts.forEach((start, idx) => blocks.push(lines.slice(start, idx + 1 < starts.length ? starts[idx + 1] : lines.length).join("\n")));
  }
  const normalize = (v: string) => v.replace(/\s+/g, "");
  const targetNorm = normalize(target);
  const out: KnowledgeCardPageRef[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const refs = parseKnowledgeCardPageRefs(block);
    if (!refs.length) continue;
    const bodyLines = stripKnowledgeCardPageRefs(block).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const heading = bodyLines.find((l) => /^##\s+\S/.test(l));
    const probes = [heading, ...bodyLines.filter((l) => !/^#/.test(l) && l.length >= 12)].filter((v): v is string => Boolean(v));
    const hit = probes.some((line) => targetNorm.includes(normalize(line)));
    if (!hit) continue;
    for (const ref of refs) {
      const key = `${ref.docKey}:${ref.pageNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}
