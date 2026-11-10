import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** 前台零技术泄漏（1110）：以下文件的用户可见文案已清掉模型 / 通道名，只许注释里出现。 */
const TECH = /Gemini|GLM|DeepSeek|Seedance|EvoLink|BytePlus|Vertex|OpenRouter|Qwen|GPT|Kling|可灵|Nano ?Banana|Hailuo|海螺|MiniMax|modelUsed/;
/**
 * Seedance 引擎名白名单（待用户决定）：画布出片下拉、相关报错文案、/create 模型下拉里的 Seedance 暂不改，
 * 以下文件里的 Seedance 先放行；用户拍板后删掉本表并把文案换成中性名。
 */
const SEEDANCE_PENDING_FILES = new Set<string>([]);
/** 代码标识符（如 KlingImagePanel、isGptImage2）不是用户可见文案，先剥掉再查。 */
const stripIdentifiers = (line: string) => line.replace(/\b\w*(?:Kling|GPT)[A-Z]\w*/g, "");
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
  // 1772 探针补漏
  "pages/MyWorks.tsx",
  "pages/Redeem.tsx",
  "pages/WorkspaceStudio.tsx",
  "pages/CreativePage.tsx",
];
const visible = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    .split("\n")
    .filter(line => !/^\s*(\/\/|\*|\/\*|import |\{\/\*)/.test(line))
    .map(line => line.replace(/\/\/.*$/, ""));

it.each(CLEAN_FILES)("%s 不向普通用户显示模型或通道名", file => {
  const lines = visible(file)
    .map(stripIdentifiers)
    .map(line => (SEEDANCE_PENDING_FILES.has(file) ? line.replace(/Seedance/g, "") : line));
  expect(lines.filter(line => TECH.test(line))).toEqual([]);
});

it("企业 Agent 调用历史：modelUsed 只给 supervisor / admin 看", () => {
  const lines = visible("pages/EnterpriseAgentDetail.tsx").filter(line => /\{[^}]*modelUsed/.test(line));
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line).toMatch(/canSeeModel &&/);
  expect(visible("pages/EnterpriseAgentDetail.tsx").join("\n")).toMatch(
    /canSeeModel = user\?\.role === "admin" \|\| user\?\.role === "supervisor"/,
  );
});

it("/test-lab 只对 supervisor / admin 开放", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  expect(app).toMatch(/path=\{"\/test-lab"\} component=\{SupervisorTestLabRoute\}/);
  const guard = app.slice(app.indexOf("function SupervisorTestLabRoute"), app.indexOf("function LegacyRemixRedirect"));
  expect(guard).toMatch(/user\?\.role !== "admin" && user\?\.role !== "supervisor"\) return <NotFound \/>/);
});

it("语音顾问面板：模型与通道名只在 supervisor 调试入口出现", () => {
  const leaks = visible("components/canvas/CreativeVoicePanel.tsx").filter(line => /Gemini|GLM|DeepSeek|Vertex|Google/.test(line));
  expect(leaks.length).toBeGreaterThan(0);
  for (const line of leaks) expect(line).toMatch(/debug \?|\? "开始语音／看片管理者测试：会调用Google/);
});
