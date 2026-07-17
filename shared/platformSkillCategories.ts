/**
 * /platform Skill 勾选 UI 分组（按用途，便于开/关一整组）。
 * Canvas 专用 Skill 不进此表（见 CANVAS_ONLY_SKILL_IDS）。
 */

import { PLATFORM_SKILL_ROUTER_CORE_IDS } from "./platformSkillRouter.js";

export type PlatformSkillCategoryId = "core" | "graphic" | "video" | "lane" | "custom";

export type PlatformSkillCategoryMeta = {
  id: PlatformSkillCategoryId;
  label: string;
  hint: string;
};

export const PLATFORM_SKILL_CATEGORY_ORDER: readonly PlatformSkillCategoryMeta[] = [
  { id: "core", label: "核心通用", hint: "钩子结构、平台母语、审核表达、封面停滑等底座" },
  { id: "graphic", label: "图文笔记", hint: "图文节奏、高收藏笔记、蓝海自然、连载弧" },
  { id: "video", label: "视频导演", hint: "导演手法、JSON 导演中台（运镜/分镜向）" },
  { id: "lane", label: "赛道专项", hint: "虚拟资料店、畅销品科普、法医、跨界医学、身份反差等" },
  { id: "custom", label: "我上传的", hint: "你自己上传的 Skill.md" },
] as const;

const GRAPHIC_IDS = new Set([
  "graphic-note-rhythm",
  "xhs-collectible-note",
  "blue-ocean-natural",
  "batch-arc-engagement",
  "encyclopedic-infographic",
  "image2-quick-templates",
  "website-html-ppt",
  "jimeng-cover",
]);

const VIDEO_IDS = new Set([
  "director-craft",
  "json-director-middleware",
  "jimeng-product-ad",
  "jimeng-short-drama",
  "ai-feed-ad",
]);

const CORE_IDS = new Set<string>(PLATFORM_SKILL_ROUTER_CORE_IDS);

/** Canvas-only：不在 /platform Skill 池展示 */
export const CANVAS_ONLY_SKILL_IDS = [
  "seedance-i2v-motion",
  "video-reverse-prompt",
  "manhua-drama-studio",
  "screenwriter-genre-templates",
  "manhua-scene-asset-library",
] as const;

export type CanvasOnlySkillId = (typeof CANVAS_ONLY_SKILL_IDS)[number];

export function isCanvasOnlySkillId(id: string): boolean {
  return (CANVAS_ONLY_SKILL_IDS as readonly string[]).includes(id);
}

export function resolvePlatformSkillCategory(skill: {
  id: string;
  source?: string;
}): PlatformSkillCategoryId {
  if (skill.source === "user") return "custom";
  const id = String(skill.id || "").trim();
  if (CORE_IDS.has(id)) return "core";
  if (GRAPHIC_IDS.has(id)) return "graphic";
  if (VIDEO_IDS.has(id)) return "video";
  return "lane";
}

export function groupPlatformSkillsByCategory<T extends { id: string; source?: string }>(
  skills: T[],
): Array<{ category: PlatformSkillCategoryMeta; skills: T[] }> {
  const buckets = new Map<PlatformSkillCategoryId, T[]>();
  for (const meta of PLATFORM_SKILL_CATEGORY_ORDER) buckets.set(meta.id, []);
  for (const sk of skills) {
    if (isCanvasOnlySkillId(sk.id)) continue;
    const cat = resolvePlatformSkillCategory(sk);
    buckets.get(cat)!.push(sk);
  }
  return PLATFORM_SKILL_CATEGORY_ORDER.map((category) => ({
    category,
    skills: buckets.get(category.id) || [],
  })).filter((g) => g.skills.length > 0);
}
