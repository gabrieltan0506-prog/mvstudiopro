import JSZip from "jszip";

/** 每片转换目标，不是文件或整书总量上限；原子插图/表格行可独立超过目标。 */
export const EPUB_PART_BYTES = 2 * 1024 * 1024;
export type EpubParseOptions = {
  partBytes?: number;
  onProgress?: (progress: { done: number; total: number }) => void;
};
export type EpubPart = {
  html: string;
  chapterStart: number;
  chapterEnd: number;
};
export type ParsedEpub = {
  title: string;
  text: string;
  /** 小书兼容字段；多片书为空，调用方必须逐片消费 parts。 */
  html: string;
  parts: EpubPart[];
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
  options: EpubParseOptions = {}
): Promise<ParsedEpub> {
  const partBytes = options.partBytes ?? EPUB_PART_BYTES;
  if (!Number.isSafeInteger(partBytes) || partBytes <= 0)
    throw new Error("电子书分片目标必须是正整数");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error("无法读取 EPUB：文件损坏、被加密或不是有效电子书");
  }
  const files = Object.values(zip.files).filter(f => !f.dir);
  for (const file of files) {
    epubPath(
      "",
      (file as typeof file & { unsafeOriginalName?: string })
        .unsafeOriginalName ?? file.name
    );
    const size = (file as unknown as { _data: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0)
      throw new Error("电子书资源大小信息损坏");
  }
  const crcTable = new Int32Array(256);
  for (let index = 0; index < crcTable.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    crcTable[index] = value;
  }
  const cache = new Map<string, Uint8Array>();
  async function read(name: string): Promise<Uint8Array> {
    if (cache.has(name)) return cache.get(name)!;
    const file = zip.file(name);
    if (!file) throw new Error(`电子书缺少资源：${name}`);
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      type ZipStream = {
        on(event: "data", callback: (chunk: Uint8Array) => void): ZipStream;
        on(event: "error", callback: (error: Error) => void): ZipStream;
        on(event: "end", callback: () => void): ZipStream;
        pause(): ZipStream;
        resume(): ZipStream;
      };
      const stream = (
        file as unknown as {
          internalStream(type: "uint8array"): ZipStream;
        }
      ).internalStream("uint8array");
      const chunks: Uint8Array[] = [];
      let length = 0;
      stream
        .on("data", (chunk: Uint8Array) => {
          length += chunk.length;
          chunks.push(chunk);
        })
        .on("error", () => reject(new Error("电子书解压失败，文件可能损坏")))
        .on("end", () => {
          try {
            const result = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) {
              result.set(chunk, offset);
              offset += chunk.length;
            }
            resolve(result);
          } catch (error) {
            reject(error);
          }
        })
        .resume();
    });
    let crc = -1;
    for (let i = 0; i < bytes.length; i++)
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]!) & 255]!;
    const declaredSize = (
      file as unknown as { _data: { uncompressedSize: number } }
    )._data.uncompressedSize;
    if (bytes.length !== declaredSize)
      throw new Error("电子书资源大小校验失败，文件可能损坏");
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
  const encoder = new TextEncoder();
  const byteLength = (value: string) => encoder.encode(value).length;
  // 为页面样式和重建的祖先标签留空间；目标仅用于分片，绝不截断或丢弃内容。
  const fragmentBytes = Math.max(1, partBytes - 2048);
  function splitText(value: string): string[] {
    const fragments: string[] = [];
    for (let offset = 0; offset < value.length; ) {
      let low = 1;
      let high = Math.min(value.length - offset, fragmentBytes);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (
          byteLength(escape(value.slice(offset, offset + middle))) <=
          fragmentBytes
        )
          low = middle;
        else high = middle - 1;
      }
      let end = offset + low;
      // UTF-16 代理对作为同一个文字原子，不能被分到两个片中。
      if (
        end < value.length &&
        /[\uD800-\uDBFF]/.test(value[end - 1]!) &&
        /[\uDC00-\uDFFF]/.test(value[end]!)
      ) {
        if (end - offset > 1) end--;
        else end++;
      }
      fragments.push(escape(value.slice(offset, end)));
      offset = end;
    }
    return fragments;
  }
  function wrapFragments(
    children: string[],
    open: string,
    close: string,
    atomic = false
  ): string[] {
    if (atomic) return [`${open}${children.join("")}${close}`];
    const fragments: string[] = [];
    const wrapperBytes = byteLength(open + close);
    let pending: string[] = [];
    let bytes = wrapperBytes;
    const flush = () => {
      if (pending.length) fragments.push(`${open}${pending.join("")}${close}`);
      pending = [];
      bytes = wrapperBytes;
    };
    for (const child of children) {
      if (!child) continue;
      const childBytes = byteLength(child);
      if (pending.length && bytes + childBytes > fragmentBytes) flush();
      pending.push(child);
      bytes += childBytes;
      if (bytes >= fragmentBytes) flush();
    }
    flush();
    if (!fragments.length && open) fragments.push(open + close);
    return fragments;
  }
  function listInteger(raw: string | null): number | undefined {
    if (raw === null || !/^[+-]?\d+$/.test(raw.trim())) return undefined;
    const value = Number(raw);
    // 对应浏览器 HTML 列表属性的有符号整数范围，拒绝脚本和异常属性值。
    return Number.isInteger(value) &&
      value >= -2147483648 &&
      value <= 2147483647
      ? value
      : undefined;
  }
  async function render(
    node: Node,
    chapterPath: string,
    depth = 0,
    orderedValue?: number
  ): Promise<{ fragments: string[]; text: string }> {
    if (depth > 200)
      throw new Error("电子书结构嵌套过深，请先整理为普通图文版");
    if (node.nodeType === 3)
      return {
        fragments: splitText(node.textContent || ""),
        text: node.textContent || "",
      };
    if (node.nodeType !== 1) return { fragments: [], text: "" };
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (dropped.has(tag)) {
      warnings.add("已移除脚本、原书样式与交互内容");
      return { fragments: [], text: "" };
    }
    if (tag === "img") {
      const src = el.getAttribute("src") || "";
      let imagePath: string;
      try {
        imagePath = epubPath(chapterPath, src);
      } catch {
        warnings.add("已移除远程图片及不安全图片路径");
        return { fragments: [], text: "" };
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
        return { fragments: [], text: "" };
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
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(
          ...Array.from(bytes.subarray(offset, offset + 8192))
        );
      imageCount++;
      return {
        fragments: [
          `<img src="data:${mime};base64,${btoa(binary)}" alt="${escape(el.getAttribute("alt") || "")}">`,
        ],
        text: "",
      };
    }
    if (tag === "svg" || tag === "math")
      throw new Error("电子书含有暂不支持的矢量图或公式，请先转换为普通图文版");
    const children: { fragments: string[]; text: string }[] = [];
    let listStart: number | undefined;
    if (tag === "ol") {
      const reversed = el.hasAttribute("reversed");
      listStart =
        listInteger(el.getAttribute("start")) ??
        (reversed
          ? Array.from(el.children).filter(
              child => child.localName.toLowerCase() === "li"
            ).length
          : 1);
      let nextValue = listStart;
      for (const child of Array.from(node.childNodes)) {
        if (
          child.nodeType === 1 &&
          (child as Element).localName.toLowerCase() === "li"
        ) {
          const value =
            listInteger((child as Element).getAttribute("value")) ?? nextValue;
          children.push(await render(child, chapterPath, depth + 1, value));
          nextValue = value + (reversed ? -1 : 1);
        } else children.push(await render(child, chapterPath, depth + 1));
      }
    } else {
      for (const child of Array.from(node.childNodes))
        children.push(await render(child, chapterPath, depth + 1));
    }
    const fragments = children.flatMap(c => c.fragments);
    const text =
      children.map(c => c.text).join("") +
      (block.has(tag) ? "\n" : tag === "td" || tag === "th" ? "\t" : "");
    if (!allowed.has(tag))
      return { fragments: wrapFragments(fragments, "", ""), text };
    let attrs = "";
    if (tag === "ol") {
      attrs += ` start="${listStart}"`;
      if (el.hasAttribute("reversed")) attrs += " reversed";
      const type = el.getAttribute("type");
      if (type && /^[1aAiI]$/.test(type)) attrs += ` type="${type}"`;
    }
    if (tag === "li") {
      const value = orderedValue ?? listInteger(el.getAttribute("value"));
      if (value !== undefined) attrs += ` value="${value}"`;
    }
    if (tag === "td" || tag === "th")
      for (const attr of ["colspan", "rowspan"]) {
        const value = el.getAttribute(attr);
        if (value && /^[1-9]\d?$/.test(value)) attrs += ` ${attr}="${value}"`;
      }
    let rendered =
      tag === "br" || tag === "hr"
        ? [`<${tag}>`]
        : wrapFragments(
            fragments,
            `<${tag}${attrs}>`,
            `</${tag}>`,
            tag === "tr"
          );
    if (tag === "li") {
      // 跨片续段仍属于原条目：保持原 value，隐藏续段标号，并从列表项语义中排除。
      // 后续真实条目的 value 已单独冻结，不会把续段算成新增步骤。
      rendered = rendered.map((fragment, index) =>
        index === 0
          ? fragment
          : fragment.replace(
              `<li${attrs}>`,
              `<li${attrs} class="epub-list-continuation" data-epub-list-continuation="true" role="presentation">`
            )
      );
    }
    return { fragments: rendered, text };
  }
  const parts: EpubPart[] = [];
  const texts: string[] = [];
  const documentHtml = (content: string) =>
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.75;color:#18212d;overflow-wrap:anywhere}.chapter+.chapter:not(.continuation){break-before:page}h1,h2,h3,h4{break-after:avoid}p{orphans:3;widows:3}.epub-list-continuation{list-style-type:none}img{display:block;max-width:100%;max-height:240mm;object-fit:contain;margin:12pt auto}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #bbb;padding:5pt}pre{white-space:pre-wrap}blockquote{border-left:2pt solid #aaa;margin-left:0;padding-left:12pt}</style></head><body>${content}</body></html>`;
  const documentBytes = byteLength(documentHtml(""));
  let pending: string[] = [];
  let pendingBytes = documentBytes;
  let chapterStart = 0;
  let chapterEnd = 0;
  function flushPart() {
    if (!pending.length) return;
    parts.push({
      html: documentHtml(pending.join("")),
      chapterStart,
      chapterEnd,
    });
    pending = [];
    pendingBytes = documentBytes;
  }
  options.onProgress?.({ done: 0, total: spine.length });
  for (let index = 0; index < spine.length; index++) {
    const ref = spine[index]!;
    const item = manifest.get(ref.getAttribute("idref"));
    if (!item) throw new Error("电子书章节目录与内容不一致");
    if (item.getAttribute("media-type") !== "application/xhtml+xml")
      throw new Error("电子书包含暂不支持的章节格式");
    const chapterPath = epubPath(opfPath, item.getAttribute("href") || "");
    try {
      const chapter = await xml(chapterPath);
      const body = elements(chapter, "body")[0];
      if (!body) throw new Error(`电子书章节缺少正文：${chapterPath}`);
      const result = await render(body, chapterPath);
      if (
        !result.text.trim() &&
        !result.fragments.some(fragment => fragment.includes("<img "))
      )
        throw new Error(`电子书包含空章节：${chapterPath}`);
      for (
        let fragmentIndex = 0;
        fragmentIndex < result.fragments.length;
        fragmentIndex++
      ) {
        const fragment = result.fragments[fragmentIndex]!;
        const content = `<section class="chapter${fragmentIndex ? " continuation" : ""}" data-chapter="${index + 1}">${fragment}</section>`;
        const bytes = byteLength(content);
        if (pending.length && pendingBytes + bytes > partBytes) flushPart();
        if (!pending.length) chapterStart = index + 1;
        chapterEnd = index + 1;
        pending.push(content);
        pendingBytes += bytes;
        // 超过目标的原子插图/表格行独立成片，不会因大而拒绝或被截成坏标签。
        if (pendingBytes >= partBytes) flushPart();
      }
      texts.push(result.text.trim());
    } finally {
      // 已输出内容由 parts 持有；不跨章保留所有解压资源，复用图按需重读。
      cache.clear();
    }
    options.onProgress?.({ done: index + 1, total: spine.length });
    // 每章让出主线程，进度提示可以真正绘制。
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  flushPart();
  const text = texts.filter(Boolean).join("\n\n");
  if (!text && !imageCount) throw new Error("电子书没有可转换的正文或图片");
  return {
    title,
    text,
    html: parts.length === 1 ? parts[0]!.html : "",
    parts,
    chapterCount: spine.length,
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
