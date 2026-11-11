import { z } from "zod";
import { novelExcerptSchema } from "./manhuaNovelSource";
import { NOVEL_IMITATION_LIBRARY_PICK_MAX, novelImitationBeatSchema } from "./novelImitation";
import {
  NOVEL_CREATIVE_PREMISE_EXCLUSION_MAX,
  NOVEL_CREATIVE_PREMISE_MAX,
  novelCreativePremiseExclusionSchema,
  novelCreativePremiseSchema,
  validateNovelCreativePremises,
} from "./novelCreativePremise";
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
/**
 * 创作顾问档位（站长 2026-11-12）：前台只显示档位名，不显示模型名。
 * 站长定价（每次顾问答复）：卓越 40（限时特价 20，截至 2026-11-30 当天结束）/ 优秀 10 / 完美 5 积分；
 * 管理者测试流程不扣积分，扣费尚未接入。价格一律经 resolveNovelAdvisorTierPrice 读取（前台与将来的扣费同读）。
 */
/** 卓越档限时特价截止（东八区 2026-12-01 零点起恢复原价）。 */
export const NOVEL_ADVISOR_PROMO_UNTIL = "2026-12-01T00:00:00+08:00";
export const NOVEL_ADVISOR_TIER_OPTIONS = [
  { value: "carbon", label: "卓越", credits: 40, promoCredits: 20, promoUntil: NOVEL_ADVISOR_PROMO_UNTIL },
  { value: "glm", label: "优秀", credits: 10, promoCredits: undefined, promoUntil: undefined },
  { value: "deepseek", label: "完美", credits: 5, promoCredits: undefined, promoUntil: undefined },
] as const;
export type NovelAdvisorTierOption = (typeof NOVEL_ADVISOR_TIER_OPTIONS)[number];
/**
 * 顾问档位在 now 时刻的价格：特价期内 credits = 特价、originalCredits = 原价、promo = true；
 * 截止时刻起（含）只返回原价，不再带特价信息。
 */
export function resolveNovelAdvisorTierPrice(
  tier: Pick<NovelAdvisorTierOption, "credits" | "promoCredits" | "promoUntil">,
  now: Date | number = Date.now()
): { credits: number; originalCredits?: number; promo: boolean } {
  const at = typeof now === "number" ? now : now.getTime();
  if (tier.promoCredits !== undefined && tier.promoUntil && at < Date.parse(tier.promoUntil))
    return { credits: tier.promoCredits, originalCredits: tier.credits, promo: true };
  return { credits: tier.credits, promo: false };
}
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
/**
 * 爆款仿写的请求附带内容：用户的新题材与纲要（纲要可短可长），
 * 以及底稿拆出的结构骨架（只有节拍、功能、位置与人物功能位）和需要避开的底稿名称。
 * 底稿原文本身不随请求发送。
 */
export const NOVEL_IMITATION_SYNOPSIS_MAX = 6000;
export const novelImitationBriefSchema = z
  .object({
    genre: text.max(200),
    synopsis: text.max(NOVEL_IMITATION_SYNOPSIS_MAX),
    skeleton: z.array(novelImitationBeatSchema).min(1).max(200).optional(),
    avoidNames: z.array(z.string().trim().min(1).max(40)).max(500).optional(),
  })
  .strict();
