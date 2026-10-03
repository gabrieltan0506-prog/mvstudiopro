import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ resolve: vi.fn(), probe: vi.fn() }));
vi.mock("./postProdMediaSource.js", async () => {
  const actual = await vi.importActual<typeof import("./postProdMediaSource.js")>("./postProdMediaSource.js");
  return { ...actual, resolveRegisteredPostProdMediaSource: state.resolve };
});
vi.mock("./gcs.js", () => ({ getGcsBucketName: () => "test-system-bucket", signGsUriV4ReadUrl: (uri: string) => `https://test.invalid/read?object=${encodeURIComponent(uri)}` }));
vi.mock("./photoMediaInput.js", () => ({ probePhotoVideoInput: state.probe }));
import { probeVideoEnhanceSource } from "./videoEnhanceSource";
beforeEach(() => {
  vi.clearAllMocks();
  state.probe.mockResolvedValue({ durationSec: 11, width: 720, height: 1280, fps: 30 });
});
it("首页系统桶签名链接也核验本人归属，并以规范对象恢复同一任务", async () => {
  state.resolve.mockResolvedValue("gs://test-system-bucket/post-prod/7/one.mp4");
  const first = await probeVideoEnhanceSource(7, "https://storage.googleapis.com/test-system-bucket/post-prod/7/one.mp4?test-signature=first", false);
  const refreshed = await probeVideoEnhanceSource(7, "https://storage.googleapis.com/test-system-bucket/post-prod/7/one.mp4?test-signature=second", false);
  expect(state.resolve).toHaveBeenCalledTimes(2);
  expect(first.canonicalSource).toBe(refreshed.canonicalSource);
  expect(state.probe).toHaveBeenCalledWith(expect.stringContaining("https://test.invalid/read?object="));
});
it("系统对象归属被拒绝时不读取媒体、不提交上游", async () => {
  state.resolve.mockRejectedValue(new Error("素材尚未登记"));
  await expect(probeVideoEnhanceSource(7, "https://storage.googleapis.com/test-system-bucket/post-prod/8/one.mp4", false)).rejects.toThrow("素材尚未登记");
  expect(state.probe).not.toHaveBeenCalled();
});
it("外部HTTPS视频沿原安全下载器读取", async () => {
  const result = await probeVideoEnhanceSource(7, "https://test.invalid/external.mp4", false);
  expect(state.resolve).not.toHaveBeenCalled();
  expect(result.canonicalSource).toBe("https://test.invalid/external.mp4");
});
