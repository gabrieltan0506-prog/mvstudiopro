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

/** 旧地址 → 新地址：不论带什么参数都去拉片页（拉片只收视频，旧的 format 参数无对应项，不透传）。 */
export function premiumRemixRedirectTarget(): string {
  return LAPIAN_PATH;
}
