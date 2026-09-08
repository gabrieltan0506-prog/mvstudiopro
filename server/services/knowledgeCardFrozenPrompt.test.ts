import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock("../../shared/knowledgeCardPagination", async importOriginal => {
  const actual = await importOriginal<typeof import("../../shared/knowledgeCardPagination")>();
  return { ...actual, planKnowledgeCardPages: mocks.plan.mockImplementation(actual.planKnowledgeCardPages) };
});
import { buildSinglePageKnowledgeCardImagePrompt } from "./geminiPlatformCompositeTranslation";

const frozenPage = {
  pageId: "internal-card-3", contentMarkdown: "# 第三页方法\n\n## 条件\n阈值必须≥30%，满足条件A后执行步骤B。\n\n## 内容锁定\n这是原书讨论的术语，不能删除。",
  visualDirections: "版式测试标记：横排三个条件框，用箭头对应过程表格。",
  sourcePageIds: ["internal-source-12", "internal-source-14"],
};
describe("冻结知识卡正文与视觉指令隔离", () => {
  beforeEach(() => vi.clearAllMocks());
  it("真实第3/5页完全绕过本地分页，不借用旧第一/末页", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt("# 旧第一章\n\n不可消费的旧正文", { frozenPage, notePageIndex: 3, notePageTotal: 5 });
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(prompt).toContain("第 3/5 页");
    expect(prompt).toContain(frozenPage.contentMarkdown);
    expect(prompt).not.toContain("不可消费的旧正文");
    expect(prompt).not.toContain("第 1/5 页");
    expect(prompt).not.toContain("收尾·末页");
  });
  it("视觉方向在正文块外，内部编号不进入提示词可绘文字", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt("旧稿", { frozenPage, notePageIndex: 3, notePageTotal: 5 });
    const body = prompt.split("【以下为冻结 Markdown 正文·逐字保留知识与限定条件】：\n")[1].split("\n【冻结正文结束】")[0];
    expect(body).toBe(frozenPage.contentMarkdown);
    expect(body).not.toContain("版式测试标记");
    expect(prompt.indexOf(frozenPage.visualDirections)).toBeLessThan(prompt.indexOf("【以下为冻结 Markdown 正文"));
    for (const id of [frozenPage.pageId, ...frozenPage.sourcePageIds]) expect(prompt).not.toContain(id);
    expect(prompt).toContain("图文对应、表格行列、机制箭头");
  });
  it.each([3501, 8000])("%i字冻结稿完整保留，尾部不被旧3500字切片丢弃", size => {
    const contentMarkdown = "甲".repeat(size - 6) + "原稿末尾标记";
    const prompt = buildSinglePageKnowledgeCardImagePrompt("旧稿", { frozenPage: { ...frozenPage, contentMarkdown }, notePageIndex: 3, notePageTotal: 5 });
    expect(prompt).toContain(contentMarkdown); expect(mocks.plan).not.toHaveBeenCalled();
  });
  it("超出8000字或页码身份错误明确失败，不截断修补", () => {
    expect(() => buildSinglePageKnowledgeCardImagePrompt("旧稿", { frozenPage: { ...frozenPage, contentMarkdown: "甲".repeat(8001) }, notePageIndex: 3, notePageTotal: 5 })).toThrow("超过单页8000字");
    for (const [notePageIndex, notePageTotal] of [[0, 5], [3, 2], [1.5, 5], [3, NaN]]) {
      expect(() => buildSinglePageKnowledgeCardImagePrompt("旧稿", { frozenPage, notePageIndex, notePageTotal })).toThrow("页码无效");
    }
    expect(mocks.plan).not.toHaveBeenCalled();
  });
  it.each(["left", "center"] as const)("主体%s最终位置优先于原稿版式且始终横版16:9", subjectPosition => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt("旧稿", { frozenPage, notePageIndex: 3, notePageTotal: 5, subjectPosition, infographicTemplateId: "infographic_material_lab" });
    expect(prompt).toContain(subjectPosition === "left" ? "LEFT third" : "CENTER the main visual subject");
    expect(prompt).toContain("LANDSCAPE 16:9 canvas");
    expect(prompt).not.toContain("--ar 3:4");
  });
  it("不传冻结选项仍调用原本分页", () => {
    buildSinglePageKnowledgeCardImagePrompt("# 旧稿\n\n方法和适用条件。", { notePageIndex: 1, notePageTotal: 4 });
    expect(mocks.plan).toHaveBeenCalled();
  });
});
