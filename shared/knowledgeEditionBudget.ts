/**
 * 图文手册两档的页数预算（用户 2026-11-08 确认；2026-11-09 按敦煌 1108g2 膨胀复盘，用户拍板完整版照血脂做法）：
 * - 出图：每张图是一个章节/主题的核心图解，图内≤1200字；图数按主题定；档位只以图片张数区分：精华版≤30、超过 30 即完整版、完整版硬顶 48（KNOWLEDGE_TOPIC_IMAGE_CAP，用户 2026-11-09 改令）。
 * - 完整版（血脂基准 48 页全部图文同页、无独立内文页）：图片与该图对应内文合并在同一直式页（图在上、内文在下），
 *   **不排独立内文页**；预算页数 = 图片数。图外细节放不进图下栏时，在准备阶段给出压缩目标字数（审校合并提炼），
 *   而不是把溢出文字排成续页；排版时极少数图注过长才允许 +1 续页，且必须在回执里报出（readingPages>0 即为续页）。
 *   1108g2 复盘：旧预算把「≤72」当目标（56 页内文），16 张图排成 66–72 页；现在 72 只作硬顶，正常不会触及。
 * - 精华版：图片页:纯内文页 ≈ 1:2 至 1:3 维持不变；内文可详尽，但不重复图中已表达的内容。
 * 预算在生图前计算（两档准备阶段展示、审校请求携带），不在导出后才阻断。
 */
import { KNOWLEDGE_TOPIC_IMAGE_CAP, KNOWLEDGE_TOPIC_IMAGE_MAX_CHARS } from "./knowledgeTopicImagePlan";
import { knowledgeHandbookPagePlan, knowledgeFullPageRange } from "./knowledgeHandbookPagePlan";

export type KnowledgeEditionLevel = "full" | "concise";

/**
 * 正文合同 image-primary-v1（用户 2026-11-11：「主要重点生成在图片中，次要重点用文字说明」）。
 * 只写进新建稿件的 source.readingContract；旧稿不带此字段，审校/排版请求文字与摘要都不变，已有回执零调用复用。
 */
export const KNOWLEDGE_READING_CONTRACT = "image-primary-v1" as const;
export type KnowledgeReadingContract = typeof KNOWLEDGE_READING_CONTRACT;
export const KNOWLEDGE_IMAGE_PRIMARY_MARKER = "【图主文辅合同v1】";
export const KNOWLEDGE_IMAGE_PRIMARY_INSTRUCTIONS = `${KNOWLEDGE_IMAGE_PRIMARY_MARKER}
本合同只适用于带实际配图的页（role=illustration 或有 imageJobId）；无图的文字页照常完整整理。
这些页的主要重点已画进同页上方的信息图：该页 body 原文就是图中文字，读者在同一页就能看到。正文（body 与 reading）只承担次要重点：图中没有的背景、原因与前提条件、具体例子、操作注意事项与适用边界，以及 supplement 中的图外资料。
本合同优先于上文“body 保留关键事实、数字”的要求：逐句自查，凡是图中已有的要点、数字、表格行、清单项、步骤和口号，不得在正文中改写重述；确需承接时全章最多一句话带过，且不带图中的数字与表格内容。
不写“读图提示”“对应左上角某卡”“图中已列……此处补……”之类指向图中位置的说明。
没有图外资料时，reading 只写 1–3 句真正补充的背景或注意事项，宁短勿凑；篇幅上限不是目标字数，留白由版式处理。`;

/** 直式页图片下方要点区的保守容量（中文字符，含小标题/表格开销）；完整版每图内文上限即此值。 */
export const KNOWLEDGE_LEAD_PAGE_CHARS = 700;
/** 一整页纯内文（两栏）的保守容量（精华版内文页与估算续页用）。 */
export const KNOWLEDGE_READING_PAGE_CHARS = 1300;
/** 单张图片内的文字上限沿用出图分页上限。 */
export const KNOWLEDGE_IMAGE_TEXT_MAX_CHARS = KNOWLEDGE_TOPIC_IMAGE_MAX_CHARS;
/** 完整版总页数硬顶（用户原口径 ≤72，可精简不可多）；图文同页后正常不会触及。仅旧预算（无 readingBudgetVersion 的稿）沿用。 */
export const KNOWLEDGE_FULL_MAX_TOTAL_PAGES = 72;

/**
 * 审校预算版本 2（站长 2026-11-20 23:20：「必须要压缩到三十页左右，也就是最多八十页」）。
 * 只写在 publication.readingBudgetVersion 上（不进 source，原稿摘要不变），在首次开始审校时写入、之后各批沿用；
 * 无该字段 = 旧预算，请求文字、摘要与预算数值逐字不变。只对 readingContract=image-primary-v1 的稿生效。
 * 两档总页数上限 80：完整版文字续页 ≤30、精华版 ≤50，且都不超过 80 − 图数。
 */
