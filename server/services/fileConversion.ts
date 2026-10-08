import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { getHeapStatistics } from "node:v8";
import { tmpdir, freemem } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { assertConversionSource, conversionBilling, conversionExtension, fileConversionFormat, FILE_CONVERSION_FREE_MAX_BYTES, type FileConversionOutcome, type FileConversionRequest } from "../../shared/fileConversion";
import { epubAttribute, readEpubPackage } from "../../shared/epubPackage";
import { requireHeavyMediaContext } from "../jobs/heavyMediaContext";
import { resolveJobWorkerRole } from "../jobs/workerRole";
import { getGcsBucketName, inspectGcsObjectBounded, uploadBufferToGcsIfAbsent } from "./gcs";
import { execHeavyMedia } from "./heavyMediaProcess";
import { buildEpubPrintHtml, parseEpub, splitEpubChaptersIntoShards } from "./knowledgeCardEpubToPdf";

/** 内存对象会同时存在原文、解码/展开及输出；按实际空闲堆预留四份，不按文件MB设业务门槛。 */
export function conversionMemoryBudget() {
  return Math.max(1, Math.floor(Math.min(freemem(), getHeapStatistics().heap_size_limit - process.memoryUsage().heapUsed) / 4));
}
const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
class ConversionInputError extends Error {}
const reject = (message: string): never => { throw new ConversionInputError(message); };
const utf8 = (buffer: Buffer) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return reject("文本编码无法识别，请先保存为 UTF-8 文件"); }
};

/** 逐个条目流式计量真实解压字节，不只相信 ZIP 中声明的长度。 */
export async function validateConversionZip(buffer: Buffer, signal: AbortSignal) {
  const budget = conversionMemoryBudget();
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  let total = 0;
  for (const entry of entries) {
    signal.throwIfAborted();
    if (entry.dir) continue;
    if (entry.name.startsWith("/") || entry.name.split("/").includes("..")) reject("电子书资源路径无效");
    const stream = new Readable().wrap(entry.nodeStream());
    const onAbort = () => stream.destroy(new Error("已停止检查"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted();
        total += (chunk as Buffer).byteLength;
        if (total > budget) { stream.destroy(); reject("电子书展开超过当前可用内存，原文件保留，请稍后或拆分后转换"); }
      }
    } finally { signal.removeEventListener("abort", onAbort); stream.destroy(); }
  }
  if (zip.file("META-INF/encryption.xml")) reject("暂不支持加密电子书");
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = epubAttribute(/<rootfile\b[^>]*>/i.exec(container || "")?.[0] || "", "full-path");
  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) reject("电子书缺少阅读顺序文件");
  const pkg = readEpubPackage(opf!, opfPath, true);
  for (const chapter of pkg.spine) {
    if (!await zip.file(chapter.href)?.async("string")) reject("电子书缺少章节，未生成不完整文件");
  }
  return pkg;
}

