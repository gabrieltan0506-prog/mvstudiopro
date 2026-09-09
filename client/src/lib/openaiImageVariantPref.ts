import {
  OPENAI_IMAGE_VARIANT_DEFAULT,
  OPENAI_IMAGE_VARIANT_STORAGE_KEY,
  normalizeOpenAiImageVariant,
  type OpenAiImageVariant,
} from "@shared/openaiImageVariant";

/** 读出图档位开关；读不到（隐私模式/被禁）一律 flare。 */
export function readOpenAiImageVariantPref(): OpenAiImageVariant {
  try {
    return normalizeOpenAiImageVariant(localStorage.getItem(OPENAI_IMAGE_VARIANT_STORAGE_KEY)) ?? OPENAI_IMAGE_VARIANT_DEFAULT;
  } catch {
    return OPENAI_IMAGE_VARIANT_DEFAULT;
  }
}

export function writeOpenAiImageVariantPref(next: OpenAiImageVariant): void {
  try {
    localStorage.setItem(OPENAI_IMAGE_VARIANT_STORAGE_KEY, next);
  } catch {
    // 记不住就每次默认 flare
  }
}
