import type {
  GrowthDataAnalystPlatformRow,
  GrowthDataAnalystSummary,
  GrowthPlatform,
} from "@shared/growth";
import type { PlatformTrendCollection, TrendItem } from "./trendCollector";

const PLATFORM_LABELS: Record<GrowthPlatform, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  toutiao: "今日头条",
};

type TotalsMap = Partial<Record<GrowthPlatform, { currentTotal?: number; archivedTotal?: number }>>;

function toDate(value?: string) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDate(value: number | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function collectCoverage(items: TrendItem[]) {
  const dated = items
    .map((item) => toDate(item.publishedAt))
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  return {
    datedCount: dated.length,
    undatedCount: Math.max(0, items.length - dated.length),
    start: dated[0] ?? null,
    end: dated[dated.length - 1] ?? null,
  };
}

function inferDominantFormat(collection?: PlatformTrendCollection) {
  const items = collection?.items || [];
  const noteCount = items.filter((item) => item.contentType === "note").length;
  const videoCount = items.filter((item) => item.contentType === "video").length;
  const topicCount = items.filter((item) => item.contentType === "topic").length;
  if (noteCount > videoCount && noteCount >= topicCount) return "图文更强";
  if (videoCount >= noteCount && videoCount >= topicCount) return "视频更强";
  return "热点话题更强";
}

function buildPlatformRow(params: {
  platform: GrowthPlatform;
  collection?: PlatformTrendCollection;
  totals?: { currentTotal?: number; archivedTotal?: number };
}): GrowthDataAnalystPlatformRow {
  const { platform, collection, totals } = params;
  const currentTotal = collection?.items?.length || Number(totals?.currentTotal || 0);
  const archivedTotal = Number(totals?.archivedTotal || 0);
  const coverage = collectCoverage(collection?.items || []);
  return {
    platform,
    platformLabel: PLATFORM_LABELS[platform],
    currentTotal,
    archivedTotal,
    datedCurrentCount: coverage.datedCount,
    undatedCurrentCount: coverage.undatedCount,
    liveCoverageStart: formatDate(coverage.start),
    liveCoverageEnd: formatDate(coverage.end),
    dominantFormat: inferDominantFormat(collection),
    note: collection?.items?.length
      ? coverage.datedCount
        ? `当前样本可证日期覆盖 ${formatDate(coverage.start)} 至 ${formatDate(coverage.end)}。`
        : "当前样本保留总量，但缺少稳定可证日期。"
      : archivedTotal > 0
        ? "当前平台主要依赖历史沉淀信号。"
        : "当前平台尚无可用样本。",
  };
}

function summarizeWindow(rows: GrowthDataAnalystPlatformRow[], source: "live" | "historical") {
  if (source === "live") {
    const dated = rows
      .filter((row) => row.liveCoverageStart && row.liveCoverageEnd)
      .sort((left, right) => String(left.liveCoverageStart).localeCompare(String(right.liveCoverageStart)));
    if (!dated.length) return "当前 live 层以总量存在为主，缺少稳定日期覆盖证明。";
    const latestEnd = dated
      .slice()
      .sort((left, right) => String(right.liveCoverageEnd).localeCompare(String(left.liveCoverageEnd)))[0];
    return `live 主链当前可证覆盖从 ${dated[0].liveCoverageStart} 到 ${latestEnd.liveCoverageEnd}。`;
  }
  const historical = rows.filter((row) => row.archivedTotal > 0);
  if (!historical.length) return "historical 主链当前尚未形成足够沉淀。";
  return `historical 主链当前以 ${historical.map((row) => `${row.platformLabel}${row.archivedTotal}`).join("、")} 为主。`;
}

export function buildGrowthDataAnalystSummary(params: {
  requestedPlatforms: GrowthPlatform[];
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>;
  historicalPlatformTotals?: TotalsMap;
}): GrowthDataAnalystSummary {
  const rows = params.requestedPlatforms.map((platform) => buildPlatformRow({
    platform,
    collection: params.collections[platform],
    totals: params.historicalPlatformTotals?.[platform],
  }));

  const undatedRetainedItems = rows
    .filter((row) => row.undatedCurrentCount > 0)
    .map((row) => `${row.platformLabel} 保留 ${row.undatedCurrentCount} 条未定日期样本，可计入总量但不可当作日期覆盖。`);

  const missingRangesOrBrokenLayers = rows.flatMap((row) => {
    const issues: string[] = [];
    if (row.currentTotal > 0 && !row.liveCoverageStart) {
      issues.push(`${row.platformLabel} 当前总量存在，但 live 日期覆盖不可证。`);
    }
    if (row.currentTotal === 0 && row.archivedTotal > 0) {
      issues.push(`${row.platformLabel} 当前依赖 historical，live 主链偏弱。`);
    }
    if (row.currentTotal === 0 && row.archivedTotal === 0) {
      issues.push(`${row.platformLabel} 当前 live 与 historical 都偏空。`);
    }
    return issues;
  });

  const hasBrokenLayers = missingRangesOrBrokenLayers.length > 0;
  const hasHistoricalOnly = rows.some((row) => row.currentTotal === 0 && row.archivedTotal > 0);
  const recommendation = hasBrokenLayers
    ? hasHistoricalOnly
      ? "restore"
      : "verify"
    : rows.some((row) => row.archivedTotal === 0)
      ? "backfill"
      : "keep";

  const recommendationReason =
    recommendation === "keep"
      ? "当前 live 与 historical 两条主链都已有可用支撑，可继续沿现有节奏做平台判断。"
      : recommendation === "backfill"
        ? "当前实时层可用，但历史沉淀仍薄，需要继续回填做赛道与常青内容判断。"
        : recommendation === "restore"
          ? "部分平台只有历史层有量，建议优先补回或修复实时链路。"
          : "当前总量与日期覆盖存在裂缝，建议先核对数据层后再放大结论。";

  return {
    platformRows: rows,
    liveCoverageWindow: summarizeWindow(rows, "live"),
    historicalCoverageWindow: summarizeWindow(rows, "historical"),
    undatedRetainedItems,
    missingRangesOrBrokenLayers,
    recommendation,
    recommendationReason,
  };
}
