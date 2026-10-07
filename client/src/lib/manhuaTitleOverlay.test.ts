import { describe, expect, it } from "vitest";
import { compileManhuaTitle } from "./manhuaTitleOverlay";
import { manhuaVfxImageOptions } from "./manhuaVfxWorkflow";
import type { CanvasBlock } from "./canvasTypes";

describe("标题与叠图新范围", () => {
  const title = { text: "第三回 {\\an8} --> 终章", startSec: 0.9998, endSec: 3, fontSize: 32, alignment: 5 };
  it("标题复用烧字清洗，保留真实秒窗并传递位置", () => {
    const result = compileManhuaTitle(title, 5);
    expect(result.subtitleSrt).toContain("00:00:01,000 --> 00:00:03,000");
    expect(result.subtitleSrt).toContain("｛\\an8｝ →");
    expect(result.styleOverride).toMatchObject({ alignment: 5, fontSize: 32 });
  });
  it("标题拒绝未知时长、越界/毫秒零长时段以及非法样式", () => {
    expect(() => compileManhuaTitle(title)).toThrow("时长");
    expect(() => compileManhuaTitle({ ...title, endSec: 5.01 }, 5)).toThrow("时段");
    expect(() => compileManhuaTitle({ ...title, startSec: 1, endSec: 1.00001 }, 5)).toThrow("时间码");
    expect(() => compileManhuaTitle({ ...title, alignment: 9 }, 5)).toThrow("位置");
    expect(() => compileManhuaTitle({ ...title, fontSize: 97 }, 5)).toThrow("字号");
  });
  it("叠图素材只取当前集/共用factory持久图片，拒绝其他集、归档、外链与视频", () => {
    const block = (id: string, url: string, extra: Record<string, unknown> = {}) => ({ id, kind: "image", outputUrl: url, ...extra }) as CanvasBlock;
    const images = manhuaVfxImageOptions([
      block("keyart-e01-s01", "https://storage.googleapis.com/owner/image.png?X-Goog-Signature=old"),
      block("keyart-e01-s02", "gs://owner/image.png"),
      block("keyart-e02-s01", "gs://owner/other.png"),
      block("keyart-e01-s03", "gs://owner/archive.png", { archivedFromPreviousScript: true }),
      block("keyart-e01-s04", "https://external.invalid/image.png"),
      block("free-canvas", "gs://owner/free.png"),
      block("clip-e01-g01", "gs://owner/movie.mp4", { kind: "video", uploadedAssets: [{ id: "upload", kind: "image", gcsUri: "gs://owner/upload.png", fileName: "标志" }] }),
    ], 1);
    expect(images.map(image => image.url)).toEqual(["gs://owner/image.png", "gs://owner/upload.png"]);
  });
});
