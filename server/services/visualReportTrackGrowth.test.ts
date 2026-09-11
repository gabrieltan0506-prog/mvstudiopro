import { describe, expect, it } from "vitest";
import {
  buildIndustryGrowthHintMap,
  repairTrackGrowthRows,
  filterTrackGrowthHotOnly,
  reconcilePlatformHotTopicsWithGlobalTrackGrowth,
  filterVisualReportEvidenceItems,
  resolveVisualReportEvidenceTimeMs,
} from "./visualReportTrackGrowth";
import { getShanghaiVisualReportWindows } from "../growth/time";

describe("visual report evidence window", () => {
  const anchorMs = new Date("2026-08-15T18:00:00.000Z").getTime();
  const bounds = getShanghaiVisualReportWindows(7, anchorMs);
  const observedAt = "2026-08-15T17:57:34.368Z";

  it("keeps Bilibili-style items by their own publishedAt", () => {
    const items = [
      { title: "本周视频", publishedAt: "2026-08-14T08:00:00.000Z" },
      { title: "旧视频", publishedAt: "2026-07-01T08:00:00.000Z" },
    ];
    expect(filterVisualReportEvidenceItems(items, observedAt, bounds).map((item) => item.title))
      .toEqual(["本周视频"]);
  });

  it("keeps Xiaohongshu-style undated hot-list items by their own observation time", () => {
    const items = [
      { title: "当前热榜一", publishedAt: "", observedAt },
      { title: "当前热榜二", observedAt },
    ];
    expect(filterVisualReportEvidenceItems(items, observedAt, bounds)).toHaveLength(2);
    expect(resolveVisualReportEvidenceTimeMs(items[0])).toBe(new Date(observedAt).getTime());
  });

  it("does not revive undated items from a stale collection", () => {
    const staleObservedAt = "2026-07-01T08:00:00.000Z";
    expect(filterVisualReportEvidenceItems(
      [{ title: "旧榜", observedAt: staleObservedAt }],
      staleObservedAt,
      bounds,
    )).toEqual([]);
  });

  it("legacy undated hot pool uses a bounded current-snapshot fallback", () => {
    const items = Array.from({ length: 250 }, (_, index) => ({ title: `旧格式 ${index}` }));
    const filtered = filterVisualReportEvidenceItems(items, observedAt, bounds);
    expect(filtered).toHaveLength(200);
    expect(filtered[0]?.title).toBe("旧格式 0");
    expect(filtered.at(-1)?.title).toBe("旧格式 199");
  });

  it("uses the same observation-time fallback for industry growth hints", () => {
    const hints = buildIndustryGrowthHintMap({
      collections: {
        xiaohongshu: {
          items: [
            { title: "当前样本", publishedAt: "", observedAt, industryLabels: ["生活方式"] },
          ],
        },
      },
    }, ["xiaohongshu"], 7, anchorMs);
    expect(hints.get("生活方式")).toBe("缺少对照");
  });
});


