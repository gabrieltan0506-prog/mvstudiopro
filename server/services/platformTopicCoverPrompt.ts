/**
 * 與 Vertex（Nano Banana Pro / Nano Banana 2）與 OhMyGPT **gpt-image-2** 共用的鏡頭·光影·材質語彙；
 * 與比例鎖、2×4 像素鎖、版式指令可同條 prompt 並存，一般不衝突。
 */
export const PLATFORM_SHARED_IMAGE_PHOTOGRAPHY_MODIFIERS = [
  "Shot on 35mm lens, f/1.4 aperture",
  "editorial realism: volumetric motivated light, gentle bloom and falloff, believable skin and fabric micro-texture",
  "color grade with chromatic intent—punchy contrast or luxe muted blocking as the hook demands, not default stock gray",
  "hyper-detailed textures, ultra-photorealistic, 8k",
  "award-winning photography: deliberate background—generous negative space for hero type OR a rich contextual set; avoid generic gray voids",
].join(", ");

/**
 * 平台選題 **豎版單幀封面**：與 {@link generateGptImage2FromRawEnglishPrompt} 主路徑一致的比例約束文案，
 * 供 Vertex Nano Banana Pro / Nano Banana 2 對齊 OhMyGPT gpt-image-2（`1024×1536` 豎版白名單語義）。
 */
export const PLATFORM_TOPIC_COVER_GPT2_ASPECT_LOCK_PROMPT_SUFFIX =
  "CRITICAL OUTPUT SIZE: match OpenAI gpt-image-2 portrait **1024×1536** (taller than wide, ~2:3), full-bleed vertical cover — not 16:9 landscape, not 1:1 square hero, not letterboxed cinematic wide frame.";

/**
 * 英文視覺主體（已含譯文/提煉）後拼 GPT-IMAGE-2 同款比例鎖；可選試讀水印尾（與 gpt-image 路徑一致）。
 */
export function buildGptImage2AlignedPlatformTopicCoverPrompt(
  englishCore: string,
  trialWatermarkPromptSuffix?: string,
): string {
  const core = String(englishCore || "").trim();
  const tw = String(trialWatermarkPromptSuffix || "").trim();
  return [core, PLATFORM_TOPIC_COVER_GPT2_ASPECT_LOCK_PROMPT_SUFFIX, tw].filter(Boolean).join("\n\n");
}