/** 不执行用户脚本，不允许网络或本机资源，不用剥图回退掩盖失败。 */
export async function renderConversionHtml(html: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (Buffer.byteLength(html) > conversionMemoryBudget()) reject("文档展开后过大，请拆分后转换");
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-extensions", "--disable-background-networking"] });
  const abort = () => { void browser.close().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    let blocked = false;
    page.on("request", req => {
      if (/^data:(?:image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/|application\/font)/i.test(req.url()) && ["image", "font"].includes(req.resourceType())) void req.continue();
      else { blocked = true; void req.abort(); }
    });
    const policy = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; frame-src \'none\'; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">';
    await page.setContent(policy + html, { waitUntil: "load", timeout: 120_000 });
    const unsafe = await page.evaluate(() => !!document.querySelector('iframe, frame, object, embed, meta[http-equiv="refresh" i]'));
    // 打印展开正文折叠区并解除滚动容器裁切；宽表单独用横向纸张，不截掉右列。
    const hasWideTables = await page.evaluate(() => {
      let wide = false;
      document.querySelectorAll("details").forEach(detail => { detail.open = true; });
      document.querySelectorAll("table").forEach(table => {
        const columns = Math.max(...Array.from(table.rows).map(row => Array.from(row.cells).reduce((n, cell) => n + cell.colSpan, 0)), 0);
        if (columns >= 7 || table.scrollWidth > 1050) {
          wide = true;
          let ancestor: HTMLElement | null = table.parentElement;
          while (ancestor && ancestor !== document.body) {
            ancestor.classList.add("conversion-table-container"); ancestor = ancestor.parentElement;
          }
        }
      });
      const style = document.createElement("style");
      style.textContent = `@media print {
          .conversion-table-container {display:block!important;width:auto!important;max-width:none!important;min-width:0!important}
          details {grid-column:1/-1!important}
          details,[style*="overflow"],.table-scroll {max-height:none!important;overflow:visible!important}
          table {max-width:100%!important;width:100%!important;table-layout:fixed!important}
          th,td {min-width:0!important;max-width:none!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important}
          tr {break-inside:avoid}
        }`;
      document.head.appendChild(style);
      return wide;
    });
    if (unsafe || blocked) reject("文档包含外部资源或嵌入页面，请将图片和样式内嵌后重新上传；未生成缺图文件");
    const completeImages = await page.evaluate(async () => {
      await document.fonts.ready;
      return (await Promise.all(Array.from(document.images).map(async image => {
        image.loading = "eager";
        try { await image.decode(); return image.naturalWidth > 0 && image.naturalHeight > 0; }
        catch { return false; }
      }))).every(Boolean);
    });
    if (!completeImages) reject("文档有图片无法读取，未生成缺图文件，请检查原件");
    const pdf = Buffer.from(await page.pdf({ format: hasWideTables ? "A3" : "A4", landscape: hasWideTables, printBackground: true, preferCSSPageSize: !hasWideTables, timeout: 0 }));
    signal.throwIfAborted();
    if (blocked) reject("文档依赖外部资源，未生成不完整文件");
    return pdf;
  } finally { signal.removeEventListener("abort", abort); await browser.close(); }
}

async function pdfPages(buffer: Buffer, dir: string, signal: AbortSignal) {
  if (buffer.subarray(0, 5).toString() !== "%PDF-") reject("文件内容不是有效 PDF");
  const source = path.join(dir, "source.pdf");
  await writeFile(source, buffer);
  const { stdout } = await execHeavyMedia("pdftotext", ["-layout", "-enc", "UTF-8", source, "-"], { signal, maxBuffer: conversionMemoryBudget() });
  const pages = stdout.split("\f");
  if (pages.at(-1) === "") pages.pop();
  if (!pages.length) reject("PDF 没有可读取页面");
  const images = await execHeavyMedia("pdfimages", ["-list", source], { signal, maxBuffer: 8 * 1024 * 1024 });
  const imagePages = new Set(images.stdout.split("\n").flatMap(line => /^\s*(\d+)\s+\d+\s+(?:image|mask|smask)\s/.exec(line)?.[1] || []).map(Number));
  const needsOcr = pages.some((text, i) => imagePages.has(i + 1) && text.replace(/\s/g, "").length < 40);
  return { pages, needsOcr };
}
/** 扫描书可带文字目录；少量封面/插图不将普通电子书整本误判为扫描书。 */
export function isScannedConversionEpub(chapters: string[], textPages: string[]) {
  const imageOnly = chapters.filter((chapter, index) => /<(?:img|image)\b/i.test(chapter) && (textPages[index] || "").replace(/\s/g, "").length < 40).length;
  return imageOnly > 0 && (textPages.every(text => text.replace(/\s/g, "").length < 40) || imageOnly > chapters.length / 2);
}

