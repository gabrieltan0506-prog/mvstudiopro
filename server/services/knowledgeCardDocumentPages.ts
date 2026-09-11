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

export type KnowledgeCardDocumentPage = {
  /** 1-based PDF 页码 */
  pageNumber: number;
  text: string;
  /** 只有被选为「值得参考」的页才有图：GCS 对象 + 签名 https（喂模型/出图参考），不走 base64 */
  imageUrl?: string;
  imageGcsUri?: string;
  /** 目录页扫读给出的选中理由 */
  reason?: string;
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

export function knowledgeCardDocumentKey(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

export function knowledgeCardPageObjectName(userId: number, docKey: string, pageNumber: number): string {
  return `knowledge-card-distill/pages/u${userId}/${docKey}/p-${String(pageNumber).padStart(3, "0")}.jpg`;
}
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
  fileName: string;
  userId: number;
  abortSignal?: AbortSignal;
  selectPages: (
    sheets: KnowledgeCardContactSheet[],
    pageCount: number,
    /** 每扫完一组目录页回报一次——用户要求每一步都有百分比 */
    onProgress?: (doneSheets: number, totalSheets: number) => void | Promise<void>,
  ) => Promise<KnowledgeCardPageSelection[]>;
  onProgress?: (stage: "text" | "thumbs" | "select" | "render", done: number, total: number) => void | Promise<void>;
  /** 测试注入：不传则真实上传 GCS 并返回 { gcsUri, url(签名 https) } */
  uploadPage?: (objectName: string, jpeg: Buffer) => Promise<{ gcsUri: string; url: string }>;
}): Promise<KnowledgeCardDocumentPageSet> {
  params.abortSignal?.throwIfAborted();
  const docKey = knowledgeCardDocumentKey(params.buffer);
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

    await params.onProgress?.("text", 0, total);
    const { stdout: textRaw } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
      maxBuffer: 256 * 1024 * 1024,
      signal: params.abortSignal,
    });
    const texts = splitPdfTextByPage(textRaw);
    const pages: KnowledgeCardDocumentPage[] = Array.from({ length: total }, (_, i) => ({ pageNumber: i + 1, text: texts[i] || "" }));

    await params.onProgress?.("thumbs", 0, total);
    // 分批渲染缩略图并即拼即弃，千页书也不把整本缩略图驻留内存
    const sheets: KnowledgeCardContactSheet[] = [];
    let thumbsDone = 0;
    for (let first = 1; first <= total; first += THUMB_BATCH_PAGES) {
      params.abortSignal?.throwIfAborted();
      const last = Math.min(total, first + THUMB_BATCH_PAGES - 1);
      const thumbs = await renderPdfPagesToJpeg(pdfPath, dir, `t${first}`, THUMB_WIDTH, { first, last }, params.abortSignal);
      if (thumbs.size !== last - first + 1) throw new Error(`原稿缩略图页数不符：第 ${first}–${last} 页应 ${last - first + 1} 页，实得 ${thumbs.size} 页`);
      for (const sheet of await awaitKnowledgeCardAbort(buildContactSheets(thumbs, sheets.length), params.abortSignal)) {
        params.abortSignal?.throwIfAborted();
        const uploaded = await awaitKnowledgeCardAbort(uploadPage(knowledgeCardSheetObjectName(params.userId, docKey, sheet.index), sheet.jpeg), params.abortSignal);
        sheets.push({ index: sheet.index, pageNumbers: sheet.pageNumbers, imageUrl: uploaded.url, gcsUri: uploaded.gcsUri });
      }
      thumbsDone += thumbs.size;
      await params.onProgress?.("thumbs", thumbsDone, total);
    }

    await params.onProgress?.("select", 0, sheets.length);
    params.abortSignal?.throwIfAborted();
    const picked = await params.selectPages(sheets, total, async (doneSheets, totalSheets) => {
      await params.onProgress?.("select", Math.min(doneSheets, totalSheets), totalSheets);
    });
    const selectedMap = new Map<number, string | undefined>();
    params.abortSignal?.throwIfAborted();
    for (const item of picked) {
      const n = Math.floor(Number(item.pageNumber));
      if (Number.isInteger(n) && n >= 1 && n <= total && !selectedMap.has(n)) selectedMap.set(n, item.reason);
    }
    const selectedPages = Array.from(selectedMap.keys()).sort((a, b) => a - b);
    await params.onProgress?.("select", sheets.length, sheets.length);

    await params.onProgress?.("render", 0, selectedPages.length);
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
      await params.onProgress?.("render", done, selectedPages.length);
    }
    params.abortSignal?.throwIfAborted();
    return { docKey, fileName: params.fileName, pageCount: total, pages, selectedPages };
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
