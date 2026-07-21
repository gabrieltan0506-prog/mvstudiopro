import { describe, expect, it } from "vitest";
import { buildCanvasGptImage2JobInput } from "./canvasGptImage2JobInput";

describe("buildCanvasGptImage2JobInput", () => {
  it("wraps prompt for image job worker", () => {
    const input = buildCanvasGptImage2JobInput({
      prompt: "竖屏关键静帧",
      aspectRatio: "9:16",
      providerOverride: "openai",
    });
    expect(input.action).toBe("canvas_gpt_image2");
    expect(input.params.prompt).toBe("竖屏关键静帧");
    expect(input.params.aspectRatio).toBe("9:16");
    expect(input.params.providerOverride).toBe("openai");
    expect(input.params.gcsSubdir).toBe("canvas-gpt-image2");
    expect(input.params.generalImageEdit).toBeUndefined();
  });

  it("dedupes refs and marks generalImageEdit", () => {
    const input = buildCanvasGptImage2JobInput({
      prompt: "edit",
      referenceImageUrl: "https://a.example/x.png",
      referenceImageUrls: ["https://a.example/x.png", "https://b.example/y.png"],
      maskUrl: "https://a.example/mask.png",
    });
    expect(input.params.referenceImageUrls).toEqual([
      "https://a.example/x.png",
      "https://b.example/y.png",
    ]);
    expect(input.params.generalImageEdit).toBe(true);
    expect(input.params.maskUrl).toBe("https://a.example/mask.png");
  });
});
