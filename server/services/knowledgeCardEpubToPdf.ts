/**
 * 知识卡·EPUB → PDF（2026-09-08 用户要求第 3/4 条）：
 * 前端只管上传 EPUB，后台解包按 spine 顺序拼成一份 HTML，用 Chromium 打印成 PDF，
 * 之后走与 PDF 完全相同的逐页读图 + 抽字链路。不限制文件大小与章节数。
 *
 * 依赖：jszip（已在依赖里）、puppeteer（Fly 镜像 `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`）。
 */
import path from "node:path";
import JSZip from "jszip";

type SpineItem = { href: string; mediaType: string };

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return decodeEntities((m?.[1] ?? m?.[2] ?? "").trim());
}

function resolveZipPath(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0]!.split("?")[0]!);
  const joined = path.posix.normalize(path.posix.join(baseDir, clean));
  return joined.replace(/^\/+/, "");
}

function mimeFromName(name: string): string {
  const ext = path.posix.extname(name).toLowerCase();
  return (
    {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
      ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".otf": "font/otf",
      ".woff": "font/woff", ".woff2": "font/woff2",
    } as Record<string, string>
  )[ext] || "application/octet-stream";
}

export type ParsedEpub = {
  title: string;
  /** 按 spine 顺序的章节 HTML（已内联图片/CSS 为 data URL） */
  chapters: string[];
  /** 图片处理统计：多少张被缩、多少张被剥 */
  images: { total: number; downscaled: number; stripped: number };
};

export type ParseEpubOptions = {
  /** 位图长边超过此像素就缩到此值再内联（A4 打印 1400px 已足够）。 */
  imageMaxPx?: number;
  /** 位图超过此字节数才重新编码；小图原样内联。 */
  imageReencodeBytes?: number;
  /** 兜底：Chromium 已经崩过一次时整本剥图，只保文字。 */
  stripImages?: boolean;
};

const IMAGE_MAX_PX_DEFAULT = 1400;
const IMAGE_REENCODE_BYTES_DEFAULT = 300 * 1024;
const BITMAP_MIME_RE = /^image\/(png|jpe?g|webp|tiff?|bmp)$/i;

/**
 * 位图内联前先缩：整本书的高清插图以 base64 塞进一页 HTML，Chromium 打印时要把每张都解成位图，
 * 2026-09-10 一本大 EPUB 就这样把渲染进程压崩（Protocol error: Target closed）。
 */
async function shrinkBitmap(data: Buffer, mime: string, opts: Required<Pick<ParseEpubOptions, "imageMaxPx" | "imageReencodeBytes">>): Promise<{ data: Buffer; mime: string; changed: boolean }> {
  if (!BITMAP_MIME_RE.test(mime) || data.length <= opts.imageReencodeBytes) return { data, mime, changed: false };
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(data, { limitInputPixels: false }).rotate();
    const meta = await img.metadata();
    const longest = Math.max(meta.width || 0, meta.height || 0);
    const out = await (longest > opts.imageMaxPx ? img.resize({ width: opts.imageMaxPx, height: opts.imageMaxPx, fit: "inside", withoutEnlargement: true }) : img)
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    return out.length < data.length ? { data: out, mime: "image/jpeg", changed: true } : { data, mime, changed: false };
  } catch {
    return { data, mime, changed: false };
  }
}

