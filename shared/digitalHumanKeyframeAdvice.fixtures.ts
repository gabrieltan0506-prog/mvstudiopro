/** 仅开发测试夹具，不会提交任务或读取真实媒体。 */
import { newDigitalHumanDraft } from "./digitalHumanStudio";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema } from "./manhuaPrevis";
import type { DigitalHumanKeyframeAdviceTarget } from "./digitalHumanKeyframeAdvice";
export function keyframeAdviceDraftFixture() {
  const draft = newDigitalHumanDraft("7", "00000000-0000-4000-8000-000000000001");
  draft.script = "整理工作资料。"; draft.voiceId = "test-only";
  draft.portrait = { source: "gs://test-only/person.png", name: "本人" }; draft.scene = { source: "gs://test-only/room.png", name: "书房" };
  const audioId = "00000000-0000-4000-8000-000000000002";
  draft.audios = [{ request: { billingRequestId: audioId, input: draft.script, voice: draft.voiceId, speakerZh: "本人", speakerId: "test-only", voiceStateZh: "" }, source: "gs://test-only/voice.wav", durationSec: 30, status: "succeeded" }];
  draft.approvedAudioRequestId = audioId;
  const studio = createManhuaPrevisStudio(5); studio.audioStartSec = 10; studio.spec.aspect = draft.aspectRatio;
  studio.spec.actors[0].id = `dh-person-${draft.id}`;
  draft.mainStage = { x: studio.spec.actors[0].start[0], y: studio.spec.actors[0].start[1], yaw: studio.spec.actors[0].facingDeg || 0 };
  studio.spec = manhuaPrevisSpecSchema.parse(studio.spec);
  studio.history = [{ jobId: "test-only-render", requestId: "00000000-0000-4000-8000-000000000003", gcsUri: "gs://test-only/preview.mp4", url: "https://test.invalid/preview.mp4", createdAt: "2026-10-18T00:00:00Z", spec: structuredClone(studio.spec), durationSec: 5 }];
  draft.previsStudio = studio;
  return draft;
}
export function keyframeAdvicePlanFixture(target: DigitalHumanKeyframeAdviceTarget) {
  const actorIds = [JSON.parse(target.previs.specJson).actors[0].id];
  return { kind: "digital_human_keyframe_advice_v1", targetId: target.id, revision: target.revision, videoRequestId: target.previs.previousPreviewRequestId,
    summaryZh: "先检查手部与资料的接触，再补一张构图参考。", observations: [{ atVideoSec: 1, actorIds, detailZh: "人物在中央操作，手部位于前方。" }], whiteboxIssues: [],
    candidates: [{ label: "资料展开", necessity: "helpful", reasonZh: "锁定手与资料的位置", startSec: 11, endSec: 13, actorIds, identityZh: "本人原图锁身份", sceneZh: "书房布局不变", actionZh: "右手展开资料", compositionZh: "中景正面", referenceRoleZh: "只固定构图与手部位置，身份仍用本人原图", unverifiedZh: ["真人身份和音频未验"] }],
    noAdditionalFramesReasonZh: "", unverifiedZh: ["未逐帧与常速人工验收，真人身份与音频未验"] };
}
