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
  // 1111 MV 深度编排选择
  "components/canvas/CanvasMvCreativeAdvisor.tsx",
  "pages/EnterpriseAgentManager.tsx",
  "pages/RemixStudio.tsx",
  "pages/ResearchPage.tsx",
  // 1772 探针补漏
  "pages/MyWorks.tsx",
  "pages/Redeem.tsx",
  "pages/WorkspaceStudio.tsx",
  "pages/CreativePage.tsx",
  // 1111 拉片复刻爆款合并
  "components/HomeVideoBreakdown.tsx",
  "components/videoBreakdown/VideoBreakdownResult.tsx",
  "components/videoBreakdown/VideoBreakdownOverviewExtras.tsx",
  "pages/VideoBreakdown.tsx",
  "pages/RemixLanding.tsx",
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

/**
 * 1111 扩充：模型 / 通道 / 供应商 / 云厂商名（含出图档代号、配乐供应商、视频引擎代号）。
 * 只有 Seedance 引擎名按站长 1110 决定可留在界面上，故不在本表。
 */
const TECH_EXTENDED =
  /Gemini|GLM|DeepSeek|EvoLink|BytePlus|Vertex|OpenRouter|WaveSpeed|Qwen|Kimi|GPT|OpenAI|Kling|可灵|即梦|Jimeng|Nano ?Banana|Hailuo|海螺|MiniMax|Minimax|\bH3\b|Happy ?Horse|\bWan ?\d|Sunburst|Flare|Suno|Udio|OmniHuman|百炼|Tripo|Marble|\bFly\b|Vercel|Cloud ?Run|Google/;
const EXTENDED_CLEAN_FILES = [
  "components/canvas/ManhuaAdvisorMediaEdit.tsx",
  "components/platform/ViralProductionPanel.tsx",
  "components/NbpEngineSelector.tsx",
  "components/CreationManager.tsx",
  "components/DigitalHumanCinemaPanel.tsx",
  "components/code-motion/CodeMotionSpatialGenerator.tsx",
  "pages/CreativePage.tsx",
  "pages/ResearchPage.tsx",
  "pages/Storyboard.tsx",
  "pages/WorkflowStoryboardToVideo.tsx",
  "pages/MVAnalysis.tsx",
  "lib/manhuaPremixMaster.ts",
  "lib/advisorMediaImageJob.ts",
];
/** 用户可见文案 = 字符串字面量与 JSX 文本；代码标识符、对象键、调试面板另行判定。 */
const visibleText = (file: string) =>
  visible(file).flatMap(line =>
    Array.from(line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g))
      .map(m => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "")
      .filter(s => /[一-鿿]|\s/.test(s)),
  );

/** 仅调试模式渲染的技术字段（文件内须有对应 debugMode 闸门，下方单独断言）。 */
const DEBUG_ONLY_TEXT: Record<string, string[]> = { "pages/WorkflowStoryboardToVideo.tsx": [" hasOpenAI="] };

it.each(EXTENDED_CLEAN_FILES)("%s 用户可见文案不含模型 / 通道 / 供应商名（Seedance 除外）", file => {
  const allowed = new Set(DEBUG_ONLY_TEXT[file] ?? []);
  expect(visibleText(file).filter(s => TECH_EXTENDED.test(s) && !allowed.has(s))).toEqual([]);
});

it("/workflow 环境密钥状态只在调试模式渲染", () => {
  expect(visible("pages/WorkflowStoryboardToVideo.tsx").join("\n")).toMatch(/\{debugMode && envStatus \? \(/);
});

it("引擎 / 线路下拉的显示名：除 Seedance 外不露模型名", async () => {
  const { VIDEO_MODEL_OPTIONS } = await import("./canvasTypes");
  const { DIGITAL_HUMAN_FILM_MODELS } = await import("@shared/digitalHumanFilmDirector");
  const { MANHUA_WRITER_MODELS, manhuaWriterModelLabel } = await import("@shared/manhuaWriterModels");
  const { NOVEL_MODEL_OPTIONS, novelModelLabel } = await import("@shared/novelWorkspace");
  const labels = [
    ...VIDEO_MODEL_OPTIONS.map(o => o.label),
    ...Object.values(DIGITAL_HUMAN_FILM_MODELS).map(o => o.label),
    ...MANHUA_WRITER_MODELS.map(o => o.label),
    manhuaWriterModelLabel("glm"),
    manhuaWriterModelLabel("deepseek"),
    manhuaWriterModelLabel("carbon"),
    ...NOVEL_MODEL_OPTIONS.map(o => o.label),
    ...["z-ai/glm-5.3-flashx", "deepseek-v4.1-flash", "qwen3.8-max", "gpt-5.6-sol"].map(novelModelLabel),
  ];
  expect(labels.map(l => l.replace(/Seedance/g, "")).filter(l => TECH_EXTENDED.test(l))).toEqual([]);
  // 未知模型标识也不原样回显
  expect(novelModelLabel("gpt-5.6-sol")).toBe("创作线路");
  // 1111 线路三 / 深度编排 / 精读升级档：只出中性叫法
  const { MUSIC_MV_COMPOSE_ENGINE_LABELS } = await import("@shared/canvasMusicMv");
  const { MANHUA_WRITER_MODEL_HINTS } = await import("@shared/manhuaWriterModels");
  expect(novelModelLabel("gemini-4-carbon")).toBe("线路三");
  const carbonLabels = [...Object.values(MUSIC_MV_COMPOSE_ENGINE_LABELS), ...Object.values(MANHUA_WRITER_MODEL_HINTS), manhuaWriterModelLabel("carbon"), novelModelLabel("gemini-4-carbon"), ...NOVEL_MODEL_OPTIONS.map(o => o.label)];
  expect(carbonLabels.filter(l => /Carbon|Argon|Gemini|EvoLink|Vertex/i.test(l))).toEqual([]);
});

it("大文件逐条核对：画布出片提示、混音提示与报错不露非 Seedance 引擎 / 供应商名", () => {
  const files = ["components/canvas/FreeformCanvas.tsx", "components/canvas/CanvasAudioStudio.tsx", "lib/canvasRunBlock.ts", "lib/growthCampImagePipeline.ts", "components/DigitalHumanStudio.tsx"];
  const leaks = files.flatMap(file =>
    visibleText(file)
      .filter(s => /[一-鿿]/.test(s))
      .filter(s => /Sunburst|Flare|Minimax|MiniMax|\bH3\b|Happy ?Horse|\bWan ?\d|GPT-Image|\bFly\b|百炼|OmniHuman/.test(s))
      .map(s => `${file}: ${s.slice(0, 80)}`),
  );
  expect(leaks).toEqual([]);
});
