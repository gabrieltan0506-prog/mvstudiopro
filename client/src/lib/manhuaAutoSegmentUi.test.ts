import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  resolveManhuaActiveSegmentIndex,
  resolveManhuaSegmentBatchCharge,
  manhuaSegmentSelectionIdentity,
  isManhuaWorkbenchKeyartCurrent,
  resolveManhuaSourcePlanBeat,
} from "../components/ManhuaScriptWorkbench.js";
import { resolveShotsForEpisodeKeyarts, ensureManhuaFragmentClips, expandManhuaShotKeyartsAfterReverse, spawnManhuaDramaStudio, queuedManhuaClipBlocks } from "./canvasDramaStudio";
import type { ManhuaWriterAssetCanon } from "@shared/manhuaWriterAssetCanon";
import { confirmManhuaBoardOverlayReview } from "@shared/manhuaDirectorBoardOverlay";
import { canvasVideoClipCredits } from "@shared/canvasGenerationPricing";
import { buildWorkbenchShotsFromSegmentPlan } from "@shared/manhuaStoryDistill";
import { compileManhuaSegmentDirectorBoardOverlay } from "@shared/manhuaDirectorBoardOverlayCompile";
import {
  groupShotsIntoSegments,
  type ManhuaWorkbenchShot,
} from "@shared/manhuaScriptWorkbench";

function shot(index: number, durationSec: number): ManhuaWorkbenchShot {
  return {
    index,
    durationSec,
    cameraZh: "固定机位",
    actionZh: `镜${index}动作`,
  };
}

const uiSource = readFileSync(new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url), "utf8");
const omniSource = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
function productionHandler(source: string, attribute: string, scope: Record<string, unknown>) {
  const tree = ts.createSourceFile("view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = "";
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === attribute && node.initializer && ts.isJsxExpression(node.initializer)) {
      text = node.initializer.expression?.getText(tree) || "";
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!text) throw new Error(`缺少生产回调：${attribute}`);
  return runInNewContext(ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
}

function productionMemo(name: string, scope: Record<string, unknown>) {
  const tree = ts.createSourceFile("view.tsx", uiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer && ts.isCallExpression(node.initializer)) text = node.initializer.arguments[0]?.getText(tree) || "";
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!text) throw new Error(`缺少生产派生：${name}`);
  return runInNewContext(ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope)();
}

