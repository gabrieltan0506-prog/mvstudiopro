import { describe, expect, it } from "vitest";
import {
  buildGeminiApiUpscaleConfig,
  getConfiguredImageUpscaleProviders,
  hasValidImageUpscaleDimensions,
  isAmbiguousImageUpscaleError,
  isImageUpscaleConfigured,
  isPrivateOrReservedAddress,
  isTrustedBlobBearerHost,
  nearestGeminiImageAspectRatio,
  resolveGeminiApiUpscaleSpec,
  resolveImageUpscaleRoute,
} from "./geminiApiImageUpscale";

describe("Gemini API 高清放大模型映射", () => {
  it("2× 固定走 Nano Banana 2（Flash 图片）并请求 2K", () => {
    const spec = resolveGeminiApiUpscaleSpec("x2");
    expect(spec.model).toBe("gemini-3.1-flash-image");
    expect(spec.imageSize).toBe("2K");
    expect(spec.prompt).toContain("Upscale this image to 2K resolution (2x)");
    expect(buildGeminiApiUpscaleConfig(spec, "3:2")).toEqual({
      httpOptions: { timeout: 300_000 },
      responseModalities: ["IMAGE"],
      imageConfig: { imageSize: "2K", aspectRatio: "3:2" },
    });
  });

  it("4× 固定走 Nano Banana Pro 并请求 4K", () => {
    const spec = resolveGeminiApiUpscaleSpec("x4");
    expect(spec.model).toBe("gemini-3-pro-image");
    expect(spec.imageSize).toBe("4K");
    expect(spec.prompt).toContain("Upscale this image to 4K resolution (4x)");
    const config = buildGeminiApiUpscaleConfig(spec, "16:9");
    expect(config.imageConfig.imageSize).toBe("4K");
    expect(config.httpOptions.timeout).toBe(480_000);
  });

  it("把整单取消信号传入 Gemini API 请求配置", () => {
    const signal = AbortSignal.abort(new Error("test_abort"));
    const config = buildGeminiApiUpscaleConfig(resolveGeminiApiUpscaleSpec("x2"), "1:1", signal);
    expect(config.abortSignal).toBe(signal);
  });

  it("4× 按 Vertex → WaveSpeed → EvoLink 使用 Pro Image", () => {
    const route = resolveImageUpscaleRoute("x4");
    expect(route.providerOrder).toEqual(["vertex", "wavespeed", "evolink"]);
    expect(route.models.wavespeed).toBe("google/gemini-3-pro-image/edit");
    expect(route.models.openrouter).toBe("google/gemini-3-pro-image");
    expect(route.models.evolink).toBe("gemini-3-pro-image-preview");
    expect(route.models.vertex).toBe("gemini-3-pro-image");
    expect(route.models.gemini_api).toBe("gemini-3-pro-image");
    expect(Object.values(route.models).some((model) => model.includes("flash"))).toBe(false);
  });

  it("2× 按 Vertex → OpenRouter → Gemini API 顺序使用 Flash Image", () => {
    const route = resolveImageUpscaleRoute("x2");
    expect(route.providerOrder).toEqual(["vertex", "openrouter", "gemini_api"]);
    expect(route.models.vertex).toBe("gemini-3.1-flash-image");
    expect(route.models.openrouter).toBe("google/gemini-3.1-flash-image");
    expect(route.models.gemini_api).toBe("gemini-3.1-flash-image");
  });

  it("按原图宽高选择最接近的受支持比例", () => {
    expect(nearestGeminiImageAspectRatio(1500, 1000)).toBe("3:2");
    expect(nearestGeminiImageAspectRatio(1080, 1920)).toBe("9:16");
    expect(nearestGeminiImageAspectRatio(1000, 1000)).toBe("1:1");
  });

  it("禁止内网取图，并且只允许向 Vercel Blob 官方域名发送 Blob 令牌", () => {
    expect(isPrivateOrReservedAddress("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedAddress("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedAddress("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedAddress("::1")).toBe(true);
    expect(isPrivateOrReservedAddress("8.8.8.8")).toBe(false);
    expect(isTrustedBlobBearerHost("abc.public.blob.vercel-storage.com")).toBe(true);
    expect(isTrustedBlobBearerHost("blob.vercel-storage.com.evil.example")).toBe(false);
  });

  it("按倍率判断真实可用供应商，不用另一档的配置冒充可接单", () => {
    const keys = [
      "OPENROUTER_API_KEY",
      "EVOLINK_API_KEY",
      "GEMINI_API_KEY",
      "WAVESPEED_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "VERTEX_PROJECT_ID",
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      process.env.EVOLINK_API_KEY = "evolink-test-key";
      expect(getConfiguredImageUpscaleProviders("x2")).toEqual([]);
      expect(getConfiguredImageUpscaleProviders("x4")).toEqual(["evolink"]);
      expect(isImageUpscaleConfigured("x2")).toBe(false);
      expect(isImageUpscaleConfigured("x4")).toBe(true);

      delete process.env.EVOLINK_API_KEY;
      process.env.WAVESPEED_API_KEY = "wavespeed-test-key";
      expect(getConfiguredImageUpscaleProviders("x2")).toEqual([]);
      expect(getConfiguredImageUpscaleProviders("x4")).toEqual(["wavespeed"]);

      delete process.env.WAVESPEED_API_KEY;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/test-service-account.json";
      process.env.VERTEX_PROJECT_ID = "test-project";
      expect(getConfiguredImageUpscaleProviders("x2")).toEqual(["vertex"]);
      expect(getConfiguredImageUpscaleProviders("x4")).toEqual(["vertex"]);
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("输出必须达到目标档且宽高均不得小于输入", () => {
    expect(
      hasValidImageUpscaleDimensions({
        imageSize: "2K",
        inputWidth: 1000,
        inputHeight: 700,
        outputWidth: 2048,
        outputHeight: 1434,
      }),
    ).toBe(true);
    expect(
      hasValidImageUpscaleDimensions({
        imageSize: "2K",
        inputWidth: 3000,
        inputHeight: 2000,
        outputWidth: 2048,
        outputHeight: 1365,
      }),
    ).toBe(false);
    expect(
      hasValidImageUpscaleDimensions({
        imageSize: "4K",
        inputWidth: 1920,
        inputHeight: 1080,
        outputWidth: 3840,
        outputHeight: 2160,
      }),
    ).toBe(true);
    expect(
      hasValidImageUpscaleDimensions({
        imageSize: "4K",
        inputWidth: 1920,
        inputHeight: 2160,
        outputWidth: 3840,
        outputHeight: 2000,
      }),
    ).toBe(false);
  });

  it("请求结果歧义时停止跨供应商 fallback，输入可读性探针失败不算已接单", () => {
    expect(isAmbiguousImageUpscaleError("EvoLink task poll timeout after 600000ms")).toBe(true);
    expect(isAmbiguousImageUpscaleError("socket hang up")).toBe(true);
    expect(isAmbiguousImageUpscaleError("wavespeed_poll_ambiguous:task-1:http_503")).toBe(true);
    expect(
      isAmbiguousImageUpscaleError("evolink_input_not_provider_readable:image_fetch_failed:403"),
    ).toBe(false);
    expect(isAmbiguousImageUpscaleError("provider HTTP 429")).toBe(false);
  });
});
