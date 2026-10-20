import { MARKETING_PLAN_STEPS, type MarketingPlanResult } from "./marketingPlan";

/** 兼容旧方案的来源署名；完整原始内容和回执仍保留在服务端。 */
export function marketingPublicText(text: string): string {
  return text.replace(/DeepSeek(?:[ \t]+(?:1017|high|v4\.1[- ]flash(?:-1017)?))*/gi, "方案一")
    .replace(/GLM(?:[ \t]+(?:FlashX|high|5\.3[- ]flashx))*/gi, "方案二");
}

/** 原始服务异常不进入正文；保留明确可行动的业务提示。 */
export function marketingPublicError(value: unknown, fallback = "暂时无法处理，请稍后重试。已保存的内容仍保留。"): string {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return /^(?:需求须为|加入方案后超过|方案不存在|没有未完成|没有失败的结算|该步骤没有失败|先恢复两份原稿|已有另一份营销方案|积分不足|请先登录|上次请求结果尚未确认|返回不完整或格式不符合要求|请求未取得完整回执|三份内容已保存)/.test(message)
    && !/DeepSeek|GLM|token|provider|https?:|high|FlashX/i.test(message) ? message : fallback;
}

/** 仅用于公开API及视图，不能用于重试CAS或写回原始结果。 */
export function publicMarketingPlan(result: MarketingPlanResult): MarketingPlanResult {
  const steps = { ...result.steps };
  for (const step of MARKETING_PLAN_STEPS) {
    const raw = result.steps[step];
    steps[step] = { status: raw.status,
      text: raw.text === undefined ? undefined : marketingPublicText(raw.text),
      adoptionBrief: raw.adoptionBrief === undefined ? undefined : marketingPublicText(raw.adoptionBrief),
      error: raw.error ? marketingPublicError(raw.error) : undefined };
  }
  return { version: result.version, context: result.context, steps, billing: result.billing,
    chargedCredits: result.chargedCredits, billingError: result.billingError ? marketingPublicError(result.billingError, "结算暂未成功，已保存的方案仍保留。") : undefined };
}
