import type { TrendItem } from "./trendCollector";

export function getTrendItemAgeDays(publishedAt?: string): number | undefined {
  if (!publishedAt) return undefined;
  const timestamp = new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
}

/** 按 publishedAt 裁剪；缺失 publishedAt 的条目保留（与入库 warehouse 策略一致）。 */
export function filterTrendItemsByWindowDays(items: TrendItem[], windowDays: number): TrendItem[] {
  const days = Math.max(1, Number(windowDays) || 30);
  return items.filter((item) => {
    const ageDays = getTrendItemAgeDays(item.publishedAt);
    return ageDays === undefined || ageDays <= days;
  });
}

export function summarizeTrendWindowCounts(items: TrendItem[], windowDays: number) {
  const filtered = filterTrendItemsByWindowDays(items, windowDays);
  return {
    warehouseTotal: items.length,
    windowFiltered: filtered.length,
    windowDays,
  };
}
