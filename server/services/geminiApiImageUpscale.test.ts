import { describe, expect, it } from "vitest";
import {
  buildGeminiApiUpscaleConfig,
  isPrivateOrReservedAddress,
  isTrustedBlobBearerHost,
  nearestGeminiImageAspectRatio,
  resolveGeminiApiUpscaleSpec,
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
});
