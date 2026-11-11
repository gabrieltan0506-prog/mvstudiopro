/**
 * 爆款复刻退役（站长 2026-11-11）：「首页改成拉片复刻爆款，分镜和出片统一用拉片这套，爆款复刻自己的分镜和出片部分退役。」
 * - 旧地址 /creator-growth-camp/premium-remix（含任意查询参数）一律跳到拉片页。
 * - 服务端旧的分镜（buildPremiumRemix）与出片（generatePremiumRemixAssets）过程保留登录校验，登录后在任何扣费 / 上游请求之前直接拒绝。
 * 前后端共用这一份文案，不各写一份。
 */
export const LAPIAN_PATH = "/lapian";
export const LAPIAN_ENTRY_TITLE = "拉片复刻爆款";
export const PREMIUM_REMIX_LEGACY_PATH = "/creator-growth-camp/premium-remix";
export const PREMIUM_REMIX_RETIRED_CODE = "premium_remix_merged_into_lapian" as const;
export const PREMIUM_REMIX_RETIRED_MESSAGE_ZH = "爆款复刻的分镜与出片已并入「拉片复刻爆款」，请到拉片页面上传参考视频后复刻。本次未扣积分。";

/** 图文笔记复刻入口（站长 2026-11-11：图文要留入口）：拉片只收视频，笔记复刻沿用原有的参考拆解 + 改写 + 交接。 */
export const NOTE_REMIX_ENTRY_TITLE = "图文笔记复刻";
export const NOTE_REMIX_PATH = `${PREMIUM_REMIX_LEGACY_PATH}?format=note`;

/** 旧地址 → 新地址：带 format=note 留在笔记复刻（返回 null），其余一律去拉片页。 */
export function premiumRemixRedirectTarget(search = ""): string | null {
  return new URLSearchParams(search).get("format") === "note" ? null : LAPIAN_PATH;
}
