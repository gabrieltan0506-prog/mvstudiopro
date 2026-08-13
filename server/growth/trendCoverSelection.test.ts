import { describe, expect, it } from "vitest";
import {
  extractPlatformCoverUrl,
  selectTrendCoverCandidates,
} from "./trendCoverSelection";

describe("trendCoverSelection", () => {
  it("extracts real cover urls from the three remote platform shapes", () => {
    expect(extractPlatformCoverUrl("douyin", { video: { cover: { url_list: ["http://img/d.jpg"] } } })).toBe("https://img/d.jpg");
    expect(extractPlatformCoverUrl("bilibili", { pic: "https://img/b.jpg" })).toBe("https://img/b.jpg");
    expect(extractPlatformCoverUrl("xiaohongshu", { cover: { urlDefault: "https://img/x.jpg" } })).toBe("https://img/x.jpg");
  });

  it("keeps only post-gate covers and ranks a global top 30", () => {
    const fresh = "2026-08-14T05:00:00+08:00";
    const old = "2026-08-14T04:00:00+08:00";
    const rows = selectTrendCoverCandidates({
      douyin: { items: [
        { id: "1", title: "高互动", coverUrl: "https://p3.douyinpic.com/1.jpg", coverCapturedAt: fresh, likes: 10_000 },
        { id: "2", title: "旧封面", coverUrl: "https://p3.douyinpic.com/2.jpg", coverCapturedAt: old, likes: 20_000 },
      ] },
      bilibili: { items: [
        { id: "3", title: "次高互动", coverUrl: "https://i0.hdslb.com/3.jpg", coverCapturedAt: fresh, likes: 1_000 },
      ] },
    }, { startAt: "2026-08-14T04:54:14+08:00" });
    expect(rows.map((row) => row.sourceId)).toEqual(["douyin:1", "bilibili:3"]);
  });
});
