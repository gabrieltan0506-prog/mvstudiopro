import { describe, expect, it } from "vitest";
import {
  buildLayoutHtml,
  renderLayoutBody,
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

describe("正文安全排版", () => {
  it("标题列表表格真实转为标签，保留全文和普通换行", () => {
    const body =
      "## 结构\n\n- 本纪\n- 列传\n\n| 体例 | 内容 |\n| --- | --- |\n| 本纪 | 帝王 |\n\n**读法**\n末句保留";
    const html = renderLayoutBody(body);
    expect(html).toContain("<h2>结构</h2>");
    expect(html).toContain("<li>本纪</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>帝王</td>");
    expect(html).toContain("<strong>读法</strong>");
    expect(html).toContain("末句保留");
    expect(renderLayoutBody("旧正文第一行\n第二行")).toContain("<br>");
  });
  it("恶意HTML、实体与链接不得激活脚本或额外外链图片", () => {
    const html = renderLayoutBody(
      "<script>alert(1)</script>\n\n[文字](javascript:alert%281%29) ![配图](https://evil.invalid/a.png)\n\n<img src=x onerror=alert(1)>\n\n&#60;svg onload=alert(1)&#62;"
    );
    expect(html).not.toMatch(/<(script|img|svg|a)\b/i);
    expect(html).not.toContain("href=");
    expect(html).toContain("文字");
    expect(html).toContain("&lt;script");
    expect(html).toContain("&amp;#60;");
  });
});
