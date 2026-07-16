import type { PlatformWindowDays } from "@shared/decisionIntelligencePlatformHint";
import { normalizeBlueOceanEntries } from "@shared/blueOceanLexicon";
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

/** 兼容 string[] 与 { primary, secondary[] }[]，避免模型吐扁平数组时整栏消失 */
export function normalizeBlueOceanWords(raw: unknown): BlueOceanWord[] {
  return normalizeBlueOceanEntries(raw).map((e) => ({
    primary: e.primary,
    secondary: e.secondary,
  }));
}

/** 蓝海为空时，用赛道增长名 + 平台热词兜底，保证 PNG 仍有「蓝海词」区块 */
export function fallbackBlueOceanWords(opts: {
  trackGrowth?: Array<{ name?: string } | null> | null;
  platformDetails?: Array<{ hotTopics?: string[] | null; blueOceanWords?: BlueOceanWord[] | null } | null> | null;
}): BlueOceanWord[] {
  const out: BlueOceanWord[] = [];
  const seen = new Set<string>();
  const push = (primary: string, secondary: string[] = []) => {
    const p = String(primary || "").trim();
    if (!p || seen.has(p) || out.length >= 6) return;
    seen.add(p);
    out.push({ primary: p, secondary: secondary.filter(Boolean).slice(0, 6) });
  };

  for (const row of opts.platformDetails || []) {
    for (const bow of row?.blueOceanWords || []) {
      if (bow?.primary) push(bow.primary, bow.secondary || []);
    }
  }
  for (const t of opts.trackGrowth || []) {
    if (t?.name) push(String(t.name).trim());
  }
  for (const row of opts.platformDetails || []) {
    for (const topic of row?.hotTopics || []) {
      const name = String(topic || "").trim();
      if (name.length >= 2 && name.length <= 18) push(name);
    }
  }
  return out;
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

  const platformDetails = (Array.isArray(report.platformDetails) ? report.platformDetails : []).map(
    (p: Record<string, unknown>) => ({
      platform: String(p.platform || ""),
      displayName:
        PLATFORM_NAMES[p.platform as VisualReportPlatformKey] || String(p.platform || ""),
      trafficBoosters: Array.isArray(p.trafficBoosters) ? (p.trafficBoosters as string[]) : [],
      cashRewards: Array.isArray(p.cashRewards) ? (p.cashRewards as string[]) : [],
      hotTopics: Array.isArray(p.hotTopics) ? (p.hotTopics as string[]) : [],
      blueOceanWords: normalizeBlueOceanWords(p.blueOceanWords),
    }),
  );

  const trackGrowth = Array.isArray(report.trackGrowth)
    ? (report.trackGrowth as VisualReportData["trackGrowth"])
    : [];

  let globalBlueOceanWords = normalizeBlueOceanWords(report.globalBlueOceanWords);
  if (globalBlueOceanWords.length === 0) {
    globalBlueOceanWords = fallbackBlueOceanWords({ trackGrowth, platformDetails });
  }

  return {
    reportTitle: String(report.reportTitle || `平台趋势看板 · 近${windowDays}天`),
    dateRange: buildVisualReportDateRange(windowDays),
    theme: opts.theme,
    insightSummary: Array.isArray(report.insightSummary)
      ? (report.insightSummary as VisualReportData["insightSummary"])
      : [],
    trackGrowth,
    audiencesAndBiz: Array.isArray(report.audiencesAndBiz)
      ? (report.audiencesAndBiz as VisualReportData["audiencesAndBiz"])
      : [],
    topicExamples: Array.isArray(report.topicExamples)
      ? (report.topicExamples as VisualReportData["topicExamples"])
      : [],
    trafficSupport: Array.isArray(report.trafficSupport) ? (report.trafficSupport as string[]) : [],
    hotFestivals: Array.isArray(report.hotFestivals) ? (report.hotFestivals as string[]) : [],
    globalBlueOceanWords,
    platformDetails,
  };
}
