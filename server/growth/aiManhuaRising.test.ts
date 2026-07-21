import { describe, expect, it } from "vitest";
import { buildAiManhuaRisingBoard, buildAiManhuaRisingByPlatform } from "./aiManhuaRising";
import {
  dramaMetaFromDouyinAweme,
  extractDouyinSearchAwemes,
  inferDouyinDramaKind,
  type TrendItem,
} from "./trendCollector";

describe("inferDouyinDramaKind / dramaMetaFromDouyinAweme", () => {
  it("labels AI manhua vs short drama from text", () => {
    expect(inferDouyinDramaKind("重生漫剧开局团宠")).toBe("ai_manhua");
    expect(inferDouyinDramaKind("红果短剧连载")).toBe("short_drama");
    expect(inferDouyinDramaKind("探店测评")).toBe("unknown");
    expect(inferDouyinDramaKind("发配边关罪妻开荒养出战神")).toBe("ai_manhua");
    expect(inferDouyinDramaKind("聚宝仙盆之杂灵根才是真BOSS")).toBe("ai_manhua");
  });

  it("parses mix_info into dramaInfo", () => {
    const meta = dramaMetaFromDouyinAweme(
      {
        desc: "第3集 AI漫剧",
        mix_info: {
          mix_id: "mix-1",
          mix_name: "发配边关罪妻开荒养出战神",
          statis: {
            current_episode: 3,
            updated_to_episode: 80,
            play_view_count: 12_500_000,
          },
        },
      },
      "第3集 AI漫剧",
      ["AI漫剧"],
    );
    expect(meta.isDrama).toBe(true);
    expect(meta.dramaKind).toBe("ai_manhua");
    expect(meta.dramaInfo).toMatchObject({
      mixId: "mix-1",
      mixName: "发配边关罪妻开荒养出战神",
      currentEpisode: 3,
      totalEpisodes: 80,
      mixPlayCount: 12_500_000,
    });
  });

  it("extracts awemes from search payload shapes", () => {
    const awemes = extractDouyinSearchAwemes({
      status_code: 0,
      data: [
        {
          aweme_info: {
            aweme_id: "a1",
            desc: "AI漫剧合集",
            mix_info: { mix_id: "m1", mix_name: "漫剧A" },
          },
        },
      ],
    });
    expect(awemes).toHaveLength(1);
    expect(awemes[0].aweme_id).toBe("a1");
  });
});

