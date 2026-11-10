import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** 前台零技术泄漏（1110）：以下文件的用户可见文案已清掉模型 / 通道名，只许注释里出现。 */
const TECH = /Gemini|GLM|DeepSeek|Seedance|EvoLink|BytePlus|Vertex|OpenRouter|Qwen|GPT/;
const CLEAN_FILES = [
  "components/HomeEnterpriseAgentCard.tsx",
  "components/HomeProductGuide.tsx",
  "components/HomeFeatureCarousel.tsx",
  "components/WorkAmbientPanel.tsx",
  "components/code-motion/CodeMotionImageProduction.tsx",
  "components/code-motion/CodeMotionRevision.tsx",
  "components/canvas/ManhuaEpisodeOptimization.tsx",
  "components/canvas/ManhuaAdvisorMediaEdit.tsx",
  "components/canvas/ManhuaCreativeAdvisorPanel.tsx",
  "pages/EnterpriseAgentManager.tsx",
  "pages/RemixStudio.tsx",
  "pages/ResearchPage.tsx",
];
const visible = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    .split("\n")
    .filter(line => !/^\s*(\/\/|\*|\/\*|import |\{\/\*)/.test(line))
    .map(line => line.replace(/\/\/.*$/, ""));

it.each(CLEAN_FILES)("%s 不向普通用户显示模型或通道名", file => {
  expect(visible(file).filter(line => TECH.test(line))).toEqual([]);
});

it("语音顾问面板：模型与通道名只在 supervisor 调试入口出现", () => {
  const leaks = visible("components/canvas/CreativeVoicePanel.tsx").filter(line => /Gemini|GLM|DeepSeek|Vertex|Google/.test(line));
  expect(leaks.length).toBeGreaterThan(0);
  for (const line of leaks) expect(line).toMatch(/debug \?|\? "开始语音／看片管理者测试：会调用Google/);
});
