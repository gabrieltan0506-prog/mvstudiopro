import { planKnowledgeCardPages } from "./knowledgeCardPagination";
import {attachKnowledgeTextModules} from "./knowledgeTextAttachment";
import type { LayoutSource } from "./editableLayout";
import {knowledgeEditionParts} from './knowledgeCardEdition';

// 复用实际出图分页；缺图保留原页位置，不将后页配图前移。
export function knowledgeCardLayoutSource(input: {
  owner: string;
  sourceId: string;
  markdown: string;
  distillModel?: string;
  detailLevel?: "concise" | "full";
  infographicTemplateId?: string | null;
  images: readonly string[];
}): LayoutSource {
  const plan = planKnowledgeCardPages(input.markdown, input.distillModel);
  if (!plan.pages.length) throw new Error("请先恢复或填写手册正文");
  if (input.images.length && input.images.length !== plan.pages.length)
    throw new Error("原成品页数与当前分页不一致，未导入错配图片；请先恢复对应成品");
  const images: Record<number, string> = {};
  input.images.forEach((url, index) => { if (url) images[index + 1] = url; });
  const title = input.markdown.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").trim() || "图文知识手册";
  return {
    kind: "knowledge-publication",
    detailLevel: input.detailLevel,
    infographicTemplateId: input.infographicTemplateId || undefined,
    owner: input.owner,
    sourceId: input.sourceId,
    title,
    body: input.markdown,
    pages: plan.pages.map((body, index) => ({
      pageIndex: index + 1,
      headline: body.match(/^##\s+(.+)$/m)?.[1] || `${title} · 第 ${index + 1} 页`,
      body,
    })),
    images,
  };
}

/** 全文和配图分别保留稳定章节；精华配图绝不冒充完整文字底稿。 */
export function synchronizedKnowledgeCardSource(input: {
  inputFingerprint?: string;
  owner: string; sourceId: string; fullMarkdown: string; illustrationMarkdown: string;
  detailLevel: "concise" | "full"; distillModel?: string;
  infographicTemplateId?: string | null; imageJobIds: readonly string[];
}): LayoutSource {
  if (!input.fullMarkdown.trim()) throw new Error("缺少完整版文字底稿，请先恢复完整稿；尚未开始出图或整理");
  const edition=knowledgeEditionParts(input.illustrationMarkdown);
  if(edition){
    if(edition.level!==input.detailLevel)throw Error('当前两版方案与所选档位不一致，未开始出图');
    const images=planKnowledgeCardPages(input.illustrationMarkdown,input.distillModel).pages;
    if(!images.length||images.length!==input.imageJobIds.length||new Set(input.imageJobIds).size!==images.length)
      throw Error('配图任务与实际知识模块不一致，尚未开始生成');
    // 图文知识手册取其精华，不按原书顺序：无图文字模块并入内容最相关的图章，作为该章图外补充。
    const textModules=edition.modules.filter(m=>m.medium==='text'&&m.body.trim());
    const supplements=attachKnowledgeTextModules(images,textModules);
    return {kind:'knowledge-publication',owner:input.owner,sourceId:input.sourceId,title:edition.title,
      body:edition.knowledge,detailLevel:input.detailLevel,infographicTemplateId:input.infographicTemplateId||undefined,
      inputFingerprint:input.inputFingerprint,reviewBatchMode:'ready-images',images:{},pages:
        images.map((body,i)=>({pageIndex:i+1,headline:body.match(/^##\s+(.+)$/m)?.[1]||edition.title,body,imageJobId:input.imageJobIds[i],knowledgeRole:'illustration' as const,...(supplements[i]?{supplement:supplements[i]}:{})})),
    };
  }
  const reading = knowledgeCardLayoutSource({ ...input, markdown: input.fullMarkdown, images: [] });
  const illustrations = planKnowledgeCardPages(input.illustrationMarkdown, input.distillModel).pages;
  if (!illustrations.length || illustrations.length !== input.imageJobIds.length || new Set(input.imageJobIds).size !== input.imageJobIds.length)
    throw new Error("配图任务与原稿页数不一致，尚未开始生成");
  if (input.detailLevel === "full") {
    return {...reading,inputFingerprint:input.inputFingerprint,reviewBatchMode:"ready-images",pages:illustrations.map((body,i)=>({pageIndex:i+1,headline:reading.pages![i]?.headline||`配图 ${i+1}`,body,imageJobId:input.imageJobIds[i],knowledgeRole:"illustration" as const}))};
  }
  const textPages = reading.pages!.map(p => ({ ...p, knowledgeRole: "reading" as const }));
  return { ...reading, inputFingerprint: input.inputFingerprint, detailLevel: input.detailLevel, reviewBatchMode:"ready-images", pages: [
    ...textPages,
    ...illustrations.map((body, i) => ({
      pageIndex: textPages.length + i + 1,
      headline: `配图 ${i + 1}｜${body.match(/^##\s+(.+)$/m)?.[1] || reading.title}`,
      body, imageJobId: input.imageJobIds[i], knowledgeRole: "illustration" as const,
    })),
  ] };
}

/** 已有图片的手动导入也保留全文，不能只把选图段落交给顾问。 */
export function illustratedKnowledgeCardSource(input: {
  owner: string; sourceId: string; fullMarkdown: string; illustrationMarkdown: string;
  detailLevel?: "concise" | "full"; distillModel?: string;
  infographicTemplateId?: string | null; images: readonly string[];
}): LayoutSource {
  const edition=knowledgeEditionParts(input.illustrationMarkdown);
  if(edition){
    if(!input.images.length)return knowledgeCardLayoutSource({...input,markdown:edition.knowledge,images:[]});
    const source=synchronizedKnowledgeCardSource({...input,detailLevel:input.detailLevel||edition.level,imageJobIds:input.images.map((_,i)=>`import-${i}`)});
    const images:Record<number,string>={};let imageIndex=0;
    return {...source,pages:source.pages!.map(page=>{
      if(page.knowledgeRole==='illustration'){const url=input.images[imageIndex++];if(url)images[page.pageIndex]=url;}
      const {imageJobId,...saved}=page;return saved;
    }),images};
  }
  const reading = knowledgeCardLayoutSource({ ...input, markdown: input.fullMarkdown, images: [] });
  if (!input.images.length) return reading;
  const illustrations = knowledgeCardLayoutSource({ ...input, markdown: input.illustrationMarkdown });
  const offset = reading.pages!.length;
  return { ...reading, pages: [
    ...reading.pages!.map(page => ({ ...page, knowledgeRole: "reading" as const })),
    ...illustrations.pages!.map(page => ({ ...page, pageIndex: offset + page.pageIndex, knowledgeRole: "illustration" as const })),
  ], images: Object.fromEntries(Object.entries(illustrations.images || {}).map(([page, url]) => [offset + Number(page), url])) };
}
