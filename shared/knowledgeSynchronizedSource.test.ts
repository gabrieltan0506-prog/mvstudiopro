import { describe, expect, it } from "vitest";
import { synchronizedKnowledgeCardSource } from "./knowledgeCardEditableLayout";
import { layoutFromSource } from "./editableLayout";
import { knowledgeReviewBatches } from "./knowledgePublication";
import { planKnowledgeCardPages } from "./knowledgeCardPagination";

describe("同步手册完整底稿与配图身份", () => {
  const full = "# 河流\n\n## 水循环\n完整因果与边界说明。\n\n## 流域\n最后一章完整说明。";
  const concise = "# 河流\n\n## 精华\n简短要点。";
  it("精华配图和完整文字分别保留，不以相同页序强配", () => {
    const count = planKnowledgeCardPages(concise).pages.length;
    const source = synchronizedKnowledgeCardSource({ owner: "7", sourceId: "sync", fullMarkdown: full, illustrationMarkdown: concise,
      detailLevel: "concise", imageJobIds: Array.from({ length: count }, (_, i) => `job-${i}`) });
    const doc = layoutFromSource(source), pages = doc.publication!.source.pages;
    expect(pages.filter(p => p.role === "reading").map(p => p.body).join("\n")).toContain("最后一章完整说明");
    expect(pages.filter(p => p.role === "illustration").map(p => p.imageJobId)).toEqual(["job-0"]);
    expect(pages.every(p => p.imageUrl === "")).toBe(true);
    expect(knowledgeReviewBatches(doc.publication!.source).every(batch => new Set(batch.map(i => pages[i].role)).size === 1)).toBe(true);
  });
  it("缺完整底稿或配图身份数量错误时收费前拒绝", () => {
    const input = { owner: "7", sourceId: "sync", fullMarkdown: "", illustrationMarkdown: concise, detailLevel: "concise" as const, imageJobIds: ["job"] };
    expect(() => synchronizedKnowledgeCardSource(input)).toThrow("缺少完整版");
    expect(() => synchronizedKnowledgeCardSource({ ...input, fullMarkdown: full, imageJobIds: [] })).toThrow("任务与原稿页数不一致");
  });
});
