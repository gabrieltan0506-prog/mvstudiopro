/**
 * 剪辑台 · 包装动效点选：挂现有 motionPromptBank，可选注入。
 */

import {
  MOTION_PROMPT_BANK,
  MOTION_PROMPT_CATEGORY_LABEL_ZH,
  buildMotionPromptInjectBlock,
  getMotionPromptById,
  type MotionPromptCategory,
  type MotionPromptEntry,
} from "./motionPromptBank.js";

/** 漫剧剪辑台优先露出的包装分类（与图文广告库分区一致） */
export const MANHUA_EDIT_MOTION_CATEGORIES: readonly MotionPromptCategory[] = [
  "logo",
  "caption",
  "product_ad",
] as const;

export const MANHUA_EDIT_MOTION_MAX = 2;

export function listManhuaEditMotionEntries(
  category?: MotionPromptCategory,
): MotionPromptEntry[] {
  const cats = category
    ? [category]
    : ([...MANHUA_EDIT_MOTION_CATEGORIES] as MotionPromptCategory[]);
  return MOTION_PROMPT_BANK.filter((e) => cats.includes(e.category));
}

export function toggleManhuaEditMotionId(
  current: string[],
  id: string,
  max = MANHUA_EDIT_MOTION_MAX,
): string[] {
  const key = String(id || "").trim();
  if (!key || !getMotionPromptById(key)) return current;
  if (current.includes(key)) return current.filter((x) => x !== key);
  if (current.length >= max) return [...current.slice(1), key];
  return [...current, key];
}

export function manhuaEditMotionInjectPreview(ids: string[]): string {
  return buildMotionPromptInjectBlock(ids);
}

export function manhuaEditMotionCategoryLabel(cat: MotionPromptCategory): string {
  return MOTION_PROMPT_CATEGORY_LABEL_ZH[cat];
}
