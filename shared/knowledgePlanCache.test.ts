import { describe, expect, it } from "vitest";
import { compileKnowledgeEditions, isKnowledgeEditionManuscript, knowledgeEditionParts, knowledgeEditionPartsCache } from "./knowledgeCardEdition";
import { knowledgeCardPagesCache, knowledgeCardPagesComputeCount, knowledgeEditionIllustratedPages, knowledgeEditionIllustratedPagesCache, knowledgeEditionImagePlan, knowledgeEditionImagePlanCache, planKnowledgeCardPages } from "./knowledgeCardPagination";

const book = compileKnowledgeEditions("缓存书", Array.from({ length: 60 }, (_, i) => ({
  headline: `小节${i}`, body: Array.from({ length: 12 }, (_, j) => `第${i}节第${j}句讲一个具体知识点。`).join("") + (i % 5 ? "" : "\n\n注：适用条件说明。"),
  priority: (i % 2 ? "primary" : "secondary") as "primary" | "secondary",
})));

let base = 0;
describe("规划函数小缓存：同一输入只算一次、返回逐字相等、修改返回值不影响下一次", () => {
  const cases = [
    ["knowledgeEditionParts", () => knowledgeEditionParts(book.full), knowledgeEditionPartsCache],
    ["knowledgeEditionImagePlan", () => knowledgeEditionImagePlan(book.full), knowledgeEditionImagePlanCache],
    ["planKnowledgeCardPages", () => planKnowledgeCardPages(book.full, "glm-5.3-flashx"), { clear: () => knowledgeCardPagesCache.clear(), get computed() { return knowledgeCardPagesCache.computed && knowledgeCardPagesComputeCount() - base; } }],
    ["knowledgeEditionIllustratedPages", () => knowledgeEditionIllustratedPages(book.concise), knowledgeEditionIllustratedPagesCache],
  ] as const;
  for (const [name, run, cache] of cases) it(name, () => {
    cache.clear(); base = knowledgeCardPagesComputeCount();
    const first = run() as any;
    const snapshot = JSON.stringify(first);
    const before = cache.computed;
    expect(before).toBe(1);
    // 就地修改返回值（数组与条目对象）
    const list = Array.isArray(first) ? first : first.modules || first.images || first.pages;
    if (typeof list[0] === "object") list[0].body = "被改"; else list[0] = "被改";
    list.push("多出");
    const second = run();
    expect(cache.computed).toBe(before);
    expect(JSON.stringify(second)).toBe(snapshot);
  });

  it("分页缓存键区分提炼模型", () => {
    knowledgeCardPagesCache.clear();
    const start = knowledgeCardPagesComputeCount();
    const a = planKnowledgeCardPages(book.full, "glm-5.3-flashx");
    const b = planKnowledgeCardPages(book.full, null);
    const c = planKnowledgeCardPages(book.full, undefined);
    expect(knowledgeCardPagesComputeCount() - start).toBe(3);
    planKnowledgeCardPages(book.full, null);
    expect(knowledgeCardPagesComputeCount() - start).toBe(3);
    expect(a.pages).toEqual(b.pages);
    expect(c.distillModel).toBe(b.distillModel);
  });

  it("LRU 容量有限：超过容量后最久未用的重算", () => {
    knowledgeEditionImagePlanCache.clear();
    const docs = Array.from({ length: 7 }, (_, i) => book.full + `\n\n## 图解｜追加${i}\n\n- 要点${i}`);
    docs.forEach(d => knowledgeEditionImagePlan(d));
    expect(knowledgeEditionImagePlanCache.computed).toBe(7);
    knowledgeEditionImagePlan(docs[6]!);
    expect(knowledgeEditionImagePlanCache.computed).toBe(7);
    knowledgeEditionImagePlan(docs[0]!);
    expect(knowledgeEditionImagePlanCache.computed).toBe(8);
  });
});

describe("isKnowledgeEditionManuscript：只认两档标记", () => {
  it("两档稿为真，提炼原稿与空串为假", () => {
    expect(isKnowledgeEditionManuscript(book.full)).toBe(true);
    expect(isKnowledgeEditionManuscript(book.concise)).toBe(true);
    expect(isKnowledgeEditionManuscript("# 书\n\n## 小节\n\n正文")).toBe(false);
    expect(isKnowledgeEditionManuscript("")).toBe(false);
    expect(isKnowledgeEditionManuscript(undefined as any)).toBe(false);
  });
});
