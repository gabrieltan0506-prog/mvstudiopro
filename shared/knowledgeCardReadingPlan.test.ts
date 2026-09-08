import { describe, expect, it } from "vitest";
import {
  knowledgeCardReadingAffordablePages,
  knowledgeCardReadingConstraintsSchema,
  knowledgeCardReadingEvidencePageSchema,
  knowledgeCardReadingPlanSchema,
  quoteKnowledgeCardReadingPlan,
  validateKnowledgeCardReadingPlanSources,
  type KnowledgeCardReadingEvidencePage,
  type KnowledgeCardReadingMode,
  type KnowledgeCardReadingPlan,
  type KnowledgeCardReadingPlanOption,
} from "./knowledgeCardReadingPlan";
import { knowledgeCardCreditsForPages } from "./knowledgeCardPagination";

function option(mode: KnowledgeCardReadingMode, count: number): KnowledgeCardReadingPlanOption {
  return {
    mode, reason: "依据原稿核心知识与案例覆盖分配页面", kept: ["核心方法与适用边界"],
    omitted: mode === "complete" ? [] : ["延伸案例与重复说明"],
    pages: Array.from({ length: count }, (_, i) => ({
      pageId: `${mode}-${i + 1}`, title: `方法${i + 1}`, brief: "解释方法及其适用范围",
      sourcePageIds: ["document-1-page-1"], visualDirections: "保留原页的图文对照关系",
    })),
  };
}
function plan(): KnowledgeCardReadingPlan {
  return {
    version: 1, sourceDigest: "a".repeat(64), model: "gpt-5.6-sol", presentation: "options",
    reason: "核心结论可精简，完整保留案例需要更多页面",
    options: [option("concise", 4), option("balanced", 6), option("complete", 9)],
  };
}
const evidence: KnowledgeCardReadingEvidencePage = {
  id: "document-1-page-1", documentId: "document-1", pageNumber: 1, status: "read",
  summary: "方法与适用条件", contentMarkdown: "方法需要满足特定条件。", visuals: [], uncertainties: [],
};

