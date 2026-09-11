import type { PlatformWindowDays } from "@shared/decisionIntelligencePlatformHint";
import {
  buildEvidenceBlueOceanFallback,
  normalizeBlueOceanEntries,
} from "@shared/blueOceanLexicon";
import type { VisualReportData } from "@/components/VisualReportTemplate";

export type VisualReportPlatformKey = "douyin" | "xiaohongshu" | "bilibili" | "weixin_channels";
export type VisualReportTheme = "dark" | "light";
export type VisualReportWindowDays = "3" | "7" | "15" | "30";

const PLATFORM_NAMES: Record<VisualReportPlatformKey, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  weixin_channels: "视频号",
};

type BlueOceanWord = { primary: string; secondary: string[] };

/** 兼容 string[] 与 { primary, secondary[] }[]，避免模型吐扁平数组时整栏消失 */
export function normalizeBlueOceanWords(raw: unknown): BlueOceanWord[] {
  return normalizeBlueOceanEntries(raw).map((e) => ({
    primary: e.primary,
    secondary: e.secondary,
  }));
}

/** 蓝海为空时，用赛道 / 热词 / 行业口径兜底，保证 PNG 仍有「蓝海词」区块 */
export function fallbackBlueOceanWords(opts: {
  trackGrowth?: Array<{ name?: string } | null> | null;
  platformDetails?: Array<{ hotTopics?: string[] | null; blueOceanWords?: BlueOceanWord[] | null } | null> | null;
  industryKeys?: string[] | null;
  evidenceTitles?: string[] | null;
  topicHints?: string[] | null;
}): BlueOceanWord[] {
  return buildEvidenceBlueOceanFallback(opts).map((e) => ({
    primary: e.primary,
    secondary: e.secondary,
  }));
}

/** generateVisualReport 仅支持 3/7/15/30 天；45 天窗口映射为 30 天报表。 */
export function toVisualReportWindowDays(days: PlatformWindowDays): VisualReportWindowDays {
  if (days === 45) return "30";
  return String(days) as VisualReportWindowDays;
}

export function toVisualReportPlatforms(
  platforms: readonly string[],
): VisualReportPlatformKey[] {
  const allowed = new Set<VisualReportPlatformKey>(["douyin", "xiaohongshu", "bilibili", "weixin_channels"]);
  return platforms.filter((p): p is VisualReportPlatformKey => allowed.has(p as VisualReportPlatformKey));
}

/** 旧任务仅用已保存的时间恢复上海日历窗口，不能随查看日期漂移。 */
export function buildVisualReportDateRange(
  windowDays: VisualReportWindowDays,
  anchor?: string | number | null,
): string {
  if (anchor == null || anchor === "") return "日期区间未记录";
  const anchorMs = typeof anchor === "number" ? anchor : Date.parse(anchor);
  if (!Number.isFinite(anchorMs)) return "日期区间未记录";
  const format = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const startMs = anchorMs - (Number(windowDays) - 1) * 86_400_000;
  return `${format.format(new Date(startMs))} – ${format.format(new Date(anchorMs))}`;
}

