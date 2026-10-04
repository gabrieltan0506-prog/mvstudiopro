import { z } from "zod";

export const TEMPLATE_REWRITE_MARKER = "【模板改写建议】";
const text = z.string().trim().min(1).max(800);
export const advisorTemplatePlanSchema = z
  .object({
    publicId: z.string().min(1).max(160),
    reason: text,
    changes: z.array(text).min(2).max(5),
    preserve: text,
  })
  .strict();
export const advisorTemplatePlansSchema = z
  .object({
    kind: z.literal("template-plans"),
    plans: z.array(advisorTemplatePlanSchema).min(3).max(5),
  })
  .strict();
export const advisorRewriteResponseSchema = z
  .object({
    kind: z.literal("template-rewrite"),
    body: z.string().trim().min(40).max(9000),
    endHook: z.string().trim().min(1).max(2000).optional(),
    changes: z.array(text).min(1).max(6),
  })
  .strict();
export const advisorRewriteCandidateSchema = z
  .object({
    episodeIndex: z.number().int().positive(),
    originalEndHook: z.string().max(2000).optional(),
    endHook: z.string().trim().min(1).max(2000).optional(),
    originalBody: z.string().min(1).max(8000),
    rewrittenBody: z.string().min(40).max(9000),
    changes: z.array(text).min(1).max(6),
  })
  .strict();
export type AdvisorRewriteCandidate = z.infer<
  typeof advisorRewriteCandidateSchema
>;

/** 结构与完整性门禁，不把字数检查宣称为创作品质验收。 */
export function validateAdvisorRewriteBody(
  original: string,
  body: string
): void {
  if (!original.trim() || original.length > 8000)
    throw new Error("当前集原稿不完整或超过8000字，未采用改稿");
  if (body.trim() === original.trim())
    throw new Error("改写与原稿相同，请检查顾问回答。");
  if (
    body.trim().length <
      Math.max(40, Math.ceil(original.trim().length * 0.8)) ||
    body.length > 9000 ||
    /\[object Object\]|object_object/i.test(body)
  )
    throw new Error("优化稿未保留完整单集正文，原稿保留");
  const sceneIds = Array.from(
    original.matchAll(/(?:场次|場次)\s*(E\d+-S\d+)\b/gi)
  ).map(m => m[1].toUpperCase());
  if (sceneIds.some(id => !new RegExp(`\\b${id}\\b`, "i").test(body)))
    throw new Error("优化稿缺少原集场次，原稿保留");
}
export const TEMPLATE_REWRITE_DELIVERY = `输出可直接套用的完整单集剧本，不交分析报告或操作建议；未改的场次和正文也必须完整保留。只借模板的创作方法，不搬入来源人物、剧情或强加回忆。结合本集具体情况改进节奏、场景空间与调度、人物关系及动作、服装妆容、灯光色彩、声音氛围和自然对白；只用适合本集的特色，不机械加满所有效果。保留人物身份、动机、关键因果、场次编号及格式，核对会面、威胁、行动和后果的日期先后，例如明晚会面不能因未赴约而在明早受罚。用简体中文。仅在answer内返回对象或JSON文本：{"kind":"template-rewrite","body":"完整单集正文，不超过9000字","endHook":"与正文时序一致的完整片尾钩子，不超过2000字","changes":["实际落实的具体变化，不超过6条"]}。用户确认前不写回项目、不生成媒体。`;
