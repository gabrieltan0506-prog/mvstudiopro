/**
 * 单页图文知识卡片：本地分页（无 LLM）+ 积分（前 8 页满价，第 9 页起折扣，不封顶）。
 * 页费按提练模型分档（见 knowledgeCardDistillModels）；本模块负责切页与计价。
 */

import {
  knowledgeCardPageCreditsForModel,
  resolveKnowledgeCardDistillModel,
  type KnowledgeCardDistillModelId,
} from "./knowledgeCardDistillModels.js";

export const KNOWLEDGE_CARD_TARGET_MIN_PAGES = 4;
export const KNOWLEDGE_CARD_TARGET_MAX_PAGES = 8;
/**
 * 每页合理字数上限（超出则增页；页数不封顶）。
 *
 * 用户 2026-08-05 给了两张验收样张（16:9 横版，一页承载 4–6 个模块 + 表格 + 指标条），
 * 实测每页约 1000–1200 字，取其上界：9.5 万字的书（成稿约 6800 字）因此落在 6 页，
 * 仍在 4K 门槛（`KNOWLEDGE_CARD_4K_MAX_PAGES`）内。旧值 850 是按「一页一节」的疏朗竖版设的，
 * 在横版下每页只填约 220 字，白白多出好几倍页数。
 */
export const KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE = 1200;
/** 一页横版卡片最多承载几个 `##` 小节（对齐样张密度） */
export const KNOWLEDGE_CARD_MAX_SECTIONS_PER_PAGE = 6;
/** 低于此字数不强行拆成 4 页 */
export const KNOWLEDGE_CARD_MIN_CHARS_FOR_TARGET_MIN = 480;
/** 短贴文可跳过提练的字数上限（前端/路由启发式） */
export const KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS = 3200;

/** @deprecated 默认精细档满价；请用 knowledgeCardPageCreditsForModel */
export const KNOWLEDGE_CARD_CREDITS_FULL = 30;
/** @deprecated 默认精细档折扣；请用 knowledgeCardPageCreditsForModel */
export const KNOWLEDGE_CARD_CREDITS_DISCOUNT = 24;
export const KNOWLEDGE_CARD_FULL_PRICE_PAGES = 8;
/** ≤ 此页数出图 4K（gpt-image-2 quality=high）；超过则整套一律 2K（medium） */
export const KNOWLEDGE_CARD_4K_MAX_PAGES = 6;

/** 知识卡出图像素质：总页数 ≤6 → high≈4K；>6 → medium≈2K。 */
export function knowledgeCardImageQuality(pageTotal: number): "high" | "medium" {
  const n = Math.max(0, Math.floor(Number(pageTotal) || 0));
  return n > 0 && n <= KNOWLEDGE_CARD_4K_MAX_PAGES ? "high" : "medium";
}

export type KnowledgeCardPagePlan = {
  pages: string[];
  pageCount: number;
  credits: number;
  roundText: string;
  distillModel: KnowledgeCardDistillModelId;
};

/** 整套 N 页合计积分（不封顶；前 8 满价，其后折扣；按提练模型分档）。 */
export function knowledgeCardCreditsForPages(
  n: number,
  distillModel?: string | null,
): number {
  const pages = Math.max(0, Math.floor(Number(n) || 0));
  const { full, discount } = knowledgeCardPageCreditsForModel(distillModel);
  if (pages <= KNOWLEDGE_CARD_FULL_PRICE_PAGES) {
    return pages * full;
  }
  return KNOWLEDGE_CARD_FULL_PRICE_PAGES * full + (pages - KNOWLEDGE_CARD_FULL_PRICE_PAGES) * discount;
}

/** 第 pageIndex 页（1-based）单次扣费。 */
export function knowledgeCardCreditsForPageIndex(
  pageIndex: number,
  distillModel?: string | null,
): number {
  const i = Math.floor(Number(pageIndex) || 0);
  if (i < 1) return 0;
  const { full, discount } = knowledgeCardPageCreditsForModel(distillModel);
  if (i <= KNOWLEDGE_CARD_FULL_PRICE_PAGES) return full;
  return discount;
}

