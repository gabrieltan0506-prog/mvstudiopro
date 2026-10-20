import { maskMediaProviderDetails } from "./maskMediaUrls";

/** 仅整理创作说明和错误提示的展示用语；不改原始回执、歌词、请求或错误分类。 */
export function creativeUserText(value: string): string {
  return maskMediaProviderDetails(value).replace(
    /Gemini(?:\s*\d+(?:\.\d+)*)?(?:\s*(?:Flash|Pro))?|GLM(?:[-\s]*\d+(?:\.\d+)*)?(?:\s*FlashX?)?|(?:GPT[-\s]*6[-\s]*)?Astra|Suno(?:[-\s]*V?\d+)?|Image\s*2(?:\.5)?\s*Flare/gi,
    "创作服务"
  );
}
