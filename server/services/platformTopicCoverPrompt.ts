/**
 * 與 Vertex（Nano Banana Pro / Nano Banana 2）與 OhMyGPT **gpt-image-2** 共用的鏡頭·光影·材質語彙；
 * 與比例鎖、2×4 像素鎖、版式指令可同條 prompt 並存，一般不衝突。
 */
import { PLATFORM_FASHION_EDITORIAL_CHARACTER_EN } from "../../shared/platformFashionEditorialCharacter.js";

export const PLATFORM_SHARED_IMAGE_PHOTOGRAPHY_MODIFIERS = [
  "Shot on 35mm lens, f/1.8 aperture",
  "bright natural daylight or soft golden-hour side light — lively, youthful, healthy mood",
  "avoid default low-key gloom, heavy shadows, funeral-dark grading, or overly serious corporate portrait lighting",
  "hyper-detailed textures, ultra-photorealistic, 8k",
  "award-winning photography: generous negative space for a short hero headline; lifestyle editorial, not encyclopedia poster",
  "color grade with chromatic intent—fresh contrast and one accent color; not muddy gray or oppressive dark-gold",
  /** 封面字数硬锁：禁止说明书式多行文案（用户反馈 GPT-image/NB2 易印满屏字） */
  "ON-IMAGE TEXT HARD LIMIT: at most ONE short Simplified Chinese hero line (8–14 chars) plus optional one tiny subline; NO paragraph, NO 3+ lines of copy, NO footer call-to-action walls, NO bullet lists of tips",
  PLATFORM_FASHION_EDITORIAL_CHARACTER_EN,
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
