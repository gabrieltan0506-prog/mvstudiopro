import { z } from "zod";
import { manhuaPrevisAudioSchema } from "./manhuaPrevisAudio";
import { inkSpeechSchema } from "./inkSpeech";
import {
  codeMotionAudioSchema,
  validateCodeMotionAudio,
} from "./codeMotionAudio";
import { codeMotionCompositionSchema } from "./codeMotionComposition";
import { ART_MOTION_GRAMMARS, ART_MOTION_STYLES } from "./artMotionCatalog";

const id = z.string().min(1).max(80);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// Only bounded JSON values, never executable code, remote fonts, or user supplied file paths.
const scalar = z.union([
  z.string().max(500),
  z.number().finite().min(-1e12).max(1e12),
  z.boolean(),
  z.null(),
]);
const datum = z.union([
  scalar,
  z.array(scalar).max(120),
  z.record(z.string().max(80), scalar),
  z.array(z.record(z.string().max(80), scalar)).max(120),
]);
export const artMotionCueSchema = z
  .object({
    at: z.number().finite().min(0).max(180),
    kind: z.enum([
      "title",
      "point",
      "number",
      "highlight",
      "image",
      "card",
      "draw",
      "enter",
      "equation",
      "line",
      "insert",
      "react",
      "bar",
      "candle",
      "step",
    ]),
    text: z.string().max(240).optional(),
    sub: z.string().max(400).optional(),
    dur: z.number().finite().positive().max(180).optional(),
    imageUri: z
      .string()
      .regex(/^gs:\/\//)
      .max(2048)
      .optional(),
    data: z
      .record(z.string().max(80), datum)
      .refine(v => Object.keys(v).length <= 30)
      .optional(),
  })
  .strict();
export const artMotionSpecSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["animation", "art"]),
    grammar: id.refine(v => ART_MOTION_GRAMMARS.some(x => x.id === v)),
    duration: z.number().finite().min(1).max(180),
    width: z.union([
      z.literal(720),
      z.literal(1280),
      z.literal(1080),
      z.literal(1920),
    ]),
    height: z.union([
      z.literal(720),
      z.literal(1280),
      z.literal(1080),
      z.literal(1920),
    ]),
    fps: z.union([z.literal(24), z.literal(30)]).default(30),
    alpha: z.boolean().default(false),
    background: color.default("#f5f1e8"),
    title: z.string().max(120).default(""),
    cues: z.array(artMotionCueSchema).max(60).default([]),
    data: z
      .record(z.string().max(80), datum)
      .refine(v => Object.keys(v).length <= 30)
      .default({}),
    scenes: z
      .array(
        z
          .object({
            style: id.refine(v => ART_MOTION_STYLES.some(x => x.id === v)),
            duration: z.number().finite().min(0.5).max(180),
            transition: z
              .enum(["none", "fade", "swirl", "inkBloom", "pixelate", "shards"])
              .default("fade"),
          })
          .strict()
      )
      .max(35)
      .default([]),
    stageAnimation: z
      .object({
        previsJobId: z.string().regex(/^prv_[a-f0-9]{48}$/),
        scopeId: z.string().uuid(),
        clipId: z.string().min(1).max(160),
        worldTaskId: z.string().min(1).max(200),
        sceneRef: z.string().min(1).max(200),
        worldSourceVersion: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    audioTimeline: manhuaPrevisAudioSchema.optional(),
    inkSpeech: inkSpeechSchema.optional(),
    codeAudio: codeMotionAudioSchema.optional(),
    composition: codeMotionCompositionSchema.optional(),
    audioUri: z
      .string()
      .regex(/^gs:\/\//)
      .max(2048)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (v.codeAudio) {
      if (
        v.stageAnimation ||
        v.audioUri ||
        v.audioTimeline ||
        v.mode !== "animation"
      )
        fail("映客音轨不能与其他制作路线混用");
      for (const message of validateCodeMotionAudio(v.codeAudio, v.duration))
        fail(message);
    }
    if (v.composition) {
      if (
        v.mode !== "animation" ||
        v.stageAnimation ||
        v.scenes.length ||
        Object.keys(v.data).length
      )
        fail("逐镜编排不能混用旧艺术或场景路线");
      if (
        Math.abs(
          v.composition.scenes.reduce((n, s) => n + s.duration, 0) - v.duration
        ) > 1e-6
      )
        fail("逐镜编排总时长与视频不一致");
      const registered = new Set(v.cues.map(c => c.imageUri).filter(Boolean));
      if (
        v.composition.scenes.some(s =>
          s.elements.some(
            e => e.type === "image" && !registered.has(e.imageUri)
          )
        )
      )
        fail("编排图片必须登记到素材入口");
    }
    if (
      v.inkSpeech &&
      (v.audioUri ||
        v.audioTimeline ||
        v.stageAnimation ||
        v.duration > 60 ||
        v.inkSpeech.lines.some(line => line.at + line.duration > v.duration))
    )
      fail("映客对白不可与其他音轨混用或超出片长");
    if (
      ![
        [720, 1280],
        [1280, 720],
        [1080, 1920],
        [1920, 1080],
      ].some(([w, h]) => w === v.width && h === v.height)
    )
      fail("请选择横屏或竖屏画幅");
    if (JSON.stringify(v).length > 100_000)
      fail("动画配置过大，请减少文本和数据");
    if (
      v.cues.some(
        c =>
          c.at >= v.duration ||
          (c.dur !== undefined && c.at + c.dur > v.duration)
      )
    )
      fail("动画事件超出片长");
    if (
      v.mode === "art" &&
      (!v.scenes.length ||
        Math.abs(v.scenes.reduce((s, c) => s + c.duration, 0) - v.duration) >
          0.001)
    )
      fail("艺术段落总时长必须等于片长");
    if (v.mode === "art" && v.alpha)
      fail("艺术场景使用完整背景，透明输出仅用于解说动画");
    if (
      v.audioTimeline &&
      (!v.stageAnimation ||
        v.audioUri ||
        v.audioTimeline.durationSec !== v.duration ||
        v.audioTimeline.dialogueCount !== 0)
    )
      fail(
        "场景动画配乐须与本段时长一致，不含对白，且不能与旧单条音轨同时使用"
      );
    if (
      v.stageAnimation &&
      (v.mode !== "animation" ||
        v.alpha ||
        v.fps !== 24 ||
        v.duration > 30 ||
        v.cues.length ||
        Object.keys(v.data).length ||
        v.scenes.length)
    )
      fail(
        "3D场景动画只消费原白模动作：常速24帧、最多30秒，不叠加解说动画数据"
      );
    if (
      v.mode === "animation" &&
      !v.stageAnimation &&
      !v.composition &&
      !v.cues.length &&
      !Object.keys(v.data).length
    )
      fail("请填写动画内容");
    if (v.mode === "animation" && !v.composition) {
      const allowed = ART_MOTION_CUE_KINDS[v.grammar] || [];
      if (v.cues.some(c => !allowed.includes(c.kind)))
        fail("当前样式不支持所选段落类型，请重新选择");
      if (v.cues.some(c => c.kind === "image" && !c.imageUri))
        fail("图片段落必须选择素材");
      if (v.grammar === "t3_finance_chart") {
        const series = v.data.series;
        const chart =
          v.cues.find(c => ["bar", "line", "candle"].includes(c.kind))?.kind ||
          v.data.chart ||
          "bar";
        if (
          !Array.isArray(series) ||
          !series.length ||
          series.some(
            r =>
              !r ||
              typeof r !== "object" ||
              Array.isArray(r) ||
              typeof r.label !== "string" ||
              (chart === "candle"
                ? [r.o, r.h, r.l, r.c].some(
                    n => typeof n !== "number" || !Number.isFinite(n)
                  )
                : typeof r.value !== "number" || !Number.isFinite(r.value))
          )
        )
          fail("请填写完整且有效的图表数据");
      }
      if (
        v.cues.some(
          c =>
            c.kind === "line" &&
            v.grammar === "t1_3b1b" &&
            (!Array.isArray(c.data?.values) ||
              c.data.values.length < 2 ||
              c.data.values.some(x => typeof x !== "number"))
        )
      )
        fail("曲线至少需要两个有效数值");
    }
    // Image inputs must go through ownership resolution, not hidden inside arbitrary style data.
    const walk = (x: unknown): boolean => {
      if (typeof x === "string")
        return /(?:https?:|data:|file:|javascript:|gs:)\/\//i.test(x);
      if (Array.isArray(x)) return x.some(walk);
      return (
        !!x &&
        typeof x === "object" &&
        Object.entries(x).some(
          ([k, v]) =>
            [
              "__proto__",
              "prototype",
              "constructor",
              "image",
              "url",
              "src",
            ].includes(k) || walk(v)
        )
      );
    };
    if (walk(v.data) || v.cues.some(c => walk(c.data)))
      fail("图片请从素材栏选择，不在动画数据中填写链接");
  });
export type ArtMotionSpec = z.infer<typeof artMotionSpecSchema>;
export const artMotionJobSchema = z
  .object({
    action: z.literal("art_motion"),
    scopeKey: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    params: artMotionSpecSchema,
  })
  .strict();
export type ArtMotionJob = z.infer<typeof artMotionJobSchema>;
export const artMotionRequestSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().optional(),
    spec: artMotionSpecSchema,
    status: z.enum([
      "submitting",
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ]),
    gcsUri: z
      .string()
      .regex(/^gs:\/\//)
      .optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();
export const artMotionStateSchema = z
  .object({
    version: z.literal(1),
    spec: artMotionSpecSchema,
    request: artMotionRequestSchema.optional(),
    media: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().max(500),
            kind: z.enum(["image", "audio"]),
            gcsUri: z.string().regex(/^gs:\/\//),
          })
          .strict()
      )
      .optional(),
    history: z.array(artMotionRequestSchema).default([]),
  })
  .strict();
