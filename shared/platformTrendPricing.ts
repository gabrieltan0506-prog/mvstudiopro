/** 北京时间 2026-09-16 00:00 起，3 天/周趋势报告（含优秀封面页）统一 60 积分。 */
export const PLATFORM_TREND_PROMO_END_AT = "2026-09-16T00:00:00+08:00";
export const PLATFORM_TREND_PROMO_CREDITS = 50;
export const PLATFORM_TREND_STANDARD_CREDITS = 60;

export function getPlatformTrendReportCredits(windowDays: number, nowMs = Date.now()) {
  const scheduledWindow = windowDays === 3 || windowDays === 7;
  return !scheduledWindow || nowMs < Date.parse(PLATFORM_TREND_PROMO_END_AT)
    ? PLATFORM_TREND_PROMO_CREDITS
    : PLATFORM_TREND_STANDARD_CREDITS;
}

export function isPlatformTrendCoverPromo(windowDays: number, nowMs = Date.now()) {
  return (windowDays === 3 || windowDays === 7) && nowMs < Date.parse(PLATFORM_TREND_PROMO_END_AT);
}
