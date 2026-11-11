/** 2026-10-04：编剧扩写只选模型，两个模型均每集 6 积分。 */
export const MANHUA_WRITER_MODELS = [
  { id: "glm", label: "线路一" },
  { id: "deepseek", label: "线路二" },
] as const;
export type ManhuaWriterModel = (typeof MANHUA_WRITER_MODELS)[number]["id"];
export const MANHUA_WRITER_EPISODE_CREDITS = 6;
export const MANHUA_WRITER_GENERATION_MIN = 3;
export function manhuaWriterModelLabel(model: ManhuaWriterModel): string {
  // 前台与扣费记录只露中性线路名（模型名是商业机密，与 ManhuaEpisodeOptimization「线路一／二」同口径）
  return model === "deepseek" ? "线路二" : "线路一";
}
export function manhuaWriterExpansionQuote(episodeCount: number, fromEpisode = 0) {
  const total = Math.min(6, Math.max(MANHUA_WRITER_GENERATION_MIN, Math.floor(episodeCount) || 3));
  const start = Math.min(total, Math.max(0, Math.floor(fromEpisode) || 0));
  const episodes = start > 0 ? total - start + 1 : total;
  return { episodes, credits: episodes * MANHUA_WRITER_EPISODE_CREDITS };
}
