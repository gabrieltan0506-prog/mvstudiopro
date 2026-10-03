import JSZip from "jszip";
import { epubAttribute, readEpubPackage } from "@shared/epubPackage";
import { NOVEL_SOURCE_MAX_CHARS, type ManhuaNovelDraft, type NovelChapter } from "@shared/manhuaNovelSource";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Read bounded entries only; illustrations never get inflated or sent to a model. */
async function readText(file: JSZip.JSZipObject | null, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (!file) throw new Error("EPUB 缺少章节文件，未导入；当前原文保留。");
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let bytes = 0; let failed = false;
    // JSZip implements this in zipObject.js; its shipped declarations only expose the generator variant.
    const stream = (file as JSZip.JSZipObject & { internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream("uint8array");
    stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { failed = true; stream.pause(); reject(new Error("EPUB 单个章节过大，请分卷导入；当前原文保留。")); return; }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (failed) return;
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
      try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(joined)); }
      catch { reject(new Error("EPUB 文字编码无法完整读取，请转换为 UTF-8 后导入。")); }
    });
    stream.resume();
  });
}

/** XML is inert: no HTML insertion, scripts, resource loading, PDF rasterization or distillation. */
function chapterText(raw: string) {
  const doc = new DOMParser().parseFromString(raw, "application/xhtml+xml");
  if (doc.querySelector("parsererror")) throw new Error("EPUB 章节格式无法完整读取；当前原文保留。");
  doc.querySelectorAll("script,style,head").forEach(node => node.remove());
  const root = doc.querySelector("body");
  if (!root) throw new Error("EPUB 章节缺少正文；当前原文保留。");
  const title = root.querySelector("h1,h2,h3")?.textContent?.trim() || "";
  const images = root.querySelectorAll("img,image,svg").length;
  function walk(node: Node): string {
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1) return "";
    const element = node as Element, tag = element.localName.toLowerCase();
    if (tag === "br") return "\n";
    if (/^(img|image|svg)$/.test(tag)) return element.getAttribute("alt") ? `［插图：${element.getAttribute("alt")}］` : "";
    const text = Array.from(node.childNodes).map(walk).join("");
    return /^(p|div|section|article|h[1-6]|li|tr|blockquote|pre)$/.test(tag) ? `\n${text}\n` : text;
  }
  return { title, images, text: walk(root).replace(/\r\n?/g, "\n").replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n").trim() };
}

export async function importManhuaEpub(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<{ draft: ManhuaNovelDraft; imageCount: number }> {
  if (file.size > MAX_FILE_BYTES) throw new Error("EPUB 超过64MB，请分卷导入；当前原文保留。");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const container = await readText(zip.file("META-INF/container.xml"), 256 * 1024);
  const opfPath = epubAttribute(/<rootfile\b[^>]*>/i.exec(container)?.[0] || "", "full-path");
  if (!opfPath) throw new Error("EPUB 缺少书籍目录；当前原文保留。");
  const { title, spine } = readEpubPackage(await readText(zip.file(opfPath)), opfPath, true);
  if (spine.length > 10000) throw new Error("EPUB 分节过多，请按卷导入；当前原文保留。");
  const chapters: NovelChapter[] = []; let text = "", imageCount = 0, line = 1;
  for (let i = 0; i < spine.length; i++) {
    const content = chapterText(await readText(zip.file(spine[i].href)));
    imageCount += content.images;
    // Keep even image-only covers as explicit selectable sections; never pretend their pixels were read.
    const part = content.text || "［本节无可提取文字，可能为封面或插图页］";
    const start = text.length;
    text += part + (i < spine.length - 1 ? "\n\n" : "");
    if (text.length > NOVEL_SOURCE_MAX_CHARS) throw new Error("原文超过40万字符，请按卷分批导入；不会截断，当前原文保留。");
    chapters.push({ title: (content.title || `书内第 ${i + 1} 节`).slice(0, 200), start, end: text.length, line });
    line += (text.slice(start).match(/\n/g) || []).length;
  }
  return { draft: { name: (title || file.name).slice(0, 120), text, chapters, epubImageCount: imageCount, from: 0, to: 0, enabled: false }, imageCount };
}
