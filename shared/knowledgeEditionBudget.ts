/**
 * 图文手册两档的页数预算（用户 2026-11-08 确认，同日按「主题出图」改令重算）：
 * - 出图：每张图是一个章节/主题的核心图解，图内≤1200字；图数按主题定，精华版≤30、完整版≤48（见 knowledgeTopicImagePlan）。
 * - 完整版：原「图:纯内文 3:1–2:1」以 48 图、图承载大部分文字为前提；主题图数少于 48 时（如 1108 曾限 16 张），
 *   若仍套 2:1 只剩 5–8 页内文，审校须删去约四分之三的完整稿，与「内文不受 1200 字限制」冲突。
 *   因此完整版改守用户原先给出的总页数包络：总页数≤72（68–72，可精简不可多），内文页=图外细节实际所需，
 *   下限仍为 ⌊图数/3⌋；内文资料不足时据实少排，不硬凑。
 * - 精华版：图片页:纯内文页 ≈ 1:2 至 1:3 维持不变；内文可详尽，但不重复图中已表达的内容。
 * 预算在生图前计算（两档准备阶段展示、审校请求携带），不在导出后才阻断；略超可以接受。
 *
 * 版式：每张图与其要点说明同在一张直式页（图在上、要点在下），图外细节按主题接排续页，单图不独占一页。
 */
export type KnowledgeEditionLevel = "full" | "concise";

/** 直式页图片下方要点区的保守容量（中文字符，含小标题/表格开销）。 */
export const KNOWLEDGE_LEAD_PAGE_CHARS = 700;
/** 一整页纯内文（两栏）的保守容量。 */
export const KNOWLEDGE_READING_PAGE_CHARS = 1300;
/** 单张图片内的文字上限沿用出图分页上限。 */
export const KNOWLEDGE_IMAGE_TEXT_MAX_CHARS = 1200;
/** 完整版总页数包络（用户原口径 68–72 页，可精简不可多）。 */
export const KNOWLEDGE_FULL_MAX_TOTAL_PAGES = 72;

export type KnowledgePageBudget = {
  level: KnowledgeEditionLevel;
  imagePages: number;
  /** 纯内文页（不含图文同页的图片页）。 */
  textPages: { min: number; target: number; max: number };
  totalPages: { min: number; target: number; max: number };
};

export function knowledgeEditionPageBudget(level: KnowledgeEditionLevel, imagePages: number): KnowledgePageBudget {
  if (!Number.isSafeInteger(imagePages) || imagePages < 0) throw new Error("图片页数无效");
  const n = imagePages;
  // 完整版：总页数≤72，内文按图外细节实际需要排，目标取上限、资料用尽即止。精华版 1:2–1:3，目标 2.5 倍。
  const textPages = level === "full"
    ? { min: Math.floor(n / 3), target: 0, max: Math.max(Math.ceil(n / 2), KNOWLEDGE_FULL_MAX_TOTAL_PAGES - n) }
    : { min: 2 * n, target: Math.round(n * 2.5), max: 3 * n };
  if (level === "full") textPages.target = textPages.max;
  if (textPages.target > textPages.max) textPages.target = textPages.max;
  if (textPages.target < textPages.min) textPages.target = textPages.min;
  return {
    level, imagePages: n, textPages,
    totalPages: { min: n + textPages.min, target: n + textPages.target, max: n + textPages.max },
  };
}

export type KnowledgeBudgetPage = { id: string; headline: string; body: string; supplement?: string; imageUrl?: string; imageJobId?: string; role?: "reading" | "illustration" };

const hasImage = (p: KnowledgeBudgetPage) => Boolean(p.imageJobId || p.imageUrl || p.role === "illustration");

/**
 * 按预算把纯内文页分给各章：图外补充资料越多的章节得到越多整页，
 * 使每章要么只占图文同页，要么同页 + 若干填满的续页，减少半页留白。
 * 返回每页 reading 字数上限（含表格），供审校与排版模型遵守。
 */
