import { z } from "zod";

/** 0906 用户要求：这两栏是学习产品的必交内容，空白与旧占位文案都不算产出。 */
const summaryText = z
  .string()
  .trim()
  .min(2)
  .refine(value => value !== "本集未整理出该项");
export const nativeRequiredSummarySchema = z.object({
  reusableZh: summaryText,
  genPromptHintZh: summaryText,
});
export const NATIVE_REQUIRED_SUMMARY_KEYS = [
  "reusableZh",
  "genPromptHintZh",
] as const;
const labels = { reusableZh: "可复用手法", genPromptHintZh: "剧情要素" };

export function assertNativeRequiredSummary(value: unknown): void {
  const result = nativeRequiredSummarySchema.safeParse(value);
  if (result.success) return;
  const missing = NATIVE_REQUIRED_SUMMARY_KEYS.filter(
    key =>
      !summaryText.safeParse((value as Record<string, unknown> | null)?.[key])
        .success
  );
  throw new Error(
    `学习内容不完整：${missing.map(key => labels[key]).join("、")}必须有非空内容；已保存的原始证据保留`
  );
}

/**
 * 仅从调用方已核对身份、按时间排序的原稿恢复漏栏，不调用模型、不修改原稿。
 * 每个来源都必须有该栏，避免把只有前半集的摘要伪装成整集内容。
 */
export function restoreNativeRequiredSummary<T extends Record<string, unknown>>(
  target: T,
  sources: ReadonlyArray<Record<string, unknown>>
): T {
  const restored: Record<string, unknown> = { ...target };
  for (const key of NATIVE_REQUIRED_SUMMARY_KEYS) {
    if (summaryText.safeParse(target[key]).success) continue;
    const values = sources.map(source => summaryText.safeParse(source[key]));
    if (values.length && values.every(value => value.success)) {
      restored[key] = values
        .map(
          (value, index) =>
            `${values.length > 1 ? `【第${index + 1}段】` : ""}${value.data}`
        )
        .join("\n");
    }
  }
  assertNativeRequiredSummary(restored);
  return restored as T;
}
