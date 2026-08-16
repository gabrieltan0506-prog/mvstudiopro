import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteGcsObject: vi.fn(async () => undefined),
  uploadBufferToGcs: vi.fn(async () => ({
    bucket: "test-bucket",
    objectName: "temporary/image-upscale/source.png",
    gcsUri: "gs://test-bucket/temporary/image-upscale/source.png",
  })),
  fetchSafeRemoteImage: vi.fn(async () => ({
    buffer: Buffer.from("png-output"),
    contentType: "image/png",
  })),
}));

vi.mock("./gcs.js", () => ({
  deleteGcsObject: mocks.deleteGcsObject,
  uploadBufferToGcs: mocks.uploadBufferToGcs,
  signGsUriV4ReadUrl: () => "https://storage.googleapis.com/test-bucket/source.png?signed=1",
}));

vi.mock("./remoteImageFetch.js", () => ({
  fetchSafeRemoteImage: mocks.fetchSafeRemoteImage,
}));

import {
  WAVESPEED_GEMINI_PRO_IMAGE_EDIT_MODEL,
  buildWavespeedGeminiProImageEditBody,
  isWavespeedGeminiImageUpscaleConfigured,
  runWavespeedGeminiImageUpscale,
} from "./wavespeedGeminiImageUpscale";

describe("WaveSpeed Gemini Pro Image 4K fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("固定使用官方 edit 模型与 4K 请求契约", () => {
    expect(WAVESPEED_GEMINI_PRO_IMAGE_EDIT_MODEL).toBe("google/gemini-3-pro-image/edit");
    expect(buildWavespeedGeminiProImageEditBody({
      prompt: "upscale only",
      sourceUrl: "https://example.com/source.png",
      aspectRatio: "9:16",
    })).toEqual({
      prompt: "upscale only",
      images: ["https://example.com/source.png"],
      aspect_ratio: "9:16",
      resolution: "4k",
      output_format: "png",
    });
  });

  it("成功时只创建一次、轮询既有 prediction，并清理精确临时副本", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WAVESPEED_API_KEY", "wavespeed-test-key");
    expect(isWavespeedGeminiImageUpscaleConfigured()).toBe(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "prediction-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { id: "prediction-1", status: "completed", outputs: ["https://cdn.example.com/output.png"] },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = runWavespeedGeminiImageUpscale({
      sourceBuffer: Buffer.from("source"),
      sourceMimeType: "image/png",
      prompt: "upscale only",
      aspectRatio: "9:16",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;

    expect(result.predictionId).toBe("prediction-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://api.wavespeed.ai/api/v3/google/gemini-3-pro-image/edit");
    expect(JSON.parse(String(createInit.body))).toMatchObject({ resolution: "4k", output_format: "png" });
    expect(mocks.deleteGcsObject).toHaveBeenCalledWith({
      bucket: "test-bucket",
      objectName: "temporary/image-upscale/source.png",
    });
  });

  it("任务已创建但轮询结果不明时保留临时输入，禁止伪装已失败后跨家重建", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WAVESPEED_API_KEY", "wavespeed-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "prediction-ambiguous" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = runWavespeedGeminiImageUpscale({
      sourceBuffer: Buffer.from("source"),
      sourceMimeType: "image/png",
      prompt: "upscale only",
      aspectRatio: "16:9",
    });
    const assertion = expect(pending).rejects.toThrow(
      "wavespeed_poll_ambiguous:prediction-ambiguous:http_503",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(mocks.deleteGcsObject).not.toHaveBeenCalled();
  });
});
