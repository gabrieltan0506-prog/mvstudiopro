import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as studio from "./canvasDramaStudio";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { buildManhuaAssembleSubtitleSource } from "./manhuaAssembleSubtitleSource";
import {
  resolveManhuaAdvisorShotsFromBlocks,
  manhuaSegmentSelectionIdentity,
} from "../components/ManhuaScriptWorkbench";
import {
  groupShotsIntoSegments,
  resolveClipSegmentIndex,
} from "@shared/manhuaScriptWorkbench";
import { parseManhuaEpisodeSegmentPlanFromMarkdown } from "@shared/manhuaEpisodeSegmentPlan";
import {
  upsertShotDialogueSection,
  MANHUA_DIALOGUE_SILENCE_TOKEN,
} from "@shared/manhuaShotDialoguePersist";
import { canvasVideoClipCredits } from "@shared/canvasGenerationPricing";

const text = [
  "| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |",
  "|---|---|---|---|---|---|",
  "| 1 | 0-5 | 缓推 | 阿菁牵住墨屠 | 阿菁：走吧 | 风声 |",
  "| 2 | 5-10 | 固定 | 墨屠张开黑翼 | 墨屠：别怕 | 鼓点 |",
  "| 3 | 10-15 | 全景 | 墨屠护住阿菁 | 无 | 风声 |",
].join("\n");
const override = upsertShotDialogueSection("", {
  1: "阿菁：留在我身边",
  2: MANHUA_DIALOGUE_SILENCE_TOKEN,
});
const block = (id: string, outputText: string) => ({
  ...defaultCanvasBlock("text", 0, 0),
  id,
  outputText,
  status: "done" as const,
});
const beats = block("beats-e01", override);
const reverse = block("reverse-e01", text);
const sourceBlocks = () => [beats, reverse];

