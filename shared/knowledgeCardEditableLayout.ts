import { knowledgeEditionIllustratedPages, planKnowledgeCardPages } from "./knowledgeCardPagination";
import type { LayoutSource } from "./editableLayout";
import {knowledgeEditionParts} from './knowledgeCardEdition';
import { KNOWLEDGE_READING_CONTRACT } from "./knowledgeEditionBudget";
import { KNOWLEDGE_SUPPLEMENT_MAX_CHARS } from "./knowledgePublication";

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
    // 主题图只画核心图解；图外细节（overflow）与并入的文字模块排在该图下方及续页；headline为图下内文标题。
    const pages=knowledgeEditionIllustratedPages(input.illustrationMarkdown)!;
    const images=pages.map(page=>page.body);
    if(!images.length||images.length!==input.imageJobIds.length||new Set(input.imageJobIds).size!==images.length)
      throw Error('配图任务与实际知识模块不一致，尚未开始生成');
    return {kind:'knowledge-publication',owner:input.owner,sourceId:input.sourceId,title:edition.title,
      body:edition.knowledge,detailLevel:input.detailLevel,infographicTemplateId:input.infographicTemplateId||undefined,
      inputFingerprint:input.inputFingerprint,reviewBatchMode:'ready-images',readingContract:KNOWLEDGE_READING_CONTRACT,images:{},pages:
        pages.map((page,i)=>({pageIndex:i+1,headline:page.headline||edition.title,body:page.body,imageJobId:input.imageJobIds[i],knowledgeRole:'illustration' as const,...(page.supplement?{supplement:page.supplement}:{})})),
    };
  }
  const reading = knowledgeCardLayoutSource({ ...input, markdown: input.fullMarkdown, images: [] });
  const illustrations = planKnowledgeCardPages(input.illustrationMarkdown, input.distillModel).pages;
  if (!illustrations.length || illustrations.length !== input.imageJobIds.length || new Set(input.imageJobIds).size !== input.imageJobIds.length)
    throw new Error("配图任务与原稿页数不一致，尚未开始生成");
  if (input.detailLevel === "full") {
    return {...reading,inputFingerprint:input.inputFingerprint,reviewBatchMode:"ready-images",readingContract:KNOWLEDGE_READING_CONTRACT,pages:illustrations.map((body,i)=>({pageIndex:i+1,headline:reading.pages![i]?.headline||`配图 ${i+1}`,body,imageJobId:input.imageJobIds[i],knowledgeRole:"illustration" as const}))};
  }
  const textPages = reading.pages!.map(p => ({ ...p, knowledgeRole: "reading" as const }));
  return { ...reading, inputFingerprint: input.inputFingerprint, detailLevel: input.detailLevel, reviewBatchMode:"ready-images", readingContract: KNOWLEDGE_READING_CONTRACT, pages: [
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

/** 云端排版库整库上限（与服务端 editableLayoutStore 一致）。 */
export const KNOWLEDGE_LAYOUT_LIBRARY_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 出图前在本地先查一遍超限页：超限时给出哪一章、多少字、怎么办，不让整册在表结构校验里只抛一句笼统错误。
 * 只读、不改稿，不影响任何摘要与请求身份。
 */
export function knowledgeLayoutSourceOversize(source: LayoutSource): string | null {
  const bad: string[] = [];
  for (const page of source.pages || []) {
    const name = `第 ${page.pageIndex} 章「${page.headline.slice(0, 30)}」`;
    if ((page.supplement?.length || 0) > KNOWLEDGE_SUPPLEMENT_MAX_CHARS)
      bad.push(`${name}图外内文 ${page.supplement!.length.toLocaleString()} 字（上限 ${KNOWLEDGE_SUPPLEMENT_MAX_CHARS.toLocaleString()}）`);
  }
  if (!bad.length) return null;
  const level = source.detailLevel === "concise" ? "精华版" : source.detailLevel === "full" ? "完整版" : "当前稿件";
  return `${level}出图前检查未通过，尚未开始出图、未扣费：${bad.slice(0, 3).join("；")}${bad.length > 3 ? ` 等 ${bad.length} 处` : ""}。请改用完整版（每章配图更多、图外内文更分散），或先精简这些章节后再出图。`;
}

/** 整库保存前检查体积；超限时提前说明，不发出必被拒的保存请求。 */
export function knowledgeLayoutLibraryOversize(bytes: number): string | null {
  return bytes > KNOWLEDGE_LAYOUT_LIBRARY_MAX_BYTES
    ? `云端稿件库将达 ${(bytes / 1048576).toFixed(1)}MB，超过 64MB 上限，尚未开始出图、未扣费。请先在排版稿列表中删除不再需要的旧稿后再出图。`
    : null;
}
