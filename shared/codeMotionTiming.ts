import { z } from "zod";
import {
  codeMotionCompositionSchema,
  type CodeMotionComposition,
} from "./codeMotionComposition";
import type {
  CodeMotionAudioClip,
  CodeMotionAudioSource,
} from "./codeMotionAudio";
const seconds = z.number().finite().min(0).max(360);
const token = z.string().regex(/^[A-Za-z0-9_-]{1,50}$/);
export const codeMotionTimingSchema = z
  .object({
    version: z.literal(1),
    sourceId: z.string().uuid(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    method: z.enum(["native-audio-estimate", "manual"]),
    review: z.enum(["needs-review", "confirmed"]),
    words: z
      .array(
        z
          .object({
            id: token,
            text: z.string().trim().min(1).max(60),
            startSec: seconds,
            endSec: seconds,
            confidence: z.number().min(0).max(1),
            action: z
              .enum(["pop", "rise", "slide", "spin", "fade"])
              .default("pop"),
          })
          .strict()
      )
      .max(360),
    beats: z
      .array(
        z
          .object({
            id: token,
            at: seconds,
            strength: z.number().min(0).max(1),
          })
          .strict()
      )
      .max(360),
    evidence: z
      .object({
        model: z.string().max(100),
        requestId: z.string().uuid(),
        rawUri: z.string().regex(/^gs:\/\/[^\s?#]+$/),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!v.words.length && !v.beats.length)
      fail("至少添加一个真实词语秒窗或拍点");
    if (
      new Set(v.words.map(w => w.id)).size !== v.words.length ||
      new Set(v.beats.map(b => b.id)).size !== v.beats.length
    )
      fail("词语或拍点编号重复");
    if (
      v.words.some(
        (w, i) =>
          w.endSec <= w.startSec ||
          (i > 0 && w.startSec < v.words[i - 1].endSec - 1e-6)
      )
    )
      fail("词语秒窗须递增、不重叠且结束晚于开始");
    if (v.beats.some((b, i) => i > 0 && b.at <= v.beats[i - 1].at))
      fail("拍点时间须严格递增");
  });
export type CodeMotionTiming = z.infer<typeof codeMotionTimingSchema>;
export function validateCodeMotionTimingSource(
  timing: CodeMotionTiming,
  sources: CodeMotionAudioSource[],
  clips: CodeMotionAudioClip[]
) {
  const source = sources.find(s => s.id === timing.sourceId);
  if (!source || source.sha256 !== timing.sourceSha256)
    throw new Error("词拍数据与当前原音身份不一致，请恢复对应原音");
  if (
    timing.words.some(w => w.endSec > source.duration + 1e-6) ||
    timing.beats.some(b => b.at >= source.duration)
  )
    throw new Error("词拍时间超出原音");
  if (!clips.some(c => c.sourceId === source.id && c.volume > 0))
    throw new Error("词拍原音尚未在成片选用");
}
/** Source seconds map through the actual trim/placement. No uniform word division or invented BPM. */
export function applyCodeMotionTiming(
  composition: CodeMotionComposition,
  timing: CodeMotionTiming,
  clips: CodeMotionAudioClip[]
): CodeMotionComposition {
  if (timing.review !== "confirmed")
    throw new Error("请先试听核对词语与拍点并确认，再预览或导出");
  const result = codeMotionCompositionSchema.parse(composition);
  let sceneAt = 0;
  result.scenes.forEach((scene, sceneIndex) => {
    const origin = sceneAt;
    sceneAt += scene.duration;
    clips
      .filter(c => c.sourceId === timing.sourceId && c.volume > 0)
      .forEach((clip, clipIndex) => {
        timing.words.forEach((word, wordIndex) => {
          const from = Math.max(word.startSec, clip.trimStart),
            to = Math.min(word.endSec, clip.trimStart + clip.duration);
          if (to <= from) return;
          const start = Math.max(0, clip.at + from - clip.trimStart - origin),
            end = Math.min(
              scene.duration,
              clip.at + to - clip.trimStart - origin
            );
          if (end <= start) return;
          const first = {
            at: start,
            opacity: 0,
            scale: word.action === "pop" ? 0.6 : 1,
            x: word.action === "slide" ? 0.2 : 0.5,
            y: word.action === "rise" ? 0.96 : 0.84,
            rotation: word.action === "spin" ? -20 : 0,
          };
          const landed = {
            at: start + Math.min(0.12, (end - start) / 3),
            opacity: 1,
            scale: 1,
            x: 0.5,
            y: 0.84,
            rotation: 0,
            ease: "easeOut",
          };
          scene.elements.push({
            id: `timing-word-${sceneIndex}-${clipIndex}-${wordIndex}`,
            type: "text",
            text: word.text,
            start,
            end,
            layer: 95,
            transform: { x: 0.5, y: 0.84, fill: "#ffffff" },
            keyframes: [
              first,
              landed,
              { at: end - Math.min(0.08, (end - start) / 4), opacity: 1 },
              { at: end, opacity: 0 },
            ],
            fontSize: 0.075,
            font: "sans",
            weight: "bold",
            align: "center",
            maxWidth: 0.9,
            lineHeight: 1.2,
            letterSpacing: 0,
            blend: "normal",
            continuity: "reset",
          } as any);
        });
        timing.beats.forEach((beat, beatIndex) => {
          if (
            beat.at < clip.trimStart ||
            beat.at >= clip.trimStart + clip.duration
          )
            return;
          const start = clip.at + beat.at - clip.trimStart - origin;
          if (start < 0 || start >= scene.duration) return;
          const end = Math.min(scene.duration, start + 0.18);
          scene.elements.push({
            id: `timing-beat-${sceneIndex}-${clipIndex}-${beatIndex}`,
            type: "shape",
            shape: "ellipse",
            start,
            end,
            layer: 90,
            transform: { x: 0.5, y: 0.5, stroke: "#ffffff", opacity: 0 },
            keyframes: [
              { at: start, opacity: beat.strength * 0.35, scale: 0.9 },
              { at: end, opacity: 0, scale: 1.3, ease: "easeOut" },
            ],
            width: 0.7,
            height: 0.7,
            radius: 0,
            strokeWidth: 0.004,
            filled: false,
            blend: "screen",
            continuity: "reset",
          } as any);
        });
      });
  });
  return codeMotionCompositionSchema.parse(result);
}
