import { describe, expect, it } from "vitest";
import { filterTrendItemsByWindowDays, summarizeTrendWindowCounts } from "./trendWindow";
import type { TrendItem } from "./trendCollector";

function item(partial: Partial<TrendItem> & Pick<TrendItem, "id" | "title">): TrendItem {
  return { ...partial, id: partial.id, title: partial.title };
}

describe("filterTrendItemsByWindowDays", () => {
  const now = Date.now();
  const day = 86_400_000;

  it("keeps undated items in long windows", () => {
    const items = [
      item({ id: "1", title: "a", publishedAt: new Date(now - 2 * day).toISOString() }),
      item({ id: "2", title: "b" }),
    ];
    const filtered = filterTrendItemsByWindowDays(items, 30);
    expect(filtered.map((x) => x.id).sort()).toEqual(["1", "2"]);
  });

  it("prefers dated in-window items for short windows when enough dated samples exist", () => {
    const items: TrendItem[] = [];
    for (let i = 0; i < 10; i++) {
      items.push(item({ id: `d${i}`, title: `dated-${i}`, publishedAt: new Date(now - i * day).toISOString() }));
    }
    items.push(item({ id: "old", title: "old", publishedAt: new Date(now - 40 * day).toISOString() }));
    items.push(item({ id: "undated", title: "undated" }));
    const filtered = filterTrendItemsByWindowDays(items, 7);
    expect(filtered.some((x) => x.id === "old")).toBe(false);
    expect(filtered.some((x) => x.id === "undated")).toBe(false);
    expect(filtered.length).toBeGreaterThanOrEqual(8);
  });

  it("backfills undated when short-window dated samples are scarce", () => {
    const items = [
      item({ id: "1", title: "a", publishedAt: new Date(now - 1 * day).toISOString() }),
      item({ id: "2", title: "b" }),
      item({ id: "3", title: "c" }),
    ];
    const filtered = filterTrendItemsByWindowDays(items, 7);
    expect(filtered.map((x) => x.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("summarize includes datedTotal", () => {
    const items = [
      item({ id: "1", title: "a", publishedAt: new Date(now - 1 * day).toISOString() }),
      item({ id: "2", title: "b" }),
    ];
    const summary = summarizeTrendWindowCounts(items, 7);
    expect(summary.datedTotal).toBe(1);
    expect(summary.warehouseTotal).toBe(2);
  });
});
