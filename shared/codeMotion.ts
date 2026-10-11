import { codeMotionTimingSchema, validateCodeMotionTimingSource, applyCodeMotionTiming } from "./codeMotionTiming";
import { z } from "zod";
import { CODE_MOTION_AUDIO_SOURCE_LIMIT, codeMotionEmotionSchema } from "./codeMotionMedia";
import { codeMotionVideoSchema, validateCodeMotionVideo } from "./codeMotionVideo";
import { artMotionSpecSchema, type ArtMotionSpec } from "./artMotion";
import {
  codeMotionAudioSourceSchema,
  codeMotionAudioClipSchema,
  codeMotionAudioClipDraftSchema,
  codeMotionAudioSchema,
  validateCodeMotionAudio,
} from "./codeMotionAudio";
import {
  codeMotionPlanSceneSchema,
  resolveCodeMotionCompositionImages,
} from "./codeMotionComposition";

const uuid = z.string().uuid();
export const codeMotionImageSchema = z
  .object({
    id: uuid,
    name: z.string().min(1).max(160),
    gcsUri: z
      .string()
      .regex(/^gs:\/\//)
      .max(2048),
  })
  .strict();
const codeMotionBriefObject = z
  .object({
    title: z.string().trim().min(1, "请给这条视频起个名字").max(60),
    request: z.string().trim().min(2, "说说你想做什么").max(2000),
    text: z.string().trim().max(4000).default(""),
    style: z.enum(["words", "cards", "data", "scenes"]),
    duration: z.number().finite().min(15).max(180),
    durationMode: z.enum(["natural", "fixed"]).optional(),
    generationTier: z.enum(["free", "paid"]).optional(),
    revisionSource: z.object({ projectId: uuid, generation: z.string().regex(/^\d+$/), instruction: z.string().trim().min(2).max(1200) }).strict().optional(),
    orientation: z.enum(["landscape", "portrait"]),
    images: z.array(codeMotionImageSchema).max(8).default([]),
    audios: z
      .array(codeMotionAudioSourceSchema)
      .max(CODE_MOTION_AUDIO_SOURCE_LIMIT)
      .optional(),
    data: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(30),
            value: z.number().finite().min(0).max(1e9).nullable(),
          })
          .strict()
      )
      .max(12)
      .default([]),
    unit: z.string().trim().max(12).default(""),
    chart: z.enum(["bar", "line"]).default("bar"),
    period: z.string().trim().max(60).default(""),
    source: z.string().trim().max(120).default(""),
  })
  .strict();
