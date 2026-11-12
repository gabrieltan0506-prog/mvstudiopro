import {selectedKnowledgeBookLayout} from "./knowledgeBookLayout";
import {contentDecoration} from "./knowledgeContentDesign";
import {resolveKnowledgeDecoration} from "./knowledgeDecorations";
import type { EditableLayout } from "./editableLayout";
import type { KnowledgeReview } from "./knowledgePublication";
import { buildKnowledgeBookletHtml, chooseKnowledgeBookletTheme, KNOWLEDGE_BOOKLET_VERSION, type KnowledgeBookletImageMode } from "./knowledgeBooklet";
import { resolveKnowledgePublicationTemplate } from "./knowledgePublicationTemplates";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export const KNOWLEDGE_PUBLICATION_LAYOUT_VERSION = `${KNOWLEDGE_BOOKLET_VERSION}-publication-v10-whole-image`;

/**
 * 每章配图版式（站长 2026-11-12：不再切图）：所有档位、所有章一律图文同页（整图在章标题下、正文在图下两栏，放不下接续页）。
 * 不再读取页数分配里的跨页名额；即使页数分配仍返回 spread 也一律忽略。
 */
export function knowledgePublicationImageModes(doc: Pick<EditableLayout, "pages" | "publication">): KnowledgeBookletImageMode[] {
  return doc.pages.map(() => "inline");
}
export function knowledgePublicationHead(title: string, pagination?: { offset: number; total: number; count: number }) {
  const attributes = pagination ? ` data-booklet-page-offset="${pagination.offset}" data-booklet-total-pages="${pagination.total}" data-booklet-expected-pages="${pagination.count}"` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body data-knowledge-publication="${KNOWLEDGE_PUBLICATION_LAYOUT_VERSION}"${attributes}>`;
}
/** 预览与服务端导出调用同一排版器，保留已确认正文与真实校核提示。 */
/** nextImage：旧参数，仅保留签名兼容（只校验格式）；下篇预告只印下一章标题，不再放其图片裁切条。末章自动标记全书完。 */
/** imageMode：旧参数，仅保留签名兼容；传入 spread/auto 也一律按图文同页（整图）排版。 */
export function knowledgePublicationChapter(doc: EditableLayout, review: KnowledgeReview, index: number, image: string, preview=false, nextImage="", imageMode?: KnowledgeBookletImageMode) {
  const page=doc.pages[index],checked=review.pages[index];
  if(!page || !checked || page.id!==checked.id) throw new Error("图文页身份不一致");
  if(page.imageUrl && !image) throw new Error(`第${index+1}页图片未载入，未输出缺图文件`);
  // 导出配图一律以 https 地址引用（GCS 签名 URL），禁止 base64 内嵌：内嵌会让 HTML 与请求体随图片数量失控（用户 2026-11-10 再次明确）。
  if(!preview && image && !/^https:\/\/[^\s"'<>]+$/.test(image)) throw new Error("导出配图必须以地址引用，不得内嵌图片数据");
  if(!preview && nextImage && !/^https:\/\/[^\s"'<>]+$/.test(nextImage)) throw new Error("导出配图必须以地址引用，不得内嵌图片数据");
  const following=doc.pages[index+1];
  const next=following?{headline:following.headline,chapterNo:index+2}:null;
  void imageMode;const mode:KnowledgeBookletImageMode="inline";
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
  return buildKnowledgeBookletHtml({title:doc.title,theme,fragment:true,chapterOffset:index,decoration,imageMode:mode,next,pages:[{id:page.id,headline:page.headline,body:page.body,imageUrl:image}]});
}
export function buildKnowledgePublicationHtml(doc:EditableLayout,review:KnowledgeReview,images:Record<string,string>,preview=false) {
  return knowledgePublicationHead(doc.title)+doc.pages.map((p,i)=>knowledgePublicationChapter(doc,review,i,images[p.imageUrl]||"",preview,images[doc.pages[i+1]?.imageUrl||""]||"")).join("\n")+"</body></html>";
}
