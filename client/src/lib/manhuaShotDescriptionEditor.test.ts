import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ManhuaShotDescriptionEditor } from "../components/ManhuaShotDescriptionEditor";

it("旧稿描述超200字时完整显示并禁止保存，不会静默裁剪", () => {
  const legacy = "长".repeat(210);
  const html = renderToStaticMarkup(createElement(ManhuaShotDescriptionEditor, {
    shotIndex: 101,
    description: legacy,
    onApply: () => { throw new Error("不应保存超长旧稿"); },
  }));
  expect(html).toContain("210/200");
  expect(html).toContain(legacy);
  expect(html).toMatch(/<button[^>]*disabled[^>]*>保存本镜描述<\/button>/);
});
