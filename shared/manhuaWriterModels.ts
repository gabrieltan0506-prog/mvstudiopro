/** 2026-10-04：编剧扩写只选模型，线路一 / 线路二均每集 6 积分。 */
/**
 * 1111 站长令：小说改编创作加「线路三」（Gemini 4 Carbon，走共用调用层三通道 fallback；全部失败不静默换线，返回可重试提示且不扣点）。
 * 线路三只用于连载扩写与小说改编；其他文字步骤（资产 / 节拍 / 分镜文字、免费试写、单集优化）选线路三时明示改用线路一，见 manhuaWriterAuxModel。
 */
export const MANHUA_WRITER_MODELS = [
  { id: "glm", label: "线路一" },
  { id: "deepseek", label: "线路二" },
  { id: "carbon", label: "线路三" },
] as const;
export type ManhuaWriterModel = (typeof MANHUA_WRITER_MODELS)[number]["id"];
/** 线路一 / 线路二的扩写只认这两条（其他文字步骤的接口入参）。 */
export type ManhuaWriterAuxModel = Exclude<ManhuaWriterModel, "carbon">;
export const MANHUA_WRITER_EPISODE_CREDITS = 6;
/**
 * 线路三每集积分（**占位价，待站长定价**；只保证不亏本，未达 65% 毛利底线）。估算（首发价 $2/$10 每百万 token，输出含思考）：
 * - 普通连载扩写（一次调用）：提示词约 1.3 万字 + 模板 0.5–1.5 万字 ≈ 2–3 万输入 token；6 集正文 + 思考约 3–5 万 token
 *   → 一次约 $0.35–0.55，每集约 $0.06–0.09；12-01 起翻倍，每集约 $0.12–0.18。
 * - 小说改编（先写小说 JSON 再写剧本，两次调用，碎句时各再修一次）：每集约 $0.12–0.18；12-01 起约 $0.24–0.36。
 * 25 积分 ≈ $0.37/集（1 积分 ≈ $0.0147），覆盖最坏情形（12-01 后小说改编）不亏；按 65% 毛利底线，首发期建议 ≥35，12-01 起建议 ≥70。
 */
export const MANHUA_WRITER_CARBON_EPISODE_CREDITS = 25;
export const MANHUA_WRITER_GENERATION_MIN = 3;
/** 不含模型名的线路说明（前台按钮 title / 选项旁提示用）。 */
export const MANHUA_WRITER_MODEL_HINTS: Record<ManhuaWriterModel, string> = {
  glm: "速度快",
  deepseek: "备用线路",
  carbon: "推理更强、更慢、积分更高；仅用于连载扩写与小说改编",
};
export function manhuaWriterModelLabel(model: ManhuaWriterModel): string {
  // 前台与扣费记录只露中性线路名（模型名是商业机密，与 ManhuaEpisodeOptimization「线路一／二」同口径）
  return model === "carbon" ? "线路三" : model === "deepseek" ? "线路二" : "线路一";
}
export function manhuaWriterEpisodeCredits(model: ManhuaWriterModel = "glm"): number {
  return model === "carbon" ? MANHUA_WRITER_CARBON_EPISODE_CREDITS : MANHUA_WRITER_EPISODE_CREDITS;
}
/** 其他文字步骤的线路：线路三只用于扩写 / 改编，这些步骤明示改用线路一（界面提示里写明）。 */
export function manhuaWriterAuxModel(model: ManhuaWriterModel): ManhuaWriterAuxModel {
  return model === "carbon" ? "glm" : model;
}
export function manhuaWriterExpansionQuote(episodeCount: number, fromEpisode = 0, model: ManhuaWriterModel = "glm") {
  const total = Math.min(6, Math.max(MANHUA_WRITER_GENERATION_MIN, Math.floor(episodeCount) || 3));
  const start = Math.min(total, Math.max(0, Math.floor(fromEpisode) || 0));
  const episodes = start > 0 ? total - start + 1 : total;
  return { episodes, credits: episodes * manhuaWriterEpisodeCredits(model) };
}
