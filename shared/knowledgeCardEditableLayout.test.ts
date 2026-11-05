import { describe, it, expect } from "vitest";
import { knowledgeCardLayoutSource } from "./knowledgeCardEditableLayout";
import { planKnowledgeCardPages } from "./knowledgeCardPagination";
import { layoutFromSource } from "./editableLayout";

describe("知识卡真实分页进入独立排版稿", () => {
  const markdown = "# 通史知识卡片\n\n" + Array.from({ length: 13 }, (_, i) => `## 主题${i + 1}\n\n${"历史正文、人物关系与事件依据。".repeat(60)}\n末句${i + 1}`).join("\n\n");
  it("完整正文、缺图空位和最后一页图片沿实际出图分页保留", () => {
    const plan = planKnowledgeCardPages(markdown);
    expect(plan.pages.length).toBeGreaterThan(2);
    const images = plan.pages.map((_, i) => i === 1 ? "" : `https://example.test/page-${i + 1}.png`);
    const source = knowledgeCardLayoutSource({ owner: "7", sourceId: "knowledge-card:actual-job", markdown, images });
    const doc = layoutFromSource(source);
    expect(doc.sourceId).toBe("knowledge-card:actual-job");
    expect(doc.pages.map(p => p.body)).toEqual(plan.pages);
    expect(doc.pages[1].imageUrl).toBe("");
    expect(doc.pages[2].imageUrl).toBe(images[2]);
    expect(doc.pages.at(-1)?.body).toContain("末句13");
    expect(doc.pages.at(-1)?.imageUrl).toBe(images.at(-1));
    expect(source.body).toBe(markdown);
  });
  it("页数不匹配明确拒绝，不静默配错图片", () => {
    expect(() => knowledgeCardLayoutSource({ owner: "7", sourceId: "knowledge-card:old", markdown, images: ["https://example.test/only.png"] })).toThrow("页数与当前分页不一致");
  });
  it("只有正文也能进入排版，不伪造图片或生成请求", () => {
    const source = knowledgeCardLayoutSource({ owner: "7", sourceId: "knowledge-card:text", markdown: "# 真稿\n完整正文末句", images: [] });
    expect(layoutFromSource(source).pages[0].body).toContain("完整正文末句");
    expect(source.images).toEqual({});
  });
});
