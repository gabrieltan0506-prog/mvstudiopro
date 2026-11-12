/**
 * 爆款仿写 · 示例底稿结构拆解（1112）：底稿拆成「结构骨架」的 schema、类型与常量。
 * 骨架只记结构与功能（节拍顺序、作用、位置、人物功能位），不记原作人名与原句；
 * 底稿专有名词单独列出，只供后续原创度自查用。
 */
import { z } from "zod";
import { NOVEL_REVIEW_DIMENSIONS, type NovelReviewDimension } from "./novelCraftReview";

export const NOVEL_IMITATION_BEAT_NAME_MAX = 60;
export const NOVEL_IMITATION_BEAT_FUNCTION_MAX = 30;
export const NOVEL_IMITATION_BEAT_POSITION_MAX = 60;
export const NOVEL_IMITATION_BEAT_ROLES_MAX = 8;
export const NOVEL_IMITATION_BEAT_ROLE_MAX = 30;
export const NOVEL_IMITATION_BEAT_SUMMARY_MAX = 400;
export const NOVEL_IMITATION_MAX_BEATS = 80;
export const NOVEL_IMITATION_MAX_PROPER_NOUNS = 200;
export const NOVEL_IMITATION_PROPER_NOUN_MAX = 60;

/** 扣费已接入（1112），经 shared/novelStepBilling.ts 读取。 */
export const NOVEL_IMITATION_SKELETON_CREDITS = 30;
/** 扣费已接入（1112），经 shared/novelStepBilling.ts 读取。 */
export const NOVEL_IMITATION_EPISODE_CREDITS = 15;

/** 底稿拆解分片大小（字）与并发上限。 */
export const NOVEL_IMITATION_SHARD_CHARS = 24000;
export const NOVEL_IMITATION_SHARD_CONCURRENCY = 4;

const text = (max: number) => z.string().trim().min(1).max(max);

export const novelImitationBeatSchema = z.object({
  index: z.number().int().min(1),
  name: text(NOVEL_IMITATION_BEAT_NAME_MAX),
  /** 这一拍的作用：钩子 / 铺垫 / 爽点 / 反转 / 情绪高点 / 卷末悬念等。 */
  function: text(NOVEL_IMITATION_BEAT_FUNCTION_MAX),
  /** 在底稿中的大致位置，如「第3-5章」或「约 20%」。 */
  position: text(NOVEL_IMITATION_BEAT_POSITION_MAX),
  /** 只写人物功能位（主角 / 对手 / 助力 / 情感对象…），不写原作人名。 */
  roles: z.array(text(NOVEL_IMITATION_BEAT_ROLE_MAX)).max(NOVEL_IMITATION_BEAT_ROLES_MAX),
  /** 功能性描述，不引用原句。 */
  summary: text(NOVEL_IMITATION_BEAT_SUMMARY_MAX),
});

// ---------- 评分与特色段（1112b：拆书参考模板） ----------

/** 综合分达到此分数，整本结构骨架收录为「拆书参考模板」（单处真源）。 */
export const NOVEL_IMITATION_COLLECT_SCORE = 80;
/** 每次拆解最多给出的特色段条数（汇总结果与每片候选都按此上限）。 */
export const NOVEL_IMITATION_MAX_HIGHLIGHTS = 8;
export const NOVEL_IMITATION_SCORE_REASON_MAX = 200;
export const NOVEL_IMITATION_HIGHLIGHT_FEATURE_MAX = 60;
export const NOVEL_IMITATION_HIGHLIGHT_BEATS_MAX = 8;
export const NOVEL_IMITATION_HIGHLIGHT_BEAT_MAX = 120;
export const NOVEL_IMITATION_HIGHLIGHT_REUSE_MAX = 200;
/** 模型按「题材 + 结构特征」生成的中性展示名（不含原作名称）。 */
export const NOVEL_IMITATION_TITLE_MAX = 40;
/** 工作台每次最多勾选的「我的拆书模板」条数。 */
export const NOVEL_IMITATION_LIBRARY_PICK_MAX = 3;

const dimensionScore = z.number().int().min(1).max(5);

/**
 * 示例底稿的综合评分：维度与 1–5 分制沿用审稿准绳（shared/novelCraftReview 的七个维度），
 * total 为 0–100 的综合分。全部由模型在汇总（只有一片时为该片）同一次调用里给出，只作参考分，不是平台评定。
 */
export const novelImitationScoreSchema = z.object({
  total: z.number().int().min(0).max(100),
  dimensions: z
    .object(Object.fromEntries(NOVEL_REVIEW_DIMENSIONS.map(d => [d, dimensionScore])) as Record<NovelReviewDimension, typeof dimensionScore>)
    .strict(),
  reason: text(NOVEL_IMITATION_SCORE_REASON_MAX),
});

