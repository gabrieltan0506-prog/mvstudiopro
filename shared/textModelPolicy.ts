/** 下架模型只用于识别历史草稿，不能重新发送给供应商。 */
export const PLATFORM_TEXT_MODEL = "z-ai/glm-5.3-flashx" as const;
export const PLATFORM_TEXT_MODEL_SHORT = "glm-5.3-flashx" as const;
export function isRetiredKimiModel(raw: unknown): boolean {
  return /^(?:[^/]+\/)?kimi(?:-k3)?(?::[^\s]+)?$/i.test(String(raw || "").trim());
}
export function migrateRetiredTextModel(raw: unknown): string {
  const model = String(raw || "").trim();
  return isRetiredKimiModel(model) ? PLATFORM_TEXT_MODEL : model;
}