async function textDocument(pages: string[]) {
  return Packer.toBuffer(new Document({ sections: [{ children: pages.flatMap((text, page) => text.split(/\r?\n/).map((line, index) => new Paragraph({ pageBreakBefore: page > 0 && index === 0, children: [new TextRun(line)] }))) }] }));
}
const mimeFor = (ext: string) => ({ pdf: "application/pdf", txt: "text/plain; charset=utf-8", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", tiff: "image/tiff", avif: "image/avif" })[ext] || "application/octet-stream";

export type FileConversionIo = {
  read?: typeof inspectGcsObjectBounded;
  pricing?: Parameters<typeof conversionBilling>[3];
  onStage?: (stage: string, details?: Record<string, unknown>) => void;
  recognizePdf?: typeof import("./fileConversionOcr").recognizeConversionPdf;
  save?: typeof uploadBufferToGcsIfAbsent;
  onSource?: (sha256: string) => Promise<void>;
  beforeConvert?: (billing: ReturnType<typeof conversionBilling>) => Promise<void>;
};
/** 正式worker与本地已授权验收共用转换器；本地仅替换文件I/O，不替换格式执行器。 */
export async function executeFileConversion(request: FileConversionRequest, signal: AbortSignal, io: FileConversionIo = {}): Promise<FileConversionOutcome> {
  const owner = requireHeavyMediaContext();
  if (resolveJobWorkerRole() !== (request.lane === "paid" ? "rig" : "app")) throw new Error("文件转换车道与执行机器不一致");
  assertConversionSource(request.source, owner.userId, request.formatId, request.phase === "inspect");
  const dir = await mkdtemp(path.join(tmpdir(), "file-conversion-"));
  try {
    const chunks: Buffer[] = [];
    const checked = await (io.read || inspectGcsObjectBounded)({ gcsUri: `gs://${getGcsBucketName()}/${request.source.objectName}`, generation: request.source.generation,
      maxBytes: request.lane === "free" ? FILE_CONVERSION_FREE_MAX_BYTES : conversionMemoryBudget(), signal, onChunk: chunk => chunks.push(Buffer.from(chunk)) });
    if ((request.source.sha256 && checked.sha256 !== request.source.sha256) || checked.byteLength !== request.source.bytes) reject("原文件内容或大小已变化，请重新选择；本次未转换、未扣积分");
    await io.onSource?.(checked.sha256);
    io.onStage?.("source_verified", { bytes: checked.byteLength, sha256: checked.sha256 });
    const buffer = Buffer.concat(chunks);
    const format = fileConversionFormat(request.formatId);
    const ext = conversionExtension(request.source.fileName);
    let needsOcr = false;
    let pages = [""];
    let epub: Awaited<ReturnType<typeof parseEpub>> | undefined;
    let html = "";
    let image: import("sharp").Sharp | undefined;
    if (ext === "pdf") ({ pages, needsOcr } = await pdfPages(buffer, dir, signal));
    else if (ext === "epub") {
      await validateConversionZip(buffer, signal);
      epub = await parseEpub(buffer, { abortSignal: signal, imageReencodeBytes: Number.MAX_SAFE_INTEGER });
      pages = epub.chapters.map(chapter => chapter.replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").trim());
      needsOcr = isScannedConversionEpub(epub.chapters, pages);
    } else if (ext === "html" || ext === "htm") {
      html = utf8(buffer);
      if (!/<(?:html|body|p|div|h[1-6]|table|img)\b/i.test(html)) reject("HTML 文件没有可打印内容");
    } else if (ext === "txt") { pages = [utf8(buffer)]; if (!pages[0]!.trim()) reject("文本内容为空"); }
    else {
      const sharp = (await import("sharp")).default;
      image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "warning", animated: true });
      const meta = await image.metadata();
      if (!meta.width || !meta.height || (meta.pages || 1) !== 1) reject("仅支持静态单页图片，未截取动画或多页图片");
      const actual = meta.format === "heif" ? "avif" : meta.format;
      if (!(format.from as readonly string[]).includes(String(actual))) reject("图片内容与格式不符");
    }
    const billing = conversionBilling(checked.byteLength, needsOcr, request.lane, io.pricing);
    io.onStage?.("inspected", { pages: pages.length, needsOcr, chapters: epub?.chapters.length, images: epub?.images });
    if (request.phase === "inspect") return { type: "inspection", source: { ...request.source, sha256: checked.sha256 }, formatId: request.formatId, pages: pages.length, billing,
      notice: needsOcr ? `检测到需文字识别的图片页。扫描 PDF/EPUB 按原文件大小计费；识别文字需对照原件校对。${epub ? "输出保留原图，并附逐页识别文字。" : ""}${billing.available ? "请确认所示内容和积分后开始转换。" : "请选择已开放费率的付费通道；本次未扣积分、未开始转换。"}` : format.note };
    if (!billing.available) reject(needsOcr && request.lane === "free" ? "扫描件需文字识别，请选择付费转换；本次未扣积分，免费名额已返还" : "付费转换费率尚未开放，本次未扣积分、未开始转换");
    if (request.lane === "paid" && !io.beforeConvert) throw new Error("付费转换缺少结算入口");
    await io.beforeConvert?.(billing);
    let scannedEpubPdf: Buffer | undefined;
    if (needsOcr) {
      if (epub) {
        scannedEpubPdf = await renderConversionHtml(buildEpubPrintHtml(epub), signal);
        await writeFile(path.join(dir, "source.pdf"), scannedEpubPdf);
        ({ pages } = await pdfPages(scannedEpubPdf, dir, signal));
      }
      const { recognizeConversionPdf } = await import("./fileConversionOcr");
      const recognized = await (io.recognizePdf || recognizeConversionPdf)(path.join(dir, "source.pdf"), pages, dir, signal);
      pages = recognized.pages;
      io.onStage?.("ocr", { pages: pages.length, characters: pages.map(text => text.length), confidences: recognized.confidences });
      // 扫描EPUB的PDF保留原图文；另附逐页可检索文字，避免收费后仍只有原图。
      if (epub && format.to === "pdf") {
        const escaped = pages.map((text, index) => `<section style="page-break-before:always"><h2>第 ${index + 1} 页识别文字</h2><pre>${text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre></section>`).join("");
        const textPdf = await renderConversionHtml(`<html><meta charset="utf-8"><body>${escaped}</body></html>`, signal);
        const original = path.join(dir,"original.pdf"), text = path.join(dir,"recognized.pdf"), merged = path.join(dir,"recognized-book.pdf");
        await writeFile(original, scannedEpubPdf!); await writeFile(text, textPdf);
        await execHeavyMedia("pdfunite", [original, text, merged], { signal }); scannedEpubPdf = await readFile(merged);
      }
    }
    signal.throwIfAborted();
    let output: Buffer;
    if (format.to === "docx") {
      if (!pages.join("").trim()) reject("文件没有可导出的文字，未交付空文档");
      output = await textDocument(pages);
    }
    else if (format.to === "txt") {
      const text = pages.join("\n\n");
      if (!text.trim()) reject("文件没有可导出的文字，未交付空文件");
      output = Buffer.from(text, "utf8");
    } else if (format.id === "html-pdf") output = await renderConversionHtml(html, signal);
    else if (format.id === "epub-pdf" && scannedEpubPdf) output = scannedEpubPdf;
    else if (format.id === "epub-pdf" && epub) {
      const parts: string[] = [];
      for (const [index, shard] of Array.from(splitEpubChaptersIntoShards(epub.chapters).entries())) {
        signal.throwIfAborted();
        const part = path.join(dir, `chapter-${index}.pdf`);
        await writeFile(part, await renderConversionHtml(buildEpubPrintHtml({ ...epub, chapters: shard.map(i => epub!.chapters[i]!) }), signal));
        parts.push(part);
      }
      if (parts.length === 1) output = await readFile(parts[0]!);
      else { const merged = path.join(dir, "merged.pdf"); await execHeavyMedia("pdfunite", [...parts, merged], { signal }); output = await readFile(merged); }
    } else if (image) {
      if (format.to === "jpeg") image = image.flatten({ background: "#ffffff" });
      output = await image.toFormat(format.to as "png" | "jpeg" | "webp" | "tiff" | "avif").toBuffer();
    } else throw new Error("转换执行器与格式目录不一致");
    signal.throwIfAborted();
    if (!output.length || output.length > conversionMemoryBudget()) reject("输出为空或当前可用内存不足，未交付文件");
    io.onStage?.("converted", { bytes: output.length });
    const outputSha = sha(output);
    const objectName = `file-conversion/u${owner.userId}/results/${owner.executionId}/${outputSha}.${format.to}`;
    await (io.save || uploadBufferToGcsIfAbsent)({ objectName, buffer: output, contentType: mimeFor(format.to), signal,
      metadata: { userId: owner.userId, sourceSha256: checked.sha256, sha256: outputSha } });
    io.onStage?.("saved", { bytes: output.length });
    return { type: "converted", objectName, fileName: request.source.fileName.replace(/\.[^.]+$/, "") + "." + format.to,
      mimeType: mimeFor(format.to), bytes: output.length, sha256: outputSha, sourceSha256: checked.sha256, credits: billing.credits!, ...(needsOcr ? { notice: "扫描文字识别稿：已保留低置信度文字并标注待核；复杂多栏阅读顺序、专名和错字请对照原件校对，不代表原版式Word。" } : {}) };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ConversionInputError) return { type: "rejected", message: error.message };
    throw error;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
