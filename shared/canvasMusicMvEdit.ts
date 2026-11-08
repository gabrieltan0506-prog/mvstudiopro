import { z } from "zod";
import type { CanvasMusicMvPlan } from "./canvasMusicMv";
import { manhuaSourceVersionIdentity } from "./manhuaMultiview";
import {
  isStockAssetInsertable,
  stockDurationFrames,
  type StockFootageAsset,
} from "./stockFootage";

export const MV_EDIT_FPS = 30;
export const MV_EDIT_MIN_FRAMES = 15;
const identity = z.string().trim().min(1).max(5000);
export const musicMvEditSourceSchema = z
  .object({
    url: identity,
    taskId: z.string().min(1).max(200).optional(),
    durationSec: z.number().finite().positive().max(3600),
  })
  .strict();
export const musicMvEditClipSchema = z
  .object({
    id: z.string().min(1).max(200),
    shotId: z.string().min(1).max(100),
    blockId: z.string().min(1).max(200),
    title: z.string().max(4000),
    kind: z.enum(["generated", "singing", "footage"]),
    sourceInFrame: z.number().int().min(0).max(108000),
    durationFrames: z.number().int().min(MV_EDIT_MIN_FRAMES).max(108000),
    source: musicMvEditSourceSchema.optional(),
  })
  .strict();
export const musicMvEditDocumentSchema = z
  .object({
    version: z.literal(1),
    fps: z.literal(30),
    basePlanRequestId: z.string().uuid(),
    audioId: z.string().min(1).max(200),
    audioDurationSec: z.number().finite().positive().max(3600),
    clips: z.array(musicMvEditClipSchema).max(1000),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (new Set(doc.clips.map(c => c.id)).size !== doc.clips.length)
      ctx.addIssue({
        code: "custom",
        path: ["clips"],
        message: "剪辑片段编号重复",
      });
    doc.clips.forEach((c, i) => {
      const stock = isMusicMvStockSource(c.source);
      if (stock && c.kind !== "footage")
        ctx.addIssue({
          code: "custom",
          path: ["clips", i, "kind"],
          message: "图库素材只能作为素材切片入片",
        });
      if (stock && !MV_STOCK_GCS_URI.test(c.source!.url))
        ctx.addIssue({
          code: "custom",
          path: ["clips", i, "source", "url"],
          message: "图库素材只保存永久存储地址，不保存临时签名或第三方直链",
        });
      if (
        c.source &&
        c.sourceInFrame + c.durationFrames >
          (stock
            ? stockDurationFrames(c.source.durationSec, MV_EDIT_FPS)
            : Math.round(c.source.durationSec * MV_EDIT_FPS))
      )
        ctx.addIssue({
          code: "custom",
          path: ["clips", i],
          message: "裁点超出源视频时长",
        });
    });
  });
export type MusicMvEditClip = z.infer<typeof musicMvEditClipSchema>;
export type MusicMvEditSource = z.infer<typeof musicMvEditSourceSchema>;

/**
 * 图库素材绑定合同：source.url 存采用资产的 gcsUri，source.taskId 存 assetId，
 * durationSec 为资产时长。服务端凭 assetId 查本人采用记录核对，url 本身不作所有权证据。
 */
