/**
 * 同步 PDF 渲染（downloadPlatformPdf / downloadAnalysisPdf）入口的 HTML 净化。
 *
 * 渲染端（pdf-worker，无头浏览器）会加载 HTML 里的外链资源，原先匿名可提交任意 HTML → 可让渲染端去请求内网 / 元数据地址。
 * pdf-worker 本身不动，只在服务端入口这一层收：
 * 1. 大小上限（PDF_HTML_MAX_BYTES，可 env 覆盖）
 * 2. 删掉会执行代码或引入外部文档的元素：script / iframe / frame(set) / object / embed / applet / portal / base /
 *    meta refresh / link[rel=import|prefetch|preload|prerender|preconnect|dns-prefetch|modulepreload|manifest]
 * 3. 删掉 on* 事件属性与 javascript: 地址
 * 4. 外链资源（src / href / srcset / poster / data / background / xlink:href、CSS url() 与 @import）只留本站与自有存储（见 ownedResourceUrl），
 *    其余地址去掉；<a href> 不触发加载，保留
 * 5. 头部注入 CSP（default-src 'none'，图片 / 样式 / 字体 / 媒体只许 data: 与白名单源）兜底，正则漏网的资源也加载不了
 * 正则净化不是完整 HTML 解析器，第 5 条才是硬边界。
 */
import { isOwnedResourceUrl, ownedResourceCspSources, ownedResourcePolicy, type OwnedResourcePolicy } from "./ownedResourceUrl";

export const PDF_HTML_MAX_BYTES_DEFAULT = 8 * 1024 * 1024;

export function pdfHtmlMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.PDF_HTML_MAX_BYTES || "");
  return Number.isFinite(raw) && raw >= 100_000 ? Math.floor(raw) : PDF_HTML_MAX_BYTES_DEFAULT;
}

export class PdfHtmlRejectedError extends Error {
  constructor(public readonly reason: "too_large") {
    super("报告内容过大，请改用作品库导出");
  }
}

const DANGEROUS_CONTAINERS = ["script", "iframe", "frameset", "object", "applet", "portal", "noscript", "template"];
const DANGEROUS_VOID = ["embed", "frame", "base", "param"];
const BLOCKED_LINK_RELS = /\b(import|prefetch|preload|prerender|preconnect|dns-prefetch|modulepreload|manifest)\b/i;
const URL_ATTRS = ["src", "href", "srcset", "poster", "data", "background", "xlink:href", "action", "formaction", "ping", "longdesc", "cite", "manifest", "lowsrc", "dynsrc"];

function isAbsoluteOrProtocolRelative(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}

/** 资源地址是否可留：data: 图片 / 字体、相对地址（无 <base> 时解析不到外网）、白名单绝对地址。 */
function keepResourceUrl(raw: string, policy: OwnedResourcePolicy): boolean {
  const value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!value) return true;
  if (/^data:(image|font|application\/font|application\/x-font|audio|video)\//i.test(value)) return true;
  if (/^(javascript|vbscript|file|ftp|ws|wss|blob|filesystem|chrome|about):/i.test(value)) return false;
  if (value.startsWith("#")) return true;
  if (!isAbsoluteOrProtocolRelative(value)) return !value.startsWith("\\");
  return isOwnedResourceUrl(value, policy);
}

function sanitizeCss(css: string, policy: OwnedResourcePolicy): string {
  return css
    .replace(/@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;?/gi, (whole, _q, url) => (keepResourceUrl(url, policy) ? whole : ""))
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (whole, _q, url) => (keepResourceUrl(url, policy) ? whole : "url()"))
    .replace(/expression\s*\(/gi, "(");
}

function sanitizeSrcset(value: string, policy: OwnedResourcePolicy): string {
  return value
    .split(",")
    .map(part => part.trim())
    .filter(part => part && keepResourceUrl(part.split(/\s+/)[0] || "", policy))
    .join(", ");
}

