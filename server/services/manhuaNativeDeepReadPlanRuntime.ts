/**
 * 原生精读计划的生产依赖装配。
 *
 * 路由预览与 worker 复核必须调用同一入口；两边各装一次依赖会让剧名、seriesKey、
 * 已入库集或占位口径再次分叉，最终出现“确认的是 A，执行的是 B”。
 */
import {
  buildNativeDeepReadPlanPreview,
  probeNativeDeepReadDurationSec,
  type NativeDeepReadPlanPreview,
} from "./manhuaNativeDeepReadPlan.js";
import {
  fetchDouyinAwemeDetailViaWebApi,
  listDouyinAwemePlaybackUrlsViaWebApi,
  listDouyinMixEpisodesViaWebApi,
} from "./manhuaLearnDouyinWebApi.js";
import { listIngestedNativeDeepReadEpisodes } from "./manhuaNativeDeepReadIngest.js";
import { listNativeDeepReadEpisodeClaimStates } from "./manhuaNativeDeepReadClaim.js";
import { isManhuaNativeDeepReadEnabled } from "./manhuaNativeDeepReadRunner.js";
import { resolveManhuaSeriesKey } from "./manhuaTemplateLearnService.js";
import type { ManhuaTemplateLearnLlmProvider } from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  fetchManhua0996EpisodePlayback,
  readManhuaLearnExtraSourceHosts,
  resolveManhua0996Series,
} from "./manhuaLearn0996Source.js";
import { isManhua0996SourceUrl } from "../../shared/manhuaLearn0996Source.js";

export type NativeDeepReadPlanRuntimeInput = {
  url: string;
  limit: number;
  allowPartial?: boolean;
  learnLlm?: ManhuaTemplateLearnLlmProvider;
  abortSignal?: AbortSignal;
};

export async function buildNativeDeepReadPlanPreviewFromServices(
  input: NativeDeepReadPlanRuntimeInput,
): Promise<NativeDeepReadPlanPreview> {
  return buildNativeDeepReadPlanPreview(input, {
    fetchAwemeDetail: fetchDouyinAwemeDetailViaWebApi,
    listMixEpisodes: listDouyinMixEpisodesViaWebApi,
    refreshPlaybackUrls: listDouyinAwemePlaybackUrlsViaWebApi,
    refreshSourcePlayback: async (sourceUrl, abortSignal) => {
      const playback = await fetchManhua0996EpisodePlayback(sourceUrl, abortSignal);
      return { playbackUrls: playback.playbackUrls, referer: playback.referer };
    },
    resolveExternalSeries: async (sourceUrl, abortSignal) => {
      const resolved = await resolveManhua0996Series(sourceUrl, abortSignal);
      return {
        sourceIdentity: resolved.source.canonicalUrl,
        seriesId: `0996:${resolved.source.host}:${resolved.source.vodId}`,
        titleZh: resolved.page.titleZh,
        currentEpisodeIndex: resolved.page.currentEpisodeIndex,
        episodes: resolved.page.episodes.map((episode) => ({
          index: episode.index,
          url: episode.url,
          title: episode.title,
          access: "free" as const,
        })),
      };
    },
    isExternalSource: (sourceUrl) => isManhua0996SourceUrl(
      sourceUrl,
      readManhuaLearnExtraSourceHosts(),
    ),
    probeDurationSec: (playbackUrl, abortSignal, referer) =>
      probeNativeDeepReadDurationSec(playbackUrl, abortSignal, undefined, referer),
    listIngestedEpisodes: listIngestedNativeDeepReadEpisodes,
    listClaimStates: listNativeDeepReadEpisodeClaimStates,
    resolveSeriesKey: resolveManhuaSeriesKey,
    isExecutionEnabled: isManhuaNativeDeepReadEnabled,
  });
}
