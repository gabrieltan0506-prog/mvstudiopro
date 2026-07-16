/**
 * 编剧剧种模板：选类型 → 套骨架 → 题材一句微调即可开写。
 * 正文由运营/用户后续填入；`ready:false` 的条目仅占位，不覆盖默认 prompt。
 */

import {
  MANHUA_DRAMA_DEFAULT_PROMPTS,
  type ManhuaDramaStage,
} from "./videoReversePrompt.js";

export type ScreenwriterGenreTemplate = {
  id: string;
  labelZh: string;
  /** 一句话调性 / 卖点 */
  pitch: string;
  /** 开场钩子公式（可空，待填） */
  hookPattern: string;
  /** 角色槽位说明（可空） */
  characterSlots: string;
  /** 6–8 镜节拍骨架（可空） */
  beatSkeleton: string;
  /** 对白语气 */
  dialogueTone: string;
  /** 禁止崩坏 / 题材雷区 */
  avoid: string;
  /**
   * 各阶段附加块（叠在 MANHUA_DRAMA_DEFAULT_PROMPTS 之后）。
   * 未 ready 时忽略。
   */
  stageAddons?: Partial<Record<ManhuaDramaStage, string>>;
  /** true = 可套用；false = 仅占位等你填模板 */
  ready: boolean;
};

/** 占位剧种 id：你补正文后把对应条目的 ready 改 true 即可 */
export const SCREENWRITER_GENRE_PLACEHOLDER_IDS = [
  "campus_angst",
  "sweet_romance",
  "rebirth_revenge",
  "workplace_power",
  "family_ethics",
  "scifi_farewell",
  "custom_slot_a",
  "custom_slot_b",
] as const;

export type ScreenwriterGenreId = (typeof SCREENWRITER_GENRE_PLACEHOLDER_IDS)[number] | (string & {});

function emptySlot(id: string, labelZh: string, pitch: string): ScreenwriterGenreTemplate {
  return {
    id,
    labelZh,
    pitch,
    hookPattern: "",
    characterSlots: "",
    beatSkeleton: "",
    dialogueTone: "",
    avoid: "",
    stageAddons: undefined,
    ready: false,
  };
}

/**
 * 剧种注册表。填模板时优先改这里的字段；也可从
 * `docs/2026Jul16/screenwriter-templates/*.md` 粘贴后同步进来。
 */
export const SCREENWRITER_GENRE_TEMPLATES: ScreenwriterGenreTemplate[] = [
  emptySlot("campus_angst", "校园虐心", "青涩对峙 / 错过 / 最后一眼"),
  emptySlot("sweet_romance", "甜宠日常", "反差萌 / 小确幸 / 轻冲突收甜"),
  emptySlot("rebirth_revenge", "重生复仇", "信息差打脸 / 节奏爽点密集"),
  emptySlot("workplace_power", "职场爽文", "降维打击 / 专业锚点 / 权力反转"),
  emptySlot("family_ethics", "家庭伦理", "代际张力 / 沉默与爆发"),
  emptySlot("scifi_farewell", "科幻离别", "规则压迫下的私情一搏"),
  emptySlot("custom_slot_a", "自定义槽 A", "待你粘贴模板"),
  emptySlot("custom_slot_b", "自定义槽 B", "待你粘贴模板"),
];

export function listScreenwriterGenres(opts?: { onlyReady?: boolean }): ScreenwriterGenreTemplate[] {
  const list = SCREENWRITER_GENRE_TEMPLATES.slice();
  if (opts?.onlyReady) return list.filter((g) => g.ready);
  return list;
}

export function getScreenwriterGenreTemplate(id: string | undefined | null): ScreenwriterGenreTemplate | null {
  const key = String(id || "").trim();
  if (!key) return null;
  return SCREENWRITER_GENRE_TEMPLATES.find((g) => g.id === key) || null;
}

/** 把剧种骨架拼成可注入 LLM 的硬约束块（未 ready 返回空串） */
export function composeGenreTemplatePromptBlock(genre: ScreenwriterGenreTemplate | null | undefined): string {
  if (!genre || !genre.ready) return "";
  const lines = [
    `【编剧剧种模板·${genre.labelZh}（id=${genre.id}）】`,
    genre.pitch ? `调性：${genre.pitch}` : "",
    genre.hookPattern ? `钩子公式：\n${genre.hookPattern}` : "",
    genre.characterSlots ? `角色槽位：\n${genre.characterSlots}` : "",
    genre.beatSkeleton ? `节拍骨架：\n${genre.beatSkeleton}` : "",
    genre.dialogueTone ? `对白语气：${genre.dialogueTone}` : "",
    genre.avoid ? `禁止崩坏：${genre.avoid}` : "",
    "硬规则：套模板后只允许按用户题材微调人设/场景名词，禁止改掉钩子公式与节拍骨架的因果顺序；成稿去导演名/片名/真人名。",
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * 生成某阶段最终 prompt：默认漫剧阶段句 + 剧种总块（故事/角色/节拍）+ 阶段 addon。
 */
export function buildManhuaStagePromptWithGenre(
  stage: ManhuaDramaStage,
  opts?: { genreId?: string; topic?: string },
): string {
  const base = MANHUA_DRAMA_DEFAULT_PROMPTS[stage];
  const genre = getScreenwriterGenreTemplate(opts?.genreId);
  const genreBlock = composeGenreTemplatePromptBlock(genre);
  const addon = genre?.ready ? String(genre.stageAddons?.[stage] || "").trim() : "";
  const topic = String(opts?.topic || "").trim();

  const parts = [base];
  if (genreBlock && (stage === "story_brief" || stage === "character_bible" || stage === "episode_beats")) {
    parts.push(genreBlock);
  }
  if (addon) parts.push(`【剧种阶段附加·${stage}】\n${addon}`);
  if (topic) {
    parts.push(`【用户题材硬约束】${topic.slice(0, 800)}\n必须围绕该题材展开，禁止跑题。`);
  }
  return parts.join("\n\n");
}

/** 供 UI / Skill 文档列出「待填」状态 */
export function summarizeGenreRegistry(): Array<{
  id: string;
  labelZh: string;
  ready: boolean;
}> {
  return SCREENWRITER_GENRE_TEMPLATES.map((g) => ({
    id: g.id,
    labelZh: g.labelZh,
    ready: g.ready,
  }));
}
