import { beforeEach, describe, expect, it, vi } from "vitest";
import { cropManhuaSheet2x2 } from "./manhuaSheetCropApi";
import { __resetManhuaLocalMediaStoreForTests, importLocalMediaRecords, rehydrateBlocksFromLocalMedia } from "./manhuaLocalMediaStore";
import type { CanvasBlock } from "./canvasTypes";

const fetchMock = vi.fn();
beforeEach(async () => {
  await __resetManhuaLocalMediaStoreForTests();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ tiles: [{ slot: "topRight", url: "/api/canvas-media/manhua-scene-tiles/test/1-topRight.png" }] }) });
  vi.stubGlobal("fetch", fetchMock);
});

describe("恢复拼板后按原云端来源请求裁切", () => {
  it("把实际缓存恢复出的展示地址追溯回源图和原裁切图，不上传缓存字节", async () => {
    const sheetUrl = "/api/canvas-media/generated/canvas-gpt-image2/1.png";
    const tileUrl = "https://storage.googleapis.com/test-bucket/manhua-scene-tiles/test/1-topRight.png";
    await importLocalMediaRecords([
      { sourceUrl: sheetUrl, blob: new Blob(["sheet"]), mime: "image/png" },
      { sourceUrl: tileUrl, blob: new Blob(["tile"]), mime: "image/png" },
    ]);
    const blocks = await rehydrateBlocksFromLocalMedia([
      { id: "sceneplate-test", kind: "image", outputUrl: sheetUrl },
      { id: "keyart-e01-test", kind: "image", outputUrl: tileUrl },
    ] as CanvasBlock[]);
    expect(blocks.map(b => b.outputUrl)).toEqual([expect.stringMatching(/^blob:/), expect.stringMatching(/^blob:/)]);
    await cropManhuaSheet2x2({ sheetUrl: blocks[0].outputUrl!, existingTiles: { topRight: blocks[1].outputUrl! } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect(request.credentials).toBe("include");
    expect(JSON.parse(request.body)).toEqual({ sheetUrl, existingTiles: { topRight: tileUrl }, objectPrefix: "" });
  });

  it("来源缺失时明确拒绝，源图或旧裁切图都不会触发请求", async () => {
    await expect(cropManhuaSheet2x2({ sheetUrl: "blob:untracked" })).rejects.toThrow("未提交");
    await expect(cropManhuaSheet2x2({ sheetUrl: "/api/canvas-media/generated/test/1.png", existingTiles: { topRight: "blob:untracked" } })).rejects.toThrow("未提交");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