describe("赛道样本计数与对照证据", () => {
  const anchorMs = Date.parse("2026-09-09T04:00:00Z");
  const currentTime = "2026-09-08T04:00:00Z";
  const priorTime = "2026-09-05T04:00:00Z";
  const samples = (label: string, count: number, observedAt: string) =>
    Array.from({ length: count }, () => ({ industryLabels: [label], observedAt }));
  const makeHints = (items: any[]) => buildIndustryGrowthHintMap({
    collections: { douyin: { items } },
  }, ["douyin"], 3, anchorMs);

  it("无前窗的多个分类均保留观察状态，不按排序制造百分比", () => {
    const hints = makeHints([...samples("美食", 8, currentTime), ...samples("生活", 2, currentTime)]);
    expect(Array.from(hints.values())).toEqual(["缺少对照", "缺少对照"]);
    const rows = repairTrackGrowthRows([
      { name: "美食", growth: "+98%", isHot: true },
      { name: "生活", growth: "+12%", isHot: true },
    ], hints);
    expect(filterTrackGrowthHotOnly(rows)).toHaveLength(2);
    expect(rows.every((row) => row.isHot === false)).toBe(true);
    expect(rows[0].evidence).toEqual({
      metric: "sample_count", currentCount: 8, priorCount: 0,
      sampleScope: "collected_items", platforms: ["douyin"], windowDays: 3,
      currentStart: "2026-09-06T16:00:00.000Z",
      currentEndExclusive: "2026-09-09T16:00:00.000Z",
      priorStart: "2026-09-03T16:00:00.000Z",
      priorEndExclusive: "2026-09-06T16:00:00.000Z",
    });
  });

  it("真实前后计数支持增长、下降和归零，不把归零夹成-99%", () => {
    const hints = makeHints([
      ...samples("美食", 3, currentTime), ...samples("美食", 2, priorTime),
      ...samples("生活", 1, currentTime), ...samples("生活", 2, priorTime),
      ...samples("摄影", 2, priorTime),
    ]);
    expect(Object.fromEntries(hints)).toEqual({ 美食: "+50%", 生活: "-50%", 摄影: "-100%" });
    const rows = repairTrackGrowthRows(Array.from(hints.keys()).map((name) => ({ name, growth: "模型猜测" })), hints);
    expect(rows[0].evidence?.currentCount).toBe(3);
    expect(rows[0].evidence?.priorCount).toBe(2);
    expect(filterTrackGrowthHotOnly(rows).map((row) => row.name)).toEqual(["美食"]);
    expect(reconcilePlatformHotTopicsWithGlobalTrackGrowth(["美食", "生活", "摄影"], rows, hints)).toEqual(["美食"]);
  });

  it("精确分类才能引用证据，组合赛道和子串不能挪用单桶数值", () => {
    const hints = makeHints([...samples("美食", 3, currentTime), ...samples("美食", 1, priorTime)]);
    const rows = repairTrackGrowthRows([
      { name: " 美食 ", growth: "" },
      { name: "美食/旅行", growth: "+98%", evidence: hints.evidenceByLabel?.get("美食") },
      { name: "美食攻略", growth: "+80%" },
    ], hints);
    expect(rows[0].growth).toBe("高热");
    expect(rows[0].evidence?.currentCount).toBe(3);
    expect(rows.slice(1).map((row) => row.growth)).toEqual(["无匹配样本", "无匹配样本"]);
    expect(rows[1]).not.toHaveProperty("evidence");
  });

  it("普通旧Map可兼容，但不会凭空附加证据", () => {
    const rows = repairTrackGrowthRows([{ name: "美食", growth: "+12%" }], new Map([["美食", "+50%"]]));
    expect(rows[0].growth).toBe("+50%");
    expect(rows[0]).not.toHaveProperty("evidence");
  });

  it("重复标签不重复计数，窗口外和无逐条时间的样本不参与增长", () => {
    const hints = makeHints([
      { industryLabels: ["美食", "美食"], contentLabels: ["美食"], observedAt: currentTime },
      ...samples("美食", 1, priorTime),
      ...samples("美食", 5, "2026-08-01T00:00:00Z"),
      { industryLabels: ["美食"] },
    ]);
    expect(hints.get("美食")).toBe("+0%");
    expect(hints.evidenceByLabel?.get("美食")).toMatchObject({ currentCount: 1, priorCount: 1 });
  });
  it("多平台统计保留范围，重复平台参数不会重复累计", () => {
    const hints = buildIndustryGrowthHintMap({ collections: {
      douyin: { items: samples("美食", 2, currentTime) },
      bilibili: { items: [...samples("美食", 1, currentTime), ...samples("美食", 2, priorTime)] },
    } }, ["douyin", "bilibili", "douyin"], 3, anchorMs);
    expect(hints.get("美食")).toBe("+50%");
    expect(hints.evidenceByLabel?.get("美食")).toMatchObject({
      currentCount: 3, priorCount: 2, platforms: ["douyin", "bilibili"],
    });
  });

  it.each([3, 7, 15, 30])("%i天窗口两侧都按左闭右开真实计数", (days) => {
    const bounds = getShanghaiVisualReportWindows(days, anchorMs);
    const items = [bounds.priorStart - 1, bounds.priorStart, bounds.currentStart - 1,
      bounds.currentStart, bounds.currentEndExclusive - 1, bounds.currentEndExclusive]
      .map((ms) => ({ industryLabels: ["美食"], observedAt: new Date(ms).toISOString() }));
    const hints = buildIndustryGrowthHintMap({ collections: { douyin: { items } } }, ["douyin"], days, anchorMs);
    expect(hints.evidenceByLabel?.get("美食")).toMatchObject({ currentCount: 2, priorCount: 2, windowDays: days });
    expect(hints.get("美食")).toBe("+0%");
  });

  it("热门话题旁路继续按语义排除负向分类，组合赛道仍不挪用数值", () => {
    const hints = makeHints([
      ...samples("美食", 1, currentTime), ...samples("美食", 2, priorTime),
      ...samples("生活", 2, currentTime), ...samples("生活", 1, priorTime),
    ]);
    // 全局列表没有该负向桶时，仍须使用样本映射排除相关话题。
    expect(reconcilePlatformHotTopicsWithGlobalTrackGrowth([
      "美食攻略", "美食/旅行", "生活记录", "摄影",
    ], [], hints)).toEqual(["生活记录", "摄影"]);
    expect(repairTrackGrowthRows([{ name: "生活/摄影", growth: "+99%" }], hints)[0])
      .toEqual({ name: "生活/摄影", growth: "无匹配样本", isHot: false });
  });

});