/** 已提练的短贴文可跳过再提练。 */
export function shouldSkipKnowledgeCardDistill(text: string, hasUploads: boolean): boolean {
  if (hasUploads) return false;
  const t = String(text || "").trim();
  if (!t) return true;
  return t.length <= KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS;
}

type ParsedMd = {
  h1: string;
  preamble: string;
  sections: string[];
};

function parseMarkdownSections(full: string): ParsedMd {
  const lines = full.split(/\r?\n/);
  const h1 = lines.find((l) => /^#\s+/.test(l.trim()))?.trim() ?? "";
  const sectionStarts: number[] = [];
  lines.forEach((l, i) => {
    if (/^##\s+/.test(l.trim())) sectionStarts.push(i);
  });
  if (sectionStarts.length === 0) {
    return { h1, preamble: full, sections: [] };
  }
  const preamble = lines.slice(0, sectionStarts[0]).join("\n").trim();
  const sections = sectionStarts.map((start, idx) => {
    const end = idx + 1 < sectionStarts.length ? sectionStarts[idx + 1] : lines.length;
    return lines.slice(start, end).join("\n").trim();
  });
  return { h1, preamble, sections };
}

function splitByChars(text: string, parts: number): string[] {
  const s = text.trim();
  if (!s) return [];
  if (parts <= 1) return [s];
  const out: string[] = [];
  const len = s.length;
  let start = 0;
  for (let i = 0; i < parts; i++) {
    const remaining = parts - i;
    const end = i === parts - 1 ? len : Math.min(len, start + Math.ceil((len - start) / remaining));
    let cut = end;
    if (i < parts - 1 && end < len) {
      const windowStart = Math.max(start + Math.floor((end - start) * 0.55), start + 1);
      const slice = s.slice(windowStart, Math.min(len, end + 80));
      const m = slice.search(/\n|。|！|？|;|；/);
      if (m >= 0) cut = windowStart + m + 1;
    }
    const chunk = s.slice(start, cut).trim();
    if (chunk) out.push(chunk);
    start = cut;
  }
  return out.filter(Boolean);
}

function packSectionsIntoPages(
  h1: string,
  preamble: string,
  sections: string[],
  pageCount: number,
): string[] {
  const n = Math.max(1, pageCount);
  if (n === 1 || sections.length === 0) {
    return [[preamble, ...sections].filter(Boolean).join("\n\n").trim()].filter(Boolean);
  }

  const buckets: string[][] = Array.from({ length: n }, () => []);
  const per = sections.length / n;
  sections.forEach((sec, idx) => {
    const bucket = Math.min(n - 1, Math.floor(idx / Math.max(per, 1e-9)));
    buckets[bucket].push(sec);
  });

  for (let i = 0; i < n; i++) {
    if (buckets[i].length > 0) continue;
    let donor = -1;
    let donorLen = 0;
    for (let j = 0; j < n; j++) {
      if (buckets[j].length > donorLen) {
        donorLen = buckets[j].length;
        donor = j;
      }
    }
    if (donor >= 0 && donorLen > 1) {
      buckets[i].push(buckets[donor].pop()!);
    }
  }

  return buckets
    .map((secs, i) => {
      const head = i === 0 ? preamble : h1 && !secs[0]?.includes(h1) ? h1 : "";
      return [head, ...secs].filter(Boolean).join("\n\n").trim();
    })
    .filter(Boolean);
}

function resolveDesiredPageCount(charCount: number, sectionCount: number): number {
  const byCap = Math.max(1, Math.ceil(charCount / KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE));

  if (charCount < KNOWLEDGE_CARD_MIN_CHARS_FOR_TARGET_MIN && sectionCount <= 1) {
    return 1;
  }

  let n = byCap;

  if (sectionCount >= 2) {
    // 横版一页可放数节（样张为 4–6 节/页），只在字数或节数撑不住时才增页
    n = Math.max(byCap, Math.ceil(sectionCount / KNOWLEDGE_CARD_MAX_SECTIONS_PER_PAGE));
  }

  if (charCount >= KNOWLEDGE_CARD_MIN_CHARS_FOR_TARGET_MIN) {
    n = Math.max(n, KNOWLEDGE_CARD_TARGET_MIN_PAGES);
  }

  return Math.max(1, n);
}

/**
 * 出图链路会往 `scriptContext` 前面注入的内部约束块表头。
 * 知识卡把 `scriptContext` 逐页切开当**正文**渲染，这些块一旦混进来就会被印上屏
 * （用户 2026-08-05 收到的整本书知识卡，第 1 页整页是「封面出图短约束 / 壳轮换策略库」，
 * 含 coverHeadline、A1 壳、mk1/mk3 等内部代号，正文从第 2 页才开始）。
 * 注入点已在源头按 kind 关掉，这里是防再犯的第二道闸。
 */
const KNOWLEDGE_CARD_INTERNAL_DIRECTIVE_HEADS = [
  "【Platform 出图短约束】",
  "【本条图文·视觉气质手法卡】",
  "【本条导演灵感画布·主手法卡】",
  "【编导分镜·导演板",
  "【人物造型·国际时尚大片】",
  "【光影与机位约束",
  "【剧情目的·镜头】",
  "【戏种节奏】",
  "【DeepResearch Pro",
  "【3×4 跨段视觉真源】",
];

/** 剥掉混进知识卡正文的内部出图约束段；剥空则退回原文（宁可脏也不要空页）。 */
export function stripKnowledgeCardInternalDirectives(text: string): string {
  const full = String(text || "");
  if (!full.trim()) return full;
  if (!KNOWLEDGE_CARD_INTERNAL_DIRECTIVE_HEADS.some((h) => full.includes(h))) {
    return full;
  }
  const kept = full
    .split(/\n\s*\n/)
    .filter((block) => {
      const head = block.trimStart();
      return !KNOWLEDGE_CARD_INTERNAL_DIRECTIVE_HEADS.some((h) => head.startsWith(h));
    })
    .join("\n\n")
    .trim();
  return kept || full;
}

/**
 * 计划知识卡片分页（页数不封顶）。
 * 16:9 横版一页承载数个小节，目标约 4–8 页；精华很长时可继续增页。
 */
export function planKnowledgeCardPages(
  text: string,
  distillModel?: string | null,
): KnowledgeCardPagePlan {
  const model = resolveKnowledgeCardDistillModel(distillModel);
  const full = stripKnowledgeCardInternalDirectives(String(text || "")).trim();
  if (!full) {
    return { pages: [], pageCount: 0, credits: 0, roundText: "", distillModel: model };
  }

  const parsed = parseMarkdownSections(full);
  const neededByCap = Math.ceil(full.length / KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE);
  const pageCount = resolveDesiredPageCount(full.length, parsed.sections.length);

  let pages: string[];
  if (parsed.sections.length >= 2) {
    pages = packSectionsIntoPages(parsed.h1, parsed.preamble, parsed.sections, pageCount);
    if (pages.length < pageCount && full.length >= KNOWLEDGE_CARD_MIN_CHARS_FOR_TARGET_MIN) {
      pages = splitByChars([parsed.preamble, ...parsed.sections].filter(Boolean).join("\n\n"), pageCount);
      if (parsed.h1) {
        pages = pages.map((p, i) => (i === 0 || p.includes(parsed.h1) ? p : `${parsed.h1}\n\n${p}`));
      }
    }
  } else {
    pages = splitByChars(full, pageCount);
  }

  if (pages.some((p) => p.length > KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE * 1.35)) {
    pages = splitByChars(full, Math.max(pages.length + 1, neededByCap));
  }

  const finalPages = pages.filter(Boolean);
  return {
    pages: finalPages,
    pageCount: finalPages.length,
    credits: knowledgeCardCreditsForPages(finalPages.length, model),
    roundText: full,
    distillModel: model,
  };
}
