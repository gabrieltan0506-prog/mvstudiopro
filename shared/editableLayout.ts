import { z } from "zod";
import { Marked } from "marked";
import { knowledgePublicationSchema, knowledgeManuscript } from "./knowledgePublication";

// 排版稿独立保存，不反写模型原稿，也不触发任何生成请求。
export const layoutImageSchema = z
  .string()
  .max(6000)
  .refine(
    value => !value || /^https?:\/\//i.test(value) || /^\/api\//.test(value),
    "图片地址不可用"
  );
export const layoutPageSchema = z
  .object({
    id: z.string().uuid(),
    headline: z.string().max(500),
    body: z.string().max(50000),
    imageUrl: z.string().max(6000),
    imagePlacement: z.enum(["above", "below"]),
  })
  .strict();
export const editableLayoutSchema = z
  .object({
    id: z.string().uuid(),
    sourceId: z.string().max(300),
    title: z.string().max(500),
    aspect: z.enum(["3:4", "9:16", "1:1"]),
    theme: z.enum(["paper", "ink", "sage"]),
    fontSize: z.number().int().min(18).max(36),
    pages: z.array(layoutPageSchema).min(1),
    updatedAt: z.string().datetime(),
    publication: knowledgePublicationSchema.optional(),
  })
  .strict().superRefine((doc, ctx) => {
    if (!doc.publication && doc.pages.length > 100)
      ctx.addIssue({code:"custom", message:"普通排版稿最多100页"});
    if (doc.publication && (doc.pages.length !== doc.publication.source.pages.length ||
        doc.pages.some((page, i) => page.id !== doc.publication!.source.pages[i].id)))
      ctx.addIssue({code:"custom", message:"知识稿与原稿页身份不一致"});
  });
export const layoutLibrarySchema = z
  .object({
    version: z.literal(1),
    owner: z.string().regex(/^\d+$/),
    documents: z.array(editableLayoutSchema).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.documents.map(d => d.id)).size !== value.documents.length)
      ctx.addIssue({ code: "custom", message: "稿件编号重复" });
    for (const doc of value.documents)
      if (new Set(doc.pages.map(p => p.id)).size !== doc.pages.length)
        ctx.addIssue({ code: "custom", message: "页编号重复" });
  });
