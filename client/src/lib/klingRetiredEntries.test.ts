import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KLING_RETIRED_CLIENT } from "@shared/klingRetired";
import { getModelById, getModelsByFamily, getModelsByGroup } from "./aiStudioRegistry";

/** 可灵停用（方案 A）·前端入口：停用常量下不渲染任何可灵创建入口；历史作品展示不动。 */
const src = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("前端停用常量", () => {
  it("前端恒为停用", () => expect(KLING_RETIRED_CLIENT).toBe(true));
});

describe("模型注册表", () => {
  it("可选列表不含可灵项，按 id 仍能查到旧配置（旧草稿不丢）", () => {
    expect(getModelsByFamily("video").some((m) => m.provider === "kling")).toBe(false);
    expect(getModelsByFamily("image").some((m) => m.provider === "kling")).toBe(false);
    expect(getModelsByGroup("kling")).toEqual([]);
    expect(getModelsByFamily("music").length).toBeGreaterThan(0);
    expect(getModelById("kling-video-2.6")?.provider).toBe("kling");
  });
});

describe("监管测试台", () => {
  it("实际渲染的生图引擎下拉里没有可灵选项", async () => {
    const { default: TestLab } = await import("../pages/TestLab");
    const html = renderToStaticMarkup(createElement(TestLab));
    expect(html).toContain('value="google"');
    expect(html).not.toContain('value="kling"');
    expect(html).not.toMatch(/Kling/);
  });
  it("源码里每个可灵选项都挂在停用常量之后", () => {
    const lines = src("pages/TestLab.tsx").split("\n").filter((l) => l.includes('<option value="kling"'));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toMatch(/KLING_RETIRED_CLIENT \? null :/);
  });
});

describe("工作室控制（旧工作流）", () => {
  it("可灵开关区整块挂在停用常量的否分支，停用分支只给中文提示、不调保存", () => {
    const s = src("pages/WorkspaceStudio.tsx");
    const gate = s.indexOf("{KLING_RETIRED_CLIENT ? (");
    const notice = s.indexOf('data-testid="kling-retired-notice"');
    const controls = s.indexOf("工作室控制 V1");
    const save = s.indexOf("onClick={handleSaveStudioControls}");
    expect(gate).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(gate);
    expect(controls).toBeGreaterThan(notice);
    expect(save).toBeGreaterThan(controls);
    const noticeBlock = s.slice(notice, controls);
    expect(noticeBlock).toMatch(/已下线/);
    expect(noticeBlock).not.toMatch(/Kling|可灵|mutate|handleSave/);
  });
});

describe("营销位与路由残留", () => {
  it("作品展示页的「影视级视频」筛选页签在停用常量下不出现", () => {
    expect(src("pages/Showcase.tsx")).toMatch(/\.\.\.\(KLING_RETIRED_CLIENT \? \[\] : \[\{ id: "kling", label: "影视级视频"/);
  });
  it("App 路由与导航里没有可灵工作室 / 旧 remix 入口", () => {
    const app = src("App.tsx");
    const nav = src("components/Navbar.tsx");
    for (const s of [app, nav]) {
      expect(s).not.toMatch(/kling-studio|RemixStudio|path=\{"\/remix"\}|href: "\/remix"/i);
    }
  });
});
