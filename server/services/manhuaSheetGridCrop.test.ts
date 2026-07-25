import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  cropSheet2x2ToTiles,
  MANHUA_SHEET_GRID_VIEWS,
} from "./manhuaSheetGridCrop";

/** 四格各刷一个纯色，切开后靠色值验证切到了正确的格子 */
async function makeFourColorSheet(width: number, height: number): Promise<Buffer> {
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  const block = (w: number, h: number, r: number, g: number, b: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();
  const [tl, tr, bl, br] = await Promise.all([
    block(halfW, halfH, 255, 0, 0),
    block(width - halfW, halfH, 0, 255, 0),
    block(halfW, height - halfH, 0, 0, 255),
    block(width - halfW, height - halfH, 255, 255, 0),
  ]);
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: tl, left: 0, top: 0 },
      { input: tr, left: halfW, top: 0 },
      { input: bl, left: 0, top: halfH },
      { input: br, left: halfW, top: halfH },
    ])
    .png()
    .toBuffer();
}

async function centerPixel(buf: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const cx = Math.floor(info.width / 2);
  const cy = Math.floor(info.height / 2);
  const at = (cy * info.width + cx) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

describe("manhuaSheetGridCrop", () => {
  it("四格切到正确位置，顺序与出图提示词一致", async () => {
    const sheet = await makeFourColorSheet(360, 640);
    const tiles = await cropSheet2x2ToTiles(sheet);

    expect(tiles.map((t) => t.slot)).toEqual(
      MANHUA_SHEET_GRID_VIEWS.map((v) => v.slot),
    );
    expect(tiles.map((t) => t.labelZh)).toEqual(["主视角", "正面聚焦", "高俯斜角", "正俯"]);
    await expect(centerPixel(tiles[0]!.buffer)).resolves.toEqual([255, 0, 0]);
    await expect(centerPixel(tiles[1]!.buffer)).resolves.toEqual([0, 255, 0]);
    await expect(centerPixel(tiles[2]!.buffer)).resolves.toEqual([0, 0, 255]);
    await expect(centerPixel(tiles[3]!.buffer)).resolves.toEqual([255, 255, 0]);
  });

  it("奇数边长不漏接缝：四格尺寸加起来仍等于原图", async () => {
    const sheet = await makeFourColorSheet(361, 641);
    const tiles = await cropSheet2x2ToTiles(sheet);
    const dims = await Promise.all(
      tiles.map(async (t) => {
        const m = await sharp(t.buffer).metadata();
        return { w: Number(m.width), h: Number(m.height) };
      }),
    );
    // 左上 + 右上 的宽 = 原宽；左上 + 左下 的高 = 原高
    expect(dims[0]!.w + dims[1]!.w).toBe(361);
    expect(dims[0]!.h + dims[2]!.h).toBe(641);
  });

  it("拒绝小到没法切的图", async () => {
    const tiny = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(cropSheet2x2ToTiles(tiny)).rejects.toThrow(/sheet_too_small/);
  });
});
