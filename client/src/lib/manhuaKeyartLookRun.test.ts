import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { runCanvasBlock } from "./canvasRunBlock";
import {
  spawnManhuaDramaStudio,
  expandManhuaShotKeyartsAfterReverse,
  ensureManhuaFragmentClips,
  runManhuaDramaFactoryPipeline,
  getBlockEpisodeIndex,
  queuedManhuaKeyartBlocks,
} from "./canvasDramaStudio";
import { consumableManhuaCustomAssetRefsForCanon } from "@shared/manhuaAssetScriptSync";
import * as rerun from "@shared/manhuaCanvasRerunCompile";
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
import {
  collectManhuaCharacterSheetUrlById,
  collectManhuaPropImageUrlById,
} from "./canvasDramaStudio";
import {
  isManhuaKeyartLookCurrent,
  recordManhuaKeyartLookOutput,
} from "@shared/manhuaKeyartLookState";
import {
  resolveClipLocalSegmentIndex,
  resolveKeyartShotIndex,
  resolveSegmentIndexFromShotIndex,
} from "@shared/manhuaScriptWorkbench";
import { mergeManhuaMediaVersions } from "./manhuaMediaVersions";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

const customRefs = [
  {
    id: "heiqi",
    role: "character" as const,
    labelZh: "黑奇",
    url: "https://test.invalid/identity.png",
    claimedAnchorIds: ["heiqi"],
    refDuty: "identity" as const,
    primaryBindings: [{ anchorId: "heiqi", duty: "identity" as const }],
  },
];
const lookRefs = [
  {
    id: "after",
    role: "character" as const,
    claimedAnchorIds: ["heiqi"],
    url: "https://test.invalid/after.png",
  },
];
const characterLookSets = [
  {
    id: "look-after",
    characterId: "heiqi",
    index: 1,
    labelZh: "变身后",
    lookRefId: "after",
  },
];
const segmentLookBindings = { "e1:s1": { heiqi: "look-after" } };
const options = {
  customRefs,
  lookRefs,
  characterLookSets,
  segmentLookBindings,
};
let submitted: Array<{
  input: { params: { prompt: string; referenceImageUrls: string[] } };
}>;
let failResult: boolean;

beforeEach(() => {
  submitted = [];
  failResult = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/jobs" && init?.method === "POST") {
        submitted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ jobId: "test-keyart-job" }));
      }
      if (url === "/api/jobs/test-keyart-job" && init?.method === "GET") {
        return new Response(
          JSON.stringify(
            failResult
              ? { status: "failed", error: "测试图片生成失败" }
              : {
                  status: "succeeded",
                  output: { imageUrl: "https://test.invalid/new-output.png" },
                }
          )
        );
      }
      throw new Error("禁止真实网络或未声明调用");
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const spawned = spawnManhuaDramaStudio({
    topic: "黑奇保护阿菁",
    episodeIndex: 1,
  });
  const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
  const source = spawned.blocks.map(b =>
    b.id === reverse.id
      ? {
          ...b,
          status: "done" as const,
          outputText: "1. 黑奇抬头\n2. 黑奇站直\n3. 黑奇前进",
        }
      : b
  );
  const expanded = expandManhuaShotKeyartsAfterReverse(
    source,
    spawned.edges,
    reverse.id
  );
  const blocks = expanded.blocks.map(b =>
    b.id.startsWith("keyart-")
      ? {
          ...b,
          status: "done" as const,
          refImageUrl: "https://test.invalid/old-reference.png",
          outputUrl: `https://test.invalid/${b.id}.png`,
          outputUrls: ["https://test.invalid/older-output.png"],
        }
      : b
  );
  return {
    blocks,
    edges: expanded.edges,
    keyarts: blocks.filter(b => b.id.startsWith("keyart-")),
  };
}

