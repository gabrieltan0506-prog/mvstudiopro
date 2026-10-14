import { describe, it, expect, vi } from "vitest";
import React, { createElement } from "react";
vi.stubGlobal("React", React);
import { renderToStaticMarkup } from "react-dom/server";
import { ViralCreationPackageView } from "../components/platform/ViralCreationPackageView";
import { fictionalViralBlueprint } from "../../../shared/viralCreation.fixture";

describe("已确认设计与复盘方案显示", () => {
 it("字体层级和交付实验到达现有方案视图，旧稿仍可读", () => {
  const bp=fictionalViralBlueprint();
  const pack={...bp.xhsPackage,cover:{...bp.xhsPackage.cover,layout:"无衬线字体，主标题较大、副标题较小，人物右侧、标题左上，深字浅底并留白。"},experiment:{...bp.xhsPackage.experiment,variable:"交付范围"}};
  const html=renderToStaticMarkup(createElement(ViralCreationPackageView,{value:pack}));
  expect(html).toContain("无衬线字体");expect(html).toContain("主标题较大");expect(html).toContain("本轮只改：交付范围");expect(html).not.toContain("创作方案字段不完整");
  expect(renderToStaticMarkup(createElement(ViralCreationPackageView,{value:bp.xhsPackage}))).toContain("本轮只改：标题");
 });
});
