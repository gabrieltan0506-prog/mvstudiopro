import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { buildManhuaWriterSession, serializeManhuaWriterSession, MANHUA_WRITER_SESSION_LS_KEY } from "@shared/manhuaWriterSession";
import { formatManhuaWriterPackMarkdown, type ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import { buildManhuaStoryAssetRefreshPrompt, parseManhuaStoryAssetRefresh } from "./manhuaStoryAssetRefresh";
import { ManhuaStoryAssetRefreshRunError, readManhuaStoryAssetRefreshRun, runManhuaStoryAssetRefresh } from "./manhuaStoryAssetRefreshRun";
import { prepareManualEpisodeEditAdoption } from "./manhuaAdvisorAdoption";

const source = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("OmniCanvas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let helper = "";
let ingestHelper = "";
let imageTry = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "refreshStoryAssetsAfterAdoption") helper = node.getText(tree);
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "ingestSheetToMyLibrary" && node.initializer) ingestHelper = node.initializer.getText(tree);
  if (ts.isTryStatement(node) && node.tryBlock.getText(tree).includes("out = await runCanvasBlock(") && node.catchClause?.getText(tree).includes("previousBlock")) imageTry = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
const code = ts.transpileModule(`${helper}\nrefreshStoryAssetsAfterAdoption`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const pack: ManhuaWriterPack = { seriesTitle: "旧约", logline: "赴约", rawMarkdown: "旧剧情", episodeCount: 2,
    charactersMd: "- 沈砚舟｜青年青衫｜守约｜认识阿菁｜守信", propsMd: "- 玉扣｜信物｜白玉", locationsMd: "- 湖边｜安静｜石桥残荷",
    episodes: [{ index: 1, title: "赴约", body: "沈砚舟带玉扣到湖边。", endHook: "有人出现" }, { index: 2, title: "归家", body: "阿菁已归家。", endHook: "门开了" }] };
  const plan = prepareManualEpisodeEditAdoption({ writerPack: pack, projectBible: null, blocks: [], edges: [], overlays: {}, busy: false,
    edit: { episodeIndex: 1, originalBody: pack.episodes[0].body, originalEndHook: pack.episodes[0].endHook, body: "沈砚舟带裂纹玉扣到湖边。", endHook: pack.episodes[0].endHook } });
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const writerSession = buildManhuaWriterSession({ writerPack: plan.writerPack });
  values.set(MANHUA_WRITER_SESSION_LS_KEY, serializeManhuaWriterSession(writerSession));
  const snapshotRef = { current: { writerSession, blocks: [], edges: [] } };
  const scope = { current: "7:project-a" };
  const markdown = `## 人物表\n${pack.charactersMd}\n## 道具表\n- 玉扣｜信物｜有裂纹的白玉\n## 场景表\n${pack.locationsMd}`;
  const setStoryAssetRefresh = vi.fn(), setWriterPack = vi.fn(), setWriterBusy = vi.fn(), toast = { error: vi.fn(), success: vi.fn() };
  const optimizeCopyMutation = { mutateAsync: vi.fn(async () => ({ result: { optimizedMarkdown: markdown } })) };
  const confirmAssetsAndPrepareImages = vi.fn(async (opts: any) => {
    opts.assertCurrent();
    expect(opts.episodesOverride).toEqual(plan.writerPack.episodes);
    expect(opts.regenerateAnchorIds).toHaveLength(1);
    expect(opts.onlyAnchorIds).toEqual([]);
    expect(opts.assetCanonOverride.props[0].lookZh).toContain("裂纹");
    opts.onImageTaskCreated("propsheet-jade", "job-asset-1");
    opts.onReceipt({ planned: 1, completed: 1, assets: [] });
  });
  const context = { Error, voiceStoryboardScope: scope.current, currentVoiceStoryboardScope: scope, latestDraftSnapshotRef: snapshotRef,
    storyAssetRefreshKey: "story-assets-test", storyAssetRefreshLock: { current: false }, localStorage: storage, crypto: { randomUUID: () => "adoption-operation-1" },
    projectBible: null, writerModel: "glm", setWriterBusy, setFactoryProgress: vi.fn(), setStoryAssetRefresh,
    setWriterPack, setProjectBible: vi.fn(), runManhuaStoryAssetRefresh, ManhuaStoryAssetRefreshRunError,
    optimizeCopyMutation, buildManhuaStoryAssetRefreshPrompt, parseManhuaStoryAssetRefresh, buildManhuaWriterSession,
    serializeManhuaWriterSession, formatManhuaWriterPackMarkdown, MANHUA_WRITER_SESSION_LS_KEY,
    stashManhuaAssetBlocksBeforePurge: vi.fn(), seedIdFromManhuaSheetBlockId: (id: string) => id,
    confirmAssetsAndPrepareImages, toast, maskMediaProviderDetails: (message: string) => message };
  const run = runInNewContext(code, context) as (plan: ReturnType<typeof prepareManualEpisodeEditAdoption>) => Promise<void>;
  return { inputPack: pack, plan, run, context, values, snapshotRef, scope, storage, toast, setStoryAssetRefresh, setWriterPack, setWriterBusy, optimizeCopyMutation, confirmAssetsAndPrepareImages };
}