export type NovelImitationBrief = z.infer<typeof novelImitationBriefSchema>;
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
    /** revise 阶段：审稿、改稿各自的线路（1111 站长：拆成两个下拉）；缺省沿用 modelPreference。 */
    reviewModelPreference: novelModelSchema.optional(),
    rewriteModelPreference: novelModelSchema.optional(),
    source: novelExcerptSchema.optional(),
    advisorMessage: text.max(2000).optional(),
    advisorIntent: z
      .enum(["discussion", "recommend_templates", "story_variants", "creative_premises"])
      .optional(),
    /**
     * 创意环节（1112）：「换一批」时带上已出过的设想（标题 + 核心设想）作为不要重复的方向。
     * 只随 creative_premises 请求携带；旧请求没有此字段。
     */
    premiseExclusions: z
      .array(novelCreativePremiseExclusionSchema)
      .max(NOVEL_CREATIVE_PREMISE_EXCLUSION_MAX)
      .optional(),
    /**
     * 本作核心创意（1112）：用户采用并可手改的核心创意文本。非空时进入顾问讨论 / 故事线、大纲、正文与审稿改稿提示词；
     * 可选，不是任何阶段的前提。旧请求没有此字段，行为不变。
     */
    creativePremise: text.max(NOVEL_CREATIVE_PREMISE_MAX).optional(),
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
    /**
     * 爆款仿写（1112 第一版）：用户自己的题材与纲要；方向沿用 direction。
     * 存在即表示仿写模式（结构沿用所选模板骨架，题材、人物与故事发展全部来自用户）。旧请求没有此字段，行为不变。
     */
    imitation: novelImitationBriefSchema.optional(),
    /**
     * 拆书参考模板（1112b）：用户勾选的公共拆书参考模板 id（最多 3 条）。服务端从公共库读取结构内容，
     * 只在大纲与正文阶段作为结构参考注入；任何模式都可用。旧请求没有此字段，行为不变。
     */
    libraryTemplateIds: z.array(z.string().trim().min(1).max(80)).max(NOVEL_IMITATION_LIBRARY_PICK_MAX).optional(),
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
    if (v.advisorIntent === "creative_premises" && v.stage !== "advice")
      c.addIssue({ code: "custom", message: "核心创意只在创作顾问环节生成" });
    if (v.premiseExclusions !== undefined && v.advisorIntent !== "creative_premises")
      c.addIssue({ code: "custom", message: "仅「换一批」核心创意携带已出过的方向" });
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
    if (
      v.stage !== "revise" &&
      (v.reviewModelPreference !== undefined ||
        v.rewriteModelPreference !== undefined)
    )
      c.addIssue({ code: "custom", message: "仅审稿改稿可分别选择审稿与改稿线路" });
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
    if (v.libraryTemplateIds && new Set(v.libraryTemplateIds).size !== v.libraryTemplateIds.length)
      c.addIssue({ code: "custom", message: "拆书模板不可重复" });
    if (v.imitation && v.stage === "outline" && !v.imitation.skeleton?.length)
      c.addIssue({ code: "custom", message: "请先拆解底稿结构" });
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
/** 仿写模式「结构锁定」大纲：先列模板结构骨架（有序节拍），每集再标出覆盖的节拍与本作内容。 */
const imitationBeatName = text.max(40);
const imitationBeatFunction = text.max(20);
export const novelImitationOutlineSchema = z
  .object({
    structure: z
      .array(
        z
          .object({
            beat: imitationBeatName,
            function: imitationBeatFunction,
            role: text.max(300),
          })
          .strict()
      )
      .min(1)
      .max(60),
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
            beats: z
              .array(
                z
                  .object({
                    beat: imitationBeatName,
                    function: imitationBeatFunction,
                    content: text.max(600),
                  })
                  .strict()
              )
              .min(1)
              .max(12),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict();
export type NovelImitationOutline = z.infer<typeof novelImitationOutlineSchema>;
/**
 * 仿写大纲格式化：在原有格式上加「结构骨架」与每集「结构节拍」行。
 * 每集仍以「第N集：」开头、块间空一行，正文阶段按集取大纲条目的方式不变。
 */
export function formatNovelImitationOutline(plan: NovelImitationOutline) {
  return [
    `结构骨架（模板节拍）\n${plan.structure
      .map((b, i) => `${i + 1}. ${b.beat}【${b.function}】${b.role}`)
      .join("\n")}`,
    `核心冲突\n${plan.premise}`,
    `人物关系\n${plan.characters}`,
    ...plan.episodes.map(
      ep =>
        `第${ep.index}集：${ep.title}\n剧情：${ep.events}\n本集兑现：${ep.payoff}\n片尾钩子：${ep.hook}\n结构节拍：${ep.beats
          .map(b => `${b.beat}【${b.function}】${b.content}`)
          .join("；")}`
    ),
  ].join("\n\n");
}
export const novelAdviceSchema = z
  .object({
    variants: z.array(novelStoryVariantSchema).length(3).optional(),
    /** 创意环节（1112）：恰好 4 个核心设想；只在 creative_premises 请求的结果里出现。 */
    premises: z.array(novelCreativePremiseSchema).optional(),
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
            /** ≤30 字（不计空白）；能定位时已修正为原文对应的原始片段（可能含原文换行）。 */
            quote: text
              .max(60)
              .refine(q => q.replace(/\s+/g, "").length <= 30, "定位片段不超过30字"),
            problem: text.max(600),
            fix: text.max(800),
            /** 仅在归一化后仍无法在原文定位时为 false；能定位的不带此字段。 */
            located: z.literal(false).optional(),
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
const clip = (max: number) =>
  z.preprocess(
    v => (typeof v === "string" ? Array.from(v.trim()).slice(0, max).join("") : v),
    z.string()
  );
/** 改稿对大纲的影响（模型自报）；旧结果没有此字段时按「未申报」处理。 */
export const novelOutlineImpactSchema = z
  .object({
    changed: z.boolean(),
    level: z.enum(["none", "partial", "major"]),
    items: z
      .array(
        z
          .object({ what: clip(80), before: clip(40), after: clip(40) })
          .strip()
      )
      .max(12)
      .default([]),
  })
  .strip()
  .transform(v => {
    // 自相矛盾时从严：列了偏离项就算改动了情节。
    const level =
      v.items.length && v.level === "none" ? ("partial" as const) : v.level;
    return { ...v, level, changed: v.changed || level !== "none" };
  });
export type NovelOutlineImpact = z.infer<typeof novelOutlineImpactSchema>;
export const novelRevisedChapterSchema = z
  .object({
    title: text.max(120),
    text: text.max(6500),
    changes: z
      .array(z.object({ issue: text.max(400), what: text.max(800) }).strict())
      .min(1)
      .max(20),
    outlineImpact: novelOutlineImpactSchema.optional(),
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
    /** 本次审稿、改稿实际所用的模型标识（前台只经 novelModelLabel 显示线路名）；旧结果缺省。 */
    models: z
      .object({ review: z.string().optional(), revise: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict();
export type NovelReviseResult = z.infer<typeof novelReviseResultSchema>;
/** 正文字数：去掉空白后的字符数（中文按字计）。 */
export const novelTextLength = (value: string) =>
  value.replace(/\s+/g, "").length;
/** 审稿/改稿各用哪条线路：分开选的优先，缺省沿用 modelPreference（旧请求不受影响）。 */
export function novelRevisePreference(
  input: Pick<
    NovelTestInput,
    "modelPreference" | "reviewModelPreference" | "rewriteModelPreference"
  >,
  step: "review" | "revise"
) {
  return step === "review"
    ? input.reviewModelPreference ?? input.modelPreference
    : input.rewriteModelPreference ?? input.modelPreference;
}
const QUOTE_MARKS = /[“”「」『』"＂‘’'＇〝〞]/;
/** 引用比对的单字归一化：空白去掉（返回空串），全角转半角，中英文引号统一。 */
function normalizeQuoteChar(ch: string) {
  if (/\s/.test(ch) || ch === "\u3000") return "";
  if (QUOTE_MARKS.test(ch)) return '"';
  if (ch === "。") return ".";
  if (ch === "、") return ",";
  const code = ch.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  return ch;
}
/** 归一化后的字符串与每个字在原文中的下标。 */
function normalizeWithMap(value: string) {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const n = normalizeQuoteChar(value[i]);
    if (!n) continue;
    text += n;
    map.push(i);
  }
  return { text, map };
}
export const normalizeNovelQuote = (value: string) => normalizeWithMap(value).text;
/** 在原文中定位引用：归一化后比对，返回原文中的原始片段区间；找不到返回 null。 */
export function locateNovelQuote(original: string, quote: string) {
  const q = normalizeNovelQuote(quote);
  if (!q) return null;
  const body = normalizeWithMap(original);
  const at = body.text.indexOf(q);
  if (at < 0) return null;
  const start = body.map[at];
  const end = body.map[at + q.length - 1] + 1;
  return { start, end, text: original.slice(start, end) };
}
export const NOVEL_REVIEW_MIN_LOCATED = 3;
/**
 * 审稿意见定位（1111 放宽失败方式，标准不降）：归一化后能在原文找到的，quote 修正为原文原始片段；
 * 仍找不到的标 located:false 排在后面、不进改稿清单；能定位的少于 3 条才判审稿失败。
 */
export function validateNovelReview(original: string, value: unknown) {
  const review = novelReviewSchema.parse(value);
  const located: NovelReview["issues"] = [];
  const missing: NovelReview["issues"] = [];
  for (const { located: _, ...issue } of review.issues) {
    const hit = locateNovelQuote(original, issue.quote);
    if (hit)
      located.push({ ...issue, quote: hit.text.length <= 60 ? hit.text : issue.quote });
    else missing.push({ ...issue, located: false });
  }
  if (located.length < NOVEL_REVIEW_MIN_LOCATED)
    throw new Error(
      `审稿意见引用的片段在原文中找不到（能定位的仅${located.length}条，至少需要${NOVEL_REVIEW_MIN_LOCATED}条）`
    );
  return { ...review, issues: [...located, ...missing] };
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
    if (input.advisorIntent === "creative_premises") {
      validateNovelCreativePremises(result.premises);
      if (JSON.stringify(result, null, 2).length > 60000)
        throw new Error("核心创意结果过长");
      // 创意环节不推荐模板：模型多给的推荐不展示也不保留。
      return { ...result, recommendations: [] };
    } else if (result.premises) throw new Error("当前请求未要求核心创意");
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
  if (input.stage === "outline" && input.imitation) {
    const plan = novelImitationOutlineSchema.parse(value);
    if (
      plan.episodes.length !== input.episodeCount ||
      plan.episodes.some((e, i) => e.index !== i + (input.episodeStart || 1))
    )
      throw new Error("分集数量或次序不完整");
    if (formatNovelImitationOutline(plan).length > 14000)
      throw new Error("本批大纲超出可编辑长度，原始结果保留");
    return plan;
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
