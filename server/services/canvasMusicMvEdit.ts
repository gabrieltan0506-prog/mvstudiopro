import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  canvasMusicMvDraftInputSchema,
  canvasMusicMvPlanSchema,
} from "../../shared/canvasMusicMv";
import {
  musicMvEditDocumentSchema,
  musicMvEditReceiptSchema,
  musicMvEditKey,
  type MusicMvEditDocument,
} from "../../shared/canvasMusicMvEdit";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
  signGsUriV4ReadUrl,
} from "./gcs";
import {
  resolveCanvasMusicMvAudio,
  resolveCanvasMusicMvVideo,
} from "./canvasMusicMvMedia";
import { probe } from "./postProduction";

export const saveMusicMvEditInputSchema = z
  .object({
    revisionId: z.string().uuid(),
    document: musicMvEditDocumentSchema,
  })
  .strict();
export const getMusicMvEditInputSchema = z
  .object({
    revisionId: z.string().uuid(),
    basePlanRequestId: z.string().uuid(),
  })
  .strict();
const real = {
  bucket: getGcsBucketName,
  download: downloadGcsObjectVersioned,
  upload: uploadBufferToGcsIfAbsent,
  resolveAudio: resolveCanvasMusicMvAudio,
  resolveVideo: resolveCanvasMusicMvVideo,
  probe: async (source: string, signal: AbortSignal) =>
    probe(
      source.startsWith("gs://") ? signGsUriV4ReadUrl(source, 600) : source,
      signal
    ),
};
export type MusicMvEditDeps = typeof real;
const root = (uid: number, base: string, revision: string) =>
  `canvas-music-mv/edits/${uid}/${base}/${revision}.json`;
const sha = (doc: MusicMvEditDocument) =>
  createHash("sha256").update(musicMvEditKey(doc)).digest("hex");
async function read(d: MusicMvEditDeps, objectName: string) {
  try {
    return JSON.parse(
      (
        await d.download({ gcsUri: `gs://${d.bucket()}/${objectName}` })
      ).buffer.toString("utf8")
    );
  } catch (e) {
    if (
      e instanceof Error &&
      /^gcs_(?:stat|download)_failed:404(?:$|:)/.test(e.message)
    )
      return null;
    throw e;
  }
}
export async function getMusicMvEdit(
  userId: number,
  raw: z.infer<typeof getMusicMvEditInputSchema>,
  d = real
) {
  const input = getMusicMvEditInputSchema.parse(raw);
  const value = await read(
    d,
    root(userId, input.basePlanRequestId, input.revisionId)
  );
  if (!value)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "剪辑版本不存在或不属于当前账号",
    });
  const result = musicMvEditReceiptSchema.parse(value);
  if (
    result.revisionId !== input.revisionId ||
    result.document.basePlanRequestId !== input.basePlanRequestId ||
    sha(result.document) !== result.sha256
  )
    throw new Error("剪辑版本证据不一致");
  return result;
}
/** 只保存编辑决定，不生成媒体；不可变版本避免跨标签覆盖和网络重试重建。 */
export async function saveMusicMvEdit(
  userId: number,
  raw: z.infer<typeof saveMusicMvEditInputSchema>,
  d = real
) {
  const input = saveMusicMvEditInputSchema.parse(raw);
  const doc = input.document;
  const objectName = root(userId, doc.basePlanRequestId, input.revisionId);
  const prior = await read(d, objectName);
  if (prior) {
    const parsed = musicMvEditReceiptSchema.parse(prior);
    if (parsed.sha256 !== sha(doc))
      throw new TRPCError({
        code: "CONFLICT",
        message: "保存编号已绑定另一剪辑内容，请恢复原保存",
      });
    return getMusicMvEdit(
      userId,
      {
        revisionId: input.revisionId,
        basePlanRequestId: doc.basePlanRequestId,
      },
      d
    );
  }
  const base = `canvas-music-mv/evidence/${userId}/${doc.basePlanRequestId}`;
  const [rawPlan, settled] = await Promise.all([
    read(d, `${base}/result.json`),
    read(d, `${base}/settled.json`),
  ]);
  if (!rawPlan || settled?.settled !== true)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "原分镜尚未采用或不属于当前账号",
    });
  const plan = canvasMusicMvPlanSchema.parse(rawPlan.plan);
  const savedInput = canvasMusicMvDraftInputSchema.parse(rawPlan.input);
  if (
    savedInput.requestId !== doc.basePlanRequestId ||
    plan.audioId !== doc.audioId ||
    plan.audioDurationSec !== doc.audioDurationSec
  )
    throw new Error("剪辑歌曲与原计划不一致");
  await d.resolveAudio(userId, savedInput.audio);
  const cache = new Map<string, Promise<void>>();
  const controller = new AbortController();
  const signal = AbortSignal.any([
    AbortSignal.timeout(45000),
    controller.signal,
  ]);
  // 同一素材的分割/重复片段只探一次；四路有界并行，不提交后期或模型任务。
  let next = 0;
  const inspect = async () => {
    while (next < doc.clips.length) {
      signal.throwIfAborted();
      const clip = doc.clips[next++];
      const shot = plan.shots.find(s => s.id === clip.shotId);
      if (!shot || (shot.kind || "generated") !== clip.kind)
        throw new Error("剪辑引用了原计划之外的镜头");
      if (!clip.source) continue;
      const actual = await d.resolveVideo(userId, clip.source);
      if (
        shot.kind === "footage" &&
        shot.sourceClip &&
        actual !== (await d.resolveVideo(userId, shot.sourceClip))
      )
        throw new Error("已有素材身份与原计划不一致");
      const key = JSON.stringify([actual, clip.source.durationSec]);
      let pending = cache.get(key);
      if (!pending) {
        pending = (async () => {
          const info = await d.probe(actual, signal);
          if (
            !info.width ||
            !info.height ||
            !Number.isFinite(info.durationSec) ||
            Math.abs(info.durationSec - clip.source!.durationSec) > 0.1
          )
            throw new Error("源视频时长或媒体身份已变化，请重新同步素材");
        })();
        cache.set(key, pending);
      }
      await pending;
    }
  };
  const inspections = Array.from(
    { length: Math.min(4, doc.clips.length) },
    () =>
      inspect().catch(error => {
        controller.abort();
        throw error;
      })
  );
  const results = await Promise.allSettled(inspections);
  const failed = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );
  if (failed) throw failed.reason;
  const receipt = musicMvEditReceiptSchema.parse({
    revisionId: input.revisionId,
    createdAt: new Date().toISOString(),
    sha256: sha(doc),
    document: doc,
  });
  const saved = await d.upload({
    bucket: d.bucket(),
    objectName,
    buffer: Buffer.from(JSON.stringify(receipt)),
    contentType: "application/json",
  });
  if (!saved.created) {
    const existing = await getMusicMvEdit(
      userId,
      {
        revisionId: input.revisionId,
        basePlanRequestId: doc.basePlanRequestId,
      },
      d
    );
    if (existing.sha256 !== receipt.sha256)
      throw new TRPCError({
        code: "CONFLICT",
        message: "同时保存了不同剪辑内容，原版本保留",
      });
    return existing;
  }
  return receipt;
}