export type EditableLayout = z.infer<typeof editableLayoutSchema>;
export type LayoutLibrary = z.infer<typeof layoutLibrarySchema>;
export type LayoutSource = {
  readingPreparation?: import("./knowledgeReadingPreparation").KnowledgeReadingPreparation;
  reviewBatchMode?: "ready-images";
  kind?: "knowledge-publication";
  inputFingerprint?: string;
  infographicTemplateId?: string;
  detailLevel?: "concise" | "full";
  owner: string;
  sourceId: string;
  title: string;
  body: string;
  pages?: { headline: string; body: string; pageIndex: number; imageJobId?: string; knowledgeRole?: "reading" | "illustration" }[];
  images?: Record<number, string>;
};
export function layoutFromSource(source: LayoutSource): EditableLayout {
  const pages = source.pages?.length
    ? source.pages
    : [{ headline: source.title, body: source.body, pageIndex: 1 }];
  const sourcePages = pages.map(p => ({
    id: crypto.randomUUID(), headline: p.headline, body: p.body,
    imageUrl: source.images?.[p.pageIndex] || "",
    ...(p.imageJobId ? { imageJobId: p.imageJobId } : {}),
    ...(p.knowledgeRole ? { role: p.knowledgeRole } : {}),
  }));
  return editableLayoutSchema.parse({
    id: crypto.randomUUID(),
    sourceId: source.sourceId,
    title: source.title,
    aspect: "3:4",
    theme: "paper",
    fontSize: 24,
    updatedAt: new Date().toISOString(),
    pages: sourcePages.map(({ imageJobId, role, ...p }) => ({
      ...p,
      imagePlacement: "below",
    })),
    ...(source.kind === "knowledge-publication" ? { publication: {
      version: 1, requestId: crypto.randomUUID(),
      billing: {version:"interior-pages-v1",confirmed:false},
      inputFingerprint: source.inputFingerprint,
      infographicTemplateId: source.infographicTemplateId,
      source: { title: source.title, detailLevel: source.detailLevel, pages: sourcePages, readingPreparation: source.readingPreparation, reviewBatchMode: source.reviewBatchMode },
      manuscript: knowledgeManuscript({title:source.title, pages:sourcePages}),
    } } : {}),
  });
}
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
// 只开放排版标签；原始HTML转义，默认剥离链接，手册仅允许HTTP(S)来源。
const createLayoutMarkdown = (allowSourceLinks = false) => new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ tokens, href }) {
      const label = this.parser.parseInline(tokens);
      return allowSourceLinks && /^https?:\/\//i.test(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    },
    image({ text }) {
      return escapeHtml(text);
    },
    text(token) {
      return "tokens" in token && token.tokens
        ? this.parser.parseInline(token.tokens)
        : escapeHtml(token.text);
    },
    codespan({ text }) {
      return `<code>${escapeHtml(text)}</code>`;
    },
    code({ text }) {
      return `<pre><code>${escapeHtml(text)}</code></pre>`;
    },
  },
});
const layoutMarkdown = createLayoutMarkdown();
const sourceMarkdown = createLayoutMarkdown(true);
/** 只有知识手册启用来源链接，旧编辑器仍剥离链接，任意HTML/脚本继续转义。 */
export function renderLayoutBody(body: string, allowSourceLinks = false): string {
  return (allowSourceLinks ? sourceMarkdown : layoutMarkdown).parse(body, { async: false });
}
export const layoutPalette = {
  paper: ["#fff9ed", "#242125", "#bd5037"],
  ink: ["#18252d", "#f4f0e8", "#efbb78"],
  sage: ["#edf2e9", "#21382e", "#52795a"],
} as const;
export function layoutPageStyle(doc: EditableLayout) {
  const [background, color, accent] = layoutPalette[doc.theme];
  const minHeight =
    doc.aspect === "9:16" ? 1280 : doc.aspect === "3:4" ? 960 : 720;
  return { background, color, accent, minHeight };
}
/** 单文件HTML保留可选取文字，图片必须先完整嵌入；转义全部用户内容。 */
export function buildLayoutHtml(
  raw: EditableLayout,
  embeddedImages: Record<string, string>,
  preview = false
): string {
  const doc = editableLayoutSchema.parse(raw);
  if (!preview && !doc.title.trim()) throw new Error("请填写稿件标题后导出");
  const style = layoutPageStyle(doc);
  const pages = doc.pages
    .map((p, i) => {
      const data = preview
        ? layoutImageSchema.safeParse(p.imageUrl).success
          ? p.imageUrl
          : ""
        : p.imageUrl
          ? embeddedImages[p.imageUrl]
          : "";
      if (
        !preview &&
        p.imageUrl &&
        (!data ||
          !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
            data
          ))
      )
        throw new Error(`第${i + 1}页图片未完整载入，未导出缺图文件`);
      const img = data
        ? `<img src="${escapeHtml(data)}" alt="${escapeHtml(p.headline)}">`
        : "";
      return `<article class="page"><div class="eyebrow">${escapeHtml(doc.title)} · ${String(i + 1).padStart(2, "0")}</div>${p.imagePlacement === "above" ? img : ""}<h1 contenteditable="${preview ? "false" : "true"}">${escapeHtml(p.headline)}</h1><div class="body" contenteditable="${preview ? "false" : "true"}">${renderLayoutBody(p.body)}</div>${p.imagePlacement === "below" ? img : ""}<footer>${i + 1} / ${doc.pages.length}</footer></article>`;
    })
    .join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.title)}</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#deded8;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}.page{width:720px;min-height:${style.minHeight}px;margin:0 auto 24px;padding:56px;background:${style.background};color:${style.color};overflow-wrap:anywhere;page-break-after:always}.eyebrow{font-size:14px;color:${style.accent};border-bottom:2px solid;padding-bottom:14px}h1{font-size:44px;line-height:1.3;margin:34px 0;white-space:pre-wrap}.body{font-size:${doc.fontSize}px;line-height:1.75}.body p{margin:0 0 .8em}.body h1,.body h2,.body h3,.body h4,.body h5,.body h6{font-size:1.25em;line-height:1.4;margin:1em 0 .5em}.body ul,.body ol{padding-left:1.5em;margin:.6em 0}.body li{margin:.25em 0}.body li p{margin:0}.body table{width:100%;border-collapse:collapse;font-size:.85em;margin:1em 0;table-layout:fixed}.body th,.body td{border:1px solid currentColor;padding:.45em;text-align:left;vertical-align:top}.body th{font-weight:700}.body blockquote{margin:1em 0;padding-left:1em;border-left:3px solid currentColor}.body pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:.6em;border:1px solid currentColor}.body code{font-family:monospace}.body hr{border:0;border-top:1px solid currentColor;margin:1em 0}img{display:block;width:100%;height:auto;margin:24px 0}footer{margin-top:40px;font-size:14px;color:${style.accent}}@media print{body{padding:0;background:white}.page{margin:0 auto;break-after:page}.page:last-child{break-after:auto}}@media(max-width:750px){.page{width:100%;min-height:0;aspect-ratio:${doc.aspect.replace(":", "/")};padding:28px}h1{font-size:32px}}</style></head><body>${pages}</body></html>`;
}