describe("原页精读证据与方案契约", () => {
  it("完整内容只需四页时接受单方案，并默认报完整四页价格", () => {
    const single = { ...plan(), presentation: "single" as const, options: [option("complete", 4)] };
    expect(knowledgeCardReadingPlanSchema.parse(single)).toEqual(single);
    expect(quoteKnowledgeCardReadingPlan(single)).toMatchObject({
      defaultMode: "complete", minimumCredits: 120,
      options: [{ mode: "complete", pageCount: 4, credits: 120, selectable: true }],
    });
  });
  it("真实多方案默认展示精简，输出顺序不依赖模型返回顺序", () => {
    const value = plan();
    value.options.reverse();
    expect(quoteKnowledgeCardReadingPlan(value).options.map(item => item.mode)).toEqual(["concise", "balanced", "complete"]);
    expect(quoteKnowledgeCardReadingPlan(value).defaultMode).toBe("concise");
  });
  it("single拒绝三页、五页、非完整和多个方案", () => {
    for (const options of [[option("complete", 3)], [option("complete", 5)], [option("concise", 4)], [option("complete", 4), option("concise", 4)]])
      expect(knowledgeCardReadingPlanSchema.safeParse({ ...plan(), presentation: "single", options }).success).toBe(false);
  });
  it("options拒绝完整仅四页、缺档、重复档与没有真实取舍的附加方案", () => {
    for (const options of [
      [option("concise", 4), option("balanced", 4), option("complete", 4)],
      [option("concise", 4), option("complete", 6)],
      [option("concise", 4), option("concise", 5), option("complete", 6)],
      [{ ...option("concise", 4), omitted: [] }, option("balanced", 5), option("complete", 6)],
    ]) expect(knowledgeCardReadingPlanSchema.safeParse({ ...plan(), options }).success).toBe(false);
  });
  it("判断必须有原稿依据说明；拒绝客户端价格与未知字段", () => {
    expect(knowledgeCardReadingPlanSchema.safeParse({ ...plan(), reason: " " }).success).toBe(false);
    expect(knowledgeCardReadingPlanSchema.safeParse({ ...plan(), credits: 1 }).success).toBe(false);
    expect(knowledgeCardReadingPlanSchema.safeParse({ ...plan(), model: "moonshotai/kimi-k3" }).success).toBe(false);
    expect(knowledgeCardReadingPlanSchema.safeParse({ ...plan(), model: "balanced" }).success).toBe(false);
  });
  it("80页明确作为输入容量，81页拒绝且不截断原对象", () => {
    const value = { ...plan(), options: [option("concise", 4), option("balanced", 6), option("complete", 80)] };
    expect(knowledgeCardReadingPlanSchema.parse(value).options[2]!.pages).toHaveLength(80);
    value.options[2] = option("complete", 81);
    expect(knowledgeCardReadingPlanSchema.safeParse(value).success).toBe(false);
    expect(value.options[2]!.pages).toHaveLength(81);
  });
  it("拒绝重复成品页编号、重复来源与无来源页", () => {
    for (const patch of [{ pageId: "concise-2" }, { sourcePageIds: [] }, { sourcePageIds: ["p1", "p1"] }]) {
      const value = plan();
      Object.assign(value.options[0]!.pages[0]!, patch);
      expect(knowledgeCardReadingPlanSchema.safeParse(value).success).toBe(false);
    }
  });
  it("read要求非空真实内容，纯图页可由视觉证据成立，blank不能伪装有内容", () => {
    expect(knowledgeCardReadingEvidencePageSchema.safeParse({ ...evidence, contentMarkdown: "", visuals: [] }).success).toBe(false);
    const visual = { id: "v1", kind: "diagram", description: "两组指标对照", labels: ["甲", "乙"], relations: ["并列对照"], layoutAdvice: "并列两栏" };
    expect(knowledgeCardReadingEvidencePageSchema.parse({ ...evidence, contentMarkdown: "", visuals: [visual] }).visuals).toHaveLength(1);
    expect(knowledgeCardReadingEvidencePageSchema.safeParse({ ...evidence, visuals: [visual, visual] }).success).toBe(false);
    expect(knowledgeCardReadingEvidencePageSchema.safeParse({ ...evidence, status: "blank" }).success).toBe(false);
    expect(knowledgeCardReadingEvidencePageSchema.parse({ ...evidence, status: "blank", contentMarkdown: "" }).status).toBe("blank");
  });
  it("引用必须来自实际已读非空页，不能用未知页或重复页冒充证据", () => {
    expect(() => validateKnowledgeCardReadingPlanSources(plan(), [evidence])).not.toThrow();
    expect(() => validateKnowledgeCardReadingPlanSources(plan(), [])).toThrow(/不存在/);
    expect(() => validateKnowledgeCardReadingPlanSources(plan(), [{ ...evidence, status: "blank", contentMarkdown: "" }])).toThrow(/空白/);
    expect(() => validateKnowledgeCardReadingPlanSources(plan(), [evidence, evidence])).toThrow(/编号重复/);
    expect(() => validateKnowledgeCardReadingPlanSources(plan(), [evidence, { ...evidence, id: "different-id" }])).toThrow(/页码证据重复/);
  });
  it("完整方案不能无声漏掉已读页；允许用具体理由排除目录或重复内容", () => {
    const second = { ...evidence, id: "document-1-page-2", pageNumber: 2, summary: "重复目录" };
    const value = plan();
    expect(() => validateKnowledgeCardReadingPlanSources(value, [evidence, second])).toThrow(/未引用且未说明排除理由/);
    value.options[2]!.sourceExclusions = [{ sourcePageId: second.id, reason: "本页为目录，与成品主线重复，无独立知识" }];
    expect(() => validateKnowledgeCardReadingPlanSources(value, [evidence, second])).not.toThrow();
    expect(knowledgeCardReadingPlanSchema.parse(value).options[2]!.sourceExclusions).toEqual(value.options[2]!.sourceExclusions);
  });
  it("完整引用全部原页的旧方案无需排除字段；空白页无需排除理由", () => {
    const blank = { ...evidence, id: "blank-page", pageNumber: 2, status: "blank" as const, contentMarkdown: "" };
    expect(() => validateKnowledgeCardReadingPlanSources(plan(), [evidence, blank])).not.toThrow();
    expect(knowledgeCardReadingPlanSchema.parse(plan()).options[2]).not.toHaveProperty("sourceExclusions");
  });
  it.each(["concise", "balanced", "complete"] as const)("%s排除项也必须合法并与引用互斥", mode => {
    for (const sourcePageId of [evidence.id, "unknown-page", "blank-page"]) {
      const value = plan();
      value.options.find(item => item.mode === mode)!.sourceExclusions = [{ sourcePageId, reason: "重复说明" }];
      const blank = { ...evidence, id: "blank-page", pageNumber: 2, status: "blank" as const, contentMarkdown: "" };
      expect(() => validateKnowledgeCardReadingPlanSources(value, [evidence, blank])).toThrow(/同时引用和排除|不存在或空白/);
    }
  });
  it("排除理由不能为空，排除页不可重复或包含未知字段", () => {
    for (const sourceExclusions of [
      [{ sourcePageId: "p2", reason: " " }],
      [{ sourcePageId: "p2", reason: "目录" }, { sourcePageId: "p2", reason: "重复" }],
      [{ sourcePageId: "p2", reason: "目录", ignored: true }],
    ]) {
      const value = plan(); Object.assign(value.options[2]!, { sourceExclusions });
      expect(knowledgeCardReadingPlanSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("三方案报价保持现有价格和最少四页", () => {
  it.each(["gpt-5.6-sol", "qwen3.8-max"] as const)("%s 在第8/9页价格边界反解预算与原函数闭合", model => {
    for (const count of [0, 1, 3, 4, 8, 9, 80, 81, 300]) {
      const credits = knowledgeCardCreditsForPages(count, model);
      expect(knowledgeCardReadingAffordablePages(credits, model)).toBe(count);
      if (credits > 0) expect(knowledgeCardReadingAffordablePages(credits - 1, model)).toBe(count - 1);
    }
    const quoted = quoteKnowledgeCardReadingPlan({ ...plan(), model });
    for (const item of quoted.options) expect(item.credits).toBe(knowledgeCardCreditsForPages(item.pageCount, model));
  });
  it.each([["gpt-5.6-sol", 120], ["qwen3.8-max", 96]] as const)("%s预算低于%s明确不可达，四页不减少", (model, minimum) => {
    const value = { ...plan(), model };
    const snapshot = JSON.stringify(value);
    const quote = quoteKnowledgeCardReadingPlan(value, { budgetCredits: minimum - 1 });
    expect(quote.minimumBudgetUnreachable).toBe(true);
    expect(quote.reason).toContain("最少4页");
    expect(quote.options.every(item => !item.selectable)).toBe(true);
    expect(quote.options[0]!.pageCount).toBe(4);
    expect(JSON.stringify(value)).toBe(snapshot);
    expect(quoteKnowledgeCardReadingPlan(value, { budgetCredits: minimum }).options[0]!.selectable).toBe(true);
  });
  it("预算及目标只决定方案能否选中，不截页也不默认选择更贵方案", () => {
    const quote = quoteKnowledgeCardReadingPlan(plan(), { budgetCredits: 180, targetPages: 6 });
    expect(quote.defaultMode).toBe("concise");
    expect(quote.options.map(item => item.selectable)).toEqual([false, true, false]);
    expect(quote.options.map(item => item.pageCount)).toEqual([4, 6, 9]);
    expect(quoteKnowledgeCardReadingPlan(plan(), { targetPages: 7 }).reason).toContain("重新规划");
  });
  it("拒绝非法预算、少于4页和超过80页的目标", () => {
    for (const targetPages of [0, 3, 4.5, 81, Infinity])
      expect(knowledgeCardReadingConstraintsSchema.safeParse({ targetPages }).success).toBe(false);
    for (const budgetCredits of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => knowledgeCardReadingAffordablePages(budgetCredits, "gpt-5.6-sol")).toThrow();
    expect(knowledgeCardReadingConstraintsSchema.parse({ budgetCredits: 0, targetPages: 4 })).toEqual({ budgetCredits: 0, targetPages: 4 });
  });
});
