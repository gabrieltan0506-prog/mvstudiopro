import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
const mocks = vi.hoisted(() => ({ get: vi.fn(), sign: vi.fn(), fetch: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: mocks.get }));
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "test-bucket",
  signGcsObjectPathV4ReadUrl: mocks.sign,
  uploadStreamToGcs: vi.fn(() => { throw new Error("unexpected_upload"); }),
  uploadBufferToGcs: vi.fn(() => { throw new Error("unexpected_upload"); }),
}));
vi.mock("./manhuaAssembleAccess.js", () => ({ resolveManhuaAssembleAccess: vi.fn() }));
vi.mock("../vercel-api-core/env.js", () => ({ env: { mvspReadWriteToken: "test-key" }, getEnvStatus: vi.fn() }));
vi.mock("../vercel-api-core/render.js", () => ({ renderWorkflowFinalVideo: vi.fn() }));
vi.mock("../vercel-api-core/banana.js", () => ({ generateImageWithBanana: vi.fn() }));
vi.mock("./cometapi.js", () => ({ getCometApiBaseUrl: vi.fn(), getCometApiKey: vi.fn() }));
vi.mock("../vercel-api-core/workflow.js", () => ({ getWorkflow: vi.fn(), saveWorkflow: vi.fn(), startWorkflow: vi.fn() }));
vi.mock("../workflow/steps/characterLockStep.js", () => ({ characterLockStep: vi.fn() }));
vi.mock("../workflow/steps/backgroundRemoveStep.js", () => ({ backgroundRemoveStep: vi.fn() }));
vi.mock("../models/voiceSynthesis.js", () => ({ synthesizeVoiceAudio: vi.fn() }));
vi.mock("./flyVolumeGeneratedImages.js", () => ({ resolveSafeFlyPlatformImageReadPath: vi.fn() }));
import handler from "../../api/jobs";

function response() {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
const uuid = "12345678-1234-4123-8123-123456789abc";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MVSP_READ_WRITE_TOKEN", "test-key");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-second-key");
  vi.stubGlobal("fetch", mocks.fetch.mockImplementation(() => { throw new Error("unexpected_network"); }));
  mocks.sign.mockReturnValue("https://storage.test/fresh-signed");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("公开媒体真实 handler 离线回归", () => {
  it.each([`gcs-renders/${uuid}/rendered-video.mp4`, `gcs-public/${uuid}/asset.png`])("%s只跳转不搬运媒体字节", async (blobPath) => {
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", blobPath } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenLastCalledWith(302);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "https://storage.test/fresh-signed");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(mocks.sign).toHaveBeenCalledWith("test-bucket", blobPath, 3600);
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.send).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(["gcs-renders/../private.json", "gcs-public/../private.json", `gcs-public/${uuid}/secret.json`, `gcs-renders/${uuid}/../../private.mp4`])("拒绝恶意路径%s", async (blobPath) => {
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", blobPath } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenLastCalledWith(400);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  const oldPath = "refs/1788419489786---ROOTS-1-1024x791.webp";
  const bytes = Buffer.from("legacy-public-image-bytes");
  const oldAsset = () => ({ statusCode: 200, stream: new Response(bytes).body,
    blob: { contentType: "image/webp", cacheControl: "public, max-age=300" } });
  it.each([{ blobPath: oldPath }, { url: `https://abc.public.blob.vercel-storage.com/${oldPath}` }])("旧公开Blob入口读回原字节：%j", async (query) => {
    mocks.get.mockResolvedValueOnce(oldAsset());
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", ...query } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(bytes);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/webp");
    expect(mocks.get).toHaveBeenCalledWith("blobPath" in query ? query.blobPath : query.url,
      { token: "test-key", access: "public", useCache: true, abortSignal: expect.any(AbortSignal) });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([null, new Error("test-key upstream error")])("首store缺失或失败时仍读取第二store：%j", async (first) => {
    if (first instanceof Error) mocks.get.mockRejectedValueOnce(first);
    else mocks.get.mockResolvedValueOnce(first);
    mocks.get.mockResolvedValueOnce(oldAsset());
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", blobPath: oldPath } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(bytes);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get.mock.calls[1][1].token).toBe("test-second-key");
    expect(mocks.get.mock.calls.every(call => call[1].access === "public")).toBe(true);
  });
  it.each([{ blobPath: "renders/old.mp4" }, { url: "https://abc.public.blob.vercel-storage.com/renders/old.mp4" }])("所有store明确缺失才410：%j", async (query) => {
    mocks.get.mockResolvedValue(null);
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", ...query } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenLastCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "media_not_found" });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it.each([{ blobPath: oldPath }, { url: `https://abc.public.blob.vercel-storage.com/${oldPath}` }])("网络或鉴权失败不伪装410、不泄漏令牌：%j", async (query) => {
    mocks.get.mockRejectedValueOnce(new Error("test-key upstream auth failure")).mockResolvedValueOnce(null);
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", ...query } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect([500, 503]).toContain(res.status.mock.lastCall?.[0]);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("test-key");
    expect(JSON.stringify(res.json.mock.calls)).toContain("legacy_media_unavailable");
  });
  it.each([{ blobPath: "https://abc.private.blob.vercel-storage.com/secret.png" }, { url: "https://abc.private.blob.vercel-storage.com/secret.png" }])("不开放私有Blob主机：%j", async (query) => {
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", ...query } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect([500, 503]).toContain(res.status.mock.lastCall?.[0]);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
