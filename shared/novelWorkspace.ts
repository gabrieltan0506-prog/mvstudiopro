import { z } from "zod";
import { novelExcerptSchema } from "./manhuaNovelSource";
import {
  NOVEL_REVIEW_DIMENSIONS,
  type NovelReviewDimension,
} from "./novelCraftReview";

export const NOVEL_FACETS = [
  "场景",
  "人物",
  "妆容",
  "灯光",
  "氛围",
  "对白",
] as const;
export const NOVEL_MODEL_OPTIONS = [
  { value: "auto", label: "自动 · 线路一优先，异常时线路二接续" },
  { value: "glm", label: "线路一" },
  { value: "deepseek", label: "线路二" },
  // 1111：线路三（推理更强、更慢）；失败不换别的线路，返回可重试提示。
  { value: "carbon", label: "线路三 · 推理更强、更慢" },
] as const;
export const novelModelSchema = z.enum(["auto", "glm", "deepseek", "carbon"]);
/** 前台只显示中性线路名；模型名是商业机密，未知模型也不回显原始标识。 */
export function novelModelLabel(model?: string) {
  if (!model) return "";
  if (/glm/i.test(model)) return "线路一";
  if (/deepseek/i.test(model)) return "线路二";
  // 线路三按领域配置解析（缺省 Carbon）；换配置后仍是 gemini- 标识
  if (/^gemini-|carbon/i.test(model)) return "线路三";
  return "创作线路";
}
const text = z.string().trim().min(1);
export const novelTemplateChoiceSchema = z
  .object({
    publicId: text.max(40),
    role: text.max(160),
    weight: z.number().int().min(0).max(100).optional(),
  })
  .strict();
/** revise：审稿改稿（1111 新增；只追加枚举值，旧草稿仍可解析）。 */
export const novelStageSchema = z.enum([
  "advice",
  "outline",
  "chapter",
  "script",
  "revise",
]);
export const novelTestInputSchema = z
  .object({
    requestId: z.string().uuid(),
    roundId: z.string().uuid(),
    stage: novelStageSchema,
    topic: text.max(200),
    direction: text.max(2000),
    modelPreference: novelModelSchema.optional(),
    source: novelExcerptSchema.optional(),
    advisorMessage: text.max(2000).optional(),
    advisorIntent: z
      .enum(["discussion", "recommend_templates", "story_variants"])
      .optional(),
    advisorHistory: z
      .array(
        z
          .object({
            user: text.max(2000),
            assistant: text.max(60000),
          })
          .strict()
      )
      .max(20)
      .optional(),
    templates: z.array(novelTemplateChoiceSchema),
    // Count for this request, not the length of the entire series.
    episodeCount: z.number().int().min(1).max(20),
    episodeStart: z.number().int().positive().optional(),
    targetEpisodeCount: z.number().int().positive().optional(),
    continuity: z.string().max(8000).optional(),
    scriptBatch: z
      .object({
        id: z.string().uuid(),
        start: z.number().int().positive(),
        count: z.number().int().min(1).max(20),
        baseline: z.string().max(128),
      })
      .strict()
      .optional(),
    outline: z.string().max(14000).default(""),
    novel: z.string().max(20000).default(""),
    chapterIndex: z.number().int().positive().default(1),
    /** revise 阶段：该集待审正文（未修改版，原样）。其他阶段不得携带。 */
    reviseDraft: z.string().max(8000).optional(),
    selectedTemplateIds: z.array(z.string().max(40)).default([]),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.advisorIntent === "recommend_templates" &&
      (v.stage !== "advice" || !v.advisorMessage)
    )
      c.addIssue({
        code: "custom",
        message: "请描述新方向，再请顾问重新推荐模板",
      });
    if (
      v.advisorIntent === "story_variants" &&
      (v.stage !== "advice" || !v.templates.length)
    )
      c.addIssue({ code: "custom", message: "请先选择模板，再生成故事线方案" });
    if (new Set(v.templates.map(t => t.publicId)).size !== v.templates.length)
      c.addIssue({ code: "custom", message: "模板不可重复" });
    if (
      v.templates.some(t => t.weight !== undefined) &&
      (v.templates.some(t => t.weight === undefined) ||
        v.templates.reduce((sum, t) => sum + (t.weight || 0), 0) !== 100)
    )
      c.addIssue({
        code: "custom",
        message: "模板创作配比须全部填写，合计100%",
      });
    if (v.stage === "revise") {
      if ((v.reviseDraft || "").trim().length < 500)
        c.addIssue({ code: "custom", message: "本集正文过短，暂不能审稿改稿" });
    } else if (v.reviseDraft !== undefined)
      c.addIssue({ code: "custom", message: "仅审稿改稿携带待审正文" });
    if (v.stage !== "advice" && v.stage !== "revise" && !v.templates.length)
      c.addIssue({ code: "custom", message: "请选择模板" });
    if (
      v.stage === "chapter" &&
      (!v.outline.trim() ||
        v.chapterIndex < (v.episodeStart || 1) ||
        v.chapterIndex >= (v.episodeStart || 1) + v.episodeCount)
    )
      c.addIssue({ code: "custom", message: "请先确认大纲与章节" });
    if (
      v.targetEpisodeCount &&
      (v.episodeStart || 1) + v.episodeCount - 1 > v.targetEpisodeCount
    )
      c.addIssue({ code: "custom", message: "本批集数超出全剧计划" });
    if (
      v.scriptBatch &&
      (v.stage !== "script" ||
        v.episodeCount !== 1 ||
        (v.episodeStart || 1) < v.scriptBatch.start ||
        (v.episodeStart || 1) >= v.scriptBatch.start + v.scriptBatch.count)
    )
      c.addIssue({ code: "custom", message: "剧本分批范围无效" });
    if (v.stage === "script" && v.novel.trim().length < 500)
      c.addIssue({ code: "custom", message: "请先确认小说正文" });
  });
