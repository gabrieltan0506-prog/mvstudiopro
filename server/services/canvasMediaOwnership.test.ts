import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasMediaOwnershipCacheForTests,
  verifyCanvasMediaOwnership,
} from "./canvasMediaOwnership";

const OWNED = "generated/canvas-gpt-image2/111_aa.png";
const OTHERS = "generated/canvas-gpt-image2/999_zz.png";

function draftWith(paths: string[]): string {
  return JSON.stringify({
    payloadJson: JSON.stringify({
      canvas: {
        blocks: [
          {
            id: "keyart-1",
            outputUrl: `/api/canvas-media/${paths[0] || ""}`,
            outputUrls: paths.slice(1).map((p) => `https://storage.googleapis.com/bkt/${p}?X-Goog-Sig=old`),
            prompt: `别人的路径贴在提示词里也不算: ${OTHERS}`,
            outputText: `自由文本同样不算 ${OTHERS}`,
          },
        ],
      },
    }),
  });
}

describe("canvasMediaOwnership(三审 P0-3)", () => {
  beforeEach(() => __resetCanvasMediaOwnershipCacheForTests());

  it("本用户资产字段里的对象:放行(稳定链与签名链两种形态都认)", async () => {
    const loader = async () => draftWith([OWNED, "generated/canvas-gpt-image2/222_bb.png"]);
    expect(await verifyCanvasMediaOwnership(7, OWNED, { loader, skipCache: true })).toBe(true);
    expect(
      await verifyCanvasMediaOwnership(7, "generated/canvas-gpt-image2/222_bb.png", { loader, skipCache: true }),
    ).toBe(true);
  });

  it("他人对象(仅出现在 prompt/outputText 文本里):拒绝", async () => {
    const loader = async () => draftWith([OWNED]);
    expect(await verifyCanvasMediaOwnership(7, OTHERS, { loader, skipCache: true })).toBe(false);
  });

  it("路径穿越与非法前缀:拒绝,连快照都不必读", async () => {
    const loader = async () => draftWith([OWNED]);
    expect(await verifyCanvasMediaOwnership(7, "generated/a/../b.png", { loader, skipCache: true })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, "blog-media/x.png", { loader, skipCache: true })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, "generated/a/b.mp4", { loader, skipCache: true })).toBe(false);
  });

  it("无快照/解析失败:一律拒绝", async () => {
    expect(await verifyCanvasMediaOwnership(7, OWNED, { loader: async () => null, skipCache: true })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, OWNED, { loader: async () => "{broken", skipCache: true })).toBe(false);
  });
});