export const codeMotionBriefSchema = codeMotionBriefObject.superRefine(
  (v, ctx) => {
    if (v.style === "data" && (!v.unit || !v.period || !v.source))
      ctx.addIssue({
        code: "custom",
        message: "请补充数据的单位、时间范围和来源",
      });
    if (v.data.some(row => row.value === null))
      ctx.addIssue({
        code: "custom",
        message: "还有数据没有填写，缺失值不会按零处理",
      });
    if (
      v.data.some(
        row => row.value !== null && Number(row.value.toFixed(6)) !== row.value
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "数据最多保留六位小数，请确认原始精度后填写",
      });
    if (v.style === "data" && v.data.length < 2)
      ctx.addIssue({ code: "custom", message: "数据动画至少需要两项真实数据" });
    if (!["cards", "scenes"].includes(v.style) && v.images.length)
      ctx.addIssue({
        code: "custom",
        message: "带图片的内容请选择图文介绍或逐镜创作",
      });
    if (v.style !== "data" && v.data.length)
      ctx.addIssue({
        code: "custom",
        message: "请把数据用于数据展示，或先清空数据",
      });
    if (new Set(v.images.map(x => x.id)).size !== v.images.length)
      ctx.addIssue({ code: "custom", message: "图片重复，请重新选择" });
  }
);
export type CodeMotionBrief = z.infer<typeof codeMotionBriefSchema>;
export const codeMotionPlanSchema = z
  .object({
    version: z.literal(1),
    summary: z.string().trim().min(1).max(400),
    audioTimeline: z.array(codeMotionAudioClipSchema).max(24).optional(),
    codeVideo: codeMotionVideoSchema.optional(),
    timing: codeMotionTimingSchema.optional(),
    scenes: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(48),
            body: z.string().trim().max(100),
            speech: z
              .object({
                text: z.string().trim().max(180),
                voice: z.enum(["female", "male"]),
                role: z.enum(["narration", "dialogue"]).optional(),
                emotion: codeMotionEmotionSchema.optional(),
              })
              .strict()
              .optional(),
            duration: z.number().finite().min(0.5).max(180),
            production: z.object({
              imagePrompt: z.string().trim().min(2).max(2000),
              motion: z.enum(["code", "natural"]),
              videoPrompt: z.string().trim().max(2000),
              referenceVideoIds: z.array(z.string().min(1).max(100)).max(10).optional(),
            }).strict().optional(),
            composition: codeMotionPlanSceneSchema.optional(),
            direction: z.string().trim().max(400).optional(),
            imageId: uuid.optional(),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();
export type CodeMotionPlan = z.infer<typeof codeMotionPlanSchema>;
export function validateCodeMotionPlan(
  brief: CodeMotionBrief,
  raw: unknown
): CodeMotionPlan {
  const plan = codeMotionPlanSchema.parse(raw);
  const totalDuration = plan.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const renderDuration = brief.durationMode === "natural" ? totalDuration : brief.duration;
  if (renderDuration < 15 || renderDuration > 180)
    throw new Error("安排的总时长须在15至180秒范围内");
  if (plan.timing) {
    if (brief.style !== "scenes") throw new Error("词拍动作需要逐镜创作模式");
    validateCodeMotionTimingSource(plan.timing, brief.audios || [], plan.audioTimeline || []);
  }
  if (plan.codeVideo) {
    const errors = validateCodeMotionVideo(plan.codeVideo, renderDuration, 30);
    if (errors.length) throw new Error(errors.join("；"));
  }
  if (brief.durationMode !== "natural" && Math.abs(totalDuration - brief.duration) > 0.000001)
    throw new Error("安排的总时长与本次选择不一致，请重新调整");
  if (
    plan.scenes.some(
      s => s.imageId && !brief.images.some(i => i.id === s.imageId)
    )
  )
    throw new Error("方案用了未选择的图片，原材料保留");
  if (
    brief.images.some(
      i =>
        !plan.scenes.some(s =>
          brief.style === "scenes"
            ? s.composition?.elements.some(
                e => e.type === "image" && e.imageId === i.id
              )
            : s.imageId === i.id
        )
    )
  )
    throw new Error("方案遗漏了已选择的图片，请补齐或移除不用的图片");
  if (brief.style === "data" && plan.scenes.length !== 1)
    throw new Error("数据展示使用同一张图，请把说明合在一个画面中");
  if (brief.style === "scenes") {
    if (plan.scenes.some(scene => !scene.composition))
      throw new Error("逐镜创作缺少实际画面编排，请补齐后再预览");
    if (
      plan.scenes.some(
        scene => Math.abs(scene.composition!.duration - scene.duration) > 1e-6
      )
    )
      throw new Error("镜头编排时长与画面安排不一致");
    resolveCodeMotionCompositionImages(
      plan.scenes.map(scene => scene.composition!),
      brief.images
    );
  } else if (plan.scenes.some(scene => scene.composition))
    throw new Error("请切换逐镜创作后使用元素编排，避免内容被忽略");
  if (brief.audios?.length || plan.audioTimeline?.length) {
    const audio = codeMotionAudioSchema.parse({
      sources: brief.audios || [],
      audioTimeline: plan.audioTimeline || [],
    });
    const errors = validateCodeMotionAudio(audio, renderDuration);
    if (errors.length) throw new Error(errors.join("；"));
  }
  return plan;
}
/** 编译受控场景与素材身份；只接收数据，不执行模型提供的代码。 */
export function compileCodeMotion(
  briefInput: unknown,
  planInput: unknown,
  options: { allowPendingSpeech?: boolean; allowPendingProduction?: boolean } = {}
): ArtMotionSpec {
  const brief = codeMotionBriefSchema.parse(briefInput);
  const plan = validateCodeMotionPlan(brief, planInput);
  let at = 0;
  if (!options.allowPendingProduction) {
    let sceneAt = 0;
    for (const scene of plan.scenes) {
      if ((scene.production?.motion === "natural" || (scene.speech?.role === "dialogue" && scene.speech.text.trim())) && !plan.codeVideo?.clips.some(clip => Math.abs(clip.at - sceneAt) < 1e-6 && Math.abs(clip.duration - scene.duration) < 1e-6))
        throw new Error("动态镜头尚未完成制作，请先恢复制作并采用生成片段");
      sceneAt += scene.duration;
    }
  }
  if (!options.allowPendingSpeech) {
    let at = 0;
    for (let index = 0; index < plan.scenes.length; index++) {
      const scene = plan.scenes[index];
      if (scene.speech?.text.trim()) {
        const source = brief.audios?.find(
          audio =>
            audio.generated?.kind === "speech" &&
            audio.generated.sceneIndex === index &&
            audio.generated.text === scene.speech!.text.trim() &&
            audio.generated.voice === scene.speech!.voice &&
            (audio.generated.emotion || "") === (scene.speech!.emotion || "") &&
            (audio.generated.role || "narration") === (scene.speech!.role || "narration")
        );
        const clip =
          source &&
          plan.audioTimeline?.find(
            clip =>
              clip.sourceId === source.id &&
              clip.role === (scene.speech!.role || "narration") &&
              Math.abs(clip.at - at) < 1e-6 &&
              clip.trimStart === 0 &&
              Math.abs(clip.duration - source.duration) < 1e-6 &&
              clip.volume > 0
          );
        if (!clip || clip.duration > scene.duration + 1e-6)
          throw new Error(
            `第${index + 1}镜配音尚未生成并完整选用，或台词/音色/情绪/时长已修改；请在声音区处理后再预览或导出`
          );
      }
      at += scene.duration;
    }
  }
  let composition =
    brief.style === "scenes"
      ? resolveCodeMotionCompositionImages(
          plan.scenes.map(scene => scene.composition!),
          brief.images
        )
      : undefined;
  if (plan.timing && composition) {
    if (plan.timing.review === "confirmed") composition = applyCodeMotionTiming(composition, plan.timing, plan.audioTimeline || []);
    else if (!options.allowPendingSpeech && !options.allowPendingProduction) throw new Error("请先核对词拍时间并确认，再预览或导出");
  }
  const grammar =
    brief.style === "words" || brief.style === "scenes"
      ? "y5_kinetic_type"
      : brief.style === "cards"
        ? "t2_keynote_ui"
        : "t3_finance_chart";
  const cues: ArtMotionSpec["cues"] =
    brief.style === "data"
      ? [
          {
            at: 0,
            kind: "title",
            text: plan.scenes[0].heading,
            sub: plan.scenes[0].body,
          },
          { at: 1, kind: brief.chart },
        ]
      : plan.scenes.map((scene, index) => {
          const cue: ArtMotionSpec["cues"][number] = {
            at,
            kind:
              brief.style === "words"
                ? index
                  ? "point"
                  : "title"
                : scene.imageId
                  ? "image"
                  : "card",
            text: scene.heading,
            sub: scene.body,
            dur: scene.duration,
          };
          if (scene.imageId)
            cue.imageUri = brief.images.find(
              image => image.id === scene.imageId
            )!.gcsUri;
          at += scene.duration;
          return cue;
        });
  if (composition) {
    cues.length = 0;
    for (const image of brief.images)
      cues.push({ at: 0, kind: "image", imageUri: image.gcsUri });
  }
  return artMotionSpecSchema.parse({
    version: 1,
    mode: "animation",
    grammar,
    duration: brief.durationMode === "natural"
      ? plan.scenes.reduce((sum, scene) => sum + scene.duration, 0)
      : brief.duration,
    width: brief.orientation === "portrait" ? 720 : 1280,
    height: brief.orientation === "portrait" ? 1280 : 720,
    fps: 30,
    alpha: false,
    title: brief.title,
    cues,
    data:
      brief.style === "data"
        ? {
            title: plan.scenes[0].heading,
            unit: [plan.scenes[0].body, brief.period, brief.unit]
              .filter(Boolean)
              .join(" · "),
            source: brief.source,
            chart: brief.chart,
            suffix: brief.unit,
            decimals: Math.max(
              ...brief.data.map(row => {
                const value = row.value!;
                for (let n = 0; n <= 6; n++)
                  if (Number(value.toFixed(n)) === value) return n;
                return 6;
              })
            ),
            series: brief.data,
          }
        : {},
    scenes: [],
    ...(composition ? { composition } : {}),
    ...(plan.codeVideo ? { codeVideo: plan.codeVideo } : {}),
    ...(brief.audios?.length
      ? {
          codeAudio: {
            sources: brief.audios,
            audioTimeline: plan.audioTimeline,
          },
        }
      : {}),
  });
}
export const codeMotionProjectSchema = z
  .object({
    id: uuid,
    brief: codeMotionBriefSchema,
    plan: codeMotionPlanSchema.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.plan) {
      try {
        compileCodeMotion(v.brief, v.plan, { allowPendingSpeech: true, allowPendingProduction: true });
      } catch (e) {
        ctx.addIssue({
          code: "custom",
          message: e instanceof Error ? e.message : "方案无法使用",
        });
      }
    }
  })
  .transform(project => project.plan && project.brief.durationMode === "natural"
    ? { ...project, brief: { ...project.brief, duration: project.plan.scenes.reduce((sum, scene) => sum + scene.duration, 0) } }
    : project);
export type CodeMotionProject = z.infer<typeof codeMotionProjectSchema>;
export function codeMotionSceneDescription(
  style: CodeMotionBrief["style"],
  withImage: boolean
) {
  return style === "scenes"
    ? "按逐镜编排播放文字、图形、图片、粒子与空间镜头，所有动作沿同一时间轴"
    : style === "words"
      ? "文字依次放大进入，色带切换到下一页"
      : style === "data"
        ? "按所选图表逐步展开，保留原始数值、单位和数据来源"
        : withImage
          ? "图片完整放入画面，标题随卡片进入"
          : "文字卡片依次进入，同组最多三张并排展示";
}
export const CODE_MOTION_COST_NOTE =
  "整理方案沿用创作顾问的当前额度与积分规则；上传原音按确认的秒窗混入视频。逐句配音先生成、试听选用，再与配乐一起进入预览及导出；导出不另行合成。提交前核对画面、原音及时间轴。";

/** 未完成输入仅作本机草稿，提交仍使用上面的完整检查。 */
export const codeMotionLocalProjectSchema = z
  .object({
    id: uuid,
    brief: codeMotionBriefObject.extend({
      title: z.string().max(60),
      request: z.string().max(2000),
      data: z
        .array(
          z
            .object({
              label: z.string().max(30),
              value: z.number().finite().min(0).max(1e9).nullable(),
            })
            .strict()
        )
        .max(12),
    }),
    plan: codeMotionPlanSchema
      .extend({
        audioTimeline: z
          .array(codeMotionAudioClipDraftSchema)
          .max(24)
          .optional(),
        scenes: z
          .array(
            codeMotionPlanSchema.shape.scenes.element.extend({
              heading: z.string().max(48),
              duration: z.number().finite().min(0).max(180),
            })
          )
          .min(1)
          .max(12),
      })
      .nullable(),
  })
  .strict();

/** 接受表格复制的两列文字；空单元格保留为空，不把缺失当零。 */
export function parseCodeMotionTable(text: string): CodeMotionBrief["data"] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!text.trim()) throw new Error("请先粘贴项目名称和数值两列");
  if (lines.length > 13)
    throw new Error("一次最多十二项数据，请先挑选本条视频需要的内容");
  const rows = lines
    .map((line, index) => {
      const columns = line.split(line.includes("\t") ? "\t" : /[,，]/);
      if (columns.length !== 2)
        throw new Error(
          `第 ${index + 1} 行不是两列，请从表格复制名称和数值两列`
        );
      const label = columns[0].trim(),
        cell = columns[1].trim();
      if (
        index === 0 &&
        /^(项目|名称|时间|日期|label)$/i.test(label) &&
        /^(数值|值|value)$/i.test(cell)
      )
        return null;
      if (!label || label.length > 30)
        throw new Error(`第 ${index + 1} 行名称为空或超过三十字`);
      if (cell && !/^\d+(?:\.\d{1,6})?$/.test(cell))
        throw new Error(
          `第 ${index + 1} 行请填写零及以上的数值，最多六位小数，不含单位或千位分隔符`
        );
      const value = cell ? Number(cell) : null;
      if (value !== null && value > 1e9)
        throw new Error(`第 ${index + 1} 行数值过大，请先统一换算单位`);
      return { label, value };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (!rows.length || rows.length > 12) throw new Error("请保留一到十二项数据");
  return rows;
}
