import { z } from "zod";
import { knowledgeVisualDesignSchema, validateKnowledgeDesignBatch } from "./knowledgeDecorations";
import type { EditableLayout } from "./editableLayout";
import type { KnowledgeReview } from "./knowledgePublication";

/** 顾问只能安排已保存章节，正文、原图和审校记录不由布局方案重写。 */
export const knowledgeBookLayoutPlanSchema = z.object({
  kind: z.literal("knowledge_book_layout_v1"),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  chapters: z.array(z.object({
    pageId: z.string().uuid(),
    design: knowledgeVisualDesignSchema,
  }).strict()).min(1),
}).strict();
export type KnowledgeBookLayoutPlan = z.infer<typeof knowledgeBookLayoutPlanSchema>;
export type KnowledgeBookLayoutInput = {
  sourceDigest: string;
  title: string;
  pages: {
    id: string; headline: string; body: string; hasImage: boolean;
    imageDescription: string; cautions: KnowledgeReview["pages"][number]["cautions"];
    previousDesign?: z.infer<typeof knowledgeVisualDesignSchema>;
  }[];
};
export function validateKnowledgeBookLayoutPlan(value: unknown, input: Pick<KnowledgeBookLayoutInput,"sourceDigest"|"pages">) {
  const plan = knowledgeBookLayoutPlanSchema.parse(value);
  if (plan.sourceDigest !== input.sourceDigest) throw Error("排版方案与当前完整稿件不一致，请让顾问重新规划");
  const expected = new Set(input.pages.map(p => p.id));
  if (expected.size !== input.pages.length || plan.chapters.length !== expected.size ||
      new Set(plan.chapters.map(p => p.pageId)).size !== expected.size || plan.chapters.some(p => !expected.has(p.pageId)))
    throw Error("排版方案必须恰好保留全部原文和配图章节，不得漏页、重页或增加未知章节");
  validateKnowledgeDesignBatch(plan.chapters.map(p => ({reading:{decoration:{design:p.design}}})));
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
    doc: {...doc,pages:plan.chapters.map(p => pages.get(p.pageId)!)},
    review: {...review,pages:plan.chapters.map(p => reviews.get(p.pageId)!)},
  };
}
export const KNOWLEDGE_BOOK_LAYOUT_INSTRUCTIONS = `本次是执行整册重新排版，不是只给建议。bookLayout包含原册与已关联补充稿的全部完整正文、图片状态和审校描述。按内容决定图文章节次序，将补充图卡放到相关正文附近；每个pageId必须出现且只出现一次，不能改写、缩短、丢弃正文或原图，不得新增事实或新生图。只依据实际提供的审校描述理解图片，不能假称本次重新看过未附图片。
输出layoutPlan={kind:"knowledge_book_layout_v1",sourceDigest:"原值",chapters:[{pageId:"原id",design:{palette,layout,table,frame,motif,reason}}]}，chapters数组顺序就是最终PDF顺序。逐章按内容选择配色、版式、表格、边框与纹样；不得机械套同一方案。answer简述安排，sources=[]，supplementalImages=[]。程序只执行你返回且通过校验的方案，不会替你补选样式、插页或改写文字。`;
