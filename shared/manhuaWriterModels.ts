/** 2026-10-04：编剧扩写只选模型，两个模型均每集 6 积分。 */
export const MANHUA_WRITER_MODELS = [
  { id: "glm", label: "GLM" },
  { id: "deepseek", label: "DeepSeek" },
] as const;
export type ManhuaWriterModel = (typeof MANHUA_WRITER_MODELS)[number]["id"];
export const MANHUA_WRITER_EPISODE_CREDITS = 6;
export function manhuaWriterModelLabel(model: ManhuaWriterModel): string {
  return model === "deepseek" ? "DeepSeek" : "GLM";
}
export function manhuaWriterExpansionQuote(episodeCount: number, fromEpisode = 0) {
  const total = Math.min(6, Math.max(2, Math.floor(episodeCount) || 3));
  const start = Math.min(total, Math.max(0, Math.floor(fromEpisode) || 0));
  const episodes = start > 0 ? total - start + 1 : total;
  return { episodes, credits: episodes * MANHUA_WRITER_EPISODE_CREDITS };
}
