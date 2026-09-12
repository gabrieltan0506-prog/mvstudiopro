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
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch.mockImplementation(() => { throw new Error("unexpected_network"); }));
  mocks.sign.mockReturnValue("https://storage.test/fresh-signed");
});
afterEach(() => vi.unstubAllGlobals());

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
  it("旧Blob路径沿用get读取和200原始字节", async () => {
    const bytes = Buffer.from("test-legacy-media");
    mocks.get.mockResolvedValue({ statusCode: 200, stream: new Response(bytes).body,
      blob: { contentType: "video/mp4", cacheControl: "public, max-age=300" } });
    const res = response();
    await handler({ method: "GET", query: { op: "blobMedia", blobPath: "renders/old.mp4" } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(bytes);
    expect(mocks.get).toHaveBeenCalledWith("renders/old.mp4", { token: "test-key", access: "public" });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
