/**
 * /platform Skill 勾选 UI 分组（按用途，便于开/关一整组）。
 * Canvas 专用 Skill 不进此表（见 CANVAS_ONLY_SKILL_IDS）。
 *
 * 分类原则：一类一个篮子，勿把「笔记节奏 / 一键模板 / 视频广告」揉进同一组。
 */

import { PLATFORM_SKILL_ROUTER_CORE_IDS } from "./platformSkillRouter.js";

export type PlatformSkillCategoryId =
  | "core"
  | "graphic"
  | "templates"
  | "deck"
  | "video"
  | "lane"
  | "custom";

export type PlatformSkillCategoryMeta = {
  id: PlatformSkillCategoryId;
  label: string;
  hint: string;
};

/** UI 展示顺序（固定，勿随意打乱） */
export const PLATFORM_SKILL_CATEGORY_ORDER: readonly PlatformSkillCategoryMeta[] = [
  { id: "core", label: "核心通用", hint: "钩子结构、平台母语、审核表达、封面停滑等底座" },
  { id: "graphic", label: "图文笔记", hint: "笔记节奏、高收藏、蓝海自然、连载弧" },
  { id: "templates", label: "一键模板", hint: "百科可视化、Image-2 复刻、即梦封面" },
  { id: "deck", label: "动效PPT", hint: "路演投屏、分步动效、HTML / PPTX 导出" },
  { id: "video", label: "视频与广告", hint: "导演中台、产品广告、短剧钩子、带货广告" },
  { id: "lane", label: "赛道专项", hint: "虚拟资料店、畅销品科普、法医、跨界医学、身份反差等" },
  { id: "custom", label: "我上传的", hint: "你自己上传的 Skill.md" },
] as const;

/** 组内展示顺序（未列出的排在该组末尾，按 id） */
export const PLATFORM_SKILL_ID_ORDER: readonly string[] = [
  // core（路由核心会自然落这里；再补常见底座）
  "hook-solution-cta",
  "platform-native",
  "review-safe-voice",
  "cover-stop-scroll",
  "vivid-anti-boring",
  // graphic
  "graphic-note-rhythm",
  "xhs-collectible-note",
  "blue-ocean-natural",
  "batch-arc-engagement",
  // templates（HB 一键能力；不含动效PPT）
  "encyclopedic-infographic",
  "image2-quick-templates",
  "jimeng-cover",
  // deck（路演动效 PPT，独立栏位）
  "website-html-ppt",
  // video / ads
  "director-craft",
  "json-director-middleware",
  "jimeng-product-ad",
  "jimeng-short-drama",
  "ai-feed-ad",
  // lane
  "xhs-virtual-goods",
  "cultural-diversity",
  "lifestyle-diversity",
  "contrast-reversal-climax",
  "crossover-popsci",
  "medical-resource-library",
  "4season-fmcg-popsci",
  "label-debunk-copy",
  "authority-cite-endorsement",
  "fmcg-popsci-monetize",
  "forensic-life-lens",
];

const GRAPHIC_IDS = new Set([
  "graphic-note-rhythm",
  "xhs-collectible-note",
  "blue-ocean-natural",
  "batch-arc-engagement",
]);

const TEMPLATE_IDS = new Set([
  "encyclopedic-infographic",
  "image2-quick-templates",
  "jimeng-cover",
]);

const DECK_IDS = new Set(["website-html-ppt"]);

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

/** 营销首页动效等：文档在 skill 目录，但不进 /platform 勾选池 */
export const HOME_ONLY_SKILL_IDS = ["home-motion-v3"] as const;

export type CanvasOnlySkillId = (typeof CANVAS_ONLY_SKILL_IDS)[number];

export function isCanvasOnlySkillId(id: string): boolean {
  return (CANVAS_ONLY_SKILL_IDS as readonly string[]).includes(id);
}

/** 不进入 /platform Skill 勾选池（Canvas 专用 + 首页专用） */
export function isExcludedFromPlatformSkillPool(id: string): boolean {
  const s = String(id || "").trim();
  if (!s) return true;
  if (isCanvasOnlySkillId(s)) return true;
  return (HOME_ONLY_SKILL_IDS as readonly string[]).includes(s);
}

export function resolvePlatformSkillCategory(skill: {
  id: string;
  source?: string;
}): PlatformSkillCategoryId {
  if (skill.source === "user") return "custom";
  const id = String(skill.id || "").trim();
  if (DECK_IDS.has(id)) return "deck";
  if (TEMPLATE_IDS.has(id)) return "templates";
  if (GRAPHIC_IDS.has(id)) return "graphic";
  if (VIDEO_IDS.has(id)) return "video";
  if (CORE_IDS.has(id)) return "core";
  return "lane";
}

function skillSortKey(id: string): number {
  const idx = PLATFORM_SKILL_ID_ORDER.indexOf(id);
  return idx >= 0 ? idx : 10_000;
}

export function sortPlatformSkillsInCategory<T extends { id: string }>(skills: T[]): T[] {
  return [...skills].sort((a, b) => {
    const d = skillSortKey(a.id) - skillSortKey(b.id);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

export function groupPlatformSkillsByCategory<T extends { id: string; source?: string }>(
  skills: T[],
): Array<{ category: PlatformSkillCategoryMeta; skills: T[] }> {
  const buckets = new Map<PlatformSkillCategoryId, T[]>();
  for (const meta of PLATFORM_SKILL_CATEGORY_ORDER) buckets.set(meta.id, []);
  for (const sk of skills) {
    if (isExcludedFromPlatformSkillPool(sk.id)) continue;
    const cat = resolvePlatformSkillCategory(sk);
    buckets.get(cat)!.push(sk);
  }
  return PLATFORM_SKILL_CATEGORY_ORDER.map((category) => ({
    category,
    skills: sortPlatformSkillsInCategory(buckets.get(category.id) || []),
  })).filter((g) => g.skills.length > 0);
}