/** 有特色的章节 / 段落：只记位置、特色、功能性小节拍与复用方式，不抄原句、不写原作名称。 */
export const novelImitationHighlightSchema = z.object({
  /** 中性展示名，如「开篇三百字险境钩子」；不含原作名称。 */
  title: text(NOVEL_IMITATION_TITLE_MAX),
  position: text(NOVEL_IMITATION_BEAT_POSITION_MAX),
  /** 特色是什么：开篇钩子、反转设计、情绪爆点、信息差运用等。 */
  feature: text(NOVEL_IMITATION_HIGHLIGHT_FEATURE_MAX),
  beats: z.array(text(NOVEL_IMITATION_HIGHLIGHT_BEAT_MAX)).min(1).max(NOVEL_IMITATION_HIGHLIGHT_BEATS_MAX),
  /** 可以怎样复用到别的题材。 */
  reusableAs: text(NOVEL_IMITATION_HIGHLIGHT_REUSE_MAX),
});

export const novelImitationSkeletonSchema = z.object({
  beats: z.array(novelImitationBeatSchema).min(1).max(NOVEL_IMITATION_MAX_BEATS),
  /** 底稿专有名词（人名、地名、门派、道具、金手指名称），供后续自查。 */
  properNouns: z.array(text(NOVEL_IMITATION_PROPER_NOUN_MAX)).max(NOVEL_IMITATION_MAX_PROPER_NOUNS),
  /** 整本结构的中性展示名，如「都市逆袭 · 三段打脸升级结构」（汇总 / 单片调用给出）；1112b 新增，可选。 */
  title: text(NOVEL_IMITATION_TITLE_MAX).optional(),
  /** 参考分（模型给出）；1112b 新增，旧缓存 / 旧草稿没有此字段。 */
  score: novelImitationScoreSchema.optional(),
  /** 特色段（分片时为本片候选，汇总后为全书最多 8 条）；1112b 新增，可选。 */
  highlights: z.array(novelImitationHighlightSchema).max(NOVEL_IMITATION_MAX_HIGHLIGHTS).optional(),
});

export type NovelImitationBeat = z.infer<typeof novelImitationBeatSchema>;
export type NovelImitationScore = z.infer<typeof novelImitationScoreSchema>;
export type NovelImitationHighlight = z.infer<typeof novelImitationHighlightSchema>;
export type NovelImitationSkeleton = z.infer<typeof novelImitationSkeletonSchema>;

// ---------- 拆书参考模板库（平台公共库；独立前缀，不进 manhuaViralTemplate 审核流） ----------

export const novelImitationLibraryKindSchema = z.enum(["whole", "highlight"]);
export type NovelImitationLibraryKind = z.infer<typeof novelImitationLibraryKindSchema>;

/**
 * 公共条目：只有结构信息（节拍、功能、人物功能位、复用方式、参考分）与中性展示名。
 * 不含底稿原文、原句、专有名词、底稿文件名与上传者账号信息；
 * source 仅作内部溯源（上传者 userId 与底稿 sha256），列表接口不返回。
 */
export const novelImitationLibraryEntrySchema = z.object({
  id: z.string().min(1).max(80),
  kind: novelImitationLibraryKindSchema,
  title: z.string().min(1).max(NOVEL_IMITATION_TITLE_MAX),
  collectedAt: z.string(),
  updatedAt: z.string(),
  /** 所属底稿的参考分。 */
  score: novelImitationScoreSchema.optional(),
  /** kind=whole：整本节拍骨架（不含 properNouns）。 */
  beats: z.array(novelImitationBeatSchema).optional(),
  /** kind=highlight：该特色段。 */
  highlight: novelImitationHighlightSchema.optional(),
  source: z.object({ userId: z.number().int(), baseSha256: z.string().length(64) }),
});
export type NovelImitationLibraryEntry = z.infer<typeof novelImitationLibraryEntrySchema>;

/** 列表接口返回给前台的字段（不含溯源字段）。 */
export type NovelImitationLibraryItem = {
  id: string;
  kind: NovelImitationLibraryKind;
  title: string;
  total?: number;
  feature?: string;
  reusableAs?: string;
  collectedAt: string;
};

/** 一次拆解后的收录结果（前台展示用）。 */
export const novelImitationLibraryOutcomeSchema = z.object({
  /** 本次是否给出参考分。 */
  scored: z.boolean(),
  /** 库里这部底稿是否有整本结构条目。 */
  wholeCollected: z.boolean(),
  /** 库里这部底稿的特色章节条数。 */
  highlightCount: z.number().int().min(0),
  /** 这部底稿此前已收录且参考分不低于本次：保留原有条目，本次未覆盖。 */
  alreadyCollected: z.boolean().optional(),
  /** 收录写入未完成（不影响结构骨架本身）。 */
  failed: z.boolean().optional(),
});
export type NovelImitationLibraryOutcome = z.infer<typeof novelImitationLibraryOutcomeSchema>;
