import { describe, expect, it } from "vitest";
import {
  buildEvolinkRequestBody,
  EVOLINK_NANO_BANANA_PRO_MODEL,
} from "./evolinkGptImage2.js";

describe("EvoLink Nano Banana Pro 4K 契约", () => {
  it("使用 Pro 模型、quality=4K 与 image_urls，不混入 GPT Image resolution", () => {
    const body = buildEvolinkRequestBody(
      EVOLINK_NANO_BANANA_PRO_MODEL,
      "upscale",
      "16:9",
      "4K",
      ["https://example.com/input.png"],
      undefined,
      "4K",
    );
    expect(body).toEqual({
      model: "gemini-3-pro-image-preview",
      prompt: "upscale",
      size: "16:9",
      quality: "4K",
      image_urls: ["https://example.com/input.png"],
    });
  });
});
