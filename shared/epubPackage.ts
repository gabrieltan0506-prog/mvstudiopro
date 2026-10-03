/** Shared EPUB package order used by knowledge-card PDF and novel import. No rendering or AI. */
type SpineItem = { href: string; mediaType: string };

export function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function epubAttribute(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return decodeEntities((m?.[1] ?? m?.[2] ?? "").trim());
}

export function resolveEpubPath(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0]!.split("?")[0]!);
  const parts: string[] = [];
  for (const part of `${baseDir}/${clean}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("EPUB 资源路径越界"); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}


export function readEpubPackage(opf: string, opfPath: string, strict = false) {
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const manifest = new Map<string, SpineItem>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) || []) {
    const id = epubAttribute(tag, "id");
    const href = epubAttribute(tag, "href");
    if (id && href) manifest.set(id, { href: resolveEpubPath(opfDir, href), mediaType: epubAttribute(tag, "media-type") });
  }
  const spine: SpineItem[] = [];
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) || []) {
    const item = manifest.get(epubAttribute(tag, "idref"));
    if (!item && strict) throw new Error("EPUB 阅读顺序引用了缺失章节");
    if (item && /html|xml/i.test(item.mediaType || item.href)) spine.push(item);
    else if (item && strict) throw new Error("EPUB 含暂不支持的章节格式，请先转换为文本");
  }
  if (!spine.length) throw new Error("EPUB 没有可读章节（spine 为空）");
  const title = decodeEntities(/<dc:title[^>]*>([^<]*)<\/dc:title>/i.exec(opf)?.[1]?.trim() || "");

  return { title, spine };
}
