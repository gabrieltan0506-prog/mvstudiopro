import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ManhuaRewriteComparison } from "../components/canvas/ManhuaRewriteComparison";

afterEach(() => vi.unstubAllGlobals());

it("逐句对比显示完整长剧情与对白，技术分镜不混入剧情展示", () => {
  // 此测试配置使用经典 JSX 转译，生产前端由 Vite 的自动 JSX 运行时提供 React。
  vi.stubGlobal("React", React);
  const story = `开场：门响了。${"他等了一刻，才回应。".repeat(1200)}结尾：灯灭了。`;
  const revised = `${story}她终于走进门。`;
  const technical = "\n\n## 可拍表\n| 镜号 | 秒位 | 动作 |\n| 1 | 0-4s | TECHNICAL_KEEP |";
  const before = story + technical;
  const after = revised + technical;
  const html = renderToStaticMarkup(createElement(ManhuaRewriteComparison, { before, after }));
  const texts = (side: string) => Array.from(html.matchAll(new RegExp(`data-diff-text="${side}"[^>]*>(.*?)</span>`, "gs")), match => match[1]?.replace(/<[^>]+>/g, "")).join("");
  expect(texts("before")).toBe(story);
  expect(texts("after")).toBe(revised);
  expect(html).not.toContain("TECHNICAL_KEEP");
  expect(before).toBe(story + technical);
  expect(after).toBe(revised + technical);
});
it("相同句与改写句内未变字词都不着色，仅改动片段进入mark", () => {
 vi.stubGlobal("React", React);
 const html=renderToStaticMarkup(createElement(ManhuaRewriteComparison,{before:"门没有开。他慢慢抬头。",after:"门没有开。他猛地抬头。"}));
 expect(Array.from(html.matchAll(/<mark\b[^>]*>(.*?)<\/mark>/g),m=>m[1])).toEqual(["慢慢","猛地"]);
 expect(html).not.toContain("bg-amber");
});