function actualRerun(scope: Record<string, unknown>) {
  const source = readFileSync(
    new URL("../pages/OmniCanvas.tsx", import.meta.url),
    "utf8"
  );
  const tree = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callback = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "compileManhuaRerun" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      callback = node.initializer.arguments[0]!.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!callback) throw new Error("实际重跑回调不存在");
  return runInNewContext(
    ts.transpileModule(`(${callback})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      ...rerun,
      getBlockEpisodeIndex,
      parseManhuaEpisodeSegmentPlanFromMarkdown,
      collectManhuaCharacterSheetUrlById,
      collectManhuaPropImageUrlById,
      ensureManhuaFragmentClips,
      isManhuaKeyartLookCurrent,
      resolveClipLocalSegmentIndex,
      resolveKeyartShotIndex,
      resolveSegmentIndexFromShotIndex,
      writerFocusEpisode: 1,
      projectBible: null,
      writerPack: null,
      customAssetRefs: [...customRefs, ...lookRefs],
      consumableCustomAssetRefs: customRefs,
      characterLookSets,
      segmentLookBindings,
      directorBoardUrlByEpisode: {},
      directorBoardUrlByEpisodeSegment: {},
      directorBoardMotionOverlayBySegment: {},
      explicitWriterVideoModel: null,
      ...scope,
    }
  );
}

function actualCanvasExpression(
  which: "input" | "output",
  scope: Record<string, unknown>
) {
  const source = readFileSync(
    new URL("../components/canvas/FreeformCanvas.tsx", import.meta.url),
    "utf8"
  );
  const tree = ts.createSourceFile(
    "canvas.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let expression = "";
  function visit(node: ts.Node) {
    if (
      which === "input" &&
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "patch" &&
      node.initializer?.getText(tree).includes("compiled.imageRunPatch")
    )
      expression = node.initializer.getText(tree);
    if (
      which === "output" &&
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "patchOne" &&
      node.arguments[1]?.getText(tree).includes("recordManhuaKeyartLookOutput")
    )
      expression = node.arguments[1].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!expression) throw new Error("实际画布读写表达式缺失");
  return runInNewContext(
    ts.transpileModule(`(${expression})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { ...scope, recordManhuaKeyartLookOutput, mergeManhuaMediaVersions }
  );
}

