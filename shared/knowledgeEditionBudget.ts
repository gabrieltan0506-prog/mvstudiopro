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
import { knowledgeHandbookPagePlan } from "./knowledgeHandbookPagePlan";

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
/** 完整版总页数硬顶（用户原口径 ≤72，可精简不可多）；图文同页后正常不会触及。 */
export const KNOWLEDGE_FULL_MAX_TOTAL_PAGES = 72;

export type KnowledgePageBudget = {
  level: KnowledgeEditionLevel;
  imagePages: number;
  /** 纯内文页（不含图文同页的图片页）。完整版恒为 0：不排独立内文页。 */
  textPages: { min: number; target: number; max: number };
  totalPages: { min: number; target: number; max: number };
};

export function knowledgeEditionPageBudget(level: KnowledgeEditionLevel, imagePages: number): KnowledgePageBudget {
  if (!Number.isSafeInteger(imagePages) || imagePages < 0) throw new Error("图片页数无效");
  const n = imagePages;
  // 完整版：图文同页，预算 = 图片数，独立内文页 0（续页只在排版实测时报出，不进预算）。精华版 1:2–1:3，目标 2.5 倍。
  const textPages = level === "full"
    ? { min: 0, target: 0, max: 0 }
    : { min: 2 * n, target: Math.round(n * 2.5), max: 3 * n };
  return {
    level, imagePages: n, textPages,
    totalPages: { min: n + textPages.min, target: n + textPages.target, max: n + textPages.max },
  };
}

export type KnowledgeBudgetPage = { id: string; headline: string; body: string; supplement?: string; imageUrl?: string; imageJobId?: string; role?: "reading" | "illustration" };

const hasImage = (p: KnowledgeBudgetPage) => Boolean(p.imageJobId || p.imageUrl || p.role === "illustration");

/**
 * 每章 reading 字数上限（含表格），供审校与排版模型遵守。
 * 完整版：每个图文章只有图下一栏（KNOWLEDGE_LEAD_PAGE_CHARS），readingPages 恒为 0——不给任何章节续页预算。
 * 精华版：按图外资料多少把纯内文页分给各章，使每章要么只占图文同页，要么同页 + 若干填满的续页，减少半页留白。
 */
