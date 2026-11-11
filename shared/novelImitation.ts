/**
 * 爆款仿写 · 示例底稿结构拆解（1112）：底稿拆成「结构骨架」的 schema、类型与常量。
 * 骨架只记结构与功能（节拍顺序、作用、位置、人物功能位），不记原作人名与原句；
 * 底稿专有名词单独列出，只供后续原创度自查用。
 */
import { z } from "zod";

export const NOVEL_IMITATION_BEAT_NAME_MAX = 60;
export const NOVEL_IMITATION_BEAT_FUNCTION_MAX = 30;
export const NOVEL_IMITATION_BEAT_POSITION_MAX = 60;
export const NOVEL_IMITATION_BEAT_ROLES_MAX = 8;
export const NOVEL_IMITATION_BEAT_ROLE_MAX = 30;
export const NOVEL_IMITATION_BEAT_SUMMARY_MAX = 400;
export const NOVEL_IMITATION_MAX_BEATS = 80;
export const NOVEL_IMITATION_MAX_PROPER_NOUNS = 200;
export const NOVEL_IMITATION_PROPER_NOUN_MAX = 60;

/** 占位，待站长定价；当前管理者测试流程不扣积分。 */
export const NOVEL_IMITATION_SKELETON_CREDITS = 30;
/** 占位，待站长定价；当前管理者测试流程不扣积分。 */
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

export const novelImitationSkeletonSchema = z.object({
  beats: z.array(novelImitationBeatSchema).min(1).max(NOVEL_IMITATION_MAX_BEATS),
  /** 底稿专有名词（人名、地名、门派、道具、金手指名称），供后续自查。 */
  properNouns: z.array(text(NOVEL_IMITATION_PROPER_NOUN_MAX)).max(NOVEL_IMITATION_MAX_PROPER_NOUNS),
});

export type NovelImitationBeat = z.infer<typeof novelImitationBeatSchema>;
export type NovelImitationSkeleton = z.infer<typeof novelImitationSkeletonSchema>;
