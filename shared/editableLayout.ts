import { z } from "zod";

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
    pages: z.array(layoutPageSchema).min(1).max(100),
    updatedAt: z.string().datetime(),
  })
  .strict();
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
  owner: string;
  sourceId: string;
  title: string;
  body: string;
  pages?: { headline: string; body: string; pageIndex: number }[];
  images?: Record<number, string>;
};
export function layoutFromSource(source: LayoutSource): EditableLayout {
  const pages = source.pages?.length
    ? source.pages
    : [{ headline: source.title, body: source.body, pageIndex: 1 }];
  return editableLayoutSchema.parse({
    id: crypto.randomUUID(),
    sourceId: source.sourceId,
    title: source.title,
    aspect: "3:4",
    theme: "paper",
    fontSize: 24,
    updatedAt: new Date().toISOString(),
    pages: pages.map(p => ({
      id: crypto.randomUUID(),
      headline: p.headline,
      body: p.body,
      imageUrl: source.images?.[p.pageIndex] || "",
      imagePlacement: "below",
    })),
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
      return `<article class="page"><div class="eyebrow">${escapeHtml(doc.title)} · ${String(i + 1).padStart(2, "0")}</div>${p.imagePlacement === "above" ? img : ""}<h1 contenteditable="${preview ? "false" : "true"}">${escapeHtml(p.headline)}</h1><div class="body" contenteditable="${preview ? "false" : "true"}">${escapeHtml(p.body)}</div>${p.imagePlacement === "below" ? img : ""}<footer>${i + 1} / ${doc.pages.length}</footer></article>`;
    })
    .join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.title)}</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#deded8;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}.page{width:720px;min-height:${style.minHeight}px;margin:0 auto 24px;padding:56px;background:${style.background};color:${style.color};overflow-wrap:anywhere;page-break-after:always}.eyebrow{font-size:14px;color:${style.accent};border-bottom:2px solid;padding-bottom:14px}h1{font-size:44px;line-height:1.3;margin:34px 0;white-space:pre-wrap}.body{font-size:${doc.fontSize}px;line-height:1.75;white-space:pre-wrap}img{display:block;width:100%;height:auto;margin:24px 0}footer{margin-top:40px;font-size:14px;color:${style.accent}}@media print{body{padding:0;background:white}.page{margin:0 auto;break-after:page}.page:last-child{break-after:auto}}@media(max-width:750px){.page{width:100%;min-height:0;aspect-ratio:${doc.aspect.replace(":", "/")};padding:28px}h1{font-size:32px}}</style></head><body>${pages}</body></html>`;
}
