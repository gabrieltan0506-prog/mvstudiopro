/**
 * 完整版图文手册的页数预算与版式分配（用户 2026-11-11：「68 页太冗长……34 页图片，总页数控制在 48 到 54 页」）。
 *
 * 2026-11-13 站长：不再切图——取消跨页（一张信息图切两半分放两页），所有章一律图文同页
 * （整张横版图在上、两栏正文在下、放不完接纯文字续页）。
 * - 目标总页数区间口径不变：配图数 × 1.41～1.59，同时守「完整版 ≤72 页」硬顶，取两者较小值；只用于上限校核与报告。
 *   无跨页后每章 1 页 + 续页，总页数常低于下限——低于下限不凑页、不为凑页拉长正文。
 * - 跨页名额恒为 0（spreadSlots 字段保留，值为 0）；每章 mode 恒为 inline，正文预算一律图文同页档 KNOWLEDGE_LEAD_PAGE_CHARS。
 * - density（图内文字量，source.pages[i].body）照旧报出，供排查与报告；不再用于分配。
 * - 精华版与无档位旧稿本来就只排图文同页，不变。
 */
import { KNOWLEDGE_FULL_MAX_TOTAL_PAGES, KNOWLEDGE_LEAD_PAGE_CHARS, type KnowledgeEditionLevel } from "./knowledgeEditionBudget";

/**
 * @deprecated 2026-11-13 取消跨页后不再用于任何预算；仅为旧回执与旧调用方保留导出。
 * 原义：跨页两页图下栏合计可容的正文字数（实测约 450–600 字，取保守值）。
 */
export const KNOWLEDGE_SPREAD_PAGE_CHARS = 420;
/** 完整版总页数 / 配图数 的目标区间（用户 2026-11-11：图:文约 2:1～3:1）。 */
export const KNOWLEDGE_FULL_PAGE_RATIO = { min: 1.41, max: 1.59 } as const;

/** 类型保留 "spread" 以兼容旧回执；新分配只产出 "inline"。 */
export type KnowledgeChapterLayoutMode = "spread" | "inline";
export type KnowledgeHandbookPagePlan = {
  level?: KnowledgeEditionLevel;
  images: number;
  /** 目标总页数区间（只对完整版有意义；其余档位为 null）。 */
  range: { min: number; max: number; target: number } | null;
  /** 跨页名额：取消跨页后恒为 0（字段保留）。 */
  spreadSlots: number;
  chapters: { id: string; mode: KnowledgeChapterLayoutMode; maxChars: number; density: number }[];
};

const visible = (s: string) => s.replace(/\s+/g, "").length;

/** 完整版目标页数区间：配图数 × 1.41～1.59，上限再受 72 页硬顶约束；目标取区间中点（为个别续页留余量）。 */
export function knowledgeFullPageRange(images: number) {
  if (!Number.isSafeInteger(images) || images < 1) return null;
  const max = Math.min(Math.floor(images * KNOWLEDGE_FULL_PAGE_RATIO.max), KNOWLEDGE_FULL_MAX_TOTAL_PAGES);
  const min = Math.min(Math.ceil(images * KNOWLEDGE_FULL_PAGE_RATIO.min), max);
  return { min, max, target: Math.max(images, Math.min(max, Math.round((min + max) / 2))) };
}

/**
 * pages：按原稿章序，body 为该图图内文字（source.pages[i].body），hasImage 表示有配图。
 * 返回每章版式与正文字数预算：一律图文同页（inline），预算 KNOWLEDGE_LEAD_PAGE_CHARS；不分配跨页名额。
 */
export function knowledgeHandbookPagePlan(level: KnowledgeEditionLevel | undefined, pages: readonly { id: string; body: string; hasImage: boolean }[]): KnowledgeHandbookPagePlan {
  const images = pages.filter(p => p.hasImage).length;
  const density = pages.map(p => (p.hasImage ? visible(p.body) : 0));
  const range = level === "full" ? knowledgeFullPageRange(images) : null;
  return {
    level, images, range, spreadSlots: 0,
    chapters: pages.map((p, i) => ({ id: p.id, mode: "inline", maxChars: KNOWLEDGE_LEAD_PAGE_CHARS, density: density[i]! })),
  };
}
