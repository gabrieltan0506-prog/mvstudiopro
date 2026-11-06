import {selectedKnowledgeBookLayout} from "./knowledgeBookLayout";
import {contentDecoration} from "./knowledgeContentDesign";
import {resolveKnowledgeDecoration} from "./knowledgeDecorations";
import type { EditableLayout } from "./editableLayout";
import type { KnowledgeReview } from "./knowledgePublication";
import { buildKnowledgeBookletHtml, chooseKnowledgeBookletTheme, KNOWLEDGE_BOOKLET_VERSION } from "./knowledgeBooklet";
import { resolveKnowledgePublicationTemplate } from "./knowledgePublicationTemplates";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export const KNOWLEDGE_PUBLICATION_LAYOUT_VERSION = `${KNOWLEDGE_BOOKLET_VERSION}-publication-v7-advisor-layout`;
export function knowledgePublicationHead(title: string, pagination?: { offset: number; total: number; count: number }) {
  const attributes = pagination ? ` data-booklet-page-offset="${pagination.offset}" data-booklet-total-pages="${pagination.total}" data-booklet-expected-pages="${pagination.count}"` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body data-knowledge-publication="${KNOWLEDGE_PUBLICATION_LAYOUT_VERSION}"${attributes}>`;
}
/** 预览与服务端导出调用同一排版器，保留已确认正文与真实校核提示。 */
export function knowledgePublicationChapter(doc: EditableLayout, review: KnowledgeReview, index: number, image: string, preview=false) {
  const page=doc.pages[index],checked=review.pages[index];
  if(!page || !checked || page.id!==checked.id) throw new Error("图文页身份不一致");
  if(page.imageUrl && !image) throw new Error(`第${index+1}页图片未载入，未输出缺图文件`);
  if(!preview && image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error("导出配图必须完整内嵌");
  const selected=resolveKnowledgePublicationTemplate(doc.publication?.infographicTemplateId,checked.reading?.templateId);
  const layout=selectedKnowledgeBookLayout(doc);
  // 已采用顾问方案时不再根据标题关键词补选主题。
  const theme=chooseKnowledgeBookletTheme(layout ? '' : page.headline+'\n'+page.body,selected?.id);
  const design=layout?layout.chapters.find(p=>p.pageId===page.id)?.design:checked.reading?.decoration?.design;
  if (layout && !design) throw new Error("顾问排版方案缺少当前章节，未使用自动补选样式");
  if (!layout && doc.publication?.designMode === "content") throw new Error("请先让创作顾问重新排版；未用本地规则替代顾问方案");
  const decoration=design?contentDecoration(resolveKnowledgeDecoration(checked.reading?.decoration,page.headline),design):checked.reading?.decoration;
  const notes=checked.cautions.map(c=>`### 阅读提示\n\n${c.message}\n\n原文或图像依据：${c.evidence}`).join('\n\n');
  return buildKnowledgeBookletHtml({title:doc.title,theme,fragment:true,chapterOffset:index,decoration,pages:[{id:page.id,headline:page.headline,body:page.body+(notes?'\n\n'+notes:''),imageUrl:image}]});
}
export function buildKnowledgePublicationHtml(doc:EditableLayout,review:KnowledgeReview,images:Record<string,string>,preview=false) {
  return knowledgePublicationHead(doc.title)+doc.pages.map((p,i)=>knowledgePublicationChapter(doc,review,i,images[p.imageUrl]||"",preview)).join("\n")+"</body></html>";
}
