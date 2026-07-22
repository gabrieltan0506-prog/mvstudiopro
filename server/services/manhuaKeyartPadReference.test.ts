import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { padImageBufferToSize, parseOpenAiImageSize } from "./manhuaKeyartPadReference.js";

describe("manhuaKeyartPadReference", () => {
  it("parses OpenAI size", () => {
    expect(parseOpenAiImageSize("1024x1536")).toEqual({ width: 1024, height: 1536 });
    expect(parseOpenAiImageSize("bad")).toBeNull();
  });

  it("pads landscape sheet into 9:16 canvas", async () => {
    const src = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 20, g: 40, b: 200 } },
    })
      .png()
      .toBuffer();
    const out = await padImageBufferToSize(src, "1024x1536");
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1536);
  });
});