export function knowledgeReadingCharBudgets(level: KnowledgeEditionLevel, pages: KnowledgeBudgetPage[], contract?: KnowledgeReadingContract) {
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
    const extra = (p.supplement || "").replace(/\s+/g, "").length;
    const inImage = p.body.replace(/\s+/g, "").length;
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

/**
 * 图主文辅合同下的建议字数：按图外资料（supplement）多少定，不按上限定——资料少就写短，不拿图中内容凑字数。
 * 约为图外资料的九成再加一两句背景（120 字），封顶为上限的九成。
 */
export function knowledgeImagePrimaryTarget(page: Pick<KnowledgeBudgetPage, "supplement">, maxChars: number) {
  const offImage = (page.supplement || "").replace(/\s+/g, "").length;
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
  const readingCapacityChars = imagePages * KNOWLEDGE_LEAD_PAGE_CHARS;
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
 * 生图前预检：按两档已有资料估算页数，只提示不阻断。
 * 完整版：计划总页数恒 = 图数；内文超出图下容量时给出压缩目标（字数、比例）与「不压缩需几张图」的对比数字，
 * 不自行加图、不把溢出排成内文页。imageChars 为各图图内文字合计（可选，用于估算不丢内容所需图数）。
 */
export function knowledgeEditionBudgetCheck(level: KnowledgeEditionLevel, imagePages: number, textChars: number, imageChars = 0) {
  const budget = knowledgeEditionPageBudget(level, imagePages);
  const estimated = Math.ceil(Math.max(0, textChars - imagePages * KNOWLEDGE_LEAD_PAGE_CHARS) / KNOWLEDGE_READING_PAGE_CHARS);
  const plannedTextPages = level === "full" ? 0 : Math.min(budget.textPages.max, Math.max(budget.textPages.min, Math.min(estimated, budget.textPages.target)));
  const warnings: string[] = [];
  const compression = level === "full" ? knowledgeFullCompressionPlan(imagePages, textChars, imageChars) : null;
  if (!imagePages) warnings.push("尚无图片页，无法按图文比例排版");
  if (level === "concise" && estimated < budget.textPages.min)
    warnings.push(`精华版图外文字资料约${textChars}字，估计只够${estimated}页内文，低于建议的${budget.textPages.min}页；将据实排版，不硬凑篇幅`);
  if (compression) {
    const alternative = compression.imagesForNoLoss > compression.imageCap
      ? `不压缩需约${compression.imagesForNoLoss}张图，超过完整版上限${compression.imageCap}张，只能压缩`
      : `或改为${compression.imagesForNoLoss}张图（≤上限${compression.imageCap}张）可不丢内容，需用户拍板，不自行加图`;
    warnings.push(`完整版图文同页、不排独立内文页：${imagePages}张图图下合计可容约${compression.readingCapacityChars}字，内文资料约${textChars}字，超出${compression.excessChars}字；审校须把内文压缩至约${compression.targetReadingChars}字（约${Math.round(compression.ratio * 100)}%，每图≤${KNOWLEDGE_LEAD_PAGE_CHARS}字），合并去重、提炼为主，不删关键事实；${alternative}`);
  }
  if (level === "concise" && estimated > budget.textPages.max)
    warnings.push(`精华版图外文字资料约${textChars}字，超出${budget.textPages.max}页内文建议上限；审校将按预算合并去重，不重复图中内容`);
  return { budget, estimatedTextPages: estimated, plannedTextPages, plannedTotalPages: imagePages + plannedTextPages, warnings, compression };
}

/** 发给审校/排版模型的预算说明。 */
export function knowledgeBudgetInstructions(level: KnowledgeEditionLevel | undefined, pages: { id: string; maxChars: number; imageTargetChars?: number }[], contract?: KnowledgeReadingContract) {
  if (!level || !pages.length) return "";
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
export function knowledgeBudgetOutputContract(level: KnowledgeEditionLevel | undefined, pages: { id: string; headline: string; maxChars: number; imageTargetChars?: number }[], contract?: KnowledgeReadingContract) {
  if (level !== "full" || !pages.length) return "";
  if (contract === KNOWLEDGE_READING_CONTRACT)
    return `输出合同·篇幅（硬约束，程序逐页校验）：每页 pages[i].reading 的生成稿字数（中文字符，不含空白；副标题、小标题、表格、清单与图注全部计入）必须 ≤ 该页 maxChars；suggestedChars 是按图外资料估的建议值，可以更短，不得用图中已有内容凑字数。任一页超出即判不合格。超了先删与图中重复的句子、表格与清单。逐页：${JSON.stringify(pages.map(p => ({ id: p.id, headline: p.headline, maxChars: p.maxChars, suggestedChars: p.imageTargetChars ?? Math.floor(p.maxChars * KNOWLEDGE_BUDGET_PROMPT_MARGIN) })))}`;
  return `输出合同·篇幅（硬约束，程序逐页校验）：每页 pages[i].reading 的生成稿字数（中文字符，不含空白；副标题、各节小标题、表格表头与单元格、清单标题与正文、图注全部计入）必须 ≤ 该页 maxChars，按 targetChars 写；body 与 reading 同内容。任一页超出即整份回答判为不合格、换通道重做。输出前逐页自数一遍，超了就删与图中重复的表格/清单、合并并列例子，不截断半句、不删图外关键事实。逐页上限：${JSON.stringify(pages.map(p => ({ id: p.id, headline: p.headline, maxChars: p.maxChars, targetChars: Math.floor(p.maxChars * KNOWLEDGE_BUDGET_PROMPT_MARGIN) })))}`;
}

/** 审校后逐页核对：reading 实际字数（不含空白）对照各页预算，返回超出的页。 */
export type KnowledgeReadingOverflow = { id: string; headline: string; chars: number; maxChars: number; excess: number };
export function knowledgeReadingOverflow(
  level: KnowledgeEditionLevel | undefined,
  pages: KnowledgeBudgetPage[],
  reviewed: readonly { id: string; chars: number }[],
  contract?: KnowledgeReadingContract,
): KnowledgeReadingOverflow[] {
  if (!level) return [];
  const budgets = new Map<string, { headline: string; maxChars: number }>(knowledgeReadingCharBudgets(level, pages, contract).pages.map(p => [p.id, p]));
  return reviewed.flatMap(r => {
    const budget = budgets.get(r.id);
    if (!budget || r.chars <= budget.maxChars) return [];
    return [{ id: r.id, headline: budget.headline, chars: r.chars, maxChars: budget.maxChars, excess: r.chars - budget.maxChars }];
  });
}

/** 压缩请求的说明：只对超出页，按各页 maxChars 提炼，不删关键事实、不重复图中内容。 */
export function knowledgeCompressionInstructions(level: KnowledgeEditionLevel, overflow: readonly KnowledgeReadingOverflow[]) {
  const target = level === "full" ? `图下一栏（每页约${KNOWLEDGE_LEAD_PAGE_CHARS}字）` : "本页预算";
  return `这是篇幅压缩：以下各页审校后的reading超出${target}，须把每页reading压缩到不超过该页maxChars（中文字符，不含空白；含表格单元格与小标题）。合并去重、提炼成要点、删除与图中已画出内容重复的表格/清单/步骤，保留全部关键事实、数字、条件与边界；不新增事实、不改变结论、不写“详见图中”以外的空话。body与reading表达相同内容。沿用knowledge_publication_v1 JSON合同，pages与输入同id同顺序、一个不少。各页目标：${JSON.stringify(overflow.map(o => ({ id: o.id, chars: o.chars, maxChars: o.maxChars })))}`;
}
