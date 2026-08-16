import {
  makeWeixinChannelsObservationId,
  qualifyWeixinChannelsObservationLocally,
  WEIXIN_CHANNELS_MAX_COMPLETE_CAPTURE_MS,
  type WeixinChannelsCommentSample,
  type WeixinChannelsQualificationInput,
} from "../shared/weixinChannelsRules";
import type { WeixinChannelsRawManifest } from "./weixin-channels-raw-spool.mts";

export const WEIXIN_CHANNELS_RAW_SEARCH_MAX_AGE_DAYS = 365;

export type WeixinChannelsRawOfflineAnalysis = WeixinChannelsQualificationInput & {
  title: string;
  author?: string;
  videoIdentity?: string;
  commentSamples?: WeixinChannelsCommentSample[];
};

export type WeixinChannelsRawOfflineDecision =
  | { state: "rejected"; reason: string }
  | { state: "duplicate"; reason: string; observationId: string }
  | {
    state: "accepted";
    observationId: string;
    observation: Record<string, unknown>;
  };

export function decideWeixinChannelsRawOfflineItem(params: {
  manifest: WeixinChannelsRawManifest;
  analysis: WeixinChannelsRawOfflineAnalysis;
  duplicateVideoIdentities?: ReadonlySet<string>;
  duplicateObservationIds?: ReadonlySet<string>;
  runKind?: "formal" | "probe";
}): WeixinChannelsRawOfflineDecision {
  const { manifest, analysis } = params;
  const captureBudgetMs = manifest.captureBudgetMs
    ?? WEIXIN_CHANNELS_MAX_COMPLETE_CAPTURE_MS;
  // 该预算只记录本机何时应退出重复 UI 操作；完成并校验过的真实素材即使
  // 收尾超过 35 秒也不能在离线阶段被静默丢弃。
  if (manifest.source !== "recommendation") {
    if (manifest.searchSelectedAgeDays === undefined) {
      return { state: "rejected", reason: "search_result_age_unconfirmed" };
    }
    if (manifest.searchSelectedAgeDays > WEIXIN_CHANNELS_RAW_SEARCH_MAX_AGE_DAYS) {
      return { state: "rejected", reason: "search_result_older_than_one_year" };
    }
  }
  if (!analysis.videoIdentity) {
    return { state: "rejected", reason: "offline_video_identity_missing" };
  }
  const qualification = qualifyWeixinChannelsObservationLocally({
    query: manifest.query,
    title: analysis.title,
    likes: analysis.likes,
    shares: analysis.shares,
    favorites: analysis.favorites,
    comments: analysis.comments,
    ocrTexts: analysis.ocrTexts,
  });
  if (!qualification.qualified) {
    return {
      state: "rejected",
      reason: qualification.invalid ? "advertisement" : "offline_not_qualified",
    };
  }
  if (qualification.requiresComments && !(analysis.commentSamples?.length)) {
    return { state: "rejected", reason: "required_comments_missing" };
  }
  const observationId = makeWeixinChannelsObservationId({
    taskId: manifest.taskId,
    title: analysis.title,
    author: analysis.author,
    videoIdentity: analysis.videoIdentity,
  });
  if (params.duplicateVideoIdentities?.has(analysis.videoIdentity)
    || params.duplicateObservationIds?.has(observationId)) {
    return { state: "duplicate", reason: "offline_video_identity_duplicate", observationId };
  }
  return {
    state: "accepted",
    observationId,
    observation: {
      observationId,
      videoIdentity: analysis.videoIdentity,
      taskId: manifest.taskId,
      query: manifest.query,
      resultRank: 1,
      title: analysis.title || "当前视频",
      author: analysis.author,
      observedAt: manifest.capturedAt,
      likes: analysis.likes,
      comments: analysis.comments,
      shares: analysis.shares,
      favorites: analysis.favorites,
      commentSamples: analysis.commentSamples?.length ? analysis.commentSamples : undefined,
      ocrTexts: analysis.ocrTexts,
      captureBudgetMs,
      captureElapsedMs: manifest.captureElapsedMs,
      evidence: "capture",
      runKind: params.runKind || "formal",
      collectorWindowId: manifest.windowId,
      rawCaptureId: manifest.rawId,
    },
  };
}
