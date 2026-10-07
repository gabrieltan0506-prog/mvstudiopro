import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { manhuaRestoreConfirmationBlocker } from "./manhuaShotTimingApply";

function actualCallback(name: string, context: Record<string, unknown>) {
  const source = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]!.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!callback) throw new Error(`缺少真实回调：${name}`);
  return runInNewContext(ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

it.each(["保留", "换作品", "改草稿", "改画布", "启动任务"])("等待完整快照后校验当前状态：%s", async action => {
  const blocks: unknown[] = [];
  const writerPack = { seriesTitle: "当前作品" };
  const snapshot = { writerSession: { writerPack }, blocks };
  let release!: (value: number[]) => void;
  const context = {
    user: { id: 1 }, writerPack, blocks, projectBible: { confirmedAt: "v1" }, localStorage: {},
    latestDraftSnapshotRef: { current: snapshot }, currentVoiceStoryboardScope: { current: "作品A" }, blocksRef: { current: blocks },
    advisorRewriteRuntimeBusyRef: { current: false }, advisorRewriteHasActiveWork: () => false,
    loadAdvisorReconfirmationEpisodeIndexes: vi.fn(() => new Promise<number[]>(resolve => { release = resolve; })),
  };
  const read = actualCallback("readWriterReconfirmation", context);
  const pending = read();
  if (action === "换作品") context.currentVoiceStoryboardScope.current = "作品B";
  if (action === "改草稿") context.latestDraftSnapshotRef.current = { ...snapshot };
  if (action === "改画布") context.blocksRef.current = [...blocks];
  if (action === "启动任务") context.advisorRewriteRuntimeBusyRef.current = true;
  release([2]);
  if (action === "保留") await expect(pending).resolves.toEqual([2]);
  else await expect(pending).rejects.toThrow(action === "启动任务" ? "运行或待核实任务" : "已改变");
});

it("独立快照中有已采用改写时，不能通过只恢复确认绕过重新铺板", async () => {
  const context = {
    writerConfirmationBusyRef: { current: false }, readWriterReconfirmation: vi.fn(async () => [2]),
    maskMediaProviderDetails: (text: string) => text, toast: { error: vi.fn(), success: vi.fn() },
    manhuaRestoreConfirmationBlocker, blocks: [], writerPack: null, writerFocusEpisode: 2,
    window: { confirm: vi.fn(() => true) }, setWriterConfirmed: vi.fn(), setDirectorUnlocked: vi.fn(),
  };
  await actualCallback("restoreWriterConfirmation", context)();
  expect(context.window.confirm).not.toHaveBeenCalled();
  expect(context.setWriterConfirmed).not.toHaveBeenCalled();
  expect(context.setDirectorUnlocked).not.toHaveBeenCalled();
  expect(context.toast.error).toHaveBeenCalledWith(expect.stringContaining("已采用的顾问改写"));
  expect(context.writerConfirmationBusyRef.current).toBe(false);
});
