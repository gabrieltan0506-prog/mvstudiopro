import {
  OPENAI_IMAGE_VARIANT_DEFAULT,
  OPENAI_IMAGE_VARIANT_STORAGE_KEY,
  normalizeOpenAiImageVariantMode,
  type OpenAiImageVariant,
  type OpenAiImageVariantMode,
} from "@shared/openaiImageVariant";

/** 读开关三档；读不到（隐私模式/被禁）一律 flare。 */
export function readOpenAiImageVariantMode(): OpenAiImageVariantMode {
  try {
    return normalizeOpenAiImageVariantMode(localStorage.getItem(OPENAI_IMAGE_VARIANT_STORAGE_KEY)) ?? OPENAI_IMAGE_VARIANT_DEFAULT;
  } catch {
    return OPENAI_IMAGE_VARIANT_DEFAULT;
  }
}

/** 单张出图用的档位：「双档各一张」在只出一张的入口按 flare 走（知识卡/资产标准化等不双开）。 */
export function readOpenAiImageVariantPref(): OpenAiImageVariant {
  const mode = readOpenAiImageVariantMode();
  return mode === "both" ? OPENAI_IMAGE_VARIANT_DEFAULT : mode;
}

export function writeOpenAiImageVariantPref(next: OpenAiImageVariantMode): void {
  try {
    localStorage.setItem(OPENAI_IMAGE_VARIANT_STORAGE_KEY, next);
  } catch {
    // 记不住就每次默认 flare
  }
}