export function mapGenerateVisualReportResult(
  result: { report?: Record<string, unknown> | null; error?: string },
  opts: { windowDays: VisualReportWindowDays; theme: VisualReportTheme; createdAt?: string | number | null },
): VisualReportData | null {
  if (!result.report) return null;
  const report = result.report;
  const windowDays = opts.windowDays;

  const trackGrowthEarly = Array.isArray(report.trackGrowth)
    ? (report.trackGrowth as VisualReportData["trackGrowth"])
    : [];

  let platformDetails = (Array.isArray(report.platformDetails) ? report.platformDetails : []).map(
    (p: Record<string, unknown>) => ({
      platform: String(p.platform || ""),
      displayName:
        PLATFORM_NAMES[p.platform as VisualReportPlatformKey] || String(p.platform || ""),
      trafficBoosters: Array.isArray(p.trafficBoosters)
        ? p.trafficBoosters
            .map((b) => {
              if (typeof b === "string") return b;
              if (b && typeof b === "object") {
                const o = b as Record<string, unknown>;
                for (const k of ["text", "title", "name", "content", "label", "desc"]) {
                  if (typeof o[k] === "string" && String(o[k]).trim()) return String(o[k]);
                }
              }
              return "";
            })
            .filter((s) => s && s !== "[object Object]")
        : [],
      cashRewards: Array.isArray(p.cashRewards)
        ? p.cashRewards
            .map((b) => {
              if (typeof b === "string") return b;
              if (b && typeof b === "object") {
                const o = b as Record<string, unknown>;
                for (const k of ["text", "title", "name", "content", "label"]) {
                  if (typeof o[k] === "string" && String(o[k]).trim()) return String(o[k]);
                }
              }
              return "";
            })
            .filter((s) => s && s !== "[object Object]")
        : [],
      hotTopics: Array.isArray(p.hotTopics)
        ? p.hotTopics
            .map((b) => {
              if (typeof b === "string") return b;
              if (b && typeof b === "object") {
                const o = b as Record<string, unknown>;
                for (const k of ["text", "title", "name", "content", "label"]) {
                  if (typeof o[k] === "string" && String(o[k]).trim()) return String(o[k]);
                }
              }
              return "";
            })
            .filter((s) => s && s !== "[object Object]")
        : [],
      blueOceanWords: normalizeBlueOceanWords(p.blueOceanWords),
    }),
  );

  // 右侧浅色平台卡依赖 platformDetails[0]；模型漏字段时用赛道名兜底，避免整栏空白
  if (!platformDetails.length) {
    const hotFromTracks = (trackGrowthEarly || [])
      .map((t) => String(t?.name || "").trim())
      .filter(Boolean)
      .slice(0, 6);
    platformDetails = [
      {
        platform: "",
        displayName: "所选平台",
        trafficBoosters: [],
        cashRewards: [],
        hotTopics: hotFromTracks,
        blueOceanWords: [],
      },
    ];
  } else {
    platformDetails = platformDetails.map((pl) => {
      if (pl.hotTopics.length) return pl;
      const hotFromTracks = (trackGrowthEarly || [])
        .map((t) => String(t?.name || "").trim())
        .filter(Boolean)
        .slice(0, 6);
      return {
        ...pl,
        hotTopics: hotFromTracks.length ? hotFromTracks : pl.hotTopics,
      };
    });
  }

  const trackGrowth = trackGrowthEarly;

  const topicExamples: NonNullable<VisualReportData["topicExamples"]> = Array.isArray(
    report.topicExamples,
  )
    ? (report.topicExamples as NonNullable<VisualReportData["topicExamples"]>)
    : [];
  const topicHints = topicExamples
    .flatMap((ex) => [ex?.structure, ex?.realCase, ex?.concept])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0);

  let globalBlueOceanWords = normalizeBlueOceanWords(report.globalBlueOceanWords);
  if (globalBlueOceanWords.length === 0) {
    globalBlueOceanWords = fallbackBlueOceanWords({
      trackGrowth,
      platformDetails,
      topicHints,
    });
  }

  const aiManhuaRisingRaw = report.aiManhuaRising;
  const aiManhuaRising =
    aiManhuaRisingRaw && typeof aiManhuaRisingRaw === "object" && Array.isArray((aiManhuaRisingRaw as any).entries)
      ? {
          windowDays: Number((aiManhuaRisingRaw as any).windowDays) || Number(windowDays) || 7,
          hasBaseline: Boolean((aiManhuaRisingRaw as any).hasBaseline),
          note: String((aiManhuaRisingRaw as any).note || ""),
          entries: ((aiManhuaRisingRaw as any).entries as any[]).map((row) => ({
            mixId: String(row?.mixId || ""),
            mixName: String(row?.mixName || ""),
            dramaKind: String(row?.dramaKind || "unknown"),
            mixPlayCount: Number(row?.mixPlayCount || 0) || 0,
            delta7d: row?.delta7d == null ? null : Number(row.delta7d) || 0,
            status: String(row?.status || "steady"),
            author: row?.author ? String(row.author) : undefined,
            sampleTitle: row?.sampleTitle ? String(row.sampleTitle) : undefined,
            url: row?.url ? String(row.url) : undefined,
          })),
        }
      : null;

  const savedDateRange = typeof report.dateRange === "string" ? report.dateRange.trim() : "";
  const restoredDateRange = savedDateRange ? "" : buildVisualReportDateRange(windowDays, opts.createdAt);

  return {
    reportTitle: savedDateRange
      ? String(report.reportTitle || `平台趋势报告 · 近${windowDays}天`)
      : `平台趋势报告 · 近${windowDays}天`,
    dateRange: savedDateRange || (restoredDateRange === "日期区间未记录"
      ? restoredDateRange
      : `${restoredDateRange}（按任务创建日期恢复）`),
    theme: opts.theme,
    insightSummary: Array.isArray(report.insightSummary)
      ? (report.insightSummary as VisualReportData["insightSummary"])
      : [],
    trackGrowth,
    audiencesAndBiz: Array.isArray(report.audiencesAndBiz)
      ? (report.audiencesAndBiz as VisualReportData["audiencesAndBiz"])
      : [],
    topicExamples,
    trafficSupport: Array.isArray(report.trafficSupport) ? (report.trafficSupport as string[]) : [],
    hotFestivals: Array.isArray(report.hotFestivals) ? (report.hotFestivals as string[]) : [],
    globalBlueOceanWords,
    aiManhuaRising,
    platformDetails,
  };
}
