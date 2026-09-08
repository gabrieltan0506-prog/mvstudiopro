import { z } from "zod";
import { KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS, knowledgeCardPageCreditsForModel } from "./knowledgeCardDistillModels";
import { KNOWLEDGE_CARD_FULL_PRICE_PAGES, knowledgeCardCreditsForPages } from "./knowledgeCardPagination";

export const KNOWLEDGE_CARD_READING_MIN_PAGES = 4;
export const KNOWLEDGE_CARD_READING_MODES = ["concise", "balanced", "complete"] as const;
const id = z.string().trim().min(1).max(128);
const statement = z.string().trim().min(1).max(4_000);
const unique = (values: string[]) => new Set(values).size === values.length;

export const knowledgeCardReadingVisualSchema = z.object({
  id,
  kind: z.string().trim().min(1).max(80),
  description: statement,
  labels: z.array(statement).max(200),
  relations: z.array(statement).max(200),
  layoutAdvice: z.string().trim().max(4_000),
}).strict();

/** 图片对象地址由服务端证据记录保存，不能让模型填写或覆盖。 */
export const knowledgeCardReadingEvidencePageSchema = z.object({
  id,
  documentId: id,
  pageNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["read", "blank"]),
  summary: z.string().trim().max(8_000),
  contentMarkdown: z.string().trim().max(50_000),
  visuals: z.array(knowledgeCardReadingVisualSchema).max(200),
  uncertainties: z.array(statement).max(200),
}).strict().superRefine((page, ctx) => {
  if (!unique(page.visuals.map(visual => visual.id)))
    ctx.addIssue({ code: "custom", path: ["visuals"], message: "同页视觉证据编号不能重复" });
  if (page.status === "read" && (!page.summary || (!page.contentMarkdown && !page.visuals.length)))
    ctx.addIssue({ code: "custom", message: "已读页面必须有摘要及非空正文或视觉证据" });
  if (page.status === "blank" && (page.contentMarkdown || page.visuals.length))
    ctx.addIssue({ code: "custom", message: "空白页不能同时包含正文或视觉证据" });
});

export const knowledgeCardReadingPlanPageSchema = z.object({
  pageId: id,
  title: z.string().trim().min(1).max(240),
  brief: statement,
  contentMarkdown: z.string().trim().min(1).max(8_000).optional(),
  sourcePageIds: z.array(id).min(1).refine(unique, "引用的原页编号不能重复"),
  visualDirections: z.string().trim().min(1).max(8_000),
}).strict();

export const knowledgeCardReadingPlanOptionSchema = z.object({
  mode: z.enum(KNOWLEDGE_CARD_READING_MODES),
  reason: statement,
  kept: z.array(statement).min(1).max(200),
  omitted: z.array(statement).max(200),
  /** 原页可因重复、目录或无关内容明确排除，无需强迫所有原页都画成卡片。 */
  sourceExclusions: z.array(z.object({ sourcePageId: id, reason: statement }).strict())
    .refine(items => unique(items.map(item => item.sourcePageId)), "排除的原页编号不能重复").optional(),
  pages: z.array(knowledgeCardReadingPlanPageSchema)
    .min(KNOWLEDGE_CARD_READING_MIN_PAGES, "知识卡最少4页，不能通过减页满足预算")
    .refine(pages => unique(pages.map(page => page.pageId)), "方案内页编号不能重复"),
}).strict();

export const knowledgeCardReadingPlanSchema = z.object({
  version: z.literal(1),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/, "原稿摘要必须为SHA-256"),
  model: z.enum(KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS),
  presentation: z.enum(["single", "options"]),
  reason: statement,
  options: z.array(knowledgeCardReadingPlanOptionSchema).min(1).max(3),
}).strict().superRefine((plan, ctx) => {
  if (plan.presentation === "single") {
    if (plan.options.length !== 1 || plan.options[0]?.mode !== "complete" || plan.options[0]?.pages.length !== 4)
      ctx.addIssue({ code: "custom", path: ["options"], message: "完整内容只需4页时，仅提供一个complete四页方案" });
    return;
  }
  const modes = plan.options.map(option => option.mode);
  if (modes.length !== 3 || !unique(modes) || KNOWLEDGE_CARD_READING_MODES.some(mode => !modes.includes(mode)))
    ctx.addIssue({ code: "custom", path: ["options"], message: "多方案必须同时包含精简、均衡、完整，且各一次" });
  const complete = plan.options.find(option => option.mode === "complete");
  if (complete && complete.pages.length <= 4)
    ctx.addIssue({ code: "custom", path: ["options"], message: "完整方案只有4页时应提供单一方案" });
  for (const option of plan.options) {
    if (option.mode !== "complete" && !option.omitted.length)
      ctx.addIssue({ code: "custom", path: ["options"], message: "确有内容取舍才能提供多方案；精简与均衡须说明省略内容" });
  }
});

export const knowledgeCardReadingConstraintsSchema = z.object({
  budgetCredits: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  targetPages: z.number().int()
    .min(KNOWLEDGE_CARD_READING_MIN_PAGES, "知识卡最少4页")
    .safe("目标页数须为安全整数").optional(),
}).strict();