export const KNOWLEDGE_READING_BUDGET_VERSION = 2 as const;
export type KnowledgeReadingBudgetVersion = typeof KNOWLEDGE_READING_BUDGET_VERSION;
export const KNOWLEDGE_EDITION_MAX_TOTAL_PAGES_V2 = 80;
export const KNOWLEDGE_TEXT_PAGE_CAP_V2: Record<KnowledgeEditionLevel, number> = { full: 30, concise: 50 };
/** 新预算下的文字续页预算：min(档位上限, 80 − 图数)，图数 ≥80 时为 0。 */
export function knowledgeTextPageBudgetV2(level: KnowledgeEditionLevel, images: number) {
  return Math.max(0, Math.min(KNOWLEDGE_TEXT_PAGE_CAP_V2[level], KNOWLEDGE_EDITION_MAX_TOTAL_PAGES_V2 - images));
}
const usesBudgetV2 = (contract: KnowledgeReadingContract | undefined, version: KnowledgeReadingBudgetVersion | undefined) =>
  contract === KNOWLEDGE_READING_CONTRACT && version === KNOWLEDGE_READING_BUDGET_VERSION;

export type KnowledgePageBudget = {
  level: KnowledgeEditionLevel;
  imagePages: number;
  /** 纯内文页（不含图文同页的图片页）。完整版恒为 0：不排独立内文页。 */
  textPages: { min: number; target: number; max: number };
  totalPages: { min: number; target: number; max: number };
};

export function knowledgeEditionPageBudget(level: KnowledgeEditionLevel, imagePages: number, budgetVersion?: KnowledgeReadingBudgetVersion): KnowledgePageBudget {
  if (!Number.isSafeInteger(imagePages) || imagePages < 0) throw new Error("图片页数无效");
  const n = imagePages;
  if (budgetVersion === KNOWLEDGE_READING_BUDGET_VERSION) {
    // 新预算：文字续页按「提炼后约 30 页（精华版 50 页）、总页数 ≤80」给，不再与图数成比例。
    const t = knowledgeTextPageBudgetV2(level, n);
    return { level, imagePages: n, textPages: { min: 0, target: t, max: t }, totalPages: { min: n, target: n + t, max: n + t } };
  }
  // 完整版：图文同页，预算 = 图片数，独立内文页 0（续页只在排版实测时报出，不进预算）。精华版 1:2–1:3，目标 2.5 倍。
  const textPages = level === "full"
    ? { min: 0, target: 0, max: 0 }
    : { min: 2 * n, target: Math.round(n * 2.5), max: 3 * n };
  return {
    level, imagePages: n, textPages,
    totalPages: { min: n + textPages.min, target: n + textPages.target, max: n + textPages.max },
  };
}

/**
 * 不含空白的字数，与 `value.replace(/\s+/g, "").length` 逐码元等价（JS \s：制表/换行/垂直制表/换页/回车/空格、
 * U+00A0、U+1680、U+2000–U+200A、U+2028、U+2029、U+202F、U+205F、U+3000、U+FEFF），但不生成新字符串。
 * 1121 演练：200 章 × 5.5 万字图外内文时，预算函数每次都对全部图外内文跑正则替换，单批整理约 0.18 秒 CPU 花在这里。
 */
export function knowledgeNonWhitespaceLength(value: string) {
  let spaces = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x20 ? (c === 0x20 || (c >= 0x09 && c <= 0x0d)) :
        c >= 0xa0 && (c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff)) spaces++;
  }
  return value.length - spaces;
}
/**
 * 图外内文字数的请求内缓存：同一次请求里预算会对同一批原稿页的图外内文算 4–6 次（审校指令、输出合同、篇幅核对前后、建议字数）。
 * 以页对象为键（WeakMap，页对象随请求释放，不长期占内存），并核对图外内文仍是同一字符串——页被改过就重算，结果逐字等价。
 */
const offImageCache = new WeakMap<object, { supplement: string; count: number }>();
function supplementNonWhitespaceLength(page: { supplement?: string }) {
  const supplement = page.supplement || "";
  const hit = offImageCache.get(page);
  if (hit && hit.supplement === supplement) return hit.count;
  const count = knowledgeNonWhitespaceLength(supplement);
  offImageCache.set(page, { supplement, count });
  return count;
}
export type KnowledgeBudgetPage = { id: string; headline: string; body: string; supplement?: string; imageUrl?: string; imageJobId?: string; role?: "reading" | "illustration" };

const hasImage = (p: KnowledgeBudgetPage) => Boolean(p.imageJobId || p.imageUrl || p.role === "illustration");

/**
 * 每章 reading 字数上限（含表格），供审校与排版模型遵守。
 * 完整版：每个图文章只有图下一栏（KNOWLEDGE_LEAD_PAGE_CHARS），readingPages 恒为 0——不给任何章节续页预算。
 * 精华版：按图外资料多少把纯内文页分给各章，使每章要么只占图文同页，要么同页 + 若干填满的续页，减少半页留白。
 */
