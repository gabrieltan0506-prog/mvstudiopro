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
  resolveDouyinShortLinkViaRedirect,
  listDouyinAwemePlaybackUrlsViaWebApi,
  listDouyinMixEpisodesViaWebApi,
} from "./manhuaLearnDouyinWebApi.js";
import { listIngestedNativeDeepReadEpisodeRecords } from "./manhuaNativeDeepReadIngest.js";
import { listNativeDeepReadEpisodeClaimStates } from "./manhuaNativeDeepReadClaim.js";
import { isManhuaNativeDeepReadEnabled } from "./manhuaNativeDeepReadRunner.js";
import { resolveManhuaSeriesKey } from "./manhuaTemplateLearnService.js";
import type { ManhuaTemplateLearnLlmProvider } from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  nativeDeepReadSeriesKeyForModel,
  type ManhuaNativeDeepReadModelId,
} from "../../shared/manhuaNativeDeepReadJob.js";
import {
  fetchManhua0996EpisodePlayback,
  readManhuaLearnExtraSourceHosts,
  resolveManhua0996Series,
} from "./manhuaLearn0996Source.js";
import { isManhua0996SourceUrl } from "../../shared/manhuaLearn0996Source.js";

export type NativeDeepReadPlanRuntimeInput = {
  url: string;
  limit: number;
  segmentSeconds?: number;
  /** 整支即全集：跳过合集展开，按独立长视频单集学习 */
  treatAsStandalone?: boolean;
  videoFps?: number;
  allowPartial?: boolean;
  learnLlm?: ManhuaTemplateLearnLlmProvider;
  /** 0903 双模型：非默认模型的学习走带后缀的平行 seriesKey，卡库两版并存互不覆盖。 */
  readModel?: ManhuaNativeDeepReadModelId;
  abortSignal?: AbortSignal;
};


export async function buildNativeDeepReadPlanPreviewFromServices(
  input: NativeDeepReadPlanRuntimeInput,
): Promise<NativeDeepReadPlanPreview> {
  return buildNativeDeepReadPlanPreview(input, {
    resolveShortLink: resolveDouyinShortLinkViaRedirect,
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
    // 必须保留 partial 卡的稳定 sourceUrl：同一单源续跑要在计划阶段就回到原集号，
    // 才能让执行层命中该集的 GCS 段缓存。
    listIngestedEpisodeRecords: listIngestedNativeDeepReadEpisodeRecords,
    listClaimStates: listNativeDeepReadEpisodeClaimStates,
    resolveSeriesKey: async (keyInput) => nativeDeepReadSeriesKeyForModel(
      await resolveManhuaSeriesKey({ ...keyInput, readModel: input.readModel }),
      input.readModel,
    ),
    isExecutionEnabled: isManhuaNativeDeepReadEnabled,
  });
}
