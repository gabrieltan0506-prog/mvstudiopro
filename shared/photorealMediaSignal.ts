/**
 * 仿真人（photoreal）参考素材信号。
 *
 * 口径（2026-08-10 博客实测对齐）：BytePlus/OpenRouter 拦的是**带真人照片参考**的生成
 * （仿真人角色库图，防深伪），不拦纯提示词写实脸——所以只有命中仿真人素材路径的请求
 * 才切 EvoLink（不拦、贵 25%），纯写实风格照走便宜主路径。
 * 素材库路径形态见 shared/manhuaCharacterAssetLibrary.ts：
 * /manhua-characters/photoreal/、photoreal-age/、photoreal-gen/ 等。
 */
const PHOTOREAL_URL_PATTERN = /\/photoreal(?:-[a-z0-9]+)?\//i;

export function isPhotorealReferenceUrl(url?: string | null): boolean {
  return PHOTOREAL_URL_PATTERN.test(String(url || ""));
}

/** 任一参考素材 URL 命中仿真人路径即视为 photoreal 请求 */
export function hasPhotorealReferenceUrl(
  urls: Array<string | null | undefined>,
): boolean {
  return urls.some((u) => isPhotorealReferenceUrl(u));
}