describe("漫剧自动分段 UI 消费", () => {
  it("长镜续段轨迹不挪用旧段表同号动作，和生产编译器使用同一镜窗", () => {
    const shots = [{ ...shot(1, 20), cameraZh: "镜头向右横移跟拍", actionZh: "黑奇从画面左侧向右移动" }];
    const segments = groupShotsIntoSegments(shots, { videoModel: "seedance-2.0" });
    const shootablePlan = { segments: [{ index: 2, castZh: "旧角色", performanceZh: "旧角色从右向左后退", lightingCameraZh: "向左横移" }] };
    const common = { episodeIndex: 1, segmentIndex: 2, baseAspectRatio: "16:9" as const, segmentBoardUrls: { 2: "https://example.test/board.png" }, shots: segments[1]!.shots };
    const result = productionMemo("activeDirectorBoardMotionOverlay", {
      activeBoardBaseUrl: common.segmentBoardUrls[2], activeBoardImageGeometry: { baseAspectRatio: "16:9" },
      activeSegNo: 2, segments, shots, shootablePlan, buildWorkbenchShotsFromSegmentPlan, resolveManhuaSourcePlanBeat,
      focusEpisode: 1, directorBoardSegUrls: common.segmentBoardUrls, segmentFirstShotKeyart: undefined,
      mediaUrl: () => undefined, directorBoardMotionOverlays: {}, compileManhuaSegmentDirectorBoardOverlay,
      assetCanon: undefined,
    });
    expect(result).toEqual(compileManhuaSegmentDirectorBoardOverlay(common));
    expect(JSON.stringify(result)).not.toContain("旧角色");
    expect(result.cameraPath).not.toBeNull();
  });
  it("原稿人物路线经真实工作台确认后进入同源工厂成片提示词", () => {
    const assetCanon: ManhuaWriterAssetCanon = {
      characters: [{ id: "wa_char_heiqi", role: "character", nameZh: "黑奇", lookZh: "灰黑马", promptZh: "灰黑马" }],
      props: [], locations: [], episodeMainSceneId: {},
    };
    const spawned = spawnManhuaDramaStudio({ topic: "墨菁传", episodeIndex: 1, videoModel: "seedance-2.0" });
    const reverse = spawned.blocks.find((block) => block.id.startsWith("reverse-"))!;
    const blocks = spawned.blocks.map((block) => block.id === reverse.id ? {
      ...block, status: "done" as const,
      outputText: "1. 镜头向右横移跟拍：黑奇从画面左侧向画面右侧走\n2. 固定机位：黑奇停下",
    } : block);
    const shots = resolveShotsForEpisodeKeyarts(blocks, 1);
    const segments = groupShotsIntoSegments(shots, { videoModel: "seedance-2.0" });
    const board = "https://example.test/board.png";
    const overlay = productionMemo("activeDirectorBoardMotionOverlay", {
      activeBoardBaseUrl: board, activeBoardImageGeometry: { baseAspectRatio: "16:9" },
      activeSegNo: 1, segments, shots, shootablePlan: { segments: [] }, resolveManhuaSourcePlanBeat,
      focusEpisode: 1, directorBoardSegUrls: { 1: board }, segmentFirstShotKeyart: undefined,
      mediaUrl: () => undefined, directorBoardMotionOverlays: {}, compileManhuaSegmentDirectorBoardOverlay, assetCanon,
    });
    expect(overlay.actorRoutes).toMatchObject([{ entityId: "黑奇", entityKind: "character" }]);
    const expanded = expandManhuaShotKeyartsAfterReverse(blocks, spawned.edges, reverse.id, { videoModel: "seedance-2.0" });
    const ready = expanded.blocks.map((block) => block.id.startsWith("keyart-") ? { ...block, outputUrl: `https://example.test/${block.id}.png`, status: "done" as const } : block);
    const options = { videoModel: "seedance-2.0", assetCanon, characterSheetUrlById: { wa_char_heiqi: "https://example.test/heiqi.png" }, directorBoardUrlByEpisodeSegment: { 1: { 1: board } } };
    const unconfirmed = ensureManhuaFragmentClips(ready, expanded.edges, 1, { ...options, directorBoardMotionOverlayByEpisodeSegment: { 1: { 1: overlay } } });
    expect(queuedManhuaClipBlocks(unconfirmed.blocks, 1, "seedance-2.0")[0]!.prompt).not.toContain("【空间调度】");
    const confirmed = ensureManhuaFragmentClips(ready, expanded.edges, 1, { ...options, directorBoardMotionOverlayByEpisodeSegment: { 1: { 1: confirmManhuaBoardOverlayReview(overlay)! } } });
    expect(queuedManhuaClipBlocks(confirmed.blocks, 1, "seedance-2.0")[0]!.prompt).toContain("【空间调度】人物黑奇自画面左向右");
  });
  it("相同原稿的新数组和节点进度不清空选择，原稿、集或引擎变更才清空", () => {
    const segments = groupShotsIntoSegments([shot(1, 20)], { videoModel: "seedance-2.0" });
    const identity = manhuaSegmentSelectionIdentity(1, "seedance-2.0", segments);
    expect(manhuaSegmentSelectionIdentity(1, "seedance-2.0", structuredClone(segments))).toBe(identity);
    expect(manhuaSegmentSelectionIdentity(2, "seedance-2.0", segments)).not.toBe(identity);
    expect(manhuaSegmentSelectionIdentity(1, "seedance-2.5", segments)).not.toBe(identity);
    const changed = structuredClone(segments);
    changed[0]!.shots[0]!.actionZh = "原稿改为退后";
    expect(manhuaSegmentSelectionIdentity(1, "seedance-2.0", changed)).not.toBe(identity);
    expect(uiSource).toContain("}, [segmentSelectionIdentity]);");
    expect(uiSource).not.toContain("}, [focusEpisode, episodeVideoModel, segments]);");
  });

  it("原稿图过期时，造型图回执有效也不能放行视频", () => {
    const current = { required: "new", generatedFor: "new", generatedUrl: "https://example.test/still.png" };
    const block = { outputUrl: current.generatedUrl, manhuaKeyartLookState: current, manhuaKeyartSourceState: { ...current, generatedFor: "old" } };
    expect(isManhuaWorkbenchKeyartCurrent(block)).toBe(false);
    expect(isManhuaWorkbenchKeyartCurrent({ ...block, manhuaKeyartSourceState: current })).toBe(true);
    expect(omniSource).toContain("!isManhuaWorkbenchKeyartCurrent(candidate)");
  });

  it("真实批量回调只确认一次、一次提交；旧稿签名零确认零提交", () => {
    const blocks = [{ id: "reverse-e01", kind: "text", prompt: "", outputText: [
      "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |",
      "|---|---|---|---|---|---|",
      "| 1 | 0-10 | 固定机位 | 黑奇停步 | 黑奇：「等等」 | 风声 |",
      "| 2 | 10-20 | 缓推 | 墨菁回头 | 墨菁：「怎么了」 | 风声 |",
    ].join("\n") }];
    const segments = groupShotsIntoSegments(resolveShotsForEpisodeKeyarts(blocks as never, 1), { videoModel: "seedance-2.0" });
    expect(segments).toHaveLength(2);
    const confirm = vi.fn((_message: string) => true);
    const runFactory = vi.fn();
    const handler = productionHandler(omniSource, "onGenerateMissingFragments", {
      blocks, writerFocusEpisode: 1, activePilotVideoModel: "seedance-2.0",
      groupShotsIntoSegments, resolveShotsForEpisodeKeyarts, manhuaSegmentSelectionIdentity,
      canvasVideoClipCredits, toast: { message: vi.fn() }, window: { confirm },
      setFactoryRunScope: vi.fn(), ensureStudioSpawned: vi.fn(), factoryTopic: "墨菁传", runFactory,
    });
    handler([1, 2], "旧稿");
    expect(confirm).not.toHaveBeenCalled();
    expect(runFactory).not.toHaveBeenCalled();
    handler([1, 2], manhuaSegmentSelectionIdentity(1, "seedance-2.0", segments));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toContain("344 积分");
    expect(runFactory).toHaveBeenCalledTimes(1);
    expect(runFactory).toHaveBeenCalledWith("clip", { episodeIndexes: [1], fragmentShotIndexes: [1, 2] });
    expect(uiSource).not.toContain("将生成所选 ${batch.segmentIndexes.length}");
    expect(uiSource).not.toContain("确认静帧后将生成 ${batch.segmentIndexes.length}");
  });
  it("尾段只有一镜时保留原镜，不补假静帧", () => {
    const segments = groupShotsIntoSegments(
      [shot(1, 5), shot(2, 5), shot(3, 5), shot(4, 5)],
      { videoModel: "seedance-2.0" },
    );

    expect(segments.map((segment) => segment.shots.map((item) => item.index))).toEqual([
      [1, 2, 3],
      [4],
    ]);
    expect(segments.flatMap((segment) => segment.shots).map((item) => item.index)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("二十秒长镜拆成两段后仍能选中第二续段，静帧仍只认原镜一张", () => {
    const segments = groupShotsIntoSegments([shot(1, 20)], {
      videoModel: "seedance-2.0",
    });

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.shots[0]?.index)).toEqual([1, 1]);
    expect(segments.map((segment) => segment.shots[0]?.continuation)).toEqual([
      false,
      true,
    ]);
    expect(
      resolveManhuaActiveSegmentIndex({
        shotIndex: 1,
        segments,
        preferredSegmentIndex: 2,
      }),
    ).toBe(2);
    expect(resolveManhuaActiveSegmentIndex({ shotIndex: 1, segments })).toBe(1);
  });

  it("批量费用只计算当前真实段，重复和旧段号不会扩大扣费范围", () => {
    const segments = groupShotsIntoSegments(
      [shot(1, 5), shot(2, 5), shot(3, 5), shot(4, 5)],
      { videoModel: "seedance-2.0" },
    );

    expect(
      resolveManhuaSegmentBatchCharge({
        requestedSegmentIndexes: [2, 1, 2, 9],
        segments,
        videoModel: "seedance-2.0",
      }),
    ).toEqual({ segmentIndexes: [1, 2], credits: 344 });
  });
});
