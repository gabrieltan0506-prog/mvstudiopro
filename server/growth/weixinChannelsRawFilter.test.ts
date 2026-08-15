import { describe, expect, it } from "vitest";
import { decideWeixinChannelsRawOfflineItem } from "../../scripts/weixin-channels-raw-filter.mts";
import type { WeixinChannelsRawManifest } from "../../scripts/weixin-channels-raw-spool.mts";

function manifest(overrides: Partial<WeixinChannelsRawManifest> = {}): WeixinChannelsRawManifest {
  return {
    version: 1,
    rawId: "raw-1",
    runId: "run-1",
    state: "complete",
    source: "recommendation",
    taskId: "task-1",
    query: "推荐页",
    windowId: 101,
    capturedAt: "2026-08-15T00:00:00.000Z",
    completedAt: "2026-08-15T00:00:20.000Z",
    captureElapsedMs: 20_000,
    commentsStatus: "captured",
    assets: [],
    ...overrides,
  };
}

const qualified = {
  title: "真实爆款",
  author: "作者",
  videoIdentity: "identity-1",
  likes: 1_932,
  shares: 800,
  favorites: 700,
  comments: 79,
  ocrTexts: ["真实内容"],
};

describe("视频号 raw 离线筛选", () => {
  it("推荐页前置达标且评论不足八十仍可进入正式 pending", () => {
    const decision = decideWeixinChannelsRawOfflineItem({
      manifest: manifest(),
      analysis: qualified,
    });
    expect(decision.state).toBe("accepted");
    if (decision.state === "accepted") {
      expect(decision.observation.commentSamples).toBeUndefined();
      expect(decision.observation.rawCaptureId).toBe("raw-1");
      expect(decision.observation).not.toHaveProperty("coverImageBase64");
      expect(decision.observation).not.toHaveProperty("visualImageBase64");
      expect(decision.observation).not.toHaveProperty("visualUrl");
    }
  });

  it("评论达到八十但离线没有真实评论时拒绝", () => {
    expect(decideWeixinChannelsRawOfflineItem({
      manifest: manifest(),
      analysis: { ...qualified, comments: 80 },
    })).toEqual({ state: "rejected", reason: "required_comments_missing" });
  });

  it("搜索结果超过一年才在离线阶段删除", () => {
    expect(decideWeixinChannelsRawOfflineItem({
      manifest: manifest({
        source: "search_hottest",
        query: "企业文化",
        searchSelectedAgeDays: 730,
      }),
      analysis: { ...qualified, comments: 12 },
    })).toEqual({ state: "rejected", reason: "search_result_older_than_one_year" });
    expect(decideWeixinChannelsRawOfflineItem({
      manifest: manifest({ source: "search_latest", query: "企业文化" }),
      analysis: { ...qualified, comments: 12 },
    })).toEqual({ state: "rejected", reason: "search_result_age_unconfirmed" });
  });

  it("广告和跨窗重复都不会生成正式 pending", () => {
    expect(decideWeixinChannelsRawOfflineItem({
      manifest: manifest(),
      analysis: { ...qualified, ocrTexts: ["广告"] },
    })).toEqual({ state: "rejected", reason: "advertisement" });
    const duplicate = decideWeixinChannelsRawOfflineItem({
      manifest: manifest(),
      analysis: qualified,
      duplicateVideoIdentities: new Set(["identity-1"]),
    });
    expect(duplicate.state).toBe("duplicate");
    const accepted = decideWeixinChannelsRawOfflineItem({
      manifest: manifest(),
      analysis: qualified,
    });
    expect(accepted.state).toBe("accepted");
    if (accepted.state === "accepted") {
      expect(decideWeixinChannelsRawOfflineItem({
        manifest: manifest({ rawId: "raw-2" }),
        analysis: { ...qualified, videoIdentity: "identity-ocr-variant" },
        duplicateObservationIds: new Set([accepted.observationId]),
      }).state).toBe("duplicate");
    }
  });

  it("822/32/321/152 反例仍在离线真源被淘汰", () => {
    expect(decideWeixinChannelsRawOfflineItem({
      manifest: manifest(),
      analysis: {
        ...qualified,
        likes: 822,
        shares: 32,
        favorites: 321,
        comments: 152,
        commentSamples: [{ text: "评论样本也不能抬高前置资格" }],
      },
    })).toEqual({ state: "rejected", reason: "offline_not_qualified" });
  });
});