/** 解包 EPUB：container.xml → OPF → manifest/spine → 章节 XHTML，资源一律内联。 */
export async function parseEpub(buffer: Buffer, options: ParseEpubOptions = {}): Promise<ParsedEpub> {
  const imageMaxPx = Math.max(200, Math.floor(options.imageMaxPx || IMAGE_MAX_PX_DEFAULT));
  const imageReencodeBytes = Math.max(0, Math.floor(options.imageReencodeBytes ?? IMAGE_REENCODE_BYTES_DEFAULT));
  const images = { total: 0, downscaled: 0, stripped: 0 };
  const zip = await JSZip.loadAsync(buffer);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  if (!container) throw new Error("EPUB 缺少 META-INF/container.xml");
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] || "", "full-path");
  if (!opfPath) throw new Error("EPUB 缺少 OPF 路径");
  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new Error(`EPUB 缺少 OPF 文件：${opfPath}`);
  const opfDir = path.posix.dirname(opfPath);

  const manifest = new Map<string, SpineItem>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) || []) {
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) manifest.set(id, { href: resolveZipPath(opfDir, href), mediaType: attr(tag, "media-type") });
  }
  const spine: SpineItem[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) || []) {
    const item = manifest.get(attr(tag, "idref"));
    if (item && /html|xml/i.test(item.mediaType || item.href)) spine.push(item);
  }
  if (!spine.length) throw new Error("EPUB 没有可读章节（spine 为空）");
  const title = decodeEntities(/<dc:title[^>]*>([^<]*)<\/dc:title>/i.exec(opf)?.[1]?.trim() || "");

  const assetCache = new Map<string, string>();
  const inlineAsset = async (zipPath: string): Promise<string | null> => {
    if (assetCache.has(zipPath)) return assetCache.get(zipPath)!;
    const file = zip.file(zipPath);
    if (!file) return null;
    const mime = mimeFromName(zipPath);
    const isImage = mime.startsWith("image/");
    if (isImage) images.total += 1;
    if (isImage && options.stripImages) {
      images.stripped += 1;
      // 透明 1×1，占位不占内存；alt 仍在，读图阶段能看到「此处有图」
      const url = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      assetCache.set(zipPath, url);
      return url;
    }
    const raw = await file.async("nodebuffer");
    const shrunk = isImage ? await shrinkBitmap(raw, mime, { imageMaxPx, imageReencodeBytes }) : { data: raw, mime, changed: false };
    if (shrunk.changed) images.downscaled += 1;
    const url = `data:${shrunk.mime};base64,${shrunk.data.toString("base64")}`;
    assetCache.set(zipPath, url);
    return url;
  };

  const chapters: string[] = [];
  for (const item of spine) {
    const raw = await zip.file(item.href)?.async("string");
    if (!raw) continue;
    const dir = path.posix.dirname(item.href);
    let body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(raw)?.[1] ?? raw;
    // 内联 CSS（<link rel=stylesheet>）
    const styles: string[] = [];
    for (const link of raw.match(/<link\b[^>]*>/gi) || []) {
      if (!/stylesheet/i.test(link)) continue;
      const css = await zip.file(resolveZipPath(dir, attr(link, "href")))?.async("string");
      if (css) styles.push(css.replace(/@font-face[\s\S]*?\}/gi, ""));
    }
    for (const m of raw.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []) styles.push(m.replace(/<\/?style[^>]*>/gi, ""));
    // 图片 src / xlink:href → data URL
    const srcRe = /(<(?:img|image|source)\b[^>]*?\b(?:src|xlink:href|href)\s*=\s*)(["'])([^"']+)\2/gi;
    const replacements = new Map<string, string>();
    for (const m of Array.from(body.matchAll(srcRe))) {
      const ref = m[3]!;
      if (/^(data:|https?:)/i.test(ref) || replacements.has(ref)) continue;
      const url = await inlineAsset(resolveZipPath(dir, ref));
      if (url) replacements.set(ref, url);
    }
    for (const [ref, url] of Array.from(replacements.entries())) {
      body = body.split(`"${ref}"`).join(`"${url}"`).split(`'${ref}'`).join(`'${url}'`);
    }
    // 去掉脚本，避免打印时执行
    body = body.replace(/<script\b[\s\S]*?<\/script>/gi, "");
    chapters.push(`<section class="kc-chapter">${styles.length ? `<style>${styles.join("\n")}</style>` : ""}${body}</section>`);
  }
  if (!chapters.length) throw new Error("EPUB 章节内容为空");
  return { title, chapters, images };
}

