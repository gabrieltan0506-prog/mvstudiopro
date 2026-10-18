import { digitalHumanKeyframeAdviceTargetSchema } from "@shared/digitalHumanKeyframeAdvice";
import { digitalHumanFilmRevision } from "@shared/digitalHumanFilmDirector";
import { currentDigitalHumanAudio, digitalHumanSpatialFingerprint, type DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { advisorPrevisSpecJson, makeAdvisorPrevisTarget } from "@shared/manhuaAdvisorPrevisEdit";
import { manhuaPrevisSpecSchema } from "@shared/manhuaPrevis";
import { previsPlaybackDuration } from "@shared/manhuaPrevisPlayback";
import { digitalHumanPrevisSceneAligned } from "./digitalHumanSpatialAdvisor";

/** 只允许当前规格对应的已渲染视频；未采用的当前试看也可交给顾问审片。 */
export function makeDigitalHumanKeyframeAdviceTarget(draft: DigitalHumanDraft) {
  const studio = draft.previsStudio;
  if (!studio) throw new Error("请先建立并渲染当前白模视频");
  if (!digitalHumanPrevisSceneAligned(draft)) throw new Error("人物站位或场景已变化，请更新并渲染当前白模");
  const audio = currentDigitalHumanAudio(draft);
  if (!audio?.durationSec || draft.approvedAudioRequestId !== audio.request.billingRequestId) throw new Error("请先确认当前文稿的完整配音，以绑定补图时间");
  const spec = manhuaPrevisSpecSchema.parse(studio.spec);
  if (spec.aspect !== draft.aspectRatio) throw new Error("画幅已变化，请按当前画幅重新渲染白模");
  const exactSpec = JSON.stringify(spec);
  const take = [...studio.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find(row => JSON.stringify(row.spec) === exactSpec);
  if (!take) throw new Error("当前规格没有已渲染的白模视频，请先渲染再审片");
  if (Math.abs(take.durationSec - previsPlaybackDuration(spec)) > 0.05) throw new Error("白模回执时长与当前规格不一致，请恢复原任务");
  const previs = makeAdvisorPrevisTarget(`dh-previs-${draft.id}`, studio, take.requestId);
  if (previs.previousPreviewSpecJson !== advisorPrevisSpecJson(spec)) throw new Error("白模视频已过期，请先渲染当前规格");
  return digitalHumanKeyframeAdviceTargetSchema.parse({
    id: draft.id,
    revision: digitalHumanFilmRevision({ spatial: digitalHumanSpatialFingerprint(draft), audio: audio.request.billingRequestId, audioDuration: audio.durationSec, offset: studio.audioStartSec || 0, take: take.requestId, keyframes: draft.keyframes, directorPlan: draft.filmDirector }),
    previs, timelineStartSec: studio.audioStartSec || 0, narrationDurationSec: audio.durationSec,
    sceneZh: draft.sceneDescription.trim() || draft.scene?.name || "当前白模场景，最终场景外观尚未核验",
    existingFrames: (draft.keyframes || []).map(frame => ({ label: frame.label, useZh: frame.useZh, startSec: frame.startSec, endSec: frame.endSec, adopted: frame.adopted })),
  });
}
