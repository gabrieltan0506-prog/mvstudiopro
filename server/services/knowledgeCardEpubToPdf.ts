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
};

/** 解包 EPUB：container.xml → OPF → manifest/spine → 章节 XHTML，资源一律内联。 */
export async function parseEpub(buffer: Buffer): Promise<ParsedEpub> {
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
    const data = await file.async("nodebuffer");
    const url = `data:${mimeFromName(zipPath)};base64,${data.toString("base64")}`;
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
  return { title, chapters };
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

/** Chromium 打印：Fly 用系统 chromium；本机用 puppeteer 自带浏览器。 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const puppeteer = (await import("puppeteer")).default;
  const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim() || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 120_000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, timeout: 300_000 });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function convertEpubToPdf(buffer: Buffer): Promise<{ pdf: Buffer; title: string; chapterCount: number }> {
  const parsed = await parseEpub(buffer);
  const pdf = await renderHtmlToPdf(buildEpubPrintHtml(parsed));
  if (!pdf.length) throw new Error("EPUB 转 PDF 结果为空");
  return { pdf, title: parsed.title, chapterCount: parsed.chapters.length };
}

export function isEpubFile(mimeType: string, fileName?: string): boolean {
  const mime = String(mimeType || "").toLowerCase();
  return mime === "application/epub+zip" || String(fileName || "").toLowerCase().endsWith(".epub");
}