describe("buildAiManhuaRisingBoard", () => {
  const baseItems: TrendItem[] = [
    {
      id: "v1",
      title: "AI漫剧 第1集",
      isDrama: true,
      dramaKind: "ai_manhua",
      dramaInfo: { mixId: "m1", mixName: "漫剧甲", mixPlayCount: 2_000_000, currentEpisode: 1 },
      publishedAt: "2026-07-16T00:00:00.000Z",
    },
    {
      id: "v2",
      title: "红果短剧 第2集",
      isDrama: true,
      dramaKind: "short_drama",
      dramaInfo: { mixId: "m2", mixName: "真人短剧乙", mixPlayCount: 9_000_000 },
    },
    {
      id: "v3",
      title: "动态漫开局",
      isDrama: true,
      dramaKind: "unknown",
      dramaInfo: { mixId: "m3", mixName: "动态漫丙", mixPlayCount: 800_000 },
      publishedAt: "2026-07-15T00:00:00.000Z",
    },
  ];

  it("includes AI manhua, short_drama and soft-unknown mixes", () => {
    const board = buildAiManhuaRisingBoard({
      items: baseItems,
      nowIso: "2026-07-17T00:00:00.000Z",
      windowDays: 7,
      limit: 10,
    });
    const ids = board.entries.map((e) => e.mixId);
    expect(ids).toContain("m1");
    expect(ids).toContain("m2");
    expect(ids).toContain("m3");
    expect(board.entries.find((e) => e.mixId === "m1")?.categoryLabelZh).toBe("AI漫剧");
    expect(board.entries.find((e) => e.mixId === "m2")?.categoryLabelZh).toBe("短剧合集");
    expect(board.hasBaseline).toBe(false);
  });

  it("shows fewer than 10 entries (cap 15) and drops caption-like mixes", () => {
    const board = buildAiManhuaRisingBoard({
      items: [
        baseItems[0]!,
        baseItems[1]!,
        {
          id: "noise",
          title: "一人一句动漫 未来日记",
          isDrama: true,
          dramaKind: "unknown",
          dramaInfo: { mixId: "cap1", mixName: "一人一句动漫", mixPlayCount: 9_999_999 },
        },
      ],
      nowIso: "2026-07-17T00:00:00.000Z",
      windowDays: 15,
    });
    expect(board.windowDays).toBe(15);
    expect(board.entries.length).toBe(2);
    expect(board.entries.length).toBeLessThan(10);
    expect(board.entries.map((e) => e.mixId)).not.toContain("cap1");
  });

  it("ranks by 7d delta when baseline exists", () => {
    const board = buildAiManhuaRisingBoard({
      items: baseItems,
      baselineItems: [
        {
          id: "old1",
          title: "old",
          isDrama: true,
          dramaKind: "ai_manhua",
          dramaInfo: { mixId: "m1", mixName: "漫剧甲", mixPlayCount: 500_000 },
        },
        {
          id: "old3",
          title: "old3",
          isDrama: true,
          dramaKind: "ai_manhua",
          dramaInfo: { mixId: "m3", mixName: "动态漫丙", mixPlayCount: 700_000 },
        },
      ],
      nowIso: "2026-07-17T00:00:00.000Z",
      windowDays: 7,
    });
    expect(board.hasBaseline).toBe(true);
    expect(board.entries[0].mixId).toBe("m1");
    expect(board.entries[0].delta7d).toBe(1_500_000);
    expect(board.entries[0].status).toBe("surging");
  });

  it("kuaishou board keeps sample url and omits fake mix link", () => {
    const board = buildAiManhuaRisingBoard({
      platform: "kuaishou",
      items: [
        {
          id: "ks1",
          title: "重生漫剧开局 第1集",
          isDrama: true,
          dramaKind: "ai_manhua",
          dramaInfo: { mixId: "重生漫剧开局", mixName: "重生漫剧开局", mixPlayCount: 120_000 },
          views: 120_000,
          tags: ["快手漫剧检索"],
        },
        {
          id: "ks2",
          title: "仙侠短剧合集",
          isDrama: true,
          dramaKind: "short_drama",
          dramaInfo: { mixId: "仙侠短剧合集", mixName: "仙侠短剧合集", mixPlayCount: 80_000 },
          url: "https://www.kuaishou.com/short-video/abc",
          tags: ["短剧"],
        },
      ],
      limit: 10,
      nowIso: "2026-07-17T00:00:00.000Z",
    });
    expect(board.platform).toBe("kuaishou");
    expect(board.entries.length).toBe(2);
    const noUrl = board.entries.find((e) => e.mixId === "重生漫剧开局");
    expect(noUrl?.url).toBeUndefined();
    expect(noUrl?.tagLabelsZh?.length).toBeGreaterThan(0);
    const withUrl = board.entries.find((e) => e.mixId === "仙侠短剧合集");
    expect(withUrl?.url).toContain("kuaishou.com");
  });
});

describe("buildAiManhuaRisingByPlatform", () => {
  it("builds douyin + kuaishou boards with limit 10", () => {
    const by = buildAiManhuaRisingByPlatform({
      douyinItems: Array.from({ length: 12 }, (_, i) => ({
        id: `d${i}`,
        title: `漫剧${i}`,
        isDrama: true,
        dramaKind: "ai_manhua" as const,
        dramaInfo: {
          mixId: `dm${i}`,
          mixName: `抖音漫剧${i}`,
          mixPlayCount: 1_000_000 - i * 1000,
        },
      })),
      kuaishouItems: Array.from({ length: 5 }, (_, i) => ({
        id: `k${i}`,
        title: `快手短剧${i}`,
        isDrama: true,
        dramaKind: "short_drama" as const,
        dramaInfo: {
          mixId: `km${i}`,
          mixName: `快手短剧${i}`,
          mixPlayCount: 500_000 - i * 1000,
        },
        url: i % 2 === 0 ? `https://www.kuaishou.com/short-video/${i}` : undefined,
      })),
      limit: 10,
      windowDays: 7,
    });
    expect(by.douyin.entries).toHaveLength(10);
    expect(by.kuaishou.entries).toHaveLength(5);
    expect(by.douyin.platform).toBe("douyin");
    expect(by.kuaishou.platform).toBe("kuaishou");
  });

  it("surfaces storeReadFailed note with empty entries", () => {
    const by = buildAiManhuaRisingByPlatform({
      douyinItems: [],
      kuaishouItems: [],
      storeReadFailed: true,
    });
    expect(by.douyin.storeReadFailed).toBe(true);
    expect(by.douyin.entries).toHaveLength(0);
    expect(by.douyin.note).toMatch(/超时|暂未/);
  });
});
