import { z } from "zod";
import { digitalHumanFilmRevision } from "./digitalHumanFilmDirector";
import type { DigitalHumanDraft } from "./digitalHumanStudio";

/** 上传只建立候选；时段和画面经确认后才进入视频参考。 */
export const digitalHumanKeyframeSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  media: z.object({ source: z.string().regex(/^(gs:\/\/|https:\/\/)/).max(5000), name: z.string().max(200) }),
  useZh: z.string().max(1000),
  startSec: z.number().finite().min(0).max(1800).optional(),
  endSec: z.number().finite().positive().max(1800).optional(),
  adopted: z.boolean(),
  reviewedRevision: z.string().max(100).optional(),
}).strict();
export const digitalHumanKeyframesSchema = z.array(digitalHumanKeyframeSchema).max(24).superRefine((rows, ctx) => {
  if (new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: "custom", message: "关键分镜编号重复，未覆盖原图" });
});
export type DigitalHumanKeyframe = z.infer<typeof digitalHumanKeyframeSchema>;

export function digitalHumanKeyframeRevision(draft: DigitalHumanDraft, frame: DigitalHumanKeyframe): string {
  return digitalHumanFilmRevision({
    script: draft.script.trim(), direction: draft.direction, ratio: draft.aspectRatio,
    portrait: draft.portrait, originalPortraits: draft.originalPortraits, scene: draft.scene, sceneDescription: draft.sceneDescription,
    sourceShots: draft.source?.shots, mainStage: draft.mainStage, stageCamera: draft.stageCamera,
    stageFrame: draft.stageFrame, worldTaskId: draft.worldTaskId,
    voiceId: draft.voiceId, approvedAudioRequestId: draft.approvedAudioRequestId,
    audio: draft.audios.filter(audio => audio.request.billingRequestId === draft.approvedAudioRequestId)
      .map(audio => ({ source: audio.source, durationSec: audio.durationSec, request: audio.request })),
    actors: draft.actors.map(actor => ({ id: actor.id, label: actor.labelZh, portrait: actor.portrait, x: actor.x, y: actor.y, yaw: actor.yaw })),
    directorPlan: draft.filmDirector?.plan,
    frame: { id: frame.id, label: frame.label, media: frame.media, useZh: frame.useZh, startSec: frame.startSec, endSec: frame.endSec },
  });
}

export function assertDigitalHumanKeyframeTiming(frame: DigitalHumanKeyframe, durationSec: number | undefined): void {
  if (!durationSec) throw new Error("请先准备当前文案的完整配音，再按实际时长绑定关键分镜");
  if (frame.startSec === undefined || frame.endSec === undefined || frame.endSec <= frame.startSec || frame.endSec > durationSec + 0.001)
    throw new Error(`“${frame.label}”须绑定完整配音内的有效起止时间`);
  if (!frame.useZh.trim()) throw new Error(`请填写“${frame.label}”要锁定的画面、动作或构图`);
}

/** 分段只发送与本段有交集的已采用图片；跨段共用图保留同一素材身份。 */
export function selectDigitalHumanKeyframes(draft: DigitalHumanDraft, startSec: number, endSec: number, durationSec: number): DigitalHumanKeyframe[] {
  const frames = (draft.keyframes || []).filter(frame => frame.adopted);
  for (const frame of frames) {
    assertDigitalHumanKeyframeTiming(frame, durationSec);
    if (frame.reviewedRevision !== digitalHumanKeyframeRevision(draft, frame))
      throw new Error(`“${frame.label}”的输入已改变，请重新审图并采用；旧图已保留`);
  }
  return frames.filter(frame => frame.endSec! > startSec + 0.001 && frame.startSec! < endSec - 0.001);
}