export function knowledgeReadingCharBudgets(level: KnowledgeEditionLevel, pages: KnowledgeBudgetPage[], contract?: KnowledgeReadingContract, budgetVersion?: KnowledgeReadingBudgetVersion) {
  if (usesBudgetV2(contract, budgetVersion)) return knowledgeReadingCharBudgetsV2(level, pages);
  // 新合同完整版（用户 2026-11-11：34 图总页数 48–54）：按页数预算分配跨页/图文同页，每章正文上限 = 本章版面容量；
  // 旧稿与精华版不变（旧稿请求身份不变）。
  if (contract === KNOWLEDGE_READING_CONTRACT && level === "full") {
    const plan = knowledgeHandbookPagePlan(level, pages.map(p => ({ id: p.id, body: p.body, hasImage: hasImage(p) })));
    const modes = new Map(plan.chapters.map(c => [c.id, c]));
    return { budget: knowledgeEditionPageBudget(level, plan.images), plan, pages: pages.map(p => {
      const chapter = modes.get(p.id)!;
      return { id: p.id, headline: p.headline, maxChars: chapter.maxChars, readingPages: 0, mode: chapter.mode, imageTargetChars: knowledgeImagePrimaryTarget(p, chapter.maxChars) };
    }) };
  }
  const illustrated = pages.filter(hasImage);
  const budget = knowledgeEditionPageBudget(level, illustrated.length);
  const material = (p: KnowledgeBudgetPage) => {
    const extra = supplementNonWhitespaceLength(p);
    const inImage = knowledgeNonWhitespaceLength(p.body);
    return extra + 0.5 * inImage;
  };
  const extraPages = new Map<string, number>(illustrated.map(p => [p.id, 0]));
  const remaining = new Map<string, number>(illustrated.map(p => [p.id, Math.max(0, material(p) - KNOWLEDGE_LEAD_PAGE_CHARS)]));
  for (let k = 0; k < budget.textPages.target && illustrated.length; k++) {
    let best = illustrated[0]!.id, bestValue = -Infinity;
    for (const p of illustrated) {
      const value = remaining.get(p.id)!;
      if (value > bestValue) { best = p.id; bestValue = value; }
    }
    extraPages.set(best, extraPages.get(best)! + 1);
    remaining.set(best, bestValue - KNOWLEDGE_READING_PAGE_CHARS);
  }
  const textOnly = pages.filter(p => !hasImage(p));
  const result = pages.map(p => {
    if (hasImage(p)) {
      const pagesForChapter = extraPages.get(p.id)!;
      const maxChars = KNOWLEDGE_LEAD_PAGE_CHARS + pagesForChapter * KNOWLEDGE_READING_PAGE_CHARS;
      return { id: p.id, headline: p.headline, maxChars, readingPages: pagesForChapter, imageTargetChars: knowledgeImagePrimaryTarget(p, maxChars) };
    }
    // 旧稿或无图稿的独立文字页：平分剩余预算，至少一页（两档手册的独立文字模块已并入图文章，正常不会走到这里）。
    const share = Math.max(1, Math.floor((budget.textPages.target - Array.from(extraPages.values()).reduce((a, b) => a + b, 0)) / Math.max(1, textOnly.length)));
    return { id: p.id, headline: p.headline, maxChars: share * KNOWLEDGE_READING_PAGE_CHARS, readingPages: share };
  });
  return { budget, pages: result };
}

/** 新预算下一章值得多给一页续页的最少剩余图外资料（半页）；资料很少的章不强行给续页。 */
const KNOWLEDGE_V2_MIN_REMAINING_FOR_PAGE = Math.round(KNOWLEDGE_READING_PAGE_CHARS / 2);
const offImageChars = (p: KnowledgeBudgetPage) => supplementNonWhitespaceLength(p);

/**
 * 新预算（v2）每章正文上限 = 图下一栏 700 字 + 本章续页 × 1300 字。续页总数 = knowledgeTextPageBudgetV2；
 * 按各章图外资料（supplement）贪心分配：每次给剩余资料最多的章一页，剩余不足半页的章不再给（宁可少用预算也不凑字）。
 * 同剩余量按章序先给，结果确定。无图的独立文字页（两档手册正常不会出现）各给一页。
 */
