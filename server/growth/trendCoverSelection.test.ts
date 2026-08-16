import { describe, expect, it } from "vitest";
import {
  backfillRecentTrendCoverUrls,
  completeTrendCoverRanking,
  extractPlatformCoverUrl,
  selectTrendCoverCandidates,
} from "./trendCoverSelection";

describe("trendCoverSelection", () => {
  it("extracts real cover urls from the three remote platform shapes", () => {
    expect(extractPlatformCoverUrl("douyin", { video: { cover: { url_list: ["http://img/d.jpg"] } } })).toBe("https://img/d.jpg");
    expect(extractPlatformCoverUrl("bilibili", { pic: "https://img/b.jpg" })).toBe("https://img/b.jpg");
    expect(extractPlatformCoverUrl("xiaohongshu", { cover: { urlDefault: "https://img/x.jpg" } })).toBe("https://img/x.jpg");
  });

  it("keeps only post-gate covers and ranks each platform independently", () => {
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

  it("each platform gets 20 candidates and Terra omissions are completed from real ranking", () => {
    const fresh = "2026-08-14T05:00:00+08:00";
    const items = (prefix: string, host: string) => Array.from({ length: 25 }, (_, index) => ({
      id: `${prefix}-${index + 1}`,
      title: `${prefix}标题${index + 1}`,
      author: `${prefix}作者`,
      coverUrl: `https://${host}/${index + 1}.jpg`,
      coverCapturedAt: fresh,
      likes: 25_000 - index,
    }));
    const candidates = selectTrendCoverCandidates({
      douyin: { items: items("d", "p3.douyinpic.com") },
      bilibili: { items: items("b", "i0.hdslb.com") },
    }, { startAt: "2026-08-14T04:54:14+08:00" });
    expect(candidates).toHaveLength(40);
    expect(candidates.filter((row) => row.platform === "douyin")).toHaveLength(20);
    expect(candidates.filter((row) => row.platform === "bilibili")).toHaveLength(20);

    const completed = completeTrendCoverRanking(candidates, [
      "douyin:d-3",
      "fake:invented",
      "bilibili:b-2",
    ]);
    expect(completed).toHaveLength(40);
    expect(completed.filter((row) => row.platform === "douyin")[0]?.sourceId).toBe("douyin:d-3");
    expect(completed.filter((row) => row.platform === "bilibili")[0]?.sourceId).toBe("bilibili:b-2");
    expect(completed.some((row) => row.sourceId === "fake:invented")).toBe(false);
  });

  it("前台任务中止信号出现时，封面公网回补不会继续下一条请求", async () => {
    const controller = new AbortController();
    controller.abort("foreground-started");
    await expect(backfillRecentTrendCoverUrls("douyin", {
      platform: "douyin",
      source: "live",
      collectedAt: "2026-08-16T12:00:00.000Z",
      windowDays: 30,
      items: [{
        id: "abort-cover-1",
        title: "待回补封面",
        url: "https://www.douyin.com/video/1",
        publishedAt: "2026-08-16T10:00:00.000Z",
      }],
      notes: [],
      stats: {
        platform: "douyin",
        itemCount: 1,
        uniqueAuthorCount: 1,
        bucketCounts: {},
        requestCount: 1,
        pageDepth: 1,
        targetPerRun: 1,
        referenceMinItems: 1,
        referenceMaxItems: 1,
        collectorMode: "public_feed",
        industryCounts: {},
        ageCounts: {},
        contentCounts: {},
      },
    }, Date.parse("2026-08-16T12:00:00.000Z"), {
      signal: controller.signal,
    })).rejects.toThrow("growth_collector_aborted");
  });
});
