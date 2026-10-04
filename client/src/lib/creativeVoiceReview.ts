import { z } from "zod";
import type { CreativeVoiceTarget } from "@shared/creativeVoice";
export const voiceReviewNoteSchema = z.object({
  id: z.string().min(1), createdAt: z.string().min(1), text: z.string().trim().min(1).max(2000),
  episode: z.number().int().positive().optional(), shot: z.number().int().positive().optional(),
  atSec: z.number().finite().min(0).optional(), source: z.string().optional(), done: z.boolean(),
});
export type VoiceReviewNote = z.infer<typeof voiceReviewNoteSchema>;
export function parseVoiceReviewNotes(raw: string | null): VoiceReviewNote[] {
  return raw === null ? [] : z.array(voiceReviewNoteSchema).parse(JSON.parse(raw));
}
export function resolveVoiceTarget(targets: CreativeVoiceTarget[], episode: number, shot?: number): CreativeVoiceTarget {
  const target = targets.find(t => t.episode === episode && t.shot === shot);
  if (!target) throw new Error(shot ? "该集分镜尚不存在，未执行定位或保存。" : "该集不存在，未执行操作。");
  return target;
}
export function validateReviewSeek(note: Pick<VoiceReviewNote, "source" | "atSec">, source: string | undefined, duration: number): number {
  if (!note.source || note.source !== source) throw new Error("请先选回这条备注对应的原影片，再定位时间点。");
  if (note.atSec === undefined || !Number.isFinite(duration) || note.atSec > duration) throw new Error("影片尚未载入或时间点超出时长。");
  return note.atSec;
}