it("真实宿主采用后的资产桥保留正文与其他集，只提交相关旧资产的新图并保存任务号", async () => {
  const f = fixture(); await f.run(f.plan);
  expect(f.optimizeCopyMutation.mutateAsync).toHaveBeenCalledOnce();
  expect(f.confirmAssetsAndPrepareImages).toHaveBeenCalledOnce();
  expect(f.snapshotRef.current.writerSession.writerPack?.episodes).toEqual(f.plan.writerPack.episodes);
  expect(f.snapshotRef.current.writerSession.writerPack?.episodes[1]).toEqual(f.inputPack.episodes[1]);
  expect(f.snapshotRef.current.writerSession.writerPack?.propsMd).toContain("裂纹");
  expect(readManhuaStoryAssetRefreshRun(f.storage, "story-assets-test")).toMatchObject({ status: "done", imageTasks: [expect.objectContaining({ jobId: "job-asset-1" })] });
  expect(f.toast.error).not.toHaveBeenCalled();
  expect(f.setWriterBusy).toHaveBeenLastCalledWith(false);
});

it("真实宿主模型晚回时识别原正文已变，保全回包且不写资产/不生图", async () => {
  const f = fixture();
  f.optimizeCopyMutation.mutateAsync.mockImplementationOnce(async () => {
    f.snapshotRef.current.writerSession.writerPack!.episodes[0].body = "后来确认的新剧情";
    return { result: { optimizedMarkdown: "本次已付费模型回包" } };
  });
  await f.run(f.plan);
  expect(f.confirmAssetsAndPrepareImages).not.toHaveBeenCalled();
  expect(f.setWriterPack).not.toHaveBeenCalled();
  expect(readManhuaStoryAssetRefreshRun(f.storage, "story-assets-test")).toMatchObject({ status: "failed", settingsText: "本次已付费模型回包" });
  expect(f.toast.error).toHaveBeenCalled();
});

it("真实宿主缺失或部分图片回执不会报成功，不自动重提模型", async () => {
  const f = fixture();
  f.confirmAssetsAndPrepareImages.mockImplementationOnce(async opts => { opts.onImageTaskCreated("propsheet-jade", "partial-job"); opts.onReceipt({ planned: 1, completed: 0 }); });
  await f.run(f.plan);
  expect(readManhuaStoryAssetRefreshRun(f.storage, "story-assets-test")).toMatchObject({ status: "failed", result: { planned: 1, completed: 0 } });
  expect(f.toast.success).not.toHaveBeenCalled();
  await f.run(f.plan);
  expect(f.optimizeCopyMutation.mutateAsync).toHaveBeenCalledOnce();
  expect(f.confirmAssetsAndPrepareImages).toHaveBeenCalledOnce();
});

it("ASSET-R2：生成期间人工更新资产表后，旧模型回包不能覆盖新表", async () => {
  const f = fixture();
  f.optimizeCopyMutation.mutateAsync.mockImplementationOnce(async () => {
    f.snapshotRef.current.writerSession.writerPack!.propsMd = "- 玉扣｜人工新功能｜人工新外观";
    return { result: { optimizedMarkdown: "已付费取得但基线过期的完整三表" } };
  });
  await f.run(f.plan);
  expect(f.confirmAssetsAndPrepareImages).not.toHaveBeenCalled();
  expect(f.setWriterPack).not.toHaveBeenCalled();
  expect(f.snapshotRef.current.writerSession.writerPack?.propsMd).toContain("人工新外观");
  expect(readManhuaStoryAssetRefreshRun(f.storage, "story-assets-test")).toMatchObject({ status: "failed", settingsText: "已付费取得但基线过期的完整三表", error: expect.stringContaining("资产设定已改变") });
});

it("ASSET-R1：真实拼板裁切晚回时先核对scope，不把旧图写入已切换作品", async () => {
  expect(ingestHelper).not.toBe("");
  let current = true;
  const setCustomAssetRefs = vi.fn();
  const fn = runInNewContext(ts.transpileModule(`(${ingestHelper})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    opts: { assertCurrent: () => { if (!current) throw new Error("scope已改变"); } },
    seedIdFromManhuaSheetBlockId: () => "lake", cropManhuaSheet2x2: async () => { current = false; return [{ slot: "topLeft", url: "https://test.invalid/crop.png" }]; },
    setCustomAssetRefs, console: { warn: vi.fn() },
  });
  await expect(fn({ id: "sceneplate-lake", kind: "sceneplate", labelZh: "湖边", layout: "grid2x2" }, "https://test.invalid/old-sheet.png")).rejects.toThrow("scope已改变");
  expect(setCustomAssetRefs).not.toHaveBeenCalled();
});

it.each([true, false])("ASSET-R3：图片回执保存失败时同scope=%s安全恢复旧图，仍保留错误不重提", async sameScope => {
  expect(imageTry).not.toBe("");
  let sticky = false;
  const previousBlock = { id: "propsheet-jade", outputUrl: "https://test.invalid/old.png" };
  const saveCanvasState = vi.fn(), setBlocks = vi.fn(), blocksRef = { current: [] };
  const fn = runInNewContext(ts.transpileModule(`(async()=>{let out;${imageTry};return out;})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    opts: { assertCurrent: () => { if (sticky) throw new Error("job回执不可保存"); }, isCurrent: () => sameScope },
    runDeps: {}, runCanvasBlock: async () => { sticky = true; throw new Error("job回执不可保存"); },
    isRegenPlan: () => true, plan: { id: "propsheet-jade" }, deriveRefUrl: "", prevSheetUrl: previousBlock.outputUrl,
    block: { id: "propsheet-jade" }, previousBlock, working: [{ id: "propsheet-jade", outputUrl: undefined }], canvasEdges: [], saveCanvasState, blocksRef, setBlocks,
  });
  await expect(fn()).rejects.toThrow("job回执不可保存");
  if (sameScope) { expect(saveCanvasState).toHaveBeenCalledWith([previousBlock], []); expect(setBlocks).toHaveBeenCalledWith([previousBlock]); }
  else { expect(saveCanvasState).not.toHaveBeenCalled(); expect(setBlocks).not.toHaveBeenCalled(); }
});
