import { TEMPLATE_CATALOG_REQUEST_MARKER } from "@shared/manhuaTemplateCraft";
import { MANHUA_DIALOGUE_CRAFT_ZH } from "@shared/manhuaDialogueCraft";
import { z } from "zod";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

import { advisorTemplatePlanSchema, advisorTemplatePlansSchema as plansSchema, advisorRewriteResponseSchema as rewriteSchema, advisorRewriteCandidateSchema, validateAdvisorRewriteBody, TEMPLATE_REWRITE_DELIVERY } from "@shared/manhuaAdvisorRewrite";
export { advisorRewriteCandidateSchema } from "@shared/manhuaAdvisorRewrite";
export type { AdvisorRewriteCandidate } from "@shared/manhuaAdvisorRewrite";
import type { AdvisorRewriteCandidate } from "@shared/manhuaAdvisorRewrite";
export type AdvisorTemplatePlan = z.infer<typeof advisorTemplatePlanSchema>;

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
export function parseAdvisorRewrite(answer: string, episodeIndex: number, originalBody: string, originalEndHook?: string): AdvisorRewriteCandidate {
  const result = rewriteSchema.parse(parseJson(answer));
  validateAdvisorRewriteBody(originalBody, result.body);
  return advisorRewriteCandidateSchema.parse({ episodeIndex, originalBody, rewrittenBody: result.body, changes: result.changes, ...(result.endHook ? { endHook: result.endHook, originalEndHook: originalEndHook || "" } : {}) });
}
export const TEMPLATE_PLAN_QUESTION = TEMPLATE_CATALOG_REQUEST_MARKER + '请根据当前故事推荐3—5个不同的库内剧本模板方案，说明适配依据、具体改动与保留内容。仅在answer字段内返回JSON文本，不加说明或代码围栏：{"kind":"template-plans","plans":[{"publicId":"库内ID","reason":"依据当前故事的理由","changes":["改动1","改动2"],"preserve":"保留的人物、动机与因果"}]}。plans为3—5个不同模板，不得编造ID。';
export const TEMPLATE_REWRITE_QUESTION = "【模板改写建议】请把所选模板的适用方法落实到当前整集，生成完整优化稿供比较和套用。";
export function buildTemplatePlanQuestion(templates: PublicManhuaViralTemplateCard[]): string {
  if (templates.length < 3) throw new Error("当前可用模板不足3个，暂不能生成模板方案。");
  // Server loads the complete, private methods catalog; no six-card client shortlist.
  return TEMPLATE_PLAN_QUESTION;
}
export function buildTemplateRewriteQuestion(plan: AdvisorTemplatePlan): string {
  return `【模板改写建议】按模板编号 ${plan.publicId} 的已选方案优化当前集：${JSON.stringify(plan)}。\n${TEMPLATE_REWRITE_DELIVERY}\n${MANHUA_DIALOGUE_CRAFT_ZH}`;
}
