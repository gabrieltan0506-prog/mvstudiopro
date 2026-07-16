import type { PlatformWindowDays } from "@shared/decisionIntelligencePlatformHint";
import type { VisualReportData } from "@/components/VisualReportTemplate";

export type VisualReportPlatformKey = "douyin" | "kuaishou" | "xiaohongshu" | "bilibili";
export type VisualReportTheme = "dark" | "light";
export type VisualReportWindowDays = "3" | "7" | "15" | "30";

const PLATFORM_NAMES: Record<VisualReportPlatformKey, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  bilibili: "B站",
};

type BlueOceanWord = { primary: string; secondary: string[] };

function normalizeBlueOceanWords(raw: unknown): BlueOceanWord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b === "object" && (b as { primary?: unknown }).primary)
    .map((b) => {
      const item = b as { primary?: unknown; secondary?: unknown };
      return {
        primary: String(item.primary || "").trim(),
        secondary: Array.isArray(item.secondary)
          ? item.secondary.map((s) => String(s).trim()).filter(Boolean)
          : [],
      };
    })
    .filter((b) => b.primary);
}

/** generateVisualReport 仅支持 3/7/15/30 天；45 天窗口映射为 30 天报表。 */
export function toVisualReportWindowDays(days: PlatformWindowDays): VisualReportWindowDays {
  if (days === 45) return "30";
  return String(days) as VisualReportWindowDays;
}

export function toVisualReportPlatforms(
  platforms: readonly string[],
): VisualReportPlatformKey[] {
  const allowed = new Set<VisualReportPlatformKey>(["douyin", "kuaishou", "xiaohongshu", "bilibili"]);
  return platforms.filter((p): p is VisualReportPlatformKey => allowed.has(p as VisualReportPlatformKey));
}

export function buildVisualReportDateRange(windowDays: VisualReportWindowDays): string {
  const today = new Date();
  const end = today.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - Number(windowDays));
  const start = startDate.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  return `${start} – ${end}`;
}

export function mapGenerateVisualReportResult(
  result: { report?: Record<string, unknown> | null; error?: string },
  opts: { windowDays: VisualReportWindowDays; theme: VisualReportTheme },
): VisualReportData | null {
  if (!result.report) return null;
  const report = result.report;
  const windowDays = opts.windowDays;

  return {
    reportTitle: String(report.reportTitle || `平台趋势看板 · 近${windowDays}天`),
    dateRange: buildVisualReportDateRange(windowDays),
    theme: opts.theme,
    insightSummary: Array.isArray(report.insightSummary) ? (report.insightSummary as VisualReportData["insightSummary"]) : [],
    trackGrowth: Array.isArray(report.trackGrowth) ? (report.trackGrowth as VisualReportData["trackGrowth"]) : [],
    audiencesAndBiz: Array.isArray(report.audiencesAndBiz)
      ? (report.audiencesAndBiz as VisualReportData["audiencesAndBiz"])
      : [],
    topicExamples: Array.isArray(report.topicExamples)
      ? (report.topicExamples as VisualReportData["topicExamples"])
      : [],
    trafficSupport: Array.isArray(report.trafficSupport) ? (report.trafficSupport as string[]) : [],
    hotFestivals: Array.isArray(report.hotFestivals) ? (report.hotFestivals as string[]) : [],
    globalBlueOceanWords: normalizeBlueOceanWords(report.globalBlueOceanWords),
    platformDetails: (Array.isArray(report.platformDetails) ? report.platformDetails : []).map((p: Record<string, unknown>) => ({
      platform: String(p.platform || ""),
      displayName:
        PLATFORM_NAMES[p.platform as VisualReportPlatformKey] || String(p.platform || ""),
      trafficBoosters: Array.isArray(p.trafficBoosters) ? (p.trafficBoosters as string[]) : [],
      cashRewards: Array.isArray(p.cashRewards) ? (p.cashRewards as string[]) : [],
      hotTopics: Array.isArray(p.hotTopics) ? (p.hotTopics as string[]) : [],
      blueOceanWords: normalizeBlueOceanWords(p.blueOceanWords),
    })),
  };
}
