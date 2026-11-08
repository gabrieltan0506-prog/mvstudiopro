import { z } from "zod";
import { knowledgeVisualDesignSchema, validateKnowledgeDesignBatch } from "./knowledgeDecorations";
import type { EditableLayout } from "./editableLayout";
import type { KnowledgeReview } from "./knowledgePublication";
import { knowledgeReadingSchema, knowledgeReadingMarkdown } from "./knowledgePublicationLayout";

/** 模型偶尔把 reading.subtitle 写到 presentation 层；归位到 reading（已有则保留 reading 的），其余未知字段仍按合同拒收。 */
function liftPresentationSubtitle(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("subtitle" in value)) return value;
  const { subtitle, ...rest } = value as Record<string, unknown>;
  const reading = rest.reading;
  if (typeof subtitle === "string" && reading && typeof reading === "object" && !Array.isArray(reading)) {
    const r = reading as Record<string, unknown>;
    if (typeof r.subtitle !== "string" || !r.subtitle.trim()) return { ...rest, reading: { ...r, subtitle } };
  }
  return rest;
}
/** 顾问只安排已保存章节；展示正文独立保存，完整底稿、原图和原审校不覆盖。 */
export const knowledgeBookLayoutPlanSchema = z.object({
  kind: z.literal("knowledge_book_layout_v1"),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  chapters: z.array(z.object({
    pageId: z.string().uuid(),
    design: knowledgeVisualDesignSchema.optional(),
    templateId: z.string().max(100).optional(),
    presentation: z.preprocess(liftPresentationSubtitle, z.object({
      reading: knowledgeReadingSchema,
      imageEvidencePageIds: z.array(z.string().uuid()),
      reason: z.string().trim().min(1).max(1500),
    }).strict()).optional(),
  }).strict()).min(1),
}).strict();
export type KnowledgeBookLayoutPlan = z.infer<typeof knowledgeBookLayoutPlanSchema>;
export type KnowledgeBookLayoutInput = {
  sourceDigest: string;
  title: string;
  detailLevel?: "concise" | "full";
  pages: {
    id: string; headline: string; body: string; hasImage: boolean;
    imageDescription: string; cautions: KnowledgeReview["pages"][number]["cautions"];
    imageStatus?: KnowledgeReview["pages"][number]["imageStatus"];
    facts?: KnowledgeReview["pages"][number]["facts"];
    previousDesign?: z.infer<typeof knowledgeVisualDesignSchema>;
  }[];
};
export function validateKnowledgeBookLayoutPlan(value: unknown, input: Pick<KnowledgeBookLayoutInput,"sourceDigest"|"pages"|"detailLevel">) {
  const plan = knowledgeBookLayoutPlanSchema.parse(value);
  if (plan.sourceDigest !== input.sourceDigest) throw Error("排版方案与当前完整稿件不一致，请让顾问重新规划");
  const expected = new Set(input.pages.map(p => p.id));
  if (expected.size !== input.pages.length || plan.chapters.length !== expected.size ||
      new Set(plan.chapters.map(p => p.pageId)).size !== expected.size || plan.chapters.some(p => !expected.has(p.pageId)))
    throw Error("排版方案必须恰好保留全部原文和配图章节，不得漏页、重页或增加未知章节");
  for (const chapter of plan.chapters) {
    const presentation = chapter.presentation;
    if (!presentation) continue;
    const imageIds = presentation.imageEvidencePageIds;
    if (new Set(imageIds).size !== imageIds.length || imageIds.some(id => {
      const image = input.pages.find(p => p.id === id);
      return !image?.hasImage || image.imageStatus !== "consistent" || !image.imageDescription.trim();
    })) throw Error("图文排版只能依据已实际审校且一致的原图，不得引用缺图或不确定的图片代替文字");
    if (input.detailLevel === "full" && !imageIds.length)
      throw Error("完整版展示正文调整必须列出实际承载知识的原图；未配图章节保留完整文字");
    if (knowledgeReadingMarkdown(presentation.reading).length > 12000)
      throw Error("排版展示正文超出章节容量，未截断或覆盖完整底稿");
  }
  validateKnowledgeDesignBatch(plan.chapters.filter(p=>p.design).map(p => ({reading:{decoration:{design:p.design}}})));
  return plan;
}
export function selectedKnowledgeBookLayout(doc: EditableLayout) {
  const id = doc.publication?.layoutConversationId;
  if (!id) return undefined;
  const turn = doc.publication?.conversation?.find(t => t.request.id === id);
  if (turn?.request.action !== "layout" || !turn.response?.layoutPlan) throw Error("已选排版方案缺少原顾问回执，请恢复该次排版");
  return turn.response.layoutPlan;
}
export function applyKnowledgeBookLayout(doc: EditableLayout, review: KnowledgeReview, input: KnowledgeBookLayoutInput, value: unknown) {
  const plan = validateKnowledgeBookLayoutPlan(value, input);
  const pages = new Map(doc.pages.map(p => [p.id,p]));
  const reviews = new Map(review.pages.map(p => [p.id,p]));
  if (reviews.size !== pages.size || doc.pages.some(p => !reviews.has(p.id))) throw Error("排版正文与审校章节不一致");
  return {
    doc: {...doc,pages:plan.chapters.map(p => {
      const original = pages.get(p.pageId)!;
      return p.presentation ? {...original,body:knowledgeReadingMarkdown(p.presentation.reading)} : original;
    })},
    review: {...review,pages:plan.chapters.map(p => {
      const original = reviews.get(p.pageId)!;
      return p.presentation ? {...original,body:knowledgeReadingMarkdown(p.presentation.reading),reading:p.presentation.reading} : original;
    })},
  };
}
export const KNOWLEDGE_BOOK_LAYOUT_INSTRUCTIONS = `本次是执行整册重新排版，不是只给建议。bookLayout包含原册与已关联补充稿的完整正文、真实配图审校描述、全部facts和detailLevel。按内容决定图文章节次序，将图卡放到对应文字附近；每个pageId必须出现且只出现一次，不得新增事实、新生图或丢弃章节。只依据实际提供的审校描述理解图片，不能假称本次重新看过未附图片。
两档使用同一完整文字底稿，不能改动底稿。concise精华配图少，应保留较详细的解释，未配图知识必须文字完整说明；full完整版配图多，须逐项核对facts与实际imageDescription，把图片已经清楚表达的重复说明减少为必要的读图提示，保留图上没有说明的因果、限定、例子和全部未配图知识。不能只按字数、标题或版面目标删减。
精华版每章、完整版已审校一致且有具体观察的图片章必须输出presentation；不要只返回样式或重排后声称完成。未配图或图片尚未核验的完整版章节保留原稿。presentation={reading:完整的结构化展示文字,imageEvidencePageIds:[实际承载被减少重复知识的图片pageId],reason:具体哪些知识由哪些图表达、哪些仍以文字保留}；reading结构与原审校相同（version:1,subtitle,accent,blocks），每个块必须有title和note，prose块用text、table块用columns/rows、cards块用items，不能写HTML。程序从reading生成展示正文，不会替你裁字。full只有明确引用hasImage=true、imageStatus=consistent且imageDescription非空的原图才允许提供presentation；没有可靠图片依据则省略presentation并保留原正文。concise允许依据原稿补足说明，不新增事实。逐项保证facts的知识在文字或所列图片至少一处明确承载。原source、完整manuscript及原审校永久保留。
输出layoutPlan={kind:"knowledge_book_layout_v1",sourceDigest:"原值",chapters:[{pageId:"原id",design:{palette,layout,table,frame,motif,reason},presentation:可选对象}]}，chapters数组顺序就是最终PDF顺序。逐章按内容选择配色、版式、表格、边框与纹样；不得机械套同一方案。answer简述安排，sources=[]，supplementalImages=[]。程序只执行你返回且通过校验的方案，不会替你补选样式、插页或删改文字。`;