export type NovelTestInput = z.infer<typeof novelTestInputSchema>;
export const novelOutlineSchema = z
  .object({
    premise: text.max(3000),
    characters: text.max(3000),
    episodes: z
      .array(
        z
          .object({
            index: z.number().int().positive(),
            title: text.max(120),
            events: text.max(1500),
            hook: text.max(500),
            payoff: text.max(500),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict();
export const novelStoryVariantSchema = z
  .object({
    id: z.enum(["A", "B", "C"]),
    title: text.max(120),
    changeSummary: text.max(1000),
    tradeoff: text.max(800),
    templates: z.array(novelTemplateChoiceSchema).min(1),
    outline: novelOutlineSchema,
  })
  .strict();
export function formatNovelOutline(plan: z.infer<typeof novelOutlineSchema>) {
  return [
    `核心冲突\n${plan.premise}`,
    `人物关系\n${plan.characters}`,
    ...plan.episodes.map(
      ep =>
        `第${ep.index}集：${ep.title}\n剧情：${ep.events}\n本集兑现：${ep.payoff}\n片尾钩子：${ep.hook}`
    ),
  ].join("\n\n");
}
export const novelAdviceSchema = z
  .object({
    variants: z.array(novelStoryVariantSchema).length(3).optional(),
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
export const novelChapterSchema = z
  .object({
    title: text.max(120),
    text: text.min(500).max(6500),
    // Ancillary notes may be empty; never reject an otherwise complete paid chapter.
    notes: z.string().trim().max(2000).default(""),
    continuity: z.string().trim().max(8000).optional(),
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
      .optional(),
    episodes: z
      .array(
        z
          .object({
            index: z.number().int().positive(),
            title: text.max(120),
            opening: text.max(1200),
            payoff: text.max(1200),
            hook: text.max(1200),
            scenes: z.array(scene).min(1).max(8),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict();
export type NovelAdvice = z.infer<typeof novelAdviceSchema>;
export type NovelScript = z.infer<typeof novelScriptSchema>;
export const novelGenerationSettingsSchema = z.object({
  reasoning: z.enum(["off", "enabled", "low", "high", "max"]),
  maxTokens: z.number().int().positive(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
});
export type NovelGenerationSettings = z.infer<
  typeof novelGenerationSettingsSchema
>;
export type NovelTestResult = {
  settings?: NovelGenerationSettings;
  model?: string;
  requestId: string;
  stage: NovelTestInput["stage"];
  text: string;
  templateIds: string[];
  inputSha256: string;
  resultSha256: string;
};
const reviewScore = z.number().int().min(1).max(5);
export const novelReviewSchema = z
  .object({
    scores: z
      .object(
        Object.fromEntries(
          NOVEL_REVIEW_DIMENSIONS.map(d => [d, reviewScore])
        ) as Record<NovelReviewDimension, typeof reviewScore>
      )
      .strict(),
    issues: z
      .array(
        z
          .object({
            dimension: z.enum(NOVEL_REVIEW_DIMENSIONS),
            quote: text.max(30),
            problem: text.max(600),
            fix: text.max(800),
          })
          .strict()
      )
      .min(3)
      .max(10),
    keep: z.array(text.max(300)).max(10).default([]),
    verdict: text.max(300),
  })
  .strict();
export type NovelReview = z.infer<typeof novelReviewSchema>;
export const novelRevisedChapterSchema = z
  .object({
    title: text.max(120),
    text: text.max(6500),
    changes: z
      .array(z.object({ issue: text.max(400), what: text.max(800) }).strict())
      .min(1)
      .max(20),
  })
  .strict();
export type NovelRevisedChapter = z.infer<typeof novelRevisedChapterSchema>;
/** 审稿改稿阶段结果：未修改版（原样）、审稿意见、最终修改版同时保留。 */
export const novelReviseResultSchema = z
  .object({
    chapterIndex: z.number().int().positive(),
    original: z.string(),
    review: novelReviewSchema,
    revised: novelRevisedChapterSchema,
  })
  .strict();
export type NovelReviseResult = z.infer<typeof novelReviseResultSchema>;
/** 正文字数：去掉空白后的字符数（中文按字计）。 */
export const novelTextLength = (value: string) =>
  value.replace(/\s+/g, "").length;
const squash = (value: string) =>
  value.replace(/[\s「」“”"'‘’]/g, "");
/** 审稿意见必须能在原文定位；字数、条数与维度由 schema 把关。 */
export function validateNovelReview(original: string, value: unknown) {
  const review = novelReviewSchema.parse(value);
  const body = squash(original);
  const missing = review.issues.filter(i => !body.includes(squash(i.quote)));
  if (missing.length)
    throw new Error("审稿意见引用的片段在原文中找不到");
  return review;
}
export const NOVEL_REVISED_MIN_CHARS = 1200;
export const NOVEL_REVISED_MAX_CHARS = 3000;
export function validateNovelRevision(value: unknown) {
  const revised = novelRevisedChapterSchema.parse(value);
  const length = novelTextLength(revised.text);
  if (length < NOVEL_REVISED_MIN_CHARS || length > NOVEL_REVISED_MAX_CHARS)
    throw new Error(`修改稿字数${length}，不在${NOVEL_REVISED_MIN_CHARS}–${NOVEL_REVISED_MAX_CHARS}之间`);
  return revised;
}
export function validateNovelStageOutput(
  input: NovelTestInput,
  value: unknown,
  availableIds: string[]
) {
  if (input.stage === "advice") {
    const result = novelAdviceSchema.parse(value);
    if (input.advisorIntent === "story_variants") {
      if (
        !result.variants ||
        new Set(result.variants.map(v => v.id)).size !== 3
      )
        throw new Error("需要三个不同编号的故事线方案");
      const eligible = new Set([
        ...availableIds,
        ...input.templates.map(t => t.publicId),
      ]);
      for (const variant of result.variants) {
        if (
          variant.outline.episodes.length !== input.episodeCount ||
          variant.outline.episodes.some(
            (e, i) => e.index !== i + (input.episodeStart || 1)
          )
        )
          throw new Error("故事线分集数量或次序不完整");
        const choices = variant.templates;
        if (
          new Set(choices.map(t => t.publicId)).size !== choices.length ||
          choices.some(
            t => !eligible.has(t.publicId) || t.weight === undefined
          ) ||
          choices.reduce((n, t) => n + (t.weight || 0), 0) !== 100
        )
          throw new Error("故事线模板须来自可用库，配比合计100%");
        // First selection uses precisely the chosen methods and any explicit weights.
        if (
          !input.advisorMessage &&
          (choices.length !== input.templates.length ||
            input.templates.some(
              t =>
                !choices.some(
                  c =>
                    c.publicId === t.publicId &&
                    (t.weight === undefined || c.weight === t.weight)
                )
            ))
        )
          throw new Error("首次故事线须使用用户选定模板与配比");
        if (formatNovelOutline(variant.outline).length > 14000)
          throw new Error("故事线大纲超出可编辑长度");
      }
      if (
        new Set(result.variants.map(v => JSON.stringify(v.outline))).size !== 3
      )
        throw new Error("故事线内容不可完全重复");
      if (JSON.stringify(result, null, 2).length > 60000)
        throw new Error("故事线结果过长");
    } else if (result.variants) throw new Error("当前请求未要求故事线方案");
    const ids = result.recommendations.map(r => r.publicId);
    const available = availableIds.filter(
      id => !input.selectedTemplateIds.includes(id)
    );
    const expected =
      input.advisorIntent === "story_variants" ||
      (input.advisorMessage && input.advisorIntent !== "recommend_templates")
        ? 0
        : Math.min(3, available.length);
    if (
      ids.length < expected ||
      new Set(ids).size !== ids.length ||
      ids.some(id => !available.includes(id))
    )
      throw new Error("推荐模板不在可用库中或数量不足");
    return result;
  }
  if (input.stage === "revise") return novelReviseResultSchema.parse(value);
  if (input.stage === "chapter") {
    const chapter = novelChapterSchema.parse(value);
    // A missing optional continuity note must not discard a complete paid chapter.
    // The client asks for a reviewed continuity record before distant continuation.
    return chapter;
  }
  const result =
    input.stage === "outline"
      ? novelOutlineSchema.parse(value)
      : novelScriptSchema.parse(value);
  if (
    result.episodes.length !== input.episodeCount ||
    result.episodes.some((e, i) => e.index !== i + (input.episodeStart || 1))
  )
    throw new Error("分集数量或次序不完整");
  if (!("title" in result) && formatNovelOutline(result).length > 14000)
    throw new Error("本批大纲超出可编辑长度，原始结果保留");
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