function actualWorkbenchReview(scope: Record<string, unknown>) {
  const source = readFileSync(
    new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
    "utf8"
  );
  const tree = ts.createSourceFile(
    "workbench.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let callback = "";
  let keyarts = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "episodeKeyartReview" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      callback = node.initializer.arguments[0]!.getText(tree);
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "keyartsForEpisode"
    )
      keyarts = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!callback || !keyarts) throw new Error("真实工作台锁定状态入口缺失");
  return runInNewContext(
    ts.transpileModule(`${keyarts}\n(${callback})()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      Error,
      queuedManhuaKeyartBlocks,
      ensureManhuaFragmentClips,
      getBlockEpisodeIndex,
      resolveKeyartShotIndex,
      consumableManhuaCustomAssetRefsForCanon,
      collectManhuaCharacterSheetUrlById,
      collectManhuaPropImageUrlById,
      focusEpisode: 1,
      assetCanon: undefined,
      episodeVideoModel: undefined,
      customAssetRefs: [...customRefs, ...lookRefs],
      characterLookSets,
      segmentLookBindings,
      ...scope,
    }
  );
}

describe("静帧造型的真实编排、节点重跑与请求边界", () => {
  it("工作台选择后即时撤销旧图锁定，重出后恢复；无写入、无请求，缺图就地报错", () => {
    const data = fixture();
    const before = JSON.stringify(data.blocks);
    const changed = actualWorkbenchReview(data);
    expect(changed.error).toBe("");
    expect(changed.blocks[0].outputUrl).toBe(data.keyarts[0].outputUrl);
    expect(isManhuaKeyartLookCurrent(changed.blocks[0])).toBe(false);
    const generated = changed.blocks.map(
      (block: (typeof data.blocks)[number]) => ({
        ...block,
        manhuaKeyartLookState: recordManhuaKeyartLookOutput(
          block,
          block.outputUrl
        ),
      })
    );
    const byId = new Map(
      generated.map((block: (typeof data.blocks)[number]) => [block.id, block])
    );
    const ready = actualWorkbenchReview({
      blocks: data.blocks.map(block => byId.get(block.id) || block),
    });
    expect(isManhuaKeyartLookCurrent(ready.blocks[0])).toBe(true);
    const replaced = actualWorkbenchReview({
      blocks: data.blocks.map(block => byId.get(block.id) || block),
      customAssetRefs: [
        ...customRefs,
        { ...lookRefs[0], url: "https://test.invalid/replaced-look.png" },
      ],
    });
    expect(isManhuaKeyartLookCurrent(replaced.blocks[0])).toBe(false);
    const legacy = actualWorkbenchReview({
      ...data,
      characterLookSets: [],
      segmentLookBindings: {},
    });
    expect(legacy.error).toBe("");
    expect(legacy.blocks[0].manhuaKeyartLookState).toBeUndefined();
    const missing = actualWorkbenchReview({
      ...data,
      customAssetRefs: customRefs,
    });
    expect(missing.error).toMatch(/造型/);
    expect(isManhuaKeyartLookCurrent(missing.blocks[0])).toBe(false);
    expect(JSON.stringify(data.blocks)).toBe(before);
    expect(submitted).toHaveLength(0);
  });
  it("更换造型后旧静帧不能直出视频，页面和编排两入口都零提交", async () => {
    const data = fixture();
    const prepared = ensureManhuaFragmentClips(
      data.blocks,
      data.edges,
      1,
      options
    );
    const clip = prepared.blocks.find(
      b => b.id.startsWith("clip-") && /-g01(?:-|$)/.test(b.id)
    )!;
    await expect(
      actualRerun({ ...data, blocks: prepared.blocks, edges: prepared.edges })(
        clip
      )
    ).rejects.toThrow(/重出对应关键静帧/);
    const result = await runManhuaDramaFactoryPipeline({
      blocks: prepared.blocks,
      edges: prepared.edges,
      deps: { optimizeCopy: async () => "", userRole: "admin" },
      episodeIndex: 1,
      untilStage: "clip",
      forceFromStage: "clip",
      targetBlockIds: [clip.id],
      ensureOptions: options,
      maxRetries: 0,
    });
    expect(
      result.errors.some(error => /重出对应关键静帧/.test(error.message))
    ).toBe(true);
    expect(submitted).toHaveLength(0);
  });
  it("实际页面重跑回调同步更新 prompt 与图片，旧产物保留，最终请求读取新图", async () => {
    const data = fixture();
    const block = data.keyarts[0]!;
    const patch = await actualRerun(data)(block);
    expect(patch.imageRunPatch.editFusionUrls).toContain(
      "https://test.invalid/after.png"
    );
    expect(patch.outputUrls).toEqual([
      block.outputUrl,
      "https://test.invalid/older-output.png",
    ]);
    const inputPatch = actualCanvasExpression("input", {
      block,
      compiled: patch,
    });
    const runBlockPayload = { ...block, ...inputPatch };
    const out = await runCanvasBlock(
      { optimizeCopy: async () => "", userId: "test-user" },
      runBlockPayload
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.input.params.referenceImageUrls).toEqual([
      "https://test.invalid/identity.png",
      "https://test.invalid/after.png",
    ]);
    expect(submitted[0]?.input.params.prompt).toContain("参考图2：变身后");
    const outputPatch = actualCanvasExpression("output", {
      blockId: block.id,
      runBlockPayload,
      out,
      stashUrls: patch.outputUrls,
    });
    expect(outputPatch.outputUrls).toEqual([
      "https://test.invalid/new-output.png",
      block.outputUrl,
      "https://test.invalid/older-output.png",
    ]);
    expect(isManhuaKeyartLookCurrent(outputPatch)).toBe(true);
  });
  it.each([false, true])(
    "单张接力生成 failed=%s：保留选定形态和历史，不被上一镜底图覆盖",
    async failed => {
      failResult = failed;
      const data = fixture();
      const selected = data.keyarts[1]!;
      const result = await runManhuaDramaFactoryPipeline({
        ...data,
        deps: { optimizeCopy: async () => "", userId: "test-user" },
        episodeIndex: 1,
        untilStage: "keyart",
        forceFromStage: "keyart",
        targetBlockIds: [selected.id],
        ensureOptions: options,
        maxRetries: 0,
        shotContinuity: { keyartFromPrevStill: true },
      });
      expect(submitted).toHaveLength(1);
      const params = submitted[0]!.input.params;
      expect(params.referenceImageUrls.slice(0, 2)).toEqual([
        "https://test.invalid/identity.png",
        "https://test.invalid/after.png",
      ]);
      expect(params.referenceImageUrls).toContain(data.keyarts[0]!.outputUrl);
      expect(params.prompt).toContain("参考图2：变身后");
      const output = result.blocks.find(b => b.id === selected.id)!;
      expect(output.outputUrls).toContain(
        "https://test.invalid/older-output.png"
      );
      if (failed) {
        expect(result.errors).toHaveLength(1);
        expect(output.outputUrl).toBe(selected.outputUrl);
        expect(isManhuaKeyartLookCurrent(output)).toBe(false);
      } else {
        expect(result.errors).toEqual([]);
        expect(output.outputUrls).toContain(selected.outputUrl);
        expect(output.outputUrl).toBe("https://test.invalid/new-output.png");
        expect(isManhuaKeyartLookCurrent(output)).toBe(true);
      }
    }
  );
  it("批量静帧每张均消费同一份段选择，缺选图时零请求", async () => {
    const data = fixture();
    const result = await runManhuaDramaFactoryPipeline({
      ...data,
      deps: { optimizeCopy: async () => "" },
      episodeIndex: 1,
      untilStage: "keyart",
      forceFromStage: "keyart",
      targetBlockIds: data.keyarts.slice(0, 3).map(b => b.id),
      ensureOptions: options,
      maxRetries: 0,
    });
    expect(result.errors).toEqual([]);
    expect(submitted).toHaveLength(3);
    expect(
      submitted.every(row =>
        row.input.params.referenceImageUrls.includes(
          "https://test.invalid/after.png"
        )
      )
    ).toBe(true);
    submitted = [];
    await expect(
      actualRerun({ ...data, customAssetRefs: customRefs })(data.keyarts[0])
    ).rejects.toThrow(/造型/);
    expect(submitted).toHaveLength(0);
  });
});
