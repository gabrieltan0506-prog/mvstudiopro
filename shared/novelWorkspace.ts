import { z } from "zod";
import { novelExcerptSchema } from "./manhuaNovelSource";

export const NOVEL_FACETS = [
  "场景",
  "人物",
  "妆容",
  "灯光",
  "氛围",
  "对白",
] as const;
const text = z.string().trim().min(1);
export const novelTemplateChoiceSchema = z
  .object({ publicId: text.max(40), role: text.max(160) })
  .strict();
export const novelTestInputSchema = z
  .object({
    requestId: z.string().uuid(),
    roundId: z.string().uuid(),
    stage: z.enum(["advice", "outline", "chapter", "script"]),
    topic: text.max(200),
    direction: text.max(2000),
    source: novelExcerptSchema.optional(),
    templates: z.array(novelTemplateChoiceSchema).max(5),
    episodeCount: z.union([z.literal(2), z.literal(3)]),
    outline: z.string().max(14000).default(""),
    novel: z.string().max(20000).default(""),
    chapterIndex: z.number().int().min(1).max(3).default(1),
    selectedTemplateIds: z.array(z.string().max(40)).max(5).default([]),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.templates.map(t => t.publicId)).size !== v.templates.length)
      c.addIssue({ code: "custom", message: "模板不可重复" });
    if (v.stage !== "advice" && !v.templates.length)
      c.addIssue({ code: "custom", message: "请选择模板" });
    if (
      v.stage === "chapter" &&
      (!v.outline.trim() || v.chapterIndex > v.episodeCount)
    )
      c.addIssue({ code: "custom", message: "请先确认大纲与章节" });
    if (v.stage === "script" && v.novel.trim().length < 500)
      c.addIssue({ code: "custom", message: "请先确认小说正文" });
  });
export type NovelTestInput = z.infer<typeof novelTestInputSchema>;
export const novelAdviceSchema = z
  .object({
    assessment: text.max(3000),
    recommendations: z
      .array(
        z
          .object({
            publicId: text.max(40),
            reason: text.max(800),
            tradeoff: text.max(800),
          })
          .strict()
      )
      .max(5),
  })
  .strict();
export const novelOutlineSchema = z
  .object({
    premise: text.max(3000),
    characters: text.max(3000),
    episodes: z
      .array(
        z
          .object({
            index: z.number().int().min(1).max(3),
            title: text.max(120),
            events: text.max(1500),
            hook: text.max(500),
            payoff: text.max(500),
          })
          .strict()
      )
      .min(2)
      .max(3),
  })
  .strict();
export const novelChapterSchema = z
  .object({
    title: text.max(120),
    text: text.min(500).max(6500),
    notes: text.max(2000),
  })
  .strict();
const scene = z
  .object({
    key: text.max(30),
    场景: text.max(1800),
    人物: text.max(1800),
    妆容: text.max(1800),
    灯光: text.max(1800),
    氛围: text.max(1800),
    对白: text.max(3500),
  })
  .strict();
export const novelScriptSchema = z
  .object({
    title: text.max(200),
    // Optional only for reading pre-existing saved scripts; new generations are validated below.
    applications: z
      .array(
        z
          .object({
            publicId: text.max(40),
            method: text.max(300),
            adaptation: text.max(1200),
            sceneKeys: z.array(text.max(30)).min(1).max(24),
          })
          .strict()
      )
      .max(15)
      .optional(),
    episodes: z
      .array(
        z
          .object({
            index: z.number().int().min(1).max(3),
            title: text.max(120),
            opening: text.max(1200),
            payoff: text.max(1200),
            hook: text.max(1200),
            scenes: z.array(scene).min(1).max(8),
          })
          .strict()
      )
      .min(2)
      .max(3),
  })
  .strict();
export type NovelAdvice = z.infer<typeof novelAdviceSchema>;
export type NovelScript = z.infer<typeof novelScriptSchema>;
export type NovelTestResult = {
  requestId: string;
  stage: NovelTestInput["stage"];
  text: string;
  templateIds: string[];
  inputSha256: string;
  resultSha256: string;
};
export function validateNovelStageOutput(
  input: NovelTestInput,
  value: unknown,
  availableIds: string[]
) {
  if (input.stage === "advice") {
    const result = novelAdviceSchema.parse(value);
    const ids = result.recommendations.map(r => r.publicId);
    const available = availableIds.filter(
      id => !input.selectedTemplateIds.includes(id)
    );
    const expected = Math.min(3, available.length);
    if (
      ids.length < expected ||
      new Set(ids).size !== ids.length ||
      ids.some(id => !available.includes(id))
    )
      throw new Error("推荐模板不在可用库中或数量不足");
    return result;
  }
  if (input.stage === "chapter") return novelChapterSchema.parse(value);
  const result =
    input.stage === "outline"
      ? novelOutlineSchema.parse(value)
      : novelScriptSchema.parse(value);
  if (
    result.episodes.length !== input.episodeCount ||
    result.episodes.some((e, i) => e.index !== i + 1)
  )
    throw new Error("分集数量或次序不完整");
  if ("title" in result)
    for (const ep of result.episodes) {
      if (new Set(ep.scenes.map(s => s.key)).size !== ep.scenes.length)
        throw new Error("场次编号重复");
    }
  if ("title" in result) {
    const selected = new Set(input.templates.map(t => t.publicId));
    const keys = new Set(
      result.episodes.flatMap(ep => ep.scenes.map(scene => scene.key))
    );
    const applications = result.applications || [];
    if (
      selected.size &&
      (!applications.length ||
        applications.some(
          a =>
            !selected.has(a.publicId) || a.sceneKeys.some(key => !keys.has(key))
        ) ||
        Array.from(selected).some(
          id => !applications.some(a => a.publicId === id)
        ))
    ) {
      throw new Error("模板运用说明缺失，或引用了未选择的模板/不存在的场次");
    }
  }
  return result;
}
