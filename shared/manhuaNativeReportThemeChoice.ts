/** 报告展示选项，不进入学习卡、模型请求或计费缓存。 */
export const NATIVE_REPORT_THEME_CHOICES = ["auto", "celadon", "amber", "rose", "moon", "apricot"] as const;
export type NativeReportThemeChoice = typeof NATIVE_REPORT_THEME_CHOICES[number];
export const NATIVE_REPORT_THEME_OPTIONS: ReadonlyArray<{ id: NativeReportThemeChoice; name: string; color: string }> = [
  { id: "auto", name: "自动匹配", color: "#d8dde7" },
  { id: "celadon", name: "青瓷雨巷", color: "#426657" },
  { id: "amber", name: "秋金园林", color: "#ab7132" },
  { id: "rose", name: "蔷薇街角", color: "#aa716b" },
  { id: "moon", name: "月蓝影院", color: "#728498" },
  { id: "apricot", name: "杏色茶巷", color: "#b97834" },
];