export const MV_STOCK_ASSET_ID = /^sf_[0-9a-f]{48}$/;
const MV_STOCK_GCS_URI = /^gs:\/\/[^/?#]+\/[^?#]+$/;
export function isMusicMvStockSource(
  source: Pick<MusicMvEditSource, "taskId"> | undefined
): boolean {
  return !!source?.taskId && MV_STOCK_ASSET_ID.test(source.taskId);
}
/**
 * 片段与原计划镜头的制作方式是否一致。唯一例外：非对口型镜头可被本人已采用的
 * 图库素材替换为素材切片（对口型必须保留原唱段与人物）。
 */
export function musicMvClipMatchesShot(
  shot: { kind?: "generated" | "singing" | "footage" },
  clip: Pick<MusicMvEditClip, "kind" | "source">
): boolean {
  const planned = shot.kind || "generated";
  if (planned === clip.kind) return true;
  return (
    clip.kind === "footage" &&
    planned !== "singing" &&
    isMusicMvStockSource(clip.source)
  );
}
export type MusicMvStockBinding = Pick<
  StockFootageAsset,
  "assetId" | "gcsUri" | "kind" | "purpose" | "usage" | "durationSec"
>;
/** 抽屉裁点换算后的源入点与窗口帧数（stockTrimToFrames 的输出）。 */
export type MusicMvStockTrim = { sourceInFrame: number; durationFrames?: number };
/**
 * 把已采用的图库视频绑定到某片段：改为素材切片，入点默认归零（可传抽屉选定的入点），
 * 时长不超过原片段与所选窗口（素材较短时收缩到入点后剩余可用帧数，缺口由剪辑问题提示），
 * 入点+时长永不越过源时长，不改其他片段。
 */
export function bindMusicMvStockFootage(
  doc: MusicMvEditDocument,
  clipId: string,
  asset: MusicMvStockBinding,
  trim?: MusicMvStockTrim
): MusicMvEditDocument {
  const clip = doc.clips.find(c => c.id === clipId);
  if (!clip) throw new Error("片段不存在");
  if (clip.kind === "singing")
    throw new Error("对口型镜头须保留原唱段，不能替换为图库素材");
  if (
    asset.kind !== "video" ||
    asset.purpose !== "mv" ||
    !isStockAssetInsertable(asset) ||
    !MV_STOCK_ASSET_ID.test(asset.assetId) ||
    !MV_STOCK_GCS_URI.test(asset.gcsUri)
  )
    throw new Error("只能使用为 MV 采用、可直接入片的图库视频");
  const durationSec = asset.durationSec;
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0)
    throw new Error("图库视频缺少时长，无法裁切");
  const available = stockDurationFrames(durationSec, MV_EDIT_FPS);
  if (available < MV_EDIT_MIN_FRAMES)
    throw new Error("图库视频短于0.5秒，不能入片");
  const sourceInFrame = trim?.sourceInFrame ?? 0;
  if (!Number.isInteger(sourceInFrame) || sourceInFrame < 0)
    throw new Error("图库视频入点无效");
  if (
    trim?.durationFrames !== undefined &&
    (!Number.isInteger(trim.durationFrames) ||
      trim.durationFrames < MV_EDIT_MIN_FRAMES)
  )
    throw new Error("所选裁段短于0.5秒，不能入片");
  if (available - sourceInFrame < MV_EDIT_MIN_FRAMES)
    throw new Error("入点之后的图库视频短于0.5秒，请把入点前移");
  const durationFrames = Math.min(
    clip.durationFrames,
    trim?.durationFrames ?? clip.durationFrames,
    available - sourceInFrame
  );
  return musicMvEditDocumentSchema.parse({
    ...doc,
    clips: doc.clips.map(c =>
      c.id === clipId
        ? {
            ...c,
            kind: "footage",
            sourceInFrame,
            durationFrames,
            source: {
              url: asset.gcsUri,
              taskId: asset.assetId,
              durationSec,
            },
          }
        : c
    ),
  });
}
export type MusicMvEditDocument = z.infer<typeof musicMvEditDocumentSchema>;
export const musicMvEditReceiptSchema = z
  .object({
    revisionId: z.string().uuid(),
    createdAt: z.string(),
    sha256: z.string(),
    document: musicMvEditDocumentSchema,
  })
  .strict();
