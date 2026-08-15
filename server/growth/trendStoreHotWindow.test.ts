import { describe, expect, it } from "vitest";

import { MAX_UNDATED_HOT_ITEMS, pruneTrendItemsToHotWindow } from "./trendStore";
import type { TrendItem } from "./trendCollector";

const NOW = Date.parse("2026-07-26T00:00:00Z");

function item(id: string, daysAgo: number | null, hotValue = 0): TrendItem {
  return {
    id,
    title: `t-${id}`,
    hotValue,
    ...(daysAgo === null
      ? {}
      : { publishedAt: new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString() }),
  };
}

describe("热窗口裁剪", () => {
  it("丢掉超出窗口的条目，保留窗口内的", () => {
    const kept = pruneTrendItemsToHotWindow(
      [item("new", 10), item("edge", 89), item("old", 200), item("ancient", 360)],
      90,
      NOW,
    );
    expect(kept.map((i) => i.id)).toEqual(["new", "edge"]);
  });

  /** 判不了年龄就不删——否则平台改个时间格式就会把整池清空 */
  it("缺少 publishedAt 的条目一律保留", () => {
    const kept = pruneTrendItemsToHotWindow([item("nodate", null), item("old", 200)], 90, NOW);
    expect(kept.map((i) => i.id)).toEqual(["nodate"]);
  });

  it("publishedAt 无法解析时也保留", () => {
    const bad = { id: "bad", title: "bad", publishedAt: "not-a-date" } as TrendItem;
    expect(pruneTrendItemsToHotWindow([bad], 90, NOW).map((i) => i.id)).toEqual(["bad"]);
  });

  it("无日期热池有上限，避免 current 文件无限膨胀拖垮调度器", () => {
    const items = Array.from(
      { length: MAX_UNDATED_HOT_ITEMS + 25 },
      (_, i) => item(`undated-${i}`, null, i),
    );
    const kept = pruneTrendItemsToHotWindow(items, 90, NOW);
    expect(kept).toHaveLength(MAX_UNDATED_HOT_ITEMS);
    expect(kept[0].id).toBe(`undated-${MAX_UNDATED_HOT_ITEMS + 24}`);
  });

  /**
   * 保险：若某平台把 publishedAt 换成了别的格式导致几乎全被判为过期，
   * 不能真的清空，回退成按热度留前 N 条。
   */
  it("裁剪后不足 5% 时回退成按热度保留，而不是清空", () => {
    const items = Array.from({ length: 100 }, (_, i) => item(`old-${i}`, 300, i));
    const kept = pruneTrendItemsToHotWindow(items, 90, NOW);
    expect(kept.length).toBe(100);
    expect(kept[0].id).toBe("old-99");
  });

  /** 窗口被配成 0 时按下限 30 天算：30 天内的留下，超出的照裁，不会整池清空 */
  it("窗口下限 30 天", () => {
    const items = [item("d20", 20), item("d29", 29), item("d40", 40)];
    expect(pruneTrendItemsToHotWindow(items, 0, NOW).map((i) => i.id)).toEqual(["d20", "d29"]);
  });

  it("空集合原样返回", () => {
    expect(pruneTrendItemsToHotWindow([], 90, NOW)).toEqual([]);
  });
});
