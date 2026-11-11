import {selectedKnowledgeBookLayout} from "./knowledgeBookLayout";
import {contentDecoration} from "./knowledgeContentDesign";
import {resolveKnowledgeDecoration} from "./knowledgeDecorations";
import type { EditableLayout } from "./editableLayout";
import type { KnowledgeReview } from "./knowledgePublication";
import { buildKnowledgeBookletHtml, chooseKnowledgeBookletTheme, KNOWLEDGE_BOOKLET_VERSION, type KnowledgeBookletImageMode } from "./knowledgeBooklet";
import { KNOWLEDGE_FULL_MAX_TOTAL_PAGES, KNOWLEDGE_LEAD_PAGE_CHARS, KNOWLEDGE_READING_PAGE_CHARS, knowledgeEditionPageBudget } from "./knowledgeEditionBudget";
import { resolveKnowledgePublicationTemplate } from "./knowledgePublicationTemplates";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export const KNOWLEDGE_PUBLICATION_LAYOUT_VERSION = `${KNOWLEDGE_BOOKLET_VERSION}-publication-v8-spread-preview`;

/**
 * 每章配图版式（2026-11-11）：auto=允许分页器按内容量选「跨页大图」（每章最多比图文同页多 1 页），inline=只排图文同页。
 * 全书页数上限仍守用户口径：完整版 ≤72 页（可精简不可多），精华版 ≤ 图数×4；按字数估算图文同页总页数后，
 * 余量按「正文最短的章优先」分给 auto（短章图文同页留白最多，跨页收益最大）。章节逐段渲染，这里是全书唯一统筹处。
 */
export function knowledgePublicationImageModes(pages: readonly { body: string; imageUrl: string }[], level?: "full" | "concise"): KnowledgeBookletImageMode[] {
  const chars = pages.map(p => p.body.replace(/\s+/g, "").length);
  const inline = chars.reduce((n, c) => n + 1 + Math.ceil(Math.max(0, c - KNOWLEDGE_LEAD_PAGE_CHARS) / KNOWLEDGE_READING_PAGE_CHARS), 0);
  const images = pages.filter(p => p.imageUrl).length;
  const cap = level === "full" ? KNOWLEDGE_FULL_MAX_TOTAL_PAGES : level === "concise" ? knowledgeEditionPageBudget("concise", images).totalPages.max : Infinity;
  let spare = cap - inline;
  const order = pages.map((p, i) => i).filter(i => pages[i]!.imageUrl).sort((a, b) => chars[a]! - chars[b]! || a - b);
  const modes: KnowledgeBookletImageMode[] = pages.map(() => "inline");
  for (const i of order) { if (spare < 1) break; modes[i] = "auto"; spare--; }
  return modes;
}
export function knowledgePublicationHead(title: string, pagination?: { offset: number; total: number; count: number }) {
  const attributes = pagination ? ` data-booklet-page-offset="${pagination.offset}" data-booklet-total-pages="${pagination.total}" data-booklet-expected-pages="${pagination.count}"` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body data-knowledge-publication="${KNOWLEDGE_PUBLICATION_LAYOUT_VERSION}"${attributes}>`;
}
/** 预览与服务端导出调用同一排版器，保留已确认正文与真实校核提示。 */
/** nextImage：下一章配图地址（导出为签名地址），供本章页尾「下篇预告」裁切条；末章自动标记全书完。 */
export function knowledgePublicationChapter(doc: EditableLayout, review: KnowledgeReview, index: number, image: string, preview=false, nextImage="") {
  const page=doc.pages[index],checked=review.pages[index];
  if(!page || !checked || page.id!==checked.id) throw new Error("图文页身份不一致");
  if(page.imageUrl && !image) throw new Error(`第${index+1}页图片未载入，未输出缺图文件`);
  // 导出配图一律以 https 地址引用（GCS 签名 URL），禁止 base64 内嵌：内嵌会让 HTML 与请求体随图片数量失控（用户 2026-11-10 再次明确）。
  if(!preview && image && !/^https:\/\/[^\s"'<>]+$/.test(image)) throw new Error("导出配图必须以地址引用，不得内嵌图片数据");
  if(!preview && nextImage && !/^https:\/\/[^\s"'<>]+$/.test(nextImage)) throw new Error("导出配图必须以地址引用，不得内嵌图片数据");
  const following=doc.pages[index+1];
  const next=following?{headline:following.headline,imageUrl:following.imageUrl?nextImage:"",chapterNo:index+2}:null;
  const imageMode=knowledgePublicationImageModes(doc.pages,doc.publication?.source.detailLevel)[index];
  const layout=selectedKnowledgeBookLayout(doc);
  const chapter=layout?.chapters.find(p=>p.pageId===page.id);
  const selected=resolveKnowledgePublicationTemplate(doc.publication?.infographicTemplateId,chapter?.templateId||checked.reading?.templateId);
  // 已采用顾问方案时不再根据标题关键词补选主题。
  const theme=chooseKnowledgeBookletTheme(layout ? '' : page.headline+'\n'+page.body,selected?.id);
  const design=layout?layout.chapters.find(p=>p.pageId===page.id)?.design:checked.reading?.decoration?.design;
  if (layout && !chapter) throw new Error("顾问排版方案缺少当前章节");
  if (!layout && doc.publication?.designMode === "content") throw new Error("请先让创作顾问重新排版；未用本地规则替代顾问方案");
  const decoration=design?contentDecoration(resolveKnowledgeDecoration(checked.reading?.decoration,page.headline),design):checked.reading?.decoration;
  // 审查疑点只保留在作者面板；最终读者正文不重新附加已删除或待核的主张。
  return buildKnowledgeBookletHtml({title:doc.title,theme,fragment:true,chapterOffset:index,decoration,imageMode,next,pages:[{id:page.id,headline:page.headline,body:page.body,imageUrl:image}]});
}
export function buildKnowledgePublicationHtml(doc:EditableLayout,review:KnowledgeReview,images:Record<string,string>,preview=false) {
  return knowledgePublicationHead(doc.title)+doc.pages.map((p,i)=>knowledgePublicationChapter(doc,review,i,images[p.imageUrl]||"",preview,images[doc.pages[i+1]?.imageUrl||""]||"")).join("\n")+"</body></html>";
}
