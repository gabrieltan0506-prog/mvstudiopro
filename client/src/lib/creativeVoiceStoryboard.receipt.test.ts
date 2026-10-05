import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { saveVoiceStoryboard, voiceStoryboardSource, voiceStoryboardResultState, normalizeVoiceStoryboardSource } from "./creativeVoiceStoryboard";

it("离线提取宿主函数：严格分镜校验失败前保存完整原文，下一次操作不重复付费", async () => {
  const source = fs.readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
  const begin = source.indexOf("  async function prepareVoiceStoryboard(");
  const end = source.indexOf("\n  function backupVoiceProduction", begin);
  expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
  const code = ts.transpileModule(`${source.slice(begin, end)}\nprepareVoiceStoryboard`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const text = "完整付费分镜原文".repeat(3000) + "末尾不可丢失";
  const optimizeCopy = vi.fn(async () => text);
  const setVoiceStoryboard = vi.fn();
  const graph = { blocks: [], edges: [] };
  const noop = () => {};
  const context = {
    Error, AbortController, crypto: { randomUUID: () => "test-receipt-id" }, window: { confirm: () => true },
    localStorage: storage, saveVoiceStoryboard, voiceStoryboardSource, voiceStoryboardResultState, normalizeVoiceStoryboardSource,
    voiceStoryboard: null, writerBusy: false, factoryBusy: false, cloudConflict: null,
    voiceStoryboardScope: "1:project", currentVoiceStoryboardScope: { current: "1:project" }, voiceStoryboardKey: "candidate",
    writerConfirmed: true, writerPack: { episodes: [{ index: 1, body: "原剧情", templateReferences: [{}, {}, {}] }] },
    voiceStoryboardLock: { current: false }, abortRef: { current: null }, blocksRef: { current: graph.blocks }, edges: graph.edges,
    advisorRewriteHasActiveWork: () => false, setFactoryBusy: noop, setVoiceStoryboard, setVoiceStoryboardVisible: noop,
    projectBible: undefined, publicTemplateId: undefined, writerModel: "glm", customAssetRefs: [], explicitWriterVideoModel: undefined,
    characterLookSets: [], segmentLookBindings: [], segmentCapacityModeByEpisode: {}, writerLengthTierId: "short",
    getManhuaSegmentCapacityMode: () => "auto", ensureStudioSpawned: () => graph, factoryTopic: "原剧情",
    storyEmotionLineByEpisodeSegment: {}, activeDirectionCanon: undefined, consumableCustomAssetRefs: [],
    collectManhuaCharacterSheetUrlById: () => ({}), collectManhuaPropImageUrlById: () => ({}),
    parseManhuaEpisodeSegmentPlanFromMarkdown: () => null, directorBoardUrlByEpisode: {}, directorBoardUrlByEpisodeSegment: {},
    directorBoardMotionOverlayBySegment: {}, splitManhuaEpisodeStoryText: (body: string) => ({ story: body }),
    runDeps: { optimizeCopy },
    runManhuaEpisodeStoryboard: async ({ deps }: { deps: { optimizeCopy: (input: object) => Promise<string> } }) => {
      expect(await deps.optimizeCopy({ sourceText: "原编译输入" })).toBe(text);
      expect(JSON.parse(storage.getItem("candidate")!).text).toBe(text);
      throw new Error("音频列缺少角色");
    },
  };
  const run = runInNewContext(code, context) as (episode: number, question: string, signal: AbortSignal) => Promise<string>;
  await expect(run(1, "生成分镜", new AbortController().signal)).rejects.toThrow("音频列");
  const saved = JSON.parse(storage.getItem("candidate")!);
  expect(saved).toMatchObject({ status: "pending", text });
  expect(saved.error).toContain("校验或保存未通过");
  expect(setVoiceStoryboard.mock.lastCall?.[0].text).toBe(text);
  await expect(run(1, "生成分镜", new AbortController().signal)).rejects.toThrow("不能重复提交");
  expect(optimizeCopy).toHaveBeenCalledTimes(1);
  expect(graph).toEqual({ blocks: [], edges: [] });
});
