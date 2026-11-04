/** 趋势报告统一按时间范围计费，每个平台每份；包含数据、分析及长图。 */
export const PLATFORM_TREND_REPORT_CREDITS = { 3: 50, 7: 80, 15: 120 } as const;

export function getPlatformTrendReportCredits(windowDays: number): number {
  if (windowDays !== 3 && windowDays !== 7 && windowDays !== 15) {
    throw new Error("趋势报告仅支持近3天、7天或15天");
  }
  return PLATFORM_TREND_REPORT_CREDITS[windowDays];
}
