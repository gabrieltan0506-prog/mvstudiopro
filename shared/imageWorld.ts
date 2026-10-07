import { z } from "zod";

export const imageWorldObjectSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_-]{1,60}$/)
      .refine(
        id => !["world", "__proto__", "constructor", "prototype"].includes(id),
        "物件编号使用了保留名称"
      ),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(800),
    position: z.string().max(120),
    selected: z.boolean().default(true),
  })
  .strict();
export const imageWorldPlanSchema = z
  .object({
    scene: z.string().trim().min(1).max(1600),
    ambience: z.string().max(800).default(""),
    objects: z.array(imageWorldObjectSchema).max(12),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.objects.map(o => o.id)).size !== v.objects.length)
      ctx.addIssue({ code: "custom", message: "每个独立物件须有不同编号" });
  });
export type ImageWorldPlan = z.infer<typeof imageWorldPlanSchema>;
export const imageWorldIntentSchema = z
  .object({
    kind: z.enum(["object", "world"]),
    assetRef: z.string().min(1),
    sourceUri: z.string().min(1).max(4096),
    name: z.string().max(120),
    plan: imageWorldPlanSchema,
    model: z.enum(["marble-1.1", "marble-1.0-draft"]),
  })
  .strict();
const receipt = z
  .object({
    taskId: z.string(),
    status: z.string(),
    sourceVersion: z.string(),
    inputKey: z.string().optional(),
    glbGcsUri: z.string().optional(),
  })
  .strict();
export const imageWorldStateSchema = z
  .object({
    version: z.literal(1),
    sourceBlockId: z.string().min(1),
    sourceUrl: z.string().min(1).max(4096),
    plan: imageWorldPlanSchema,
    analysisBlockId: z.string().optional(),
    plateBlockId: z.string().optional(),
    audioBlockId: z.string().optional(),
    objectBlockIds: z.record(z.string(), z.string()).default({}),
    generations: z
      .record(
        z.string(),
        z
          .object({
            status: z.enum(["submitting", "returned", "failed"]),
            jobIds: z.array(z.string()).max(4),
            expectedCount: z.number().int().min(1).max(4),
            variants: z
              .array(z.enum(["flare", "sunburst"]))
              .min(1)
              .max(2)
              .optional(),
            prompt: z.string(),
            sourceUrl: z.string(),
          })
          .strict()
      )
      .default({}),
    pending: z.record(z.string(), imageWorldIntentSchema).default({}),
    world: receipt.optional(),
    models: z.record(z.string(), receipt).default({}),
  })
  .strict();
export type ImageWorldState = z.infer<typeof imageWorldStateSchema>;
export const IMAGE_WORLD_ANALYSIS_PROMPT = `分析参考图的静态场景和可以拆出的独立物件，只记录图中可见的证据。不要把人物身体部件拆成物件，不合并相邻、重复或叠放的不同实例。仅输出JSON：{"scene":"原场景布局、材质、光照、氛围（不含待拆物件）","ambience":"适合此场景的环境声描述","objects":[{"id":"唯一英文小写编号","name":"名称","description":"颜色材质比例及独有特征","position":"在原图中的位置，区分相似实例","selected":true}]}。最多列12个值得独立制作的物件，无法确定的不要猜测。分析不代表用户已确认制作。`;
export function parseImageWorldAnalysis(text: string): ImageWorldPlan {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return imageWorldPlanSchema.parse(JSON.parse(cleaned));
}
export function imageWorldPlatePrompt(plan: ImageWorldPlan) {
  const confirmed = plan.objects.filter(o => o.selected);
  if (!confirmed.length) throw new Error("请至少确认一个要拆出的物件");
  return `从参考图移除以下已确认物件：${confirmed.map(o => `${o.name}（${o.position}；${o.description}）`).join("；")}。保持其余背景、视角、构图、材质和光照不变，仅补齐被移除物件遮住的背景，不新增主体。`;
}
export function imageWorldObjectPrompt(
  object: ImageWorldPlan["objects"][number]
) {
  return `从参考图提取一个独立物件：${object.name}。定位：${object.position}。外观：${object.description}。忠实保留原物件颜色、材质、形状与比例。纯白背景，物件完整居中，清晰展示体积。只包含这一个实例，去除相邻、叠放或放在它上面的其他物件，不复制成一组，不加入文字和人物。`;
}
export function imageWorldEmptyPrompt(plan: ImageWorldPlan) {
  const prompt = `${plan.scene}\n这是已清除指定物件的静态空场景。不要重新加入：${plan.objects
    .filter(o => o.selected)
    .map(o => `${o.name}（${o.position}）`)
    .join("、")}。保持底图的空间布局、光照、材质、氛围与视角。`;
  if (prompt.length > 2000)
    throw new Error("空间提示超过2000字，请精简场景与物件位置；未截断或提交");
  return prompt;
}
