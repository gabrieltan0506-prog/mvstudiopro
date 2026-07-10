import type { TrendItem } from "./trendCollector";

export function getTrendItemAgeDays(publishedAt?: string): number | undefined {
  if (!publishedAt) return undefined;
  const timestamp = new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
}

/**
 * 按 publishedAt 裁剪。
 * - 长窗（>15 天）：缺失 publishedAt 的条目仍保留（warehouse 兼容）。
 * - 短窗（≤15 天，对应 UI 3/7/15）：优先只要有日期且落在窗内的样本；
 *   若有日期样本过少（<8），再回填无日期条目，避免空窗。
 */
export function filterTrendItemsByWindowDays(items: TrendItem[], windowDays: number): TrendItem[] {
  const days = Math.max(1, Number(windowDays) || 30);
  const datedInWindow: TrendItem[] = [];
  const undated: TrendItem[] = [];
  for (const item of items) {
    const ageDays = getTrendItemAgeDays(item.publishedAt);
    if (ageDays === undefined) {
      undated.push(item);
      continue;
    }
    if (ageDays <= days) datedInWindow.push(item);
  }
  if (days > 15) {
    return [...datedInWindow, ...undated];
  }
  if (datedInWindow.length >= 8) return datedInWindow;
  return [...datedInWindow, ...undated];
}

export function summarizeTrendWindowCounts(items: TrendItem[], windowDays: number) {
  const filtered = filterTrendItemsByWindowDays(items, windowDays);
  const datedCount = items.filter((item) => getTrendItemAgeDays(item.publishedAt) !== undefined).length;
  return {
    warehouseTotal: items.length,
    windowFiltered: filtered.length,
    datedTotal: datedCount,
    windowDays,
  };
}
