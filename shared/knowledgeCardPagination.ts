/**
 * 单页图文知识卡片：本地分页（无 LLM）+ 积分（前 8 页满价，第 9 页起八折，不封顶）。
 * 上传/长文的提练与 OCR 在服务端另走文本/视觉模型；本模块只负责切页与计价。
 */

export const KNOWLEDGE_CARD_TARGET_MIN_PAGES = 4;
export const KNOWLEDGE_CARD_TARGET_MAX_PAGES = 8;
/** 疏朗版式下每页合理字数上限（超出则增页；页数不封顶） */
export const KNOWLEDGE_CARD_MAX_CHARS_PER_PAGE = 850;
/** 低于此字数不强行拆成 4 页 */
export const KNOWLEDGE_CARD_MIN_CHARS_FOR_TARGET_MIN = 480;
/** 短贴文可跳过提练的字数上限（前端/路由启发式） */
export const KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS = 3200;

export const KNOWLEDGE_CARD_CREDITS_FULL = 25;
export const KNOWLEDGE_CARD_CREDITS_DISCOUNT = 20;
export const KNOWLEDGE_CARD_FULL_PRICE_PAGES = 8;
/** ≤ 此页数出图 4K（gpt-image-2 quality=high）；超过则整套一律 2K（medium） */
export const KNOWLEDGE_CARD_4K_MAX_PAGES = 6;

/** 知识卡出图像素质：总页数 ≤6 → high≈4K；>6 → medium≈2K。 */
export function knowledgeCardImageQuality(pageTotal: number): "high" | "medium" {
  const n = Math.max(0, Math.floor(Number(pageTotal) || 0));
  return n > 0 && n <= KNOWLEDGE_CARD_4K_MAX_PAGES ? "high" : "medium";
}

/** @deprecated 仅兼容旧测试/文案；产品已取消 12 页硬顶 */
export const KNOWLEDGE_CARD_HARD_MAX_PAGES = 12;

export type KnowledgeCardPagePlan = {
  pages: string[];
  pageCount: number;
  credits: number;
  roundText: string;
};

/** 整套 N 页合计积分（不封顶；前 8×25，其后×20）。 */
export function knowledgeCardCreditsForPages(n: number): number {
  const pages = Math.max(0, Math.floor(Number(n) || 0));
  if (pages <= KNOWLEDGE_CARD_FULL_PRICE_PAGES) {
    return pages * KNOWLEDGE_CARD_CREDITS_FULL;
  }
  return (
    KNOWLEDGE_CARD_FULL_PRICE_PAGES * KNOWLEDGE_CARD_CREDITS_FULL +
    (pages - KNOWLEDGE_CARD_FULL_PRICE_PAGES) * KNOWLEDGE_CARD_CREDITS_DISCOUNT
  );
}

/** 第 pageIndex 页（1-based）单次扣费。 */
export function knowledgeCardCreditsForPageIndex(pageIndex: number): number {
  const i = Math.floor(Number(pageIndex) || 0);
  if (i < 1) return 0;
  if (i <= KNOWLEDGE_CARD_FULL_PRICE_PAGES) return KNOWLEDGE_CARD_CREDITS_FULL;
  return KNOWLEDGE_CARD_CREDITS_DISCOUNT;
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
    // Prefer ~1 section per page when sections are many; merge only when tiny
    n = Math.max(byCap, sectionCount);
  }

  if (charCount >= KNOWLEDGE_CARD_MIN_CHARS_FOR_TARGET_MIN) {
    n = Math.max(n, KNOWLEDGE_CARD_TARGET_MIN_PAGES);
  }

  // Soft prefer 4–8 when content is mid-length
  if (byCap <= KNOWLEDGE_CARD_TARGET_MAX_PAGES && sectionCount <= KNOWLEDGE_CARD_TARGET_MAX_PAGES) {
    n = Math.min(KNOWLEDGE_CARD_TARGET_MAX_PAGES, Math.max(n, byCap));
    if (sectionCount >= 2) {
      n = Math.max(n, Math.min(sectionCount, KNOWLEDGE_CARD_TARGET_MAX_PAGES));
    }
  }

  return Math.max(1, n);
}

/**
 * 计划知识卡片分页（页数不封顶）。
 * 目标约 4–8；精华很长时可继续增页。
 */
export function planKnowledgeCardPages(text: string): KnowledgeCardPagePlan {
  const full = String(text || "").trim();
  if (!full) {
    return { pages: [], pageCount: 0, credits: 0, roundText: "" };
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
    credits: knowledgeCardCreditsForPages(finalPages.length),
    roundText: full,
  };
}