export type ArtMotionState = z.infer<typeof artMotionStateSchema>;
export const ART_MOTION_CUE_KINDS: Record<
  string,
  ArtMotionSpec["cues"][number]["kind"][]
> = {
  y5_kinetic_type: ["title", "point", "number", "highlight"],
  y4_storytime: ["title", "point", "highlight", "react", "insert"],
  y2_vox: ["title", "point", "image", "highlight"],
  y3_whiteboard: ["title", "point", "draw", "image", "highlight"],
  y1_kurzgesagt: ["title", "point", "highlight", "enter"],
  t1_3b1b: ["title", "point", "equation", "line", "highlight"],
  t2_keynote_ui: ["title", "card", "step", "image", "highlight", "number"],
  t3_finance_chart: ["title", "bar", "line", "candle", "highlight", "number"],
};
export function artMotionGrammarDraft(
  spec: ArtMotionSpec,
  grammar: string
): ArtMotionSpec {
  const kinds = ART_MOTION_CUE_KINDS[grammar] || [];
  const cues = spec.cues.map(c =>
    kinds.includes(c.kind)
      ? c
      : {
          ...c,
          kind: (grammar === "t3_finance_chart"
            ? "bar"
            : grammar === "t2_keynote_ui"
              ? "card"
              : "point") as ArtMotionSpec["cues"][number]["kind"],
          imageUri: undefined,
        }
  );
  const data: ArtMotionSpec["data"] =
    grammar === "t3_finance_chart"
      ? {
          title: spec.title,
          chart: "bar",
          series: [
            { label: "第一项", value: 10 },
            { label: "第二项", value: 20 },
          ],
        }
      : {};
  return { ...spec, grammar, cues, data };
}
export function defaultArtMotionSpec(): ArtMotionSpec {
  return artMotionSpecSchema.parse({
    version: 1,
    mode: "animation",
    grammar: "y5_kinetic_type",
    duration: 8,
    width: 1280,
    height: 720,
    cues: [
      { at: 0, kind: "title", text: "我的故事", sub: "从这里开始" },
      { at: 4, kind: "point", text: "下一幕", sub: "写下你的内容" },
    ],
  });
}

export function normalizeArtMotionJobStatus(
  status: string
): NonNullable<ArtMotionState["request"]>["status"] {
  const canonical = status === "canceled" ? "cancelled" : status;
  return artMotionRequestSchema.shape.status.parse(canonical);
}