export function buildEpubPrintHtml(parsed: ParsedEpub): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${parsed.title || "EPUB"}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Noto Sans CJK SC", "Noto Serif CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif; font-size: 12pt; line-height: 1.7; color: #111; }
  .kc-chapter { page-break-before: always; }
  .kc-chapter:first-child { page-break-before: auto; }
  img, svg, image { max-width: 100%; height: auto; page-break-inside: avoid; }
  table { border-collapse: collapse; max-width: 100%; page-break-inside: auto; }
  td, th { border: 1px solid #999; padding: 2pt 4pt; }
  pre { white-space: pre-wrap; }
</style></head><body>${parsed.chapters.join("\n")}</body></html>`;
}

/** Chromium 渲染进程被杀（OOM/崩溃）时 puppeteer 抛的是协议错误，不是业务错误；按这个特征识别后走剥图重试。 */
export function isChromiumCrashError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /Target closed|Session closed|Target crashed|Protocol error|Navigating frame was detached|browser has disconnected|Page crashed/i.test(message);
}

export class EpubChromiumCrashError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EpubChromiumCrashError";
  }
}

/** Chromium 打印：Fly 用系统 chromium；本机用 puppeteer 自带浏览器。 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const puppeteer = (await import("puppeteer")).default;
  const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim() || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--no-zygote"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 120_000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, timeout: 300_000 });
    return Buffer.from(pdf);
  } catch (error) {
    if (isChromiumCrashError(error)) {
      throw new EpubChromiumCrashError(
        `Chromium 转 PDF 时崩溃（HTML ${(html.length / 1024 / 1024).toFixed(1)} MB）：${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export type ConvertEpubToPdfResult = {
  pdf: Buffer;
  title: string;
  chapterCount: number;
  /** 走了哪条路：normal = 缩图后一次过；stripped = 崩过一次，剥图重来 */
  mode: "normal" | "stripped";
  images: ParsedEpub["images"];
};

/**
 * 缩图内联 → Chromium 打印；渲染进程崩了就整本剥图只保文字再打一次，两次都崩才报错，
 * 报错文案告诉用户怎么办，不再把 Protocol error 直接甩给前端。
 */
export async function convertEpubToPdf(
  buffer: Buffer,
  deps: { render?: (html: string) => Promise<Buffer>; parse?: typeof parseEpub } = {},
): Promise<ConvertEpubToPdfResult> {
  const render = deps.render || renderHtmlToPdf;
  const parse = deps.parse || parseEpub;
  const parsed = await parse(buffer);
  try {
    const pdf = await render(buildEpubPrintHtml(parsed));
    if (!pdf.length) throw new Error("EPUB 转 PDF 结果为空");
    return { pdf, title: parsed.title, chapterCount: parsed.chapters.length, mode: "normal", images: parsed.images };
  } catch (error) {
    if (!(error instanceof EpubChromiumCrashError)) throw error;
    console.warn(`[knowledgeCardEpubToPdf] 首次打印崩溃，剥图重试：${error.message}`);
  }
  const stripped = await parse(buffer, { stripImages: true });
  try {
    const pdf = await render(buildEpubPrintHtml(stripped));
    if (!pdf.length) throw new Error("EPUB 转 PDF 结果为空");
    return { pdf, title: stripped.title, chapterCount: stripped.chapters.length, mode: "stripped", images: stripped.images };
  } catch (error) {
    if (!(error instanceof EpubChromiumCrashError)) throw error;
    throw new Error(
      `这本 EPUB 太大，转 PDF 时浏览器崩溃两次（${stripped.chapters.length} 章，已试过只保文字）。请先用 Calibre 等工具转成 PDF，或拆成几本再上传。`,
    );
  }
}

export function isEpubFile(mimeType: string, fileName?: string): boolean {
  const mime = String(mimeType || "").toLowerCase();
  return mime === "application/epub+zip" || String(fileName || "").toLowerCase().endsWith(".epub");
}