export function knowledgeReadingCharBudgets(level: KnowledgeEditionLevel, pages: KnowledgeBudgetPage[]) {
  const illustrated = pages.filter(hasImage);
  const budget = knowledgeEditionPageBudget(level, illustrated.length);
  const material = (p: KnowledgeBudgetPage) => {
    const extra = (p.supplement || "").replace(/\s+/g, "").length;
    // 完整版图内文字已由图片承载，只按很小权重计入；精华版图少，图外资料是主体。
    const inImage = p.body.replace(/\s+/g, "").length;
    return extra + (level === "full" ? 0.25 : 0.5) * inImage;
  };
  const extraPages = new Map<string, number>(illustrated.map(p => [p.id, 0]));
  const remaining = new Map<string, number>(illustrated.map(p => [p.id, Math.max(0, material(p) - KNOWLEDGE_LEAD_PAGE_CHARS)]));
  for (let k = 0; k < budget.textPages.target && illustrated.length; k++) {
    let best = illustrated[0]!.id, bestValue = -Infinity;
    for (const p of illustrated) {
      const value = remaining.get(p.id)!;
      if (value > bestValue) { best = p.id; bestValue = value; }
    }
    // 资料不足一整页时不硬凑篇幅；精华版仍按比例给页，模型据实写满或略少。
    if (bestValue <= 0 && level === "full") break;
    extraPages.set(best, extraPages.get(best)! + 1);
    remaining.set(best, bestValue - KNOWLEDGE_READING_PAGE_CHARS);
  }
  const textOnly = pages.filter(p => !hasImage(p));
  const result = pages.map(p => {
    if (hasImage(p)) {
      const pagesForChapter = extraPages.get(p.id)!;
      return { id: p.id, headline: p.headline, maxChars: KNOWLEDGE_LEAD_PAGE_CHARS + pagesForChapter * KNOWLEDGE_READING_PAGE_CHARS, readingPages: pagesForChapter };
    }
    // 旧稿或无图稿的独立文字页：平分剩余预算，至少一页。
    const share = Math.max(1, Math.floor((budget.textPages.target - Array.from(extraPages.values()).reduce((a, b) => a + b, 0)) / Math.max(1, textOnly.length)));
    return { id: p.id, headline: p.headline, maxChars: share * KNOWLEDGE_READING_PAGE_CHARS, readingPages: share };
  });
  return { budget, pages: result };
}

/** 生图前预检：按两档已有资料估算页数，只提示不阻断（略超无妨）。 */
export function knowledgeEditionBudgetCheck(level: KnowledgeEditionLevel, imagePages: number, textChars: number) {
  const budget = knowledgeEditionPageBudget(level, imagePages);
  const estimated = Math.ceil(Math.max(0, textChars - imagePages * KNOWLEDGE_LEAD_PAGE_CHARS) / KNOWLEDGE_READING_PAGE_CHARS);
  const plannedTextPages = Math.min(budget.textPages.max, Math.max(level === "full" ? 0 : budget.textPages.min, Math.min(estimated, budget.textPages.target)));
  const warnings: string[] = [];
  if (!imagePages) warnings.push("尚无图片页，无法按图文比例排版");
  if (level === "concise" && estimated < budget.textPages.min)
    warnings.push(`精华版图外文字资料约${textChars}字，估计只够${estimated}页内文，低于建议的${budget.textPages.min}页；将据实排版，不硬凑篇幅`);
  if (level === "full" && estimated > budget.textPages.max)
    warnings.push(`完整版图外文字资料约${textChars}字，超出${budget.textPages.max}页内文上限（总页数≤${KNOWLEDGE_FULL_MAX_TOTAL_PAGES}）；审校将按预算合并去重`);
  if (level === "concise" && estimated > budget.textPages.max)
    warnings.push(`精华版图外文字资料约${textChars}字，超出${budget.textPages.max}页内文建议上限；审校将按预算合并去重，不重复图中内容`);
  return { budget, estimatedTextPages: estimated, plannedTextPages, plannedTotalPages: imagePages + plannedTextPages, warnings };
}

/** 发给审校/排版模型的预算说明。 */
export function knowledgeBudgetInstructions(level: KnowledgeEditionLevel | undefined, pages: { id: string; maxChars: number }[]) {
  if (!level || !pages.length) return "";
  const rule = level === "full"
    ? "本册为完整版：图片为主、文字为辅。每页reading只写图外补充（图中没画出的条件、因果、边界、读图提示）与supplement中的图外资料；图中已出现的表格、数字清单、步骤不得在reading里重打一遍，可用一句话指向图中位置。"
    : "本册为精华版：图少文多。reading详尽讲解次要重点与supplement资料，补足条件、因果与适用边界；图中已出现的表格、数字和要点不得重复抄写。";
  return `${rule}\n篇幅预算（中文字符，含表格单元格；稍超可以，明显超出须合并去重而不是删掉关键事实）：${JSON.stringify(pages.map(p => ({ id: p.id, maxChars: p.maxChars })))}`;
}
