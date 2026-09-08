import JSZip from "jszip";

export const EPUB_LIMITS = {
  archiveBytes: 20 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entryBytes: 16 * 1024 * 1024,
  entries: 2000,
  htmlBytes: 80 * 1024 * 1024,
} as const;
export type ParsedEpub = {
  title: string;
  text: string;
  html: string;
  chapterCount: number;
  imageCount: number;
  warnings: string[];
};
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const elements = (root: Document | Element, tag: string) =>
  Array.from(root.getElementsByTagNameNS("*", tag));

/** EPUB 内路径只允许落在当前压缩包内；JSZip 归一化前的原路径也必须校验。 */
export function epubPath(base: string, ref: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(ref.split(/[?#]/)[0]!);
  } catch {
    throw new Error("电子书包含无效的资源路径");
  }
  if (
    !decoded ||
    /^[\\/]|^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    /[\\\u0000-\u001f]/.test(decoded)
  )
    throw new Error("电子书包含外部资源或不安全路径");
  const parts = base ? base.split("/").slice(0, -1) : [];
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("电子书资源路径越界");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export async function parseEpub(
  data: ArrayBuffer | Uint8Array,
  fallbackTitle = "电子书",
  limits: { [K in keyof typeof EPUB_LIMITS]: number } = EPUB_LIMITS
): Promise<ParsedEpub> {
  if (data.byteLength > limits.archiveBytes)
    throw new Error("EPUB 文件超过 20 MB，请先拆分电子书");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error("无法读取 EPUB：文件损坏、被加密或不是有效电子书");
  }
  const files = Object.values(zip.files).filter(f => !f.dir);
  if (Object.keys(zip.files).length > limits.entries)
    throw new Error("电子书包含过多文件，请先拆分");
  let declared = 0;
  for (const file of files) {
    epubPath(
      "",
      (file as typeof file & { unsafeOriginalName?: string })
        .unsafeOriginalName ?? file.name
    );
    const size = (file as unknown as { _data: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > limits.entryBytes)
      throw new Error("电子书单个资源过大或大小信息损坏");
    declared += size!;
    if (declared > limits.expandedBytes)
      throw new Error("电子书解压后超过 64 MB，请先拆分");
  }
  let expanded = 0;
  const cache = new Map<string, Uint8Array>();
  async function read(name: string): Promise<Uint8Array> {
    if (cache.has(name)) return cache.get(name)!;
    const file = zip.file(name);
    if (!file) throw new Error(`电子书缺少资源：${name}`);
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      type BoundedZipStream = {
        on(
          event: "data",
          callback: (chunk: Uint8Array) => void
        ): BoundedZipStream;
        on(event: "error", callback: (error: Error) => void): BoundedZipStream;
        on(event: "end", callback: () => void): BoundedZipStream;
        pause(): BoundedZipStream;
        resume(): BoundedZipStream;
      };
      const stream = (
        file as unknown as {
          internalStream(type: "uint8array"): BoundedZipStream;
        }
      ).internalStream("uint8array");
      const chunks: Uint8Array[] = [];
      let length = 0;
      let stopped = false;
      stream
        .on("data", (chunk: Uint8Array) => {
          if (stopped) return;
          length += chunk.length;
          expanded += chunk.length;
          if (length > limits.entryBytes || expanded > limits.expandedBytes) {
            stopped = true;
            stream.pause();
            reject(new Error("电子书解压大小超过限制，已停止转换"));
            return;
          }
          chunks.push(chunk);
        })
        .on("error", () => reject(new Error("电子书解压失败，文件可能损坏")))
        .on("end", () => {
          if (stopped) return;
          const result = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(result);
        })
        .resume();
    });
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i]!;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const expectedCrc = (file as unknown as { _data: { crc32: number } })._data
      .crc32;
    if ((crc ^ -1) !== (expectedCrc | 0))
      throw new Error("电子书资源校验失败，文件可能损坏");
    cache.set(name, bytes);
    return bytes;
  }
  async function xml(name: string): Promise<Document> {
    const bytes = await read(name);
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`电子书章节不是有效 UTF-8：${name}`);
    }
    if (/<!ENTITY/i.test(source))
      throw new Error("电子书包含不支持的自定义实体");
    const doc = new DOMParser().parseFromString(source, "application/xml");
    if (elements(doc, "parsererror").length)
      throw new Error(`电子书章节格式损坏：${name}`);
    return doc;
  }
  if (zip.file("META-INF/encryption.xml"))
    throw new Error("暂不支持加密或带 DRM 的 EPUB，请提供未加密版本");
  const container = await xml("META-INF/container.xml");
  const rootPath = elements(container, "rootfile")[0]?.getAttribute(
    "full-path"
  );
  if (!rootPath) throw new Error("电子书缺少内容目录");
  const opfPath = epubPath("", rootPath);
  const opf = await xml(opfPath);
  const title =
    elements(opf, "title")[0]?.textContent?.trim() ||
    fallbackTitle.replace(/\.epub$/i, "");
  const manifest = new Map(
    elements(opf, "item").map(item => [item.getAttribute("id"), item])
  );
  const spine = elements(opf, "itemref");
  if (!spine.length) throw new Error("电子书没有可读取的章节");
  const warnings = new Set<string>();
  let imageCount = 0;
  const allowed = new Set(
    "h1 h2 h3 h4 h5 h6 p div section article span strong b em i u s blockquote pre code ul ol li dl dt dd table thead tbody tfoot tr th td caption figure figcaption sup sub br hr ruby rt rp".split(
      " "
    )
  );
  const dropped = new Set(
    "script style link iframe object embed audio video source form input button textarea select noscript".split(
      " "
    )
  );
  const block = new Set(
    "h1 h2 h3 h4 h5 h6 p div section article blockquote pre li dt dd tr figure figcaption br hr".split(
      " "
    )
  );
  let emittedImageBytes = 0;
  async function render(
    node: Node,
    chapterPath: string,
    depth = 0
  ): Promise<{ html: string; text: string }> {
    if (depth > 200)
      throw new Error("电子书结构嵌套过深，请先整理为普通图文版");
    if (node.nodeType === 3)
      return {
        html: escape(node.textContent || ""),
        text: node.textContent || "",
      };
    if (node.nodeType !== 1) return { html: "", text: "" };
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (dropped.has(tag)) {
      warnings.add("已移除脚本、原书样式与交互内容");
      return { html: "", text: "" };
    }
    if (tag === "img") {
      const src = el.getAttribute("src") || "";
      let imagePath: string;
      try {
        imagePath = epubPath(chapterPath, src);
      } catch {
        warnings.add("已移除远程图片及不安全图片路径");
        return { html: "", text: "" };
      }
      const bytes = await read(imagePath);
      const mime =
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? "image/jpeg"
            : String.fromCharCode(...Array.from(bytes.slice(0, 4))) ===
                  "RIFF" &&
                String.fromCharCode(...Array.from(bytes.slice(8, 12))) ===
                  "WEBP"
              ? "image/webp"
              : "";
      if (!mime) {
        warnings.add("已略过不支持的图片，仅保留 PNG、JPG 和 WebP 插图");
        return { html: "", text: "" };
      }
      try {
        const decoded = await createImageBitmap(
          new Blob([Uint8Array.from(bytes)], { type: mime })
        );
        if (!decoded.width || !decoded.height) throw new Error("空图片");
        decoded.close();
      } catch {
        throw new Error(`电子书插图无法解码：${imagePath}`);
      }
      emittedImageBytes += Math.ceil(bytes.length / 3) * 4;
      if (emittedImageBytes > limits.htmlBytes)
        throw new Error("电子书转换内容过大，请拆分后再试；未截断正文");
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(
          ...Array.from(bytes.subarray(offset, offset + 8192))
        );
      imageCount++;
      return {
        html: `<img src="data:${mime};base64,${btoa(binary)}" alt="${escape(el.getAttribute("alt") || "")}">`,
        text: "",
      };
    }
    if (tag === "svg" || tag === "math")
      throw new Error("电子书含有暂不支持的矢量图或公式，请先转换为普通图文版");
    const children: { html: string; text: string }[] = [];
    for (const child of Array.from(node.childNodes))
      children.push(await render(child, chapterPath, depth + 1));
    const content = children.map(c => c.html).join("");
    const text =
      children.map(c => c.text).join("") +
      (block.has(tag) ? "\n" : tag === "td" || tag === "th" ? "\t" : "");
    if (!allowed.has(tag)) return { html: content, text };
    let attrs = "";
    if (tag === "td" || tag === "th")
      for (const attr of ["colspan", "rowspan"]) {
        const value = el.getAttribute(attr);
        if (value && /^[1-9]\d?$/.test(value)) attrs += ` ${attr}="${value}"`;
      }
    return {
      html:
        tag === "br" || tag === "hr"
          ? `<${tag}>`
          : `<${tag}${attrs}>${content}</${tag}>`,
      text,
    };
  }
  let renderedBytes = 0;
  const chapters: string[] = [];
  const texts: string[] = [];
  for (const ref of spine) {
    const item = manifest.get(ref.getAttribute("idref"));
    if (!item) throw new Error("电子书章节目录与内容不一致");
    if (item.getAttribute("media-type") !== "application/xhtml+xml")
      throw new Error("电子书包含暂不支持的章节格式");
    const chapterPath = epubPath(opfPath, item.getAttribute("href") || "");
    const chapter = await xml(chapterPath);
    const body = elements(chapter, "body")[0];
    if (!body) throw new Error(`电子书章节缺少正文：${chapterPath}`);
    const result = await render(body, chapterPath);
    if (!result.text.trim() && !result.html.includes("<img "))
      throw new Error(`电子书包含空章节：${chapterPath}`);
    renderedBytes += new TextEncoder().encode(result.html).length;
    if (renderedBytes > limits.htmlBytes)
      throw new Error("电子书转换内容过大，请拆分后再试；未截断正文");
    chapters.push(`<section class="chapter">${result.html}</section>`);
    texts.push(result.text.trim());
  }
  const text = texts.filter(Boolean).join("\n\n");
  if (!text && !imageCount) throw new Error("电子书没有可转换的正文或图片");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.75;color:#18212d;overflow-wrap:anywhere}.chapter+.chapter{break-before:page}h1,h2,h3,h4{break-after:avoid}p{orphans:3;widows:3}img{display:block;max-width:100%;max-height:240mm;object-fit:contain;margin:12pt auto}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #bbb;padding:5pt}pre{white-space:pre-wrap}blockquote{border-left:2pt solid #aaa;margin-left:0;padding-left:12pt}</style></head><body>${chapters.join("\n")}</body></html>`;
  if (new TextEncoder().encode(html).length > limits.htmlBytes)
    throw new Error("电子书转换内容过大，请拆分后再试；未截断正文");
  return {
    title,
    text,
    html,
    chapterCount: chapters.length,
    imageCount,
    warnings: Array.from(warnings),
  };
}

export function epubPdfBlob(base64: string): Blob {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("转换服务返回的 PDF 数据无效，请重试");
  }
  if (!binary.startsWith("%PDF-") || binary.length < 20)
    throw new Error("转换服务未返回有效 PDF，请重试");
  return new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], {
    type: "application/pdf",
  });
}