export type KnowledgeCardReadingEvidencePage = z.infer<typeof knowledgeCardReadingEvidencePageSchema>;
export type KnowledgeCardReadingPlanPage = z.infer<typeof knowledgeCardReadingPlanPageSchema>;
export type KnowledgeCardReadingPlanOption = z.infer<typeof knowledgeCardReadingPlanOptionSchema>;
export type KnowledgeCardReadingPlan = z.infer<typeof knowledgeCardReadingPlanSchema>;
export type KnowledgeCardReadingConstraints = z.infer<typeof knowledgeCardReadingConstraintsSchema>;
export type KnowledgeCardReadingMode = typeof KNOWLEDGE_CARD_READING_MODES[number];

/** 用现有阶梯价反解，不降低最低页数，也不把请求容量冒充内容页数上限。 */
export function knowledgeCardReadingAffordablePages(budgetCredits: number, model: KnowledgeCardReadingPlan["model"]): number {
  const budget = knowledgeCardReadingConstraintsSchema.parse({ budgetCredits }).budgetCredits!;
  const activeModel = z.enum(KNOWLEDGE_CARD_ACTIVE_DISTILL_MODELS).parse(model);
  const { full, discount } = knowledgeCardPageCreditsForModel(activeModel);
  const fullCost = KNOWLEDGE_CARD_FULL_PRICE_PAGES * full;
  return budget < fullCost ? Math.floor(budget / full)
    : KNOWLEDGE_CARD_FULL_PRICE_PAGES + Math.floor((budget - fullCost) / discount);
}

/** 只对已校验的真实计划报价，不替模型生成页数、不裁页、不替用户确认购买。 */
export function quoteKnowledgeCardReadingPlan(rawPlan: KnowledgeCardReadingPlan, rawConstraints: KnowledgeCardReadingConstraints = {}) {
  const plan = knowledgeCardReadingPlanSchema.parse(rawPlan);
  const constraints = knowledgeCardReadingConstraintsSchema.parse(rawConstraints);
  const minimumCredits = knowledgeCardCreditsForPages(KNOWLEDGE_CARD_READING_MIN_PAGES, plan.model);
  const maxAffordablePages = constraints.budgetCredits === undefined ? null
    : knowledgeCardReadingAffordablePages(constraints.budgetCredits, plan.model);
  const minimumBudgetUnreachable = maxAffordablePages !== null && maxAffordablePages < KNOWLEDGE_CARD_READING_MIN_PAGES;
  const options = [...plan.options].sort((a, b) => KNOWLEDGE_CARD_READING_MODES.indexOf(a.mode) - KNOWLEDGE_CARD_READING_MODES.indexOf(b.mode)).map(option => {
    const pageCount = option.pages.length;
    const credits = knowledgeCardCreditsForPages(pageCount, plan.model);
    const withinBudget = constraints.budgetCredits === undefined || credits <= constraints.budgetCredits;
    const matchesTarget = constraints.targetPages === undefined || pageCount === constraints.targetPages;
    return { mode: option.mode, pageCount, credits, withinBudget, matchesTarget, selectable: withinBudget && matchesTarget };
  });
  return {
    defaultMode: plan.presentation === "single" ? "complete" as const : "concise" as const,
    minimumCredits, maxAffordablePages, minimumBudgetUnreachable,
    reason: minimumBudgetUnreachable ? `预算不足以生成最少4页，至少需要${minimumCredits}积分；不能减少页数。`
      : options.some(option => option.selectable) ? "" : "当前方案不满足预算或目标页数，需重新规划并报价，不能截断内容。",
    options,
  };
}

/** 服务端在模型产物落盘前，以实际读取的原页集合验证引用。 */
export function validateKnowledgeCardReadingPlanSources(plan: KnowledgeCardReadingPlan, rawEvidence: KnowledgeCardReadingEvidencePage[]): void {
  const parsed = knowledgeCardReadingPlanSchema.parse(plan);
  const evidence = rawEvidence.map(page => knowledgeCardReadingEvidencePageSchema.parse(page));
  if (!unique(evidence.map(page => page.id))) throw new Error("原页证据编号重复");
  if (!unique(evidence.map(page => JSON.stringify([page.documentId, page.pageNumber])))) throw new Error("同一文档页码证据重复");
  const readable = new Set(evidence.filter(page => page.status === "read").map(page => page.id));
  for (const option of parsed.options) {
    const covered = new Set<string>();
    for (const page of option.pages) {
      if (page.sourcePageIds.some(sourceId => !readable.has(sourceId)))
        throw new Error(`方案页${page.pageId}引用了不存在或空白的原页证据`);
      page.sourcePageIds.forEach(sourceId => covered.add(sourceId));
    }
    const excluded = new Set<string>();
    for (const item of option.sourceExclusions || []) {
      if (!readable.has(item.sourcePageId)) throw new Error(`方案排除了不存在或空白的原页证据：${item.sourcePageId}`);
      if (covered.has(item.sourcePageId)) throw new Error(`同一原页不能同时引用和排除：${item.sourcePageId}`);
      excluded.add(item.sourcePageId);
    }
    if (option.mode === "complete") {
      const unaccounted = evidence.filter(page => page.status === "read" && !covered.has(page.id) && !excluded.has(page.id));
      if (unaccounted.length) throw new Error(`完整方案仍有${unaccounted.length}个已读原页未引用且未说明排除理由，不能标记完整覆盖`);
    }
  }
}
