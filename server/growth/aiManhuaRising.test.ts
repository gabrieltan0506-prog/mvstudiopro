import { describe, expect, it } from "vitest";
import { buildAiManhuaRisingBoard } from "./aiManhuaRising";
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

  it("keeps AI manhua and excludes pure short_drama", () => {
    const board = buildAiManhuaRisingBoard({
      items: baseItems,
      nowIso: "2026-07-17T00:00:00.000Z",
      windowDays: 7,
    });
    const ids = board.entries.map((e) => e.mixId);
    expect(ids).toContain("m1");
    expect(ids).toContain("m3");
    expect(ids).not.toContain("m2");
    expect(board.hasBaseline).toBe(false);
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
});
