import { describe, expect, it } from "vitest";
import { canApplyManhuaAssembleResult, readManhuaAssembleReceipts, saveManhuaAssembleReceipt } from "./manhuaAssembleResultGuard";
import { defaultCanvasBlock } from "./canvasTypes";

describe("合成迟到归属和恢复", () => {
  const block = { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01-test", outputUrl: "https://test.invalid/source.mp4" };
  it("同名节点换剧或换源都不能回填，原剧原源可以", () => {
    const input = { submittedProject: "剧A/用户1", currentProject: "剧A/用户1", blocks: [block], clips: [{ blockId: block.id, clipUrl: block.outputUrl }] };
    expect(canApplyManhuaAssembleResult(input)).toBe(true);
    expect(canApplyManhuaAssembleResult({ ...input, currentProject: "剧B/用户1" })).toBe(false);
    expect(canApplyManhuaAssembleResult({ ...input, blocks: [{ ...block, outputUrl: "https://test.invalid/new.mp4" }] })).toBe(false);
    expect(canApplyManhuaAssembleResult({ ...input, clips: [] })).toBe(false);
  });
  it("本机恢复记录保留所有版本并按账号隔离，损坏记录不覆盖", () => {
    let data: string | null = null;
    const storage = { getItem: () => data, setItem: (_key: string, value: string) => { data = value; } };
    for (let i = 0; i < 25; i++) saveManhuaAssembleReceipt(storage, { ownerId: "1", jobId: `job${i}`, title: "原剧", url: `https://test.invalid/final${i}.mp4`, createdAt: i });
    expect(readManhuaAssembleReceipts(storage, "1")).toHaveLength(25);
    expect(readManhuaAssembleReceipts(storage, "2")).toEqual([]);
    data = "损坏的原记录";
    expect(() => saveManhuaAssembleReceipt(storage, { ownerId: "1", jobId: "later", title: "新剧", url: "https://test.invalid/later.mp4", createdAt: 26 })).toThrow();
    expect(data).toBe("损坏的原记录");
  });
});