function knowledgeReadingCharBudgetsV2(level: KnowledgeEditionLevel, pages: KnowledgeBudgetPage[]) {
  const illustrated = pages.filter(hasImage);
  const budget = knowledgeEditionPageBudget(level, illustrated.length, KNOWLEDGE_READING_BUDGET_VERSION);
  const extraPages = new Map<string, number>(illustrated.map(p => [p.id, 0]));
  const remaining = new Map<string, number>(illustrated.map(p => [p.id, offImageChars(p) - KNOWLEDGE_LEAD_PAGE_CHARS]));
  for (let k = 0; k < budget.textPages.target && illustrated.length; k++) {
    let best = "", bestValue = -Infinity;
    for (const p of illustrated) {
      const value = remaining.get(p.id)!;
      if (value > bestValue) { best = p.id; bestValue = value; }
    }
    if (bestValue < KNOWLEDGE_V2_MIN_REMAINING_FOR_PAGE) break;
    extraPages.set(best, extraPages.get(best)! + 1);
    remaining.set(best, bestValue - KNOWLEDGE_READING_PAGE_CHARS);
  }
  const result = pages.map(p => {
    const readingPages = hasImage(p) ? extraPages.get(p.id)! : 1;
    const maxChars = (hasImage(p) ? KNOWLEDGE_LEAD_PAGE_CHARS : 0) + readingPages * KNOWLEDGE_READING_PAGE_CHARS;
    return { id: p.id, headline: p.headline, maxChars, readingPages, mode: "inline" as const, imageTargetChars: knowledgeImagePrimaryTarget(p, maxChars), offImageChars: offImageChars(p) };
  });
  const plan = knowledgeHandbookPagePlan(level, pages.map(p => ({ id: p.id, body: p.body, hasImage: hasImage(p) })), KNOWLEDGE_READING_BUDGET_VERSION);
  return { budget, plan, budgetVersion: KNOWLEDGE_READING_BUDGET_VERSION, pages: result };
}

/**
 * 图主文辅合同下的建议字数：按图外资料（supplement）多少定，不按上限定——资料少就写短，不拿图中内容凑字数。
 * 约为图外资料的九成再加一两句背景（120 字），封顶为上限的九成。
 */
export function knowledgeImagePrimaryTarget(page: Pick<KnowledgeBudgetPage, "supplement">, maxChars: number) {
  const offImage = supplementNonWhitespaceLength(page);
  return Math.max(120, Math.min(Math.floor(maxChars * KNOWLEDGE_BUDGET_PROMPT_MARGIN), Math.round(offImage * 0.9) + 120));
}

/** 完整版图下容量不够时的压缩方案（准备阶段报出，不自行加图）。 */
export type KnowledgeCompressionPlan = {
  /** 当前图数下图下栏合计可容纳的内文字数（图数 × 每图图下容量）。 */
  readingCapacityChars: number;
  /** 需压缩到的内文字数（= readingCapacityChars）。 */
  targetReadingChars: number;
  /** 需压缩到的比例（0–1，相对当前内文字数）。 */
  ratio: number;
  /** 需删减/提炼掉的内文字数。 */
  excessChars: number;
  /** 不压缩内文时需要的图数（每图 = 图内 1200 字 + 图下容量），供用户对比。 */
  imagesForNoLoss: number;
  /** 本档图数硬顶；imagesForNoLoss 超过它时只能压缩。 */
  imageCap: number;
};

/** 完整版：全部内文（图外细节 + 独立文字模块）必须装进各图下栏；图内文字另算（≤1200/图）。 */
export function knowledgeFullCompressionPlan(imagePages: number, readingChars: number, imageChars = 0): KnowledgeCompressionPlan | null {
  // 准备阶段只展示（不参与请求身份），直接按新预算口径：图下一栏 + 约 30 页文字续页（总页数 ≤80）。
  const readingCapacityChars = imagePages * KNOWLEDGE_LEAD_PAGE_CHARS + knowledgeTextPageBudgetV2("full", imagePages) * KNOWLEDGE_READING_PAGE_CHARS;
  if (readingChars <= readingCapacityChars) return null;
  const totalChars = readingChars + imageChars;
  return {
    readingCapacityChars,
    targetReadingChars: readingCapacityChars,
    ratio: readingChars ? readingCapacityChars / readingChars : 1,
    excessChars: readingChars - readingCapacityChars,
    imagesForNoLoss: Math.ceil(totalChars / (KNOWLEDGE_IMAGE_TEXT_MAX_CHARS + KNOWLEDGE_LEAD_PAGE_CHARS)),
    imageCap: KNOWLEDGE_TOPIC_IMAGE_CAP.full,
  };
}

/**
 * 生图前预检：按两档已有资料估算页数，只提示不阻断（只展示，不参与请求身份）。
 * 站长 2026-11-20 23:20 口径（新稿审校预算 v2）：两档总页数 ≤80；完整版 = 图文同页 + 约 30 页文字续页，精华版文字续页 ≤50 页；
 * 图外内文远多于容量时报出需提炼到的字数与比例（提炼，不是截断），不自行加图。imageChars 为各图图内文字合计（可选）。
 */
