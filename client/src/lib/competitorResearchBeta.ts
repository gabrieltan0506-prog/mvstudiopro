/**
 * 竞品调研「内测中」闸门。
 *
 * 用户 2026-08-05 明文：竞品调研先只换模型（Gemini → GPT-5.6 Sol Ultra），
 * 等 `/canvas` 修好再对外开放；在此之前**暂时隐藏入口链接**并标注内测中。
 * supervisor / admin 仍可进入，用于内部验收。
 */

export const COMPETITOR_RESEARCH_BETA_LABEL_ZH = "内测中 · 近期开放";
export const COMPETITOR_RESEARCH_BETA_NOTE_ZH =
  "竞品调研正在内测，近期开放。这段时间可以先用平台创作的趋势看板与视频深度拆解。";

/** supervisor / admin 可进入内测中的竞品调研 */
export function canOpenCompetitorResearch(role: string | null | undefined): boolean {
  const r = String(role || "").trim().toLowerCase();
  return r === "supervisor" || r === "admin";
}