function sanitizeTag(tag: string, policy: OwnedResourcePolicy): string {
  const nameMatch = /^<\s*([a-zA-Z][\w:-]*)/.exec(tag);
  const name = (nameMatch?.[1] || "").toLowerCase();
  if (name === "meta" && /http-equiv\s*=\s*['"]?\s*(refresh|set-cookie|content-security-policy)/i.test(tag)) return "";
  if (name === "link") {
    const rel = /\brel\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2] || /\brel\s*=\s*([^\s>]+)/i.exec(tag)?.[1] || "";
    if (BLOCKED_LINK_RELS.test(rel)) return "";
  }
  let out = tag
    // on* 事件属性
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // style 属性里的 url() / @import
    .replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_w, prefix, _all, dq, sq) => {
      const css = sanitizeCss(dq ?? sq ?? "", policy);
      return dq != null ? `${prefix}"${css.replace(/"/g, "&quot;")}"` : `${prefix}'${css.replace(/'/g, "&#39;")}'`;
    });
  for (const attr of URL_ATTRS) {
    const re = new RegExp(`(\\s${attr.replace(":", "\\:")}\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>"']+))`, "gi");
    out = out.replace(re, (whole, _prefix, _all, dq, sq, bare) => {
      const value = (dq ?? sq ?? bare ?? "").replace(/&amp;/g, "&").replace(/&#x?0*3a;?/gi, ":");
      if (attr === "srcset") {
        const kept = sanitizeSrcset(value, policy);
        return kept ? whole.replace(dq ?? sq ?? bare ?? "", kept) : "";
      }
      // <a href> 只在点击时跳转，渲染时不加载；但 javascript: 一律去掉
      if (attr === "href" && name === "a") return /^\s*(javascript|vbscript|data):/i.test(value) ? "" : whole;
      return keepResourceUrl(value, policy) ? whole : "";
    });
  }
  return out;
}

export type SanitizedPdfHtml = { html: string; removedTags: number; bytes: number };

export function sanitizePdfHtml(
  rawHtml: string,
  options: { policy?: OwnedResourcePolicy; maxBytes?: number } = {},
): SanitizedPdfHtml {
  const maxBytes = options.maxBytes ?? pdfHtmlMaxBytes();
  const bytes = Buffer.byteLength(rawHtml, "utf8");
  if (bytes > maxBytes) throw new PdfHtmlRejectedError("too_large");
  const policy = options.policy ?? ownedResourcePolicy();
  let html = rawHtml;
  let removedTags = 0;
  const count = (re: RegExp) => (html.match(re) || []).length;

  // 注释里可能藏条件注释 / 被浏览器当真解析的片段：整段删
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DANGEROUS_CONTAINERS) {
    const block = new RegExp(`<\\s*${tag}\\b[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`, "gi");
    removedTags += count(block);
    html = html.replace(block, "");
    const open = new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>`, "gi");
    removedTags += count(open);
    html = html.replace(open, "");
  }
  for (const tag of DANGEROUS_VOID) {
    const re = new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>`, "gi");
    removedTags += count(re);
    html = html.replace(re, "");
  }
  // <style> 块内的 url() / @import
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_w, open, css, close) => `${open}${sanitizeCss(css, policy)}${close}`);
  // 其余每个开始标签逐个处理属性
  html = html.replace(/<\s*[a-zA-Z][\w:-]*\b[^>]*>/g, tag => {
    const next = sanitizeTag(tag, policy);
    if (!next) removedTags += 1;
    return next;
  });

  const sources = ownedResourceCspSources(policy).join(" ");
  const csp =
    `default-src 'none'; img-src data: ${sources}; style-src 'unsafe-inline' ${sources}; font-src data: ${sources}; ` +
    `media-src data: ${sources}; script-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, m => `${m}${meta}`);
  else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, m => `${m}<head>${meta}</head>`);
  else html = `${meta}${html}`;
  return { html, removedTags, bytes };
}
