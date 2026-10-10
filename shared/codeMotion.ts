import { z } from "zod";
import { artMotionSpecSchema, type ArtMotionSpec } from "./artMotion";

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
    style: z.enum(["words", "cards", "data"]),
    duration: z.number().int().min(15).max(60),
    orientation: z.enum(["landscape", "portrait"]),
    images: z.array(codeMotionImageSchema).max(8).default([]),
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
    if (v.style !== "cards" && v.images.length)
      ctx.addIssue({ code: "custom", message: "带图片的内容请选择图文介绍" });
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
    scenes: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(48),
            body: z.string().trim().max(100),
            duration: z.number().int().min(2).max(60),
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
  if (plan.scenes.reduce((sum, s) => sum + s.duration, 0) !== brief.duration)
    throw new Error("安排的总时长与本次选择不一致，请重新调整");
  if (
    plan.scenes.some(
      s => s.imageId && !brief.images.some(i => i.id === s.imageId)
    )
  )
    throw new Error("方案用了未选择的图片，原材料保留");
  if (brief.images.some(i => !plan.scenes.some(s => s.imageId === i.id)))
    throw new Error("方案遗漏了已选择的图片，请补齐或移除不用的图片");
  if (brief.style === "data" && plan.scenes.length !== 1)
    throw new Error("数据展示使用同一张图，请把说明合在一个画面中");
  return plan;
}
/** 只编译固定组件和有界数据；数值取自原材料，模型没有改写数值的入口。 */
export function compileCodeMotion(
  briefInput: unknown,
  planInput: unknown
): ArtMotionSpec {
  const brief = codeMotionBriefSchema.parse(briefInput);
  const plan = validateCodeMotionPlan(brief, planInput);
  let at = 0;
  const grammar =
    brief.style === "words"
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
  return artMotionSpecSchema.parse({
    version: 1,
    mode: "animation",
    grammar,
    duration: brief.duration,
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
        compileCodeMotion(v.brief, v.plan);
      } catch (e) {
        ctx.addIssue({
          code: "custom",
          message: e instanceof Error ? e.message : "方案无法使用",
        });
      }
    }
  });
export type CodeMotionProject = z.infer<typeof codeMotionProjectSchema>;
export function codeMotionSceneDescription(
  style: CodeMotionBrief["style"],
  withImage: boolean
) {
  return style === "words"
    ? "文字依次放大进入，色带切换到下一页"
    : style === "data"
      ? "按所选图表逐步展开，保留原始数值、单位和数据来源"
      : withImage
        ? "图片完整放入画面，标题随卡片进入"
        : "文字卡片依次进入，同组最多三张并排展示";
}
export const CODE_MOTION_COST_NOTE =
  "整理方案沿用创作顾问的当前额度与积分规则；预览和本次视频导出不扣积分。视频为无声图文动画。";

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
        scenes: z
          .array(
            codeMotionPlanSchema.shape.scenes.element.extend({
              heading: z.string().max(48),
              duration: z.number().finite().min(0).max(60),
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