export function knowledgeEditionBudgetCheck(level: KnowledgeEditionLevel, imagePages: number, textChars: number, imageChars = 0) {
  const budget = knowledgeEditionPageBudget(level, imagePages, KNOWLEDGE_READING_BUDGET_VERSION);
  const estimated = Math.ceil(Math.max(0, textChars - imagePages * KNOWLEDGE_LEAD_PAGE_CHARS) / KNOWLEDGE_READING_PAGE_CHARS);
  const plannedTextPages = Math.min(budget.textPages.max, estimated);
  const warnings: string[] = [];
  const compression = level === "full" ? knowledgeFullCompressionPlan(imagePages, textChars, imageChars) : null;
  if (!imagePages) warnings.push("尚无图片页，无法按图文比例排版");
  if (compression) {
    const alternative = compression.imagesForNoLoss > compression.imageCap
      ? `不提炼需约${compression.imagesForNoLoss}张图，超过完整版上限${compression.imageCap}张，只能提炼`
      : `或改为${compression.imagesForNoLoss}张图（≤上限${compression.imageCap}张）可少提炼，需用户拍板，不自行加图`;
    warnings.push(`完整版全册最多${KNOWLEDGE_EDITION_MAX_TOTAL_PAGES_V2}页：${imagePages}张图图文同页，另有文字续页约${budget.textPages.target}页，正文合计可容约${compression.readingCapacityChars}字；图外内文资料约${textChars}字，审校须提炼到约${compression.targetReadingChars}字（约原来的${knowledgePercent(compression.ratio)}%），提炼出背景、原因、条件、例子与注意事项，不是截断，不重复图中内容；${alternative}`);
  }
  if (level === "concise" && estimated > budget.textPages.max)
    warnings.push(`精华版全册最多${KNOWLEDGE_EDITION_MAX_TOTAL_PAGES_V2}页：图外文字资料约${textChars}字，超出${budget.textPages.max}页文字续页的容量；审校将提炼要点、合并去重，不重复图中内容`);
  return { budget, estimatedTextPages: estimated, plannedTextPages, plannedTotalPages: imagePages + plannedTextPages, warnings, compression };
}
/** 比例显示为百分数：≥10% 取整，不足 10% 保留一位小数（160 万字提炼到 7 万字时不显示成 0%）。 */
const knowledgePercent = (ratio: number) => (ratio >= 0.1 ? Math.round(ratio * 100) : Math.round(ratio * 1000) / 10);

/** 发给审校/排版模型的预算说明。 */
export function knowledgeBudgetInstructions(level: KnowledgeEditionLevel | undefined, pages: { id: string; maxChars: number; imageTargetChars?: number; offImageChars?: number }[], contract?: KnowledgeReadingContract, budgetVersion?: KnowledgeReadingBudgetVersion) {
  if (!level || !pages.length) return "";
  if (usesBudgetV2(contract, budgetVersion)) return knowledgeBudgetInstructionsV2(level, pages);
  // 新合同：上限只是上限，建议字数按图外资料多少给出；旧稿保持原文字不变（请求身份不变）。
  if (contract === KNOWLEDGE_READING_CONTRACT)
    return `${level === "full" ? "本册为完整版：图片为主、文字为辅，图片与该图内文合并在同一页。" : "本册为精华版：图少文多，无图文字页照常详尽。"}带图页reading只写图中没有的次要重点与supplement图外资料（见${KNOWLEDGE_IMAGE_PRIMARY_MARKER}）；maxChars是上限不是目标，按suggestedChars左右写，图外资料少就写短。\n篇幅（中文字符，含表格单元格）：${JSON.stringify(pages.map(p => ({ id: p.id, maxChars: p.maxChars, ...(p.imageTargetChars ? { suggestedChars: p.imageTargetChars } : {}) })))}`;
  const rule = level === "full"
    ? `本册为完整版：图片为主、文字为辅，图片与该图内文合并在同一页，不排独立内文页。每页reading必须装进图下一栏（≤maxChars，约${KNOWLEDGE_LEAD_PAGE_CHARS}字），只写图外补充（图中没画出的条件、因果、边界、读图提示）与supplement中的图外资料，资料多时合并去重、提炼成要点；图中已出现的表格、数字清单、步骤不得在reading里重打一遍，可用一句话指向图中位置。`
    : "本册为精华版：图少文多。reading详尽讲解次要重点与supplement资料，补足条件、因果与适用边界；图中已出现的表格、数字和要点不得重复抄写。";
  const tolerance = level === "full" ? "超出即会溢出为续页，须压缩进上限" : "稍超可以，明显超出须合并去重而不是删掉关键事实";
  return `${rule}\n篇幅预算（中文字符，含表格单元格；${tolerance}）：${JSON.stringify(pages.map(p => ({ id: p.id, maxChars: p.maxChars })))}`;
}

/**
 * 新预算（v2）的审校篇幅说明：告诉模型本章正文上限；图外资料远多于上限时提炼最重要的说明（背景、原因、条件、例子、注意事项），
 * 不截断、不与图中内容重复。旧预算的文字不动。
 */
