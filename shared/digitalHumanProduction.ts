import { z } from "zod";

const uri = z.string().min(1).max(5000);
const time = z.number().finite().min(0).max(1800);
export const digitalHumanSplitParamsSchema = z.object({
  audioUri: uri, audioRequestId: z.string().uuid(), script: z.string().min(1).max(4000),
}).strict();
export const digitalHumanFrameParamsSchema = z.object({ videoUri: uri, atSec: time }).strict();
export const digitalHumanMixTrackSchema = z.object({
  source: uri, name: z.string().max(200), startSec: time, sourceStartSec: time,
  durationSec: z.number().finite().positive().max(1800),
  volume: z.number().finite().min(0).max(1),
  fadeInSec: z.number().finite().min(0).max(30), fadeOutSec: z.number().finite().min(0).max(30),
  duck: z.boolean(),
}).strict().refine(v => v.fadeInSec + v.fadeOutSec <= v.durationSec, "淡入淡出超过素材选段");
export const digitalHumanVoiceSpaceSchema = z.object({
  pan: z.number().finite().min(-1).max(1), room: z.enum(["dry", "small", "cafe"]),
  volume: z.number().finite().min(0).max(2),
}).strict();
export const digitalHumanFinalParamsSchema = z.object({
  audioUri: uri, audioRequestId: z.string().uuid(),
  clips: z.array(z.object({ videoUri: uri, startSec: time, endSec: time }).strict()).min(1).max(60),
  voice: digitalHumanVoiceSpaceSchema,
  tracks: z.array(digitalHumanMixTrackSchema).max(12),
  aspectRatio: z.enum(["9:16", "16:9"]),
}).strict().superRefine((v, ctx) => {
  let end = 0;
  v.clips.forEach((clip, i) => {
    if (Math.abs(clip.startSec - end) > 1 / 48000 || clip.endSec <= clip.startSec || clip.endSec - clip.startSec > 30.001)
      ctx.addIssue({ code: "custom", path: ["clips", i], message: "分段须从零开始连续覆盖，单段不超过30秒" });
    end = clip.endSec;
  });
  v.tracks.forEach((track, i) => {
    if (track.startSec + track.durationSec > end + 1 / 48000)
      ctx.addIssue({ code: "custom", path: ["tracks", i], message: "音轨选段超出成片时长" });
  });
});
const metadata = { scopeKey: z.string().max(128).optional() };
export const digitalHumanSplitJobSchema = z.object({ ...metadata, action: z.literal("digital_human_audio_split"), params: digitalHumanSplitParamsSchema }).strict();
export const digitalHumanFrameJobSchema = z.object({ ...metadata, action: z.literal("digital_human_continuity_frame"), params: digitalHumanFrameParamsSchema }).strict();
export const digitalHumanFinalJobSchema = z.object({ ...metadata, action: z.literal("digital_human_final"), params: digitalHumanFinalParamsSchema }).strict();
export const digitalHumanProductionInputSchema = z.discriminatedUnion("action", [digitalHumanSplitJobSchema, digitalHumanFrameJobSchema, digitalHumanFinalJobSchema]);
export const digitalHumanProductionRequestSchema = z.object({ requestId: z.string().uuid(), input: digitalHumanProductionInputSchema }).strict();
export const digitalHumanSplitManifestSchema = z.object({
  version: z.literal(1), audioUri: uri, audioRequestId: z.string().uuid(), script: z.string().min(1).max(4000),
  durationSec: z.number().positive().max(1800),
  segments: z.array(z.object({ index: z.number().int().min(0), startSec: time, endSec: time, audioUri: uri }).strict()).min(1).max(60),
}).strict().superRefine((v, ctx) => {
  let end = 0;
  v.segments.forEach((s, i) => {
    if (s.index !== i || Math.abs(s.startSec - end) > 1 / 48000 || s.endSec <= s.startSec || s.endSec - s.startSec > 30.001)
      ctx.addIssue({ code: "custom", path: ["segments", i], message: "音频分段清单不连续" });
    end = s.endSec;
  });
  if (Math.abs(end - v.durationSec) > 1 / 48000) ctx.addIssue({ code: "custom", message: "音频尾部未完整保留" });
});
export type DigitalHumanProductionInput = z.infer<typeof digitalHumanProductionInputSchema>;
export type DigitalHumanProductionRequest = z.infer<typeof digitalHumanProductionRequestSchema>;
export type DigitalHumanSplitManifest = z.infer<typeof digitalHumanSplitManifestSchema>;
export type DigitalHumanFinalParams = z.infer<typeof digitalHumanFinalParamsSchema>;
export const digitalHumanProductionReceiptSchema = z.object({
  request: digitalHumanProductionRequestSchema,
  fingerprint: z.string(), status: z.enum(["submitted", "running", "succeeded", "failed", "unknown"]),
  jobId: z.string().optional(), message: z.string().optional(),
  manifest: digitalHumanSplitManifestSchema.optional(), source: uri.optional(),
}).strict();
export type DigitalHumanProductionReceipt = z.infer<typeof digitalHumanProductionReceiptSchema>;

/** 只在真实静音区间中寻找切点；回溯避免最后一段不足四秒。 */
export function planDigitalHumanAudioSegments(durationSec: number, silences: Array<{ start: number; end: number }>): Array<{ startSec: number; endSec: number }> {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 1800) throw new Error("配音时长须大于零且不超过30分钟");
  if (durationSec <= 30) return [{ startSec: 0, endSec: durationSec }];
  const points = Array.from(new Set(silences.flatMap(s => {
    const start = Math.max(0, s.start), end = Math.min(durationSec, s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.12) return [];
    // 长静音可以有多个候选；候选均距静音边缘至少60ms。
    const p = [(start + end) / 2];
    for (let t = start + 0.06; t <= end - 0.06; t += 1) p.push(t);
    return p.map(t => Math.round(t * 48000) / 48000);
  }))).filter(t => t >= 4 && t <= durationSec - 4).sort((a, b) => a - b);
  const failed = new Set<number>();
  function search(start: number, depth: number): number[] | undefined {
    if (durationSec - start >= 4 && durationSec - start <= 30) return [durationSec];
    if (depth >= 59 || failed.has(start)) return;
    const candidates = points.filter(t => t - start >= 4 && t - start <= 30).reverse();
    for (const end of candidates) { const tail = search(end, depth + 1); if (tail) return [end, ...tail]; }
    failed.add(start);
  }
  const cuts = search(0, 0);
  if (!cuts) throw new Error("未找到能完整覆盖配音的安全停顿切点；请调整朗读停顿后试听，未截断原声");
  let startSec = 0;
  return cuts.map(endSec => { const row = { startSec, endSec }; startSec = endSec; return row; });
}
