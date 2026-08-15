import { describe, expect, it } from "vitest";
import {
  buildIndustryGrowthHintMap,
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
    expect(hints.get("生活方式")).toBe("+98%");
  });
});
