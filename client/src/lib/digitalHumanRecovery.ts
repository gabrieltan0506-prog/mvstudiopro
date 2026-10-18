import {
  digitalHumanPending,
  type DigitalHumanDraft,
  type DigitalHumanVideo,
} from "@shared/digitalHumanStudio";
import { gsUriFromSignedGcsUrl } from "@shared/manhuaMultiview";
import type { CanvasDialogueResponse } from "../../../server/services/canvasDialogueOperation";
import type { CanvasVoiceReferenceResponse } from "../../../server/services/canvasVoiceReference";
import type { JobResponse } from "./jobs";
import type { VideoUpscaleStatusSnapshot } from "./videoUpscaleApi";
export type DigitalHumanRecoveryServices = {
  listVoices: () => Promise<CanvasVoiceReferenceResponse[]>;
  dialogue: (requestId: string) => Promise<CanvasDialogueResponse | null>;
  scene: (requestId: string) => Promise<{ jobId: string } | null>;
  job: (jobId: string) => Promise<JobResponse>;
  intent: (intentId: string) => Promise<{ taskId?: string; message?: string }>;
  omni?: (requestId: string) => Promise<{ taskId?: string; status: string; videoUrl?: string; error?: string } | null>;
  video: (taskId: string) => Promise<VideoUpscaleStatusSnapshot>;
  enhancements: (scope: string) => Promise<
    Array<{
      taskId: string;
      sourceUrl?: string;
      upscaleSourceUrl?: string;
      target?: string;
      upscaleTarget?: string;
    }>
  >;
  save: (update: (draft: DigitalHumanDraft) => DigitalHumanDraft) => void;
  updateVideo: (id: string, patch: Partial<DigitalHumanVideo>) => void;
};
const sourceIdentity = (value: string | undefined) =>
  value ? gsUriFromSignedGcsUrl(value) || value : undefined;
const videoStatus = (receipt: VideoUpscaleStatusSnapshot) =>
  receipt.status === "succeeded"
    ? ("succeeded" as const)
    : receipt.status === "failed"
      ? ("failed" as const)
      : ["reconcile_manual", "timed_out_pending_reconcile"].includes(
            receipt.status
          )
        ? ("unknown" as const)
        : ("running" as const);
/** 恢复只查询原编号；一条服务故障不能阻断其他已提交步骤。 */
export async function recoverDigitalHumanDraft(
  snapshot: DigitalHumanDraft,
  services: DigitalHumanRecoveryServices
): Promise<string[]> {
  const work: Array<() => Promise<void>> = [];
  if (snapshot.cloneRequest)
    work.push(async () => {
      const voices = await services.listVoices(),
        voice = voices.find(
          v => v.requestId === snapshot.cloneRequest!.requestId
        );
      if (voice?.status === "ready" && voice.voiceId)
        services.save(d => d.cloneRequest?.requestId === snapshot.cloneRequest!.requestId ? ({
          ...d,
          voiceId: voice.voiceId!,
          approvedAudioRequestId: undefined,
          cloneRequest: undefined,
        }) : d);
    });
  for (const row of snapshot.audios.filter(a => a.origin !== "recording" && digitalHumanPending(a.status)))
    work.push(async () => {
      const receipt = await services.dialogue(row.request.billingRequestId);
      if (!receipt) return;
      services.save(d => ({
        ...d,
        audios: d.audios.map(a =>
          a.request.billingRequestId === row.request.billingRequestId
            ? {
                ...a,
                status:
                  receipt.status === "reconcile_manual"
                    ? "unknown"
                    : receipt.status,
                jobId: receipt.jobId,
                source: receipt.result?.gcsUri,
                durationSec: receipt.result?.durationSec,
                creditsCost: receipt.creditsCost,
                canResumeSettlement: receipt.canResumeSettlement,
                message: receipt.message,
              }
            : a
        ),
      }));
    });
  for (const row of snapshot.scenes.filter(s => digitalHumanPending(s.status)))
    work.push(async () => {
      const jobId =
        row.jobId || (await services.scene(row.request.requestId))?.jobId;
      if (!jobId) {
        services.save(d => ({ ...d, scenes: d.scenes.map(s => s.request.requestId === row.request.requestId
          ? { ...s, status: "unknown", message: "尚未查到原场景任务。可使用原编号恢复提交，查询不会自动生成。" } : s) }));
        return;
      }
      const receipt = await services.job(jobId),
        source = receipt.output?.imageUrl;
      if (
        receipt.status === "succeeded" &&
        (typeof source !== "string" || !source)
      )
        throw new Error("场景任务缺少图片，请核对原任务");
      services.save(d => ({
        ...d,
        scenes: d.scenes.map(s =>
          s.request.requestId === row.request.requestId
            ? {
                ...s,
                jobId,
                status:
                  receipt.status === "queued" ? "running" : receipt.status,
                source: sourceIdentity(source),
                message: receipt.error,
              }
            : s
        ),
      }));
    });
  for (const row of snapshot.videos.filter(v => digitalHumanPending(v.status)))
    work.push(async () => {
      let taskId = row.taskId;
      if (row.engine === "omnihuman2-wavespeed" && !taskId) {
        if (!services.omni) throw new Error("数字人口播恢复入口暂不可用");
        const found = await services.omni(row.requestId);
        if (found) {
          taskId = found.taskId;
          services.updateVideo(row.requestId, { taskId, status: found.status === "failed" ? "failed" : found.status === "succeeded" ? "succeeded" : "unknown", source: sourceIdentity(found.videoUrl), message: found.error });
        }
      }
      if (!taskId && row.intentId && !row.engine) {
        const found = await services.intent(row.intentId);
        taskId = found.taskId;
        if (found.message)
          services.updateVideo(row.requestId, { message: found.message });
      }
      if (!taskId) return;
      const receipt = await services.video(taskId);
      if (receipt.status === "succeeded" && !receipt.videoUrl)
        throw new Error("视频任务缺少成片，请核对原任务");
      services.updateVideo(row.requestId, {
        taskId,
        status: videoStatus(receipt),
        source: sourceIdentity(receipt.videoUrl),
        message: receipt.error,
      });
    });
  for (const row of snapshot.videos.filter(
    v => v.upscale && digitalHumanPending(v.upscale.status)
  ))
    work.push(async () => {
      let taskId = row.upscale!.taskId;
      if (!taskId) {
        const tasks = await services.enhancements(
          `digital-human:${snapshot.id}:${row.requestId}${row.upscale!.target ? ":" + row.upscale!.target : ""}`
        );
        taskId = tasks.find(
          r =>
            sourceIdentity(r.upscaleSourceUrl || r.sourceUrl) ===
              sourceIdentity(row.upscale!.inputSource) &&
            (r.upscaleTarget || r.target) === (row.upscale!.target || "4k")
        )?.taskId;
      }
      if (!taskId) return;
      const receipt = await services.video(taskId);
      if (receipt.status === "succeeded" && !receipt.videoUrl)
        throw new Error("超分任务缺少成片，请核对原任务");
      services.updateVideo(row.requestId, {
        upscale: {
          ...row.upscale!,
          taskId,
          status: videoStatus(receipt),
          source: sourceIdentity(receipt.videoUrl),
          message: receipt.error,
        },
      });
    });
  const results = await Promise.allSettled(work.map(run => run()));
  return results.flatMap(r =>
    r.status === "rejected"
      ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
      : []
  );
}
