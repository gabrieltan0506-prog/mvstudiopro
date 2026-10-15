import { z } from "zod";
import type { CanvasMusicMvPlan } from "./canvasMusicMv";
import { manhuaSourceVersionIdentity } from "./manhuaMultiview";

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
      if (
        c.source &&
        c.sourceInFrame + c.durationFrames >
          Math.round(c.source.durationSec * MV_EDIT_FPS)
      )
        ctx.addIssue({
          code: "custom",
          path: ["clips", i],
          message: "裁点超出源视频时长",
        });
    });
  });
export type MusicMvEditClip = z.infer<typeof musicMvEditClipSchema>;
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
    if (!shot || (shot.kind || "generated") !== clip.kind) {
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
