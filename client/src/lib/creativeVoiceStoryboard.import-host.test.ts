import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { importManhuaEpisodeStoryboard, spawnManhuaDramaStudio } from "./canvasDramaStudio";
import { saveVoiceStoryboard, voiceStoryboardSource } from "./creativeVoiceStoryboard";
import { getManhuaSegmentCapacityMode } from "@shared/manhuaSegmentCapacity";

function fixture() {
  const source = fs.readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("OmniCanvas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "prepareImportedStoryboard") declaration = node; ts.forEachChild(node, visit); };
  visit(ast);
  if (!declaration) throw new Error("正式导入回调不存在");
  const code = ts.transpileModule(`${declaration.getText(ast)}\nprepareImportedStoryboard`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const graph = spawnManhuaDramaStudio({ topic: "针光", episodeIndex: 2 });
  const values = new Map<string, string>();
  const context = {
    Error, crypto: { randomUUID: () => "test-import-id" },
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } },
    readVoiceStoryboardRaw: async (storage: Storage, key: string) => storage.getItem(key),
    saveVoiceStoryboardDurable: async (storage: Storage, key: string, candidate: Parameters<typeof saveVoiceStoryboard>[2], options: { expectedRaw?: string | null } = {}) => {
      if (Object.prototype.hasOwnProperty.call(options, "expectedRaw") && storage.getItem(key) !== options.expectedRaw) throw new Error("另一窗口已保存");
      saveVoiceStoryboard(storage, key, candidate);
    },
    voiceStoryboardSource, importManhuaEpisodeStoryboard, voiceStoryboardLoading: false,
    currentVoiceStoryboardScope: { current: "test-user:project-a" }, currentVoiceStoryboardSource: { current: (_episode: number): string => "" },
    voiceStoryboard: null, writerBusy: false, factoryBusy: false, cloudConflict: null, voiceStoryboardScope: "test-user:project-a", voiceStoryboardKey: "candidate",
    writerConfirmed: true, writerPack: { episodes: [{ index: 2, body: "先生针光入穴。", storyboardNeedsReview: true }] },
    voiceStoryboardLock: { current: false }, abortRef: { current: null }, blocksRef: { current: graph.blocks }, edges: graph.edges,
    advisorRewriteHasActiveWork: () => false, setVoiceStoryboard: vi.fn(), setVoiceStoryboardVisible: vi.fn(),
    projectBible: undefined, publicTemplateId: undefined, writerModel: "test", customAssetRefs: [], explicitWriterVideoModel: undefined,
    characterLookSets: [], segmentLookBindings: [], segmentCapacityModeByEpisode: {}, writerLengthTierId: "short",
    getManhuaSegmentCapacityMode, ensureStudioSpawned: () => graph, factoryTopic: "针光",
    storyEmotionLineByEpisodeSegment: {}, activeDirectionCanon: undefined, consumableCustomAssetRefs: [],
    collectManhuaCharacterSheetUrlById: () => ({}), collectManhuaPropImageUrlById: () => ({}),
    directorBoardUrlByEpisode: {}, directorBoardUrlByEpisodeSegment: {}, directorBoardMotionOverlayBySegment: {},
  };
  context.currentVoiceStoryboardSource.current = episode => voiceStoryboardSource(context.blocksRef.current, context.edges, JSON.stringify({body:context.writerPack.episodes.find(item=>item.index===episode)?.body}));
  const run = runInNewContext(code, context) as (episode: number, text: string) => Promise<void>;
  return { run, context, values, graph };
}
const table = "## 分镜表\n| 镜号 | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |\n|---|---|---|---|---|---|\n| 1 | 0–5s | 近景·跟拍 | 先生针光入穴 | 无对白 | 针光 |\n| 2 | 5–10s | 中景·固定 | 娘喘息平稳 | 无对白 | 呼吸 |";

it("实际宿主只保存并展示候选，导入不直接采用，不发出付费请求", async () => {
  const { run, context, values, graph } = fixture(), original = JSON.stringify(graph);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止联网"));
  try {
    await run(2, table);
    expect(JSON.stringify(graph)).toBe(original);
    expect(JSON.parse(values.get("candidate")!)).toMatchObject({ id: "test-import-id", scope: context.voiceStoryboardScope, episode: 2, status: "ready", resultState: "returned", text: table });
    expect(context.setVoiceStoryboardVisible).toHaveBeenLastCalledWith(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(context.voiceStoryboardLock.current).toBe(false);
  } finally { fetch.mockRestore(); }
});

it.each(["pending", "ready", "failed"])("已有%s结果或未知请求不被导入覆盖", async status => {
  const { run, values, context } = fixture();
  const old = JSON.stringify({ id: "test-existing", scope: context.voiceStoryboardScope, status, resultState: "unknown" });
  values.set("candidate", old);
  await expect(run(2, table)).rejects.toThrow(/已有分镜候选或待核实/);
  expect(values.get("candidate")).toBe(old);
});

it("保存失败不显示可采用候选；坏秒位和忙状态均不写真源", async () => {
  const { run, context, values } = fixture();
  await expect(run(2, "没有秒位的文字说明")).rejects.toThrow(/完整秒位分镜表/);
  expect(values.size).toBe(0);
  context.factoryBusy = true;
  await expect(run(2, table)).rejects.toThrow(/制作任务/);
  context.factoryBusy = false;
  context.localStorage.setItem = () => { throw new Error("quota test"); };
  await expect(run(2, table)).rejects.toThrow("quota test");
  expect(context.setVoiceStoryboard).not.toHaveBeenCalled();
  expect(context.voiceStoryboardLock.current).toBe(false);
});

it("物化期间另一窗口新增未知请求时，正式宿主拒绝覆盖", async () => {
  const { run, context, values } = fixture();
  const previous = JSON.stringify({ id: "test-other-tab", scope: context.voiceStoryboardScope, status: "pending", resultState: "unknown" });
  const original = context.importManhuaEpisodeStoryboard;
  context.importManhuaEpisodeStoryboard = input => { const result = original(input); values.set("candidate", previous); return result; };
  await expect(run(2, table)).rejects.toThrow(/另一窗口已保存/);
  expect(values.get("candidate")).toBe(previous);
  expect(context.setVoiceStoryboard).not.toHaveBeenCalled();
});

it("34镜超容量时不截断；明确按原稿分段后候选保留全部镜头", async () => {
  const { run, context, values } = fixture();
  const full = table.split("| 1 |")[0] + Array.from({ length: 34 }, (_, i) => `| ${i + 1} | ${i * 5}–${(i + 1) * 5}s | 中景·跟拍 | 虚构镜${i + 1} | 无对白 | 环境声 |`).join("\n");
  await expect(run(2, full)).rejects.toThrow(/超出当前引擎固定容量/);
  expect(values.size).toBe(0);
  Object.assign(context.segmentCapacityModeByEpisode, { "2": "auto_by_source" });
  await run(2, full);
  expect(JSON.parse(values.get("candidate")!).text).toBe(full);
  expect(context.setVoiceStoryboardVisible).toHaveBeenLastCalledWith(true);
});

it("读取原请求期间切换作品不保存或展示旧作品候选", async () => {
  const { run, context, values } = fixture();
  context.readVoiceStoryboardRaw = async () => { context.currentVoiceStoryboardScope.current = "other-project"; return null; };
  await expect(run(2, table)).rejects.toThrow(/作品或画布已变化/);
  expect(values.size).toBe(0); expect(context.setVoiceStoryboard).not.toHaveBeenCalled();
  expect(context.voiceStoryboardLock.current).toBe(false);
});