function handler(name: string, deps: Record<string, unknown>) {
  const source = ts.createSourceFile(
    "OmniCanvas.tsx",
    readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let body = "";
  function visit(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    )
      body = node.initializer.expression!.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!body) throw Error(`缺少真实回调${name}`);
  const code = ts.transpileModule(`const callback = ${body};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return new Function(...Object.keys(deps), `${code}\nreturn callback;`)(
    ...Object.values(deps)
  );
}

describe("对白覆盖不能抢占真实分镜", () => {
  it("反推三镜动作和5/5/5秒不变，最新对白及静音同时消费", () => {
    const shots = studio.resolveShotsForEpisodeKeyarts(sourceBlocks(), 1);
    expect(shots).toHaveLength(3);
    expect(shots.map(shot => [shot.actionZh, shot.durationSec])).toEqual([
      ["阿菁牵住墨屠", 5],
      ["墨屠张开黑翼", 5],
      ["墨屠护住阿菁", 5],
    ]);
    expect(shots[0]?.dialogueZh).toBe("阿菁：留在我身边");
    expect(shots[1]).toMatchObject({ dialogueSuppressed: true });
    expect(shots[1]?.dialogueZh).toBeUndefined();
    expect(resolveManhuaAdvisorShotsFromBlocks({ beats, reverse })).toEqual(
      shots
    );
    const subtitle = buildManhuaAssembleSubtitleSource(sourceBlocks(), 1, 1);
    expect(subtitle?.shots).toEqual([
      { shotIndex: 1, durationSec: 5, textZh: "阿菁：留在我身边" },
      { shotIndex: 2, durationSec: 5, textZh: "" },
      { shotIndex: 3, durationSec: 5, textZh: "" },
    ]);
  });

  it("仅对白覆盖无成稿，顾问为空且字幕来源不存在", () => {
    expect(resolveManhuaAdvisorShotsFromBlocks({ beats })).toEqual([]);
    expect(buildManhuaAssembleSubtitleSource([beats], 1, 1)).toBeUndefined();
  });

  it("真实批量回调拒绝旧占位身份，零确认零提交", () => {
    const old = groupShotsIntoSegments(
      studio.resolveShotsForEpisodeKeyarts([beats], 1),
      { videoModel: "seedance-2.0" }
    );
    const confirm = vi.fn();
    const runFactory = vi.fn();
    handler("onGenerateMissingFragments", {
      blocks: sourceBlocks(),
      writerFocusEpisode: 1,
      activePilotVideoModel: "seedance-2.0",
      groupShotsIntoSegments,
      resolveShotsForEpisodeKeyarts: studio.resolveShotsForEpisodeKeyarts,
      manhuaSegmentSelectionIdentity,
      toast: { message: vi.fn() },
      window: { confirm },
      runFactory,
      canvasVideoClipCredits,
    })([1], manhuaSegmentSelectionIdentity(1, "seedance-2.0", old));
    expect(confirm).not.toHaveBeenCalled();
    expect(runFactory).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "真实自动预览回调（编译失败=%s）保留旧媒体与任务，零生成",
    failure => {
      const oldKeyart: CanvasBlock = {
        ...defaultCanvasBlock("image", 0, 0),
        id: "keyart-e01-s01",
        status: "done",
        outputUrl: "https://test.invalid/current.png",
        outputUrls: [
          "https://test.invalid/history.png",
          "https://test.invalid/current.png",
        ],
      };
      const oldClip: CanvasBlock = {
        ...defaultCanvasBlock("video", 0, 0),
        id: "clip-e01-s01",
        status: "running",
        outputUrl: "https://test.invalid/current.mp4",
        outputUrls: [
          "https://test.invalid/history.mp4",
          "https://test.invalid/current.mp4",
        ],
        videoTaskId: "test-inflight-task",
        videoTaskStatus: "running",
      };
      const initial = [...sourceBlocks(), oldKeyart, oldClip];
      let current = initial;
      let restored: CanvasBlock[] | undefined;
      const save = vi.fn((next: CanvasBlock[]) => {
        restored = JSON.parse(JSON.stringify(next));
      });
      const runFactory = vi.fn();
      const createJobSameOrigin = vi.fn();
      const error = vi.fn();
      handler("onReviewClipPromptsOnCanvas", {
        ...studio,
        resolveClipSegmentIndex,
        parseManhuaEpisodeSegmentPlanFromMarkdown,
        ensureManhuaFragmentClips: failure
          ? () => {
              throw new Error("测试编译失败");
            }
          : studio.ensureManhuaFragmentClips,
        setBlocks: (update: (prev: CanvasBlock[]) => CanvasBlock[]) => {
          current = update(current);
        },
        setEdges: (update: () => unknown) => update(),
        saveCanvasState: save,
        projectBible: null,
        writerPack: null,
        writerFocusEpisode: 1,
        edges: [],
        customAssetRefs: [],
        consumableCustomAssetRefs: [],
        characterLookSets: [],
        segmentLookBindings: {},
        directorBoardUrlByEpisode: {},
        directorBoardUrlByEpisodeSegment: {},
        directorBoardMotionOverlayBySegment: {},
        explicitWriterVideoModel: "seedance-2.0",
        setSegmentCastMismatch: vi.fn(),
        setSegmentNoFaceLock: vi.fn(),
        toast: { error },
        window: { setTimeout: (callback: () => void) => callback() },
        openManhuaFactoryCanvas: vi.fn(),
        runFactory,
        createJobSameOrigin,
      })({ segmentIndex: 1 });
      expect(runFactory).not.toHaveBeenCalled();
      expect(createJobSameOrigin).not.toHaveBeenCalled();
      if (failure) {
        expect(current).toBe(initial);
        expect(save).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledOnce();
      } else {
        expect(error).not.toHaveBeenCalled();
        expect(save).toHaveBeenCalledOnce();
        expect(restored!.find(item => item.id === oldKeyart.id)).toMatchObject({
          status: oldKeyart.status,
          outputUrl: oldKeyart.outputUrl,
          outputUrls: oldKeyart.outputUrls,
        });
        expect(restored!.find(item => item.id === oldClip.id)).toMatchObject({
          status: oldClip.status,
          outputUrl: oldClip.outputUrl,
          outputUrls: oldClip.outputUrls,
          videoTaskId: oldClip.videoTaskId,
          videoTaskStatus: oldClip.videoTaskStatus,
        });
        const serialized = JSON.stringify(restored);
        for (const value of [
          ...oldKeyart.outputUrls,
          ...oldClip.outputUrls,
          oldClip.videoTaskId!,
        ])
          expect(serialized).toContain(value);
        expect(studio.resolveShotsForEpisodeKeyarts(restored!, 1)).toHaveLength(
          3
        );
      }
    }
  );
});
