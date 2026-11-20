import { beforeEach, expect, it, vi } from "vitest";
import { __clearHandbookManuscriptCacheForTest, cachedHandbookManuscriptPages } from "./handbookManuscriptStage";
import { planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";

beforeEach(() => __clearHandbookManuscriptCacheForTest());
const md = "# 书\n\n" + Array.from({ length: 30 }, (_, i) => `## 第${i + 1}章\n\n${"内容".repeat(400)}`).join("\n\n");

it("同用户同摘要：56 页 × 并发请求只规划一次，结果与逐次重算逐字相同", () => {
  const plan = vi.fn(planKnowledgeCardPages);
  const first = cachedHandbookManuscriptPages(7, "a".repeat(64), md, undefined, plan);
  for (let i = 0; i < 56 * 2; i++) expect(cachedHandbookManuscriptPages(7, "a".repeat(64), md, undefined, plan)).toBe(first);
  expect(plan).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(first)).toBe(JSON.stringify(planKnowledgeCardPages(md).pages));
});
it("不同用户、不同摘要、不同读档模型各算各的；容量 4 条按最近使用淘汰", () => {
  const plan = vi.fn(planKnowledgeCardPages);
  cachedHandbookManuscriptPages(7, "a".repeat(64), md, undefined, plan);
  cachedHandbookManuscriptPages(8, "a".repeat(64), md, undefined, plan);
  cachedHandbookManuscriptPages(7, "b".repeat(64), md, undefined, plan);
  cachedHandbookManuscriptPages(7, "a".repeat(64), md, "glm", plan);
  expect(plan).toHaveBeenCalledTimes(4);
  cachedHandbookManuscriptPages(9, "c".repeat(64), md, undefined, plan); // 挤掉最旧的 7:a
  cachedHandbookManuscriptPages(7, "a".repeat(64), md, undefined, plan);
  expect(plan).toHaveBeenCalledTimes(6);
});
