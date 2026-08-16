import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildOpenRouterImageRequestBody,
  getOpenRouterApiKey,
  isOpenRouterGptImage2Configured,
} from "./openrouterGptImage2.js";

const KEY = "OPENROUTER_API_KEY";

describe("openrouterGptImage2 config", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });

  it("accepts sk-or keys", () => {
    process.env[KEY] = "sk-or-v1-abcdef0123456789";
    expect(getOpenRouterApiKey()).toBe("sk-or-v1-abcdef0123456789");
    expect(isOpenRouterGptImage2Configured()).toBe(true);
  });

  it("false when unset or placeholder", () => {
    expect(isOpenRouterGptImage2Configured()).toBe(false);
    process.env[KEY] = "[placeholder]";
    expect(getOpenRouterApiKey()).toBe("");
  });

  it("Pro Image 4K 使用官方 resolution 与带 type 的参考图契约", () => {
    expect(
      buildOpenRouterImageRequestBody({
        model: "google/gemini-3-pro-image",
        prompt: "upscale",
        aspectRatio: "16:9",
        quality: "high",
        resolution: "4K",
        imageUrls: ["https://example.com/input.png"],
      }),
    ).toMatchObject({
      model: "google/gemini-3-pro-image",
      resolution: "4K",
      aspect_ratio: "16:9",
      input_references: [
        {
          type: "image_url",
          image_url: { url: "https://example.com/input.png" },
        },
      ],
    });
  });
});