export type MusicMvEditReceipt = z.infer<typeof musicMvEditReceiptSchema>;
export const musicMvEditSessionSchema = z
  .object({
    draft: musicMvEditDocumentSchema,
    undo: z.array(musicMvEditDocumentSchema),
    redo: z.array(musicMvEditDocumentSchema),
    saved: musicMvEditReceiptSchema.optional(),
    versions: z.array(musicMvEditReceiptSchema),
    pending: z
      .object({
        revisionId: z.string().uuid(),
        document: musicMvEditDocumentSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type MusicMvEditSession = z.infer<typeof musicMvEditSessionSchema>;

/** 签名刷新不构成剪辑变化；只有源对象、任务、裁点和顺序决定内容版本。 */
export function musicMvEditKey(doc: MusicMvEditDocument): string {
  return JSON.stringify({
    ...doc,
    clips: doc.clips.map(c => ({
      ...c,
      source: c.source
        ? { ...c.source, url: manhuaSourceVersionIdentity(c.source.url) }
        : undefined,
    })),
  });
}
export function musicMvEditPositions(doc: MusicMvEditDocument) {
  let frame = 0;
  return doc.clips.map(clip => {
    const startFrame = frame;
    frame += clip.durationFrames;
    return { clip, startFrame, endFrame: frame };
  });
}
export function musicMvEditTotalFrames(doc: MusicMvEditDocument) {
  return doc.clips.reduce((sum, c) => sum + c.durationFrames, 0);
}

/**
 * 片段画面状态：已绑定可播放源 = ready；未绑定但对应画布镜头已有成片 = syncable
 * （点「同步已有镜头」即可写入）；其余 = missing（待素材）。
 */
export type MusicMvClipReadiness = "ready" | "syncable" | "missing";
export function musicMvClipReadiness(
  clip: Pick<MusicMvEditClip, "source" | "blockId">,
  blocks: ReadonlyArray<{ id: string; status?: string; outputUrl?: string }> = []
): MusicMvClipReadiness {
  if (clip.source) return "ready";
  const block = blocks.find(b => b.id === clip.blockId);
  return block?.status === "done" && block.outputUrl ? "syncable" : "missing";
}
/** 合成前的素材缺口：missing 含待同步片段（合成只消费已绑定源），syncable 单列便于提示。 */
export function musicMvEditMaterialGap(
  doc: MusicMvEditDocument,
  blocks: ReadonlyArray<{ id: string; status?: string; outputUrl?: string }> = []
): { missing: number; syncable: number } {
  let missing = 0,
    syncable = 0;
  for (const clip of doc.clips) {
    const r = musicMvClipReadiness(clip, blocks);
    if (r === "ready") continue;
    missing++;
    if (r === "syncable") syncable++;
  }
  return { missing, syncable };
}

/** 草稿可短于原歌；输出必须完整覆盖，演唱片必须仍对齐原唱段。 */
export function musicMvEditIssues(
  doc: MusicMvEditDocument,
  plan: CanvasMusicMvPlan
): string[] {
  const issues: string[] = [];
  if (
    doc.audioId !== plan.audioId ||
    doc.audioDurationSec !== plan.audioDurationSec
  )
    issues.push("剪辑与歌曲版本不一致");
  const remaining =
    Math.round(plan.audioDurationSec * 30) - musicMvEditTotalFrames(doc);
  if (remaining !== 0)
    issues.push(
      remaining > 0
        ? `歌曲还缺 ${(remaining / 30).toFixed(2)} 秒画面`
        : `画面超出歌曲 ${(-remaining / 30).toFixed(2)} 秒`
    );
  for (const { clip, startFrame } of musicMvEditPositions(doc)) {
    const shot = plan.shots.find(s => s.id === clip.shotId);
    if (!shot || !musicMvClipMatchesShot(shot, clip)) {
      issues.push(`「${clip.title}」镜头来源不一致`);
      continue;
    }
    if (!clip.source) issues.push(`「${clip.title}」尚未绑定可播放视频`);
    if (
      clip.kind === "singing" &&
      startFrame - clip.sourceInFrame !== Math.round(shot.startSec * 30)
    )
      issues.push(
        `「${clip.title}」已偏离原唱段；请恢复原位置或使用重新制作并对齐的镜头`
      );
  }
  return issues;
}

export function commitMusicMvEdit(
  session: MusicMvEditSession,
  document: MusicMvEditDocument
): MusicMvEditSession {
  const draft = musicMvEditDocumentSchema.parse(document);
  if (musicMvEditKey(draft) === musicMvEditKey(session.draft)) return session;
  return {
    ...session,
    draft,
    undo: [...session.undo, session.draft],
    redo: [],
  };
}
export function undoMusicMvEdit(s: MusicMvEditSession): MusicMvEditSession {
  const last = s.undo.at(-1);
  return last
    ? {
        ...s,
        draft: last,
        undo: s.undo.slice(0, -1),
        redo: [...s.redo, s.draft],
      }
    : s;
}
export function redoMusicMvEdit(s: MusicMvEditSession): MusicMvEditSession {
  const last = s.redo.at(-1);
  return last
    ? {
        ...s,
        draft: last,
        redo: s.redo.slice(0, -1),
        undo: [...s.undo, s.draft],
      }
    : s;
}
export function reorderMusicMvClip(
  doc: MusicMvEditDocument,
  fromId: string,
  toIndex: number
): MusicMvEditDocument {
  const source = doc.clips.findIndex(c => c.id === fromId);
  if (source < 0) throw new Error("拖动片段不存在");
  const clips = [...doc.clips];
  const [clip] = clips.splice(source, 1);
  clips.splice(Math.max(0, Math.min(toIndex, clips.length)), 0, clip);
  return musicMvEditDocumentSchema.parse({ ...doc, clips });
}
/** 拖动左右边缘同时改变源入点/时长；后续片段顺移，原媒体不变。 */
export function trimMusicMvClip(
  doc: MusicMvEditDocument,
  id: string,
  start: number,
  duration: number
): MusicMvEditDocument {
  if (!doc.clips.some(c => c.id === id)) throw new Error("片段不存在");
  return musicMvEditDocumentSchema.parse({
    ...doc,
    clips: doc.clips.map(c =>
      c.id === id ? { ...c, sourceInFrame: start, durationFrames: duration } : c
    ),
  });
}
export function splitMusicMvClip(
  doc: MusicMvEditDocument,
  id: string,
  offset: number,
  newId: string
): MusicMvEditDocument {
  const index = doc.clips.findIndex(c => c.id === id);
  const clip = doc.clips[index];
  if (
    !clip ||
    offset < MV_EDIT_MIN_FRAMES ||
    clip.durationFrames - offset < MV_EDIT_MIN_FRAMES
  )
    throw new Error("分割后两侧均须至少0.5秒");
  const clips = [...doc.clips];
  clips.splice(
    index,
    1,
    { ...clip, durationFrames: offset },
    {
      ...clip,
      id: newId,
      sourceInFrame: clip.sourceInFrame + offset,
      durationFrames: clip.durationFrames - offset,
    }
  );
  return musicMvEditDocumentSchema.parse({ ...doc, clips });
}