function knowledgeBudgetInstructionsV2(level: KnowledgeEditionLevel, pages: { id: string; maxChars: number; offImageChars?: number }[]) {
  const edition = level === "full"
    ? `本册为完整版：图片为主、文字为辅，全册最多${KNOWLEDGE_EDITION_MAX_TOTAL_PAGES_V2}页——每张图与该章正文同页（图在上、正文在下），正文放不下的接续到后面的文字页，全册文字续页合计约${KNOWLEDGE_TEXT_PAGE_CAP_V2.full}页。`
    : `本册为精华版：图少文多，全册最多${KNOWLEDGE_EDITION_MAX_TOTAL_PAGES_V2}页，文字续页合计约${KNOWLEDGE_TEXT_PAGE_CAP_V2.concise}页。`;
  return `${edition}每章正文（reading）的上限 maxChars 已按全册页数与各章图外资料多少分好：资料多的章上限大，资料少的章只有图下一栏。\n` +
    `写法：带图页正文只写图中没有的内容（见${KNOWLEDGE_IMAGE_PRIMARY_MARKER}）。图外资料（supplement，offImageChars 为其字数）远多于上限时，要从中提炼出最重要的说明——背景、原因、前提条件、具体例子、注意事项与适用边界——用自己的话组织成连贯的正文，写到上限附近；不是截断原文、不是只取开头，也不是逐段缩写。图外资料少于上限时据实写短，不凑字数。图中已有的要点、数字、表格行与步骤不得重复。\n` +
    `篇幅（中文字符，含表格单元格）：${JSON.stringify(pages.map(p => ({ id: p.id, maxChars: p.maxChars, ...(p.offImageChars !== undefined ? { offImageChars: p.offImageChars } : {}) })))}`;
}

/**
 * 审校稿篇幅容差（2026-11-09 用户拍板 B）：某页超出 maxChars 不超过该比例视为合格收下，超出部分交篇幅压缩
 * （函数去重 → 仍超才三跳 LLM）；超出该比例才算写坏切下一跳。可调。
 */
export const KNOWLEDGE_BUDGET_TOLERANCE = 0.15;
/** 该页超出是否仍在容差内（边界含等号：700 字上限时 805 字收下、806 字切跳）。 */
export const knowledgeBudgetWithinTolerance = (chars: number, maxChars: number, tolerance = KNOWLEDGE_BUDGET_TOLERANCE) => chars <= Math.floor(Math.round(maxChars * (1 + tolerance) * 1e6) / 1e6); // 去浮点误差：700×1.15 = 805
/**
 * 篇幅压缩提示词目标 = 上限 × 该比例（2026-11-09 用户选定：700 字上限写 595 字目标，减少「仍超出→连切多跳」）；
 * 验收仍按真实上限（≤maxChars 收下，超出才切下一跳）。可调。
 */
export const KNOWLEDGE_COMPRESSION_TARGET_RATIO = 0.85;
/** 提示词目标留 10% 余量，校验按 maxChars。 */
export const KNOWLEDGE_BUDGET_PROMPT_MARGIN = 0.9;
/**
 * 审校输出合同中的篇幅硬约束（完整版图文同页）：每页 reading 生成稿必须 ≤maxChars；路由按此逐页校验，超出即判写坏切下一跳。
 * 精华版允许续页，不加硬约束。
 */
export function knowledgeBudgetOutputContract(level: KnowledgeEditionLevel | undefined, pages: { id: string; headline: string; maxChars: number; imageTargetChars?: number }[], contract?: KnowledgeReadingContract, budgetVersion?: KnowledgeReadingBudgetVersion) {
  if (level && pages.length && usesBudgetV2(contract, budgetVersion))
    return `输出合同·篇幅（硬约束，程序逐页校验）：每页 pages[i].reading 的生成稿字数（中文字符，不含空白；副标题、小标题、表格、清单与图注全部计入）必须 ≤ 该页 maxChars。图外资料远多于上限时，按上一段要求提炼出最重要的说明写满上限附近，不是截断原文；资料少就写短，不得用图中已有内容凑字数。任一页超出即判不合格。逐页：${JSON.stringify(pages.map(p => ({ id: p.id, headline: p.headline, maxChars: p.maxChars })))}`;
  if (level !== "full" || !pages.length) return "";
  if (contract === KNOWLEDGE_READING_CONTRACT)
    return `输出合同·篇幅（硬约束，程序逐页校验）：每页 pages[i].reading 的生成稿字数（中文字符，不含空白；副标题、小标题、表格、清单与图注全部计入）必须 ≤ 该页 maxChars；suggestedChars 是按图外资料估的建议值，可以更短，不得用图中已有内容凑字数。任一页超出即判不合格。超了先删与图中重复的句子、表格与清单。逐页：${JSON.stringify(pages.map(p => ({ id: p.id, headline: p.headline, maxChars: p.maxChars, suggestedChars: p.imageTargetChars ?? Math.floor(p.maxChars * KNOWLEDGE_BUDGET_PROMPT_MARGIN) })))}`;
  return `输出合同·篇幅（硬约束，程序逐页校验）：每页 pages[i].reading 的生成稿字数（中文字符，不含空白；副标题、各节小标题、表格表头与单元格、清单标题与正文、图注全部计入）必须 ≤ 该页 maxChars，按 targetChars 写；body 与 reading 同内容。任一页超出即整份回答判为不合格、换通道重做。输出前逐页自数一遍，超了就删与图中重复的表格/清单、合并并列例子，不截断半句、不删图外关键事实。逐页上限：${JSON.stringify(pages.map(p => ({ id: p.id, headline: p.headline, maxChars: p.maxChars, targetChars: Math.floor(p.maxChars * KNOWLEDGE_BUDGET_PROMPT_MARGIN) })))}`;
}

