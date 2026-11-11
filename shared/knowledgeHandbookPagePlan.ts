/**
 * 完整版图文手册的页数预算与版式分配（用户 2026-11-11：「68 页太冗长……34 页图片，总页数控制在 48 到 54 页」）。
 *
 * - 目标总页数 = 配图数 × 1.41～1.59（34 图 → 48～54；48 图 → 68～76），同时守既有「完整版 ≤72 页」硬顶，取两者较小值。
 * - 每章至少 1 页（图文同页）；跨页大图（一章 2 页）的名额 = 目标总页数 − 章数（目标取区间中点并留出续页余量）。
 * - 名额优先给图中文字最密的章（图越密越需要放大）。生图前就确定的图内文字量是唯一在审校前、审校后、导出时都一致可得的指标：
 *   ready-images 稿的 source.pages[i].body 就是该图图内文字（≤1200 字）；审校回执的 facts 数只在审校后才有，不能用来定审校预算。
 * - 精华版（图 ≤30）不适用跨页：图少文多，保持原「图文同页 + 纯内文页 1:2–1:3」规则；无档位的旧稿同样只排图文同页。
 * - 分配只决定「允许跨页」；分页器仍按实测：跨页两页放得下本章正文才用跨页，放不下就退回图文同页（先收跨页名额），不为跨页多开续页。
 */
import { KNOWLEDGE_FULL_MAX_TOTAL_PAGES, KNOWLEDGE_LEAD_PAGE_CHARS, type KnowledgeEditionLevel } from "./knowledgeEditionBudget";

/** 跨页两页图下栏合计可容的正文字数（实测约 450–600 字，含小标题与块间距；取保守值）。 */
export const KNOWLEDGE_SPREAD_PAGE_CHARS = 420;
/** 完整版总页数 / 配图数 的目标区间（用户 2026-11-11：图:文约 2:1～3:1）。 */
export const KNOWLEDGE_FULL_PAGE_RATIO = { min: 1.41, max: 1.59 } as const;

export type KnowledgeChapterLayoutMode = "spread" | "inline";
export type KnowledgeHandbookPagePlan = {
  level?: KnowledgeEditionLevel;
  images: number;
  /** 目标总页数区间（只对完整版有意义；其余档位为 null）。 */
  range: { min: number; max: number; target: number } | null;
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
 * 返回每章版式与正文字数预算：跨页章 KNOWLEDGE_SPREAD_PAGE_CHARS，图文同页章 KNOWLEDGE_LEAD_PAGE_CHARS。
 */
export function knowledgeHandbookPagePlan(level: KnowledgeEditionLevel | undefined, pages: readonly { id: string; body: string; hasImage: boolean }[]): KnowledgeHandbookPagePlan {
  const images = pages.filter(p => p.hasImage).length;
  const density = pages.map(p => (p.hasImage ? visible(p.body) : 0));
  const range = level === "full" ? knowledgeFullPageRange(images) : null;
  const spreadSlots = range ? Math.max(0, Math.min(images, range.target - pages.length)) : 0;
  // 图内文字最多者优先；同量按章序，保证同一稿在审校、排版、导出三处分配一致。
  const order = pages.map((_, i) => i).filter(i => pages[i]!.hasImage).sort((a, b) => density[b]! - density[a]! || a - b);
  const spread = new Set(order.slice(0, spreadSlots));
  return {
    level, images, range, spreadSlots,
    chapters: pages.map((p, i) => ({ id: p.id, mode: spread.has(i) ? "spread" : "inline", maxChars: spread.has(i) ? KNOWLEDGE_SPREAD_PAGE_CHARS : KNOWLEDGE_LEAD_PAGE_CHARS, density: density[i]! })),
  };
}
