import { describe, expect, it } from "vitest";
import { filterTrendItemsByWindowDays, summarizeTrendWindowCounts } from "./trendWindow";
import type { TrendItem } from "./trendCollector";

function item(id: string, daysAgo?: number): TrendItem {
  const publishedAt = daysAgo === undefined
    ? undefined
    : new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return { id, title: id, publishedAt };
}

describe("trendWindow", () => {
  it("缺失 publishedAt 的条目保留", () => {
    const items = [item("a"), item("no-date")];
    expect(filterTrendItemsByWindowDays(items, 30)).toHaveLength(2);
  });

  it("按 publishedAt 裁剪窗口", () => {
    const items = [item("recent", 3), item("old", 90)];
    expect(filterTrendItemsByWindowDays(items, 30).map((row) => row.id)).toEqual(["recent"]);
  });

  it("summarizeTrendWindowCounts 返回仓库与窗口计数", () => {
    const items = [item("a"), item("b", 5), item("c", 60)];
    const summary = summarizeTrendWindowCounts(items, 30);
    expect(summary.warehouseTotal).toBe(3);
    expect(summary.windowFiltered).toBe(2);
  });
});
