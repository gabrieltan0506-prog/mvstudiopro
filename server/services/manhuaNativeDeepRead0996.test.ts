import { describe, expect, it, vi } from "vitest";
import { buildNativeDeepReadPlanPreview } from "./manhuaNativeDeepReadPlan.js";
import {
  buildNativeDeepReadEpisodeExecution,
  normalizeManhuaTemplateLearnSourceInput,
  resolveManhuaLearnSeriesIdentityTitle,
} from "./manhuaTemplateLearnService.js";

const sourceUrl = "https://0996zp.com/vod/play/146259/sid/1311527";

describe("第三方播放页 → 原生精读双向接线", () => {
  it("计划按页面真实当前集号起跑，媒体只在待执行集按需刷新", async () => {
    const refreshSourcePlayback = vi.fn(async (episodeUrl: string) => ({
      playbackUrls: [`https://ppvod01.kqgfbs.com/${new URL(episodeUrl).pathname.split("/").pop()}.m3u8`],
      referer: "https://0996zp.com/",
    }));
    const resolveSeriesKey = vi.fn(async () => "series0996");
    const plan = await buildNativeDeepReadPlanPreview({
      url: sourceUrl,
      limit: 2,
    }, {
      fetchAwemeDetail: vi.fn(),
      listMixEpisodes: vi.fn(),
      refreshPlaybackUrls: vi.fn(),
      refreshSourcePlayback,
      isExternalSource: () => true,
      resolveExternalSeries: async () => ({
        sourceIdentity: sourceUrl,
        seriesId: "0996:0996zp.com:146259",
        titleZh: "花开锦绣",
        currentEpisodeIndex: 20,
        episodes: [19, 20, 21, 22].map((index) => ({
          index,
          url: `https://0996zp.com/vod/play/146259/sid/${1311507 + index}`,
          title: `第${index}集`,
          access: "free" as const,
        })).map((row) => row.index === 20 ? { ...row, url: sourceUrl } : row),
      }),
      probeDurationSec: vi.fn(async (_url, _signal, referer) => {
        expect(referer).toBe("https://0996zp.com/");
        return 301;
      }),
      listIngestedEpisodes: async () => new Set(),
      listClaimStates: async () => new Map(),
      resolveSeriesKey,
      isExecutionEnabled: () => true,
    });
    expect(plan.episodes.map((episode) => episode.episodeIndex)).toEqual([20, 21]);
    expect(plan.episodes.every((episode) => episode.segments.length === 2)).toBe(true);
    expect(refreshSourcePlayback).toHaveBeenCalledTimes(2);
    expect(resolveSeriesKey).toHaveBeenCalledWith({
      sourceIdentity: sourceUrl,
      mixId: "0996:0996zp.com:146259",
      title: "花开锦绣",
      learnLlm: "gpt",
    });
    expect(resolveManhuaLearnSeriesIdentityTitle({
      titleHint: "花开锦绣",
      nativeDeepReadMode: true,
      sourceAwemeId: "",
      mixId: "",
    })).toBe("花开锦绣");
  });

  it("执行层沿用同一页面来源，并把来源秒位标记带到待审卡输入", async () => {
    const normalized = normalizeManhuaTemplateLearnSourceInput({
      url: "https://www.0996zp.com/vod/play/146259/1/1311527",
    });
    expect(normalized.sourceUrl).toBe("https://www.0996zp.com/vod/play/146259/sid/1311527");

    const execution = await buildNativeDeepReadEpisodeExecution({
      seriesKey: "series0996",
      ep: {
        index: 20,
        url: normalized.sourceUrl,
        title: "第20集",
        access: "free",
        sourceKind: "0996_mirror",
      },
      confirmedPlanEpisode: {
        episodeIndex: 20,
        sourceUrl: normalized.sourceUrl,
        durationSec: 301,
        segments: [
          { startSec: 0, endSec: 300 },
          { startSec: 300, endSec: 301 },
        ],
      },
    }, {
      probeDuration: async (_episode, state) => {
        state.sourceMarkers = [
          { kind: "opening", startSec: 0, endSec: 103, origin: "source_api" },
        ];
        return 301;
      },
      mediaSource: () => ({
        url: "https://ppvod01.kqgfbs.com/free/index.m3u8",
        referer: "https://www.0996zp.com/",
      }),
    });
    expect(execution.sourceUrl).toBe(normalized.sourceUrl);
    expect(execution.sourceMarkers).toEqual([
      { kind: "opening", startSec: 0, endSec: 103, origin: "source_api" },
    ]);
    await expect(execution.resolveNodes()).resolves.toEqual([{
      url: "https://ppvod01.kqgfbs.com/free/index.m3u8",
      referer: "https://www.0996zp.com/",
    }]);
  });
});
