import { z } from "zod";
import type { PublicManhuaViralTemplateCard } from "./manhuaViralTemplateBank";
import { advisorRewriteCandidateSchema } from "./manhuaAdvisorRewrite";
export function templateFeatureChoices(card: PublicManhuaViralTemplateCard) {
  if (card.methodBrief?.highlights.length)
    return card.methodBrief.highlights.map((label, index) => ({
      id: `brief:${index}:${label}`,
      label,
    }));
  return (card.craft?.features || []).map(f => ({ id: f.id, label: f.label }));
}
export const optimizationEpisodeSchema = z
  .object({
    index: z.number().int().positive(),
    title: z.string().max(240),
    body: z.string().min(40).max(8000),
    endHook: z.string().max(2000).default(""),
  })
  .strict();
export const optimizationInputSchema = z
  .object({
    requestId: z.string().uuid(),
    projectId: z.string().uuid(),
    model: z.enum(["glm", "deepseek"]),
    mode: z.enum(["trial", "optimize"]),
    episodes: z.array(optimizationEpisodeSchema).min(1).max(60),
    templates: z
      .array(
        z
          .object({
            publicId: z.string().regex(/^mt_[a-z0-9]{4,16}$/i),
            features: z.array(z.string().max(400)).max(30),
          })
          .strict()
      )
      .min(1)
      .max(20),
    confirmedCredits: z.number().int().nonnegative().default(0),
    resume: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.episodes.map(e => e.index)).size !== v.episodes.length ||
      new Set(v.templates.map(t => t.publicId)).size !== v.templates.length
    )
      c.addIssue({ code: "custom", message: "集数或模板重复，请重新选择" });
    if (
      v.mode === "trial" &&
      (v.episodes.length !== 1 || v.templates.length !== 1)
    )
      c.addIssue({ code: "custom", message: "每个模板每次只试写一集" });
    if (v.mode === "optimize" && v.templates.some(t => !t.features.length))
      c.addIssue({ code: "custom", message: "请为每个模板勾选要注入的特色" });
  });
export type EpisodeOptimizationInput = z.infer<typeof optimizationInputSchema>;
export const optimizationResultSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  mode: z.enum(["trial", "optimize"]),
  model: z.enum(["glm", "deepseek"]),
  candidates: z.array(advisorRewriteCandidateSchema),
  creditsCost: z.number(),
  templates: z.array(z.object({ publicId: z.string(), nameZh: z.string() })),
});
export type EpisodeOptimizationResult = z.infer<
  typeof optimizationResultSchema
>;
