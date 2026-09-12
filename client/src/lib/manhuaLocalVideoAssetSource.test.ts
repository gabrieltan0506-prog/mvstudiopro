import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("client/src/components/platform/PlatformAssetAnalysisPanel.tsx", "utf8");
const ast = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// 执行父入口的真实处理器，覆盖子上传面板尚未挂载或已卸载的时间段。
function handler(name: "ingestVideo" | "removeVideo" | "clear", bindings: Record<string, unknown>) {
  let arrow: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name
      && node.initializer && ts.isCallExpression(node.initializer)) {
      const candidate = node.initializer.arguments[0];
      if (ts.isArrowFunction(candidate)) arrow = candidate;
    }
    if (name === "clear" && ts.isJsxAttribute(node) && node.name.getText(ast) === "onClick"
      && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)
      && node.initializer.expression.getText(ast).includes("setAssets([])")) arrow = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!arrow) throw new Error(`缺少真实入口 ${name}`);
  const code = ts.transpileModule(`const extracted = ${arrow.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return extracted;`)(...Object.values(bindings));
}
function fixture() {
  const state: { ready: string | null; video: any } = { ready: "旧片来源", video: { id: "old", ready: true } };
  const bindings: Record<string, unknown> = {
    onVideoRhythmSourceReset: () => { state.ready = null; },
    isGrowthCampVideoFile: () => true,
    newPlatformImageAssetId: () => "new",
    setVideoAsset: (value: any) => {
      expect(state.ready).toBeNull();
      state.video = typeof value === "function" ? value(state.video) : value;
    },
  };
  for (const name of ["setError", "setAnalysis", "setImagePipelineDebug", "setAssets", "setPartialAnalyses",
    "setMergePending", "setContext", "setStage", "setUploadProgress", "setOptimizedMarkdown", "setOptimizeSummary"]) bindings[name] = vi.fn();
  return { state, bindings };
}

describe("素材分析父入口清除旧学习来源", () => {
  it("选择新视频即同步清除旧来源，预览失败后也不能恢复旧片", async () => {
    const { state, bindings } = fixture();
    let reject!: (error: Error) => void;
    bindings.extractVideoPreview = () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
    handler("ingestVideo", bindings)({ name: "新片.mp4", type: "video/mp4", size: 10 });
    expect(state.ready).toBeNull();
    expect(state.video.ready).toBe(false);
    reject(new Error("预览失败"));
    await Promise.resolve();
    expect(state.video.readError).toBe("预览失败");
    expect(state.ready).toBeNull();
  });
  it.each(["removeVideo", "clear"] as const)("%s 在卸载上传子面板前清除旧学习来源", name => {
    const { state, bindings } = fixture();
    handler(name, bindings)();
    expect(state.ready).toBeNull();
    expect(state.video).toBeNull();
  });
});