/** 审校后逐页核对：reading 实际字数（不含空白）对照各页预算，返回超出的页。 */
/** minChars 只在「正文偏少、需扩写」的标记上出现（此时 excess 为 0，maxChars 为扩写上限）。 */
export type KnowledgeReadingOverflow = { id: string; headline: string; chars: number; maxChars: number; excess: number; minChars?: number };
export function knowledgeReadingOverflow(
  level: KnowledgeEditionLevel | undefined,
  pages: KnowledgeBudgetPage[],
  reviewed: readonly { id: string; chars: number }[],
  contract?: KnowledgeReadingContract,
  budgetVersion?: KnowledgeReadingBudgetVersion,
): KnowledgeReadingOverflow[] {
  if (!level) return [];
  const budgets = new Map<string, { headline: string; maxChars: number }>(knowledgeReadingCharBudgets(level, pages, contract, budgetVersion).pages.map(p => [p.id, p]));
  return reviewed.flatMap(r => {
    const budget = budgets.get(r.id);
    if (!budget || r.chars <= budget.maxChars) return [];
    return [{ id: r.id, headline: budget.headline, chars: r.chars, maxChars: budget.maxChars, excess: r.chars - budget.maxChars }];
  });
}

/** 压缩请求的说明：只对超出页，按各页 maxChars 提炼，不删关键事实、不重复图中内容。 */
export function knowledgeCompressionInstructions(level: KnowledgeEditionLevel, overflow: readonly KnowledgeReadingOverflow[], budgetVersion?: KnowledgeReadingBudgetVersion) {
  // 新预算的上限含续页，不能再说「图下一栏」；旧预算文字逐字不变。
  const target = level === "full" && budgetVersion !== KNOWLEDGE_READING_BUDGET_VERSION ? `图下一栏（每页约${KNOWLEDGE_LEAD_PAGE_CHARS}字）` : "本页预算";
  return `这是篇幅压缩：以下各页审校后的reading超出${target}，须把每页reading压缩到不超过该页maxChars（中文字符，不含空白；含表格单元格与小标题）。合并去重、提炼成要点、删除与图中已画出内容重复的表格/清单/步骤，保留全部关键事实、数字、条件与边界；不新增事实、不改变结论、不写“详见图中”以外的空话。body与reading表达相同内容。沿用knowledge_publication_v1 JSON合同，pages与输入同id同顺序、一个不少。各页目标：${JSON.stringify(overflow.map(o => ({ id: o.id, chars: o.chars, maxChars: o.maxChars })))}`;
}

/**
 * 统稿后「哪些章要压缩」的标记（站长 2026-11-13：不必每章都压缩；放宽为一章可占两页，但两页的留白不得超过四分之一页；
 * 需要压缩的章先标记好，再分四路并发（两通道各两路））。只用于新合同完整版的整册补压；审校阶段的建议字数不变。
 * - 一页容量：带表格的章按 KNOWLEDGE_LEAD_PAGE_CHARS（700，实测带 5 行表格约 700–730）；
 *   纯段落的章按 KNOWLEDGE_LEAD_PROSE_PAGE_CHARS（实测满幅图下约 1130 字，留一成余量）。字数略超时版式会先等比例缩图收进同页。
 * - 两页容量：一页容量 + 一整页续页 KNOWLEDGE_READING_PAGE_CHARS；两页留白 ≤ 1/4 页 ⇒ 字数不少于「一页容量 + 续页 × 3/4」。
 * - 两页名额 = 完整版总页数上限（图数 × 1.59，≤72）− 章数；字数最多的章优先占用，名额用完的章仍按一页处理。
 * 返回要压缩的章及其目标上限：占两页仍超的压到两页容量；其余超过一页容量的压到一页容量；放得下的不出现在结果里（不调模型）。
 */
