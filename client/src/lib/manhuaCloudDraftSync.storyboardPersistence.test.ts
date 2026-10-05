import { describe, expect, it } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { tryLoadLocalCanvas, trySaveLocalCanvas } from "./manhuaCloudDraftSync";

const completeText = "【镜头】人物抬眼、转身，保留完整对白：别走。\r\n🌙\t".repeat(400);
const videoVersions = Array.from(
  { length: 12 },
  (_, index) => `https://cdn.example/final-v${index + 1}.mp4`,
);

function videoBlock(): CanvasBlock & { outputText: string } {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "final-e01",
    outputUrl: videoVersions[0],
    outputUrls: videoVersions,
    outputText: completeText,
    status: "done",
  };
}

describe("本机分镜完整保存", () => {
  it("媒体精简腾出配额时，各类节点的长文字逐字恢复且保留全部视频历史", () => {
    const blocks = [
      ...(["text", "copy_organize", "video_reverse", "image", "music"] as const)
        .map(kind => ({
          ...defaultCanvasBlock(kind, 0, 0),
          id: `${kind}-e01`,
          outputText: `${kind}\n${completeText}`,
        })),
      { ...defaultCanvasBlock("image", 0, 0), id: "keyart-e01-s01", outputText: completeText },
      videoBlock(),
    ];
    // 只有可精简的媒体引用占满配额，文字本身仍能完整存下。
    blocks[0].outputUrl = `https://cdn.example/${"a".repeat(100_000)}.jpg`;
    const edges = [{ id: "edge-1", fromId: blocks[0].id, toId: "final-e01" }];
    const quota = blocks.reduce((sum, block) => sum + block.outputText.length, 0) + 15_000;
    const attemptedSizes: number[] = [];
    let saved = "";
    // 保持已有的仅 setItem 注入合同。
    const ok = trySaveLocalCanvas(blocks, edges, {
      setItem(_key, value) {
        attemptedSizes.push(value.length);
        if (value.length > quota) throw new Error("QuotaExceededError");
        saved = value;
      },
    });
    expect(ok).toBe(true);
    expect(attemptedSizes).toHaveLength(2);
    expect(attemptedSizes[0]).toBeGreaterThan(quota);
    expect(attemptedSizes[1]).toBeLessThanOrEqual(quota);
    const restored = tryLoadLocalCanvas({ getItem: () => saved });
    expect(restored?.blocks.map(block => [block.id, block.outputText]))
      .toEqual(blocks.map(block => [block.id, block.outputText]));
    expect(restored?.edges).toEqual(edges);
    const video = restored?.blocks.find(block => block.id === "final-e01");
    expect(video?.outputUrl).toBe(videoVersions[0]);
    expect(video?.outputUrls).toEqual(videoVersions);
  });

  it("完整文字仍超额时返回失败，旧画布不被截短的新文字覆盖", () => {
    const previousBlocks = [
      { ...defaultCanvasBlock("text", 0, 0), id: "reverse-e01", outputText: "已保存的旧分镜全文。" },
      { ...videoBlock(), outputText: "已保存的视频说明。" },
    ];
    const previous = JSON.stringify({ blocks: previousBlocks, edges: [] });
    const quota = 8_000;
    expect(previous.length).toBeLessThan(quota);
    expect(completeText.length).toBeGreaterThan(quota);
    let saved = previous;
    const attemptedSizes: number[] = [];
    const ok = trySaveLocalCanvas([
      { ...previousBlocks[0], outputText: completeText },
      previousBlocks[1],
    ], [], {
      setItem(_key, value) {
        attemptedSizes.push(value.length);
        if (value.length > quota) throw new Error("QuotaExceededError");
        saved = value;
      },
    });
    expect(ok).toBe(false);
    expect(attemptedSizes).toHaveLength(2);
    expect(attemptedSizes.every(size => size > quota)).toBe(true);
    expect(saved).toBe(previous);
    const restored = tryLoadLocalCanvas({ getItem: () => saved });
    expect(restored?.blocks[0].outputText).toBe(previousBlocks[0].outputText);
    expect(restored?.blocks[1].outputUrls).toEqual(videoVersions);
  });
});
