import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assertManhuaPreviewFramesHaveMotion } from "./manhuaFramePreviewGuard";

async function writeFrame(path: string, color: { r: number; g: number; b: number }) {
  await sharp({
    create: { width: 96, height: 54, channels: 3, background: color },
  }).jpeg().toFile(path);
}

describe("manhua frame preview guard", () => {
  it("rejects a visually frozen frame set", async () => {
    const dir = await import("node:fs/promises").then((fs) => fs.mkdtemp("/tmp/manhua-frame-guard-"));
    const frame = `${dir}/same.jpg`;
    await writeFrame(frame, { r: 0, g: 0, b: 0 });
    await expect(assertManhuaPreviewFramesHaveMotion([frame, frame, frame])).rejects.toThrow("疑似抖音 App 限制页");
  });

  it("accepts a frame set with visible changes", async () => {
    const dir = await import("node:fs/promises").then((fs) => fs.mkdtemp("/tmp/manhua-frame-guard-"));
    const first = `${dir}/first.jpg`;
    const second = `${dir}/second.jpg`;
    await writeFrame(first, { r: 0, g: 0, b: 0 });
    await writeFrame(second, { r: 255, g: 220, b: 60 });
    await expect(assertManhuaPreviewFramesHaveMotion([first, second])).resolves.toBeUndefined();
  });
});
