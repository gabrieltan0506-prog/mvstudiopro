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
import { listNativeDeepReadEpisodeClaims } from "./manhuaNativeDeepReadClaim.js";
import { isManhuaNativeDeepReadEnabled } from "./manhuaNativeDeepReadRunner.js";
import { resolveManhuaSeriesKey } from "./manhuaTemplateLearnService.js";
import type { ManhuaTemplateLearnLlmProvider } from "../../shared/manhuaTemplateLearnFrameVision.js";

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
    probeDurationSec: probeNativeDeepReadDurationSec,
    listIngestedEpisodes: listIngestedNativeDeepReadEpisodes,
    listClaimedEpisodes: listNativeDeepReadEpisodeClaims,
    resolveSeriesKey: resolveManhuaSeriesKey,
    isExecutionEnabled: isManhuaNativeDeepReadEnabled,
  });
}
