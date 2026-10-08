import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { requireVoiceStoryboardCandidate, voiceStoryboardSource, type VoiceStoryboardCandidate } from "./creativeVoiceStoryboard";
import type { CanvasBlock, CanvasEdge } from "./canvasTypes";

function fixture() {
  const source = fs.readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("OmniCanvas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "applyVoiceStoryboard") declaration = node; ts.forEachChild(node, visit); };
  visit(ast); if (!declaration) throw new Error("正式采用入口不存在");
  const original: CanvasBlock[] = [], edges: CanvasEdge[] = [];
  const originalSource = voiceStoryboardSource(original, edges, "原正文");
  const candidate: VoiceStoryboardCandidate = { id: "candidate", scope: "1:project-a", episode: 2, status: "ready", source: originalSource, text: "完整34镜", blocks: [{ id: "test-preserved", x: 0, y: 0, status: "done", outputUrl: "/existing.mp4" } as CanvasBlock], edges };
  let raw: string | null = JSON.stringify(candidate);
  const context = {
    Error, JSON, voiceStoryboardLoading: false, voiceStoryboardLock: { current: false }, writerBusy: false, factoryBusy: false, cloudConflict: null,
    voiceStoryboardScope: candidate.scope, voiceStoryboardKey: "candidate", currentVoiceStoryboardScope: { current: candidate.scope },
    currentVoiceStoryboardSource: { current: () => originalSource }, voiceStoryboard: candidate,
    localStorage: {}, readVoiceStoryboardRaw: vi.fn(async () => raw), requireVoiceStoryboardCandidate,
    advisorRewriteHasActiveWork: () => false, window: { confirm: vi.fn(() => true) }, backupSceneProduction: vi.fn(async () => {}),
    saveCanvasState: vi.fn(() => true), blocksRef: { current: original }, setBlocks: vi.fn(), setEdges: vi.fn(), bumpManhuaOutboundEpoch: vi.fn(),
    setWriterFocusEpisode: vi.fn(), setWorkflowPhase: vi.fn(), setManhuaUiMode: vi.fn(), setImmersiveWorkspaceView: vi.fn(), setVoiceStoryboardVisible: vi.fn(),
  };
  const code = ts.transpileModule(`${declaration.getText(ast)}\napplyVoiceStoryboard`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = runInNewContext(code, context) as (episode: number) => Promise<string>;
  return { run, context, candidate, setRaw: (next: string | null) => { raw = next; }, original };
}

it("实际采用入口先完成大快照备份再保存分镜，保留已有视频", async () => {
  const { run, context, candidate } = fixture();
  const result = await run(2);
  expect(result).toContain("已采用并保存");
  expect(context.backupSceneProduction).toHaveBeenCalledWith(undefined, 2);
  expect(context.backupSceneProduction.mock.invocationCallOrder[0]).toBeLessThan(context.saveCanvasState.mock.invocationCallOrder[0]);
  expect(context.saveCanvasState).toHaveBeenCalledWith(candidate.blocks, candidate.edges);
  expect(context.blocksRef.current[0].outputUrl).toBe("/existing.mp4");
  expect(context.voiceStoryboardLock.current).toBe(false);
});

it("备份期间画布/正文或原请求改变，禁止写回新版本", async () => {
  for (const change of ["source", "request"] as const) {
    const { run, context, setRaw, original } = fixture();
    context.backupSceneProduction.mockImplementation(async () => {
      if (change === "source") context.currentVoiceStoryboardSource.current = () => "changed";
      else setRaw("另一窗口的新请求");
    });
    await expect(run(2)).rejects.toThrow(/变化/);
    expect(context.saveCanvasState).not.toHaveBeenCalled(); expect(context.blocksRef.current).toBe(original);
    expect(context.voiceStoryboardLock.current).toBe(false);
  }
});

it("读取失败、备份失败或最终画布保存失败均不采用，不掩盖原产物", async () => {
  for (const failure of ["read", "backup", "canvas"] as const) {
    const { run, context, original } = fixture();
    if (failure === "read") context.readVoiceStoryboardRaw.mockRejectedValue(new Error("读取失败"));
    if (failure === "backup") context.backupSceneProduction.mockRejectedValue(new Error("备份失败"));
    if (failure === "canvas") context.saveCanvasState.mockReturnValue(false);
    await expect(run(2)).rejects.toThrow(/失败/);
    expect(context.setBlocks).not.toHaveBeenCalled(); expect(context.blocksRef.current).toBe(original);
    expect(context.voiceStoryboardLock.current).toBe(false);
  }
});

it("用户取消采用时不备份不写回，读取期间切换作品也不采用", async () => {
  const first = fixture(); first.context.window.confirm.mockReturnValue(false);
  expect(await first.run(2)).toContain("用户取消"); expect(first.context.backupSceneProduction).not.toHaveBeenCalled();
  const second = fixture();
  second.context.readVoiceStoryboardRaw.mockImplementation(async () => { second.context.currentVoiceStoryboardScope.current = "1:other"; return JSON.stringify(second.candidate); });
  await expect(second.run(2)).rejects.toThrow(/作品已变化/); expect(second.context.backupSceneProduction).not.toHaveBeenCalled();
});
