import { MANHUA_DIALOGUE_CRAFT_ZH } from "@shared/manhuaDialogueCraft";
import { z } from "zod";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

const text = z.string().trim().min(1).max(800);
export const advisorTemplatePlanSchema = z.object({
  publicId: z.string().min(1).max(160),
  reason: text,
  changes: z.array(text).min(2).max(5),
  preserve: text,
}).strict();
export type AdvisorTemplatePlan = z.infer<typeof advisorTemplatePlanSchema>;
const plansSchema = z.object({ kind: z.literal("template-plans"), plans: z.array(advisorTemplatePlanSchema).min(3).max(4) }).strict();
const rewriteSchema = z.object({ kind: z.literal("template-rewrite"), body: z.string().trim().min(40).max(9000), changes: z.array(text).min(1).max(6) }).strict();
export const advisorRewriteCandidateSchema = z.object({
  episodeIndex: z.number().int().positive(), originalBody: z.string().min(1).max(8000),
  rewrittenBody: z.string().min(40).max(9000), changes: z.array(text).min(1).max(6),
}).strict();
export type AdvisorRewriteCandidate = z.infer<typeof advisorRewriteCandidateSchema>;

function parseJson(answer: string): unknown {
  return JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}
export function parseAdvisorTemplatePlans(answer: string, templates: PublicManhuaViralTemplateCard[]): AdvisorTemplatePlan[] {
  try {
    const parsed = plansSchema.parse(parseJson(answer));
    const ids = new Set(templates.map(t => t.publicId));
    if (new Set(parsed.plans.map(p => p.publicId)).size !== parsed.plans.length || parsed.plans.some(p => !ids.has(p.publicId))) return [];
    return parsed.plans;
  } catch { return []; }
}
export function formatAdvisorRewriteAnswer(answer: string): string {
  try {
    const result = rewriteSchema.parse(parseJson(answer));
    return `改写建议（尚未自动采用）\n${result.changes.map(change => `• ${change}`).join("\n")}\n\n${result.body}`;
  } catch { return answer; }
}
export function parseAdvisorRewrite(answer: string, episodeIndex: number, originalBody: string): AdvisorRewriteCandidate {
  const result = rewriteSchema.parse(parseJson(answer));
  if (result.body === originalBody.trim()) throw new Error("改写与原稿相同，请检查顾问回答。");
  return advisorRewriteCandidateSchema.parse({ episodeIndex, originalBody, rewrittenBody: result.body, changes: result.changes });
}
export const TEMPLATE_PLAN_QUESTION = '请根据当前故事推荐3—4个不同的库内剧本模板方案，说明适配依据、具体改动与保留内容。仅在answer字段内返回JSON文本，不加说明或代码围栏：{"kind":"template-plans","plans":[{"publicId":"库内ID","reason":"依据当前故事的理由","changes":["改动1","改动2"],"preserve":"保留的人物、动机与因果"}]}。plans为3—4个不同模板，不得编造ID。';
export const TEMPLATE_REWRITE_QUESTION = '【模板改写建议】' + MANHUA_DIALOGUE_CRAFT_ZH + '\n' + '按所选方案改写当前集完整正文，保留人物身份、动机、关键因果与剧本格式，不得省略未改部分；先对比再采用，不写回项目。仅在answer字段内返回JSON文本：{"kind":"template-rewrite","body":"完整改写正文（不超过9000字）","changes":["具体变化"]}。';
export function buildTemplatePlanQuestion(templates: PublicManhuaViralTemplateCard[]): string {
  const cards = templates.slice(0, 6).map(t => ({ publicId: t.publicId, name: t.nameZh, feature: (t.featureZh || t.introZh).slice(0, 160) }));
  if (cards.length < 3) throw new Error("当前可用模板不足3个，暂不能生成3—4方案。");
  const question = `${TEMPLATE_PLAN_QUESTION}\n可选模板：${JSON.stringify(cards)}`;
  if (question.length > 3900) throw new Error("候选模板资料超出问答容量，请精简后再推荐。");
  return question;
}
export function buildTemplateRewriteQuestion(plan: AdvisorTemplatePlan): string {
  return `【模板改写建议】${MANHUA_DIALOGUE_CRAFT_ZH}\n按这个已选方案改写当前集完整正文：${JSON.stringify(plan)}。保留原人物身份、动机、世界观、关键因果和剧本格式，落实方案的结构节奏；不要仅给摘要或省略未改部分。不写回正式稿，等待用户对比采用。仅在answer字段内返回JSON文本：{"kind":"template-rewrite","body":"完整改写正文（不超过9000字）","changes":["具体变化"]}。`;
}