export const KNOWLEDGE_LEAD_PROSE_PAGE_CHARS = 1000;
export const KNOWLEDGE_TWO_PAGE_MAX_BLANK = 0.25;
export function knowledgeFinalCompressionMarks(
  pages: KnowledgeBudgetPage[],
  reviewed: readonly { id: string; chars: number; hasTable: boolean }[],
  budgetVersion?: KnowledgeReadingBudgetVersion,
): KnowledgeReadingOverflow[] {
  const headline = new Map(pages.map(p => [p.id, p.headline]));
  if (budgetVersion === KNOWLEDGE_READING_BUDGET_VERSION) {
    // 新预算：每章上限已含分到的续页（审校请求同一组数值），超出才压；只有图下一栏的章仍按「留白过多就扩写」标记。
    const budgets = new Map(knowledgeReadingCharBudgetsV2("full", pages).pages.map(p => [p.id, p]));
    return reviewed.flatMap(r => {
      const b = budgets.get(r.id);
      if (!b) return [];
      if (r.chars > b.maxChars) return [{ id: r.id, headline: headline.get(r.id) || "", chars: r.chars, maxChars: b.maxChars, excess: r.chars - b.maxChars }];
      const one = r.hasTable ? KNOWLEDGE_LEAD_PAGE_CHARS : KNOWLEDGE_LEAD_PROSE_PAGE_CHARS;
      const minChars = Math.ceil(one * (1 - 2 * KNOWLEDGE_TWO_PAGE_MAX_BLANK));
      if (!b.readingPages && r.chars < minChars) return [{ id: r.id, headline: headline.get(r.id) || "", chars: r.chars, maxChars: b.maxChars, excess: 0, minChars }];
      return [];
    });
  }
  const range = knowledgeFullPageRange(pages.filter(hasImage).length);
  const slots = Math.max(0, (range?.max ?? reviewed.length) - reviewed.length);
  const one = (r: { hasTable: boolean }) => (r.hasTable ? KNOWLEDGE_LEAD_PAGE_CHARS : KNOWLEDGE_LEAD_PROSE_PAGE_CHARS);
  const twoMin = (r: { hasTable: boolean }) => one(r) + Math.ceil(KNOWLEDGE_READING_PAGE_CHARS * (1 - KNOWLEDGE_TWO_PAGE_MAX_BLANK));
  const twoMax = (r: { hasTable: boolean }) => one(r) + KNOWLEDGE_READING_PAGE_CHARS;
  // 字数够填满两页（留白 ≤ 1/4）的章按字数从多到少占两页名额；同字数按章序，保证确定。
  const twoPage = new Set(reviewed.map((r, index) => ({ r, index })).filter(({ r }) => r.chars >= twoMin(r))
    .sort((a, b) => b.r.chars - a.r.chars || a.index - b.index).slice(0, slots).map(({ r }) => r.id));
  return reviewed.flatMap(r => {
    const maxChars = twoPage.has(r.id) ? twoMax(r) : one(r);
    if (r.chars > maxChars) return [{ id: r.id, headline: headline.get(r.id) || "", chars: r.chars, maxChars, excess: r.chars - maxChars }];
    // 正文偏少（站长 2026-11-13：文字不够就扩写）：一页章的图下留白超过 1/4 页（图下正文区约占半页 ⇒ 字数不足一页容量的一半）时标记扩写，上限为一页容量。
    const minChars = Math.ceil(one(r) * (1 - 2 * KNOWLEDGE_TWO_PAGE_MAX_BLANK));
    if (!twoPage.has(r.id) && r.chars < minChars) return [{ id: r.id, headline: headline.get(r.id) || "", chars: r.chars, maxChars, excess: 0, minChars }];
    return [];
  });
}
/**
 * 扩写指令（站长 2026-11-13：文字不够就扩写；扩写的资料必须来自联网检索，不靠模型编造）。
 * 调用方须同时带上联网检索指令（KNOWLEDGE_RESEARCH_INSTRUCTIONS）：路由先联网搜索，再只用检索到的真实资料与原稿扩写。
 */
export function knowledgeExpansionInstructions(marks: readonly KnowledgeReadingOverflow[]) {
  return `这是篇幅扩写：以下各页审校后的reading偏短，版面会留下大片空白，须把每页reading扩写到不少于该页minChars、且不超过该页maxChars（中文字符，不含空白；含表格单元格与小标题）。扩写内容只能来自两处：原稿中尚未写进图和正文的资料，以及随本批提供的真实联网检索资料（补背景、成因、影响、具体例子），并按来源规则标注。没有可用资料的页保持原样、原字数输出，不为凑字数编造；不得杜撰数字、日期、引文、人名与出处；不复述图中已画出的内容；不改动、不删除已有内容的事实与结论。body与reading表达相同内容。沿用knowledge_publication_v1 JSON合同。各页目标：${JSON.stringify(marks.map(o => ({ id: o.id, headline: o.headline, minChars: o.minChars, maxChars: o.maxChars })))}`;
}
