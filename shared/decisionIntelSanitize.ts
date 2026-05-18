/**
 * 决策智库：用户可读文案后处理（与 LLM 输出、历史存档兼容）。
 */
export function sanitizeDecisionIntelMetricsText(text: string): string {
  let t = text.trim();
  if (!t) return t;
  t = t.replace(/模拟|模拟/g, "参考历史样本");
  t = t.replace(/(\d+\.?\d*)\s*pp\b/gi, "$1 个百分点");
  t = t.replace(/\bpp\b/gi, "个百分点");
  return t;
}
