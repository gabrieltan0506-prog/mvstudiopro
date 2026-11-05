import { describe, expect, it } from "vitest";
import {
  buildLayoutHtml,
  layoutFromSource,
  layoutLibrarySchema,
} from "./editableLayout";
const source = {
  owner: "7",
  sourceId: "original-1",
  title: "原稿标题",
  body: "原稿正文",
  pages: [
    { pageIndex: 1, headline: "封面标题", body: "封面原文" },
    { pageIndex: 2, headline: "第二页", body: "长正文".repeat(1000) },
  ],
  images: { 2: "https://test.invalid/image.png" },
};
describe("可编辑排版契约与导出", () => {
  it("导入全部原稿及配图，不改写或截断；修改和重排独立于原稿", () => {
    const doc = layoutFromSource(source);
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[1].body).toBe(source.pages[1].body);
    doc.pages.reverse();
    doc.pages[0].body = "修改后正文";
    expect(source.pages[1].body.length).toBe(3000);
    expect(doc.pages[0].imageUrl).toBe(source.images[2]);
    const html = buildLayoutHtml(doc, {
      [source.images[2]]: "data:image/png;base64,YQ==",
    });
    expect(html.indexOf("修改后正文")).toBeLessThan(html.indexOf("封面原文"));
    expect(html).toContain("contenteditable");
  });
  it("HTML转义恶意文字，缺图整体拒绝，预览仅允许安全地址", () => {
    const doc = layoutFromSource(source);
    doc.title = "</title><script>alert(1)</script>";
    doc.pages[0].body = "<img src=x onerror=alert(2)>";
    expect(() => buildLayoutHtml(doc, {})).toThrow("未完整载入");
    const html = buildLayoutHtml(doc, {
      [source.images[2]]: "data:image/png;base64,YQ==",
    });
    expect(html).toContain('contenteditable="true"');
    expect(buildLayoutHtml(doc, {}, true)).not.toContain(
      'contenteditable="true"'
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    doc.pages[1].imageUrl = "javascript:alert(1)";
    expect(buildLayoutHtml(doc, {}, true)).not.toContain('src="javascript:');
  });
  it("旧正文无分页时完整导入，空标题中间态可保存但不能导出", () => {
    const doc = layoutFromSource({
      owner: "7",
      sourceId: "old",
      title: "旧文",
      body: "完整旧文".repeat(800),
    });
    expect(doc.pages[0].body.length).toBe(3200);
    doc.title = "";
    expect(
      layoutLibrarySchema.parse({ version: 1, owner: "7", documents: [doc] })
        .documents[0].title
    ).toBe("");
    expect(() => buildLayoutHtml(doc, {})).toThrow("填写稿件标题");
  });
  it("拒绝重复稿件及超容量，不能静默丢稿", () => {
    const doc = layoutFromSource(source);
    expect(
      layoutLibrarySchema.safeParse({
        version: 1,
        owner: "7",
        documents: [doc, doc],
      }).success
    ).toBe(false);
    expect(() =>
      layoutFromSource({
        ...source,
        body: "",
        pages: Array.from({ length: 101 }, () => source.pages[0]),
      })
    ).toThrow();
  });
});
