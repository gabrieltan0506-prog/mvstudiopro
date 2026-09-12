import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), sign: vi.fn() }));
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "test-bucket",
  uploadStreamToGcs: mocks.upload,
  signGcsObjectPathV4ReadUrl: mocks.sign,
}));
import { buildPublicRenderMediaUrl, isPublicRenderObjectPath, signPublicRenderMediaRedirect, uploadFileToPublicRenderMedia } from "./publicRenderMedia";
const object = "gcs-renders/12345678-1234-4123-8123-123456789abc/rendered-video.mp4";
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("公开渲染产物固定空间", () => {
  it("上传挂起时传递120秒取消信号，超时返回失败而非稳定成品URL", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "render-gcs-timeout-"));
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    try {
      const file = path.join(dir, "rendered-video.mp4");
      await fs.writeFile(file, "test-render-content");
      mocks.upload.mockImplementation(({ stream, signal }) => new Promise((resolve, reject) => {
        // 缺失信号时立即暴露原始回归，避免测试自身永久等待。
        if (!signal) {
          void stream.cancel().then(() => reject(new Error("missing_upload_signal")));
          entered();
          return;
        }
        expect(signal).toBe(controller.signal);
        signal.addEventListener("abort", () => {
          void stream.cancel().then(() => reject(signal.reason));
        }, { once: true });
        entered();
      }));
      const uploading = uploadFileToPublicRenderMedia(file, "rendered-video.mp4");
      const rejected = expect(uploading).rejects.toMatchObject({ name: "TimeoutError" });
      await ready;
      controller.abort(new DOMException("test-upload-timeout", "TimeoutError"));
      await rejected;
      expect(timeout).toHaveBeenCalledWith(120_000);
      expect(mocks.upload).toHaveBeenCalledOnce();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it.each(["../private/x", "gs://other/secret", "gcs-renders/../secret", object.replace("rendered-video.mp4", "secret.json"), object + "/../secret", object.replace("gcs-renders/", "gcs-renders/%2e%2e/"), "canvas-media/secret.mp4", "/" + object, object + "\n"])("拒绝非固定产物路径：%s", (value) => {
    expect(isPublicRenderObjectPath(value)).toBe(false);
    expect(() => signPublicRenderMediaRedirect(value)).toThrow("invalid_public_render_path");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("稳定URL不持久化签名，每次只为固定桶和该对象签名", () => {
    vi.stubEnv("OAUTH_SERVER_URL", "https://test.invalid");
    const stable = buildPublicRenderMediaUrl(object);
    expect(new URL(stable).searchParams.get("blobPath")).toBe(object);
    expect(stable).not.toContain("X-Goog");
    mocks.sign.mockReturnValueOnce("https://storage.test/first").mockReturnValueOnce("https://storage.test/second");
    expect(signPublicRenderMediaRedirect(object)).not.toBe(signPublicRenderMediaRedirect(object));
    expect(mocks.sign).toHaveBeenLastCalledWith("test-bucket", object, 3600);
  });
  it.each(["rendered-video.mp4", "scene-voice-track.mp3"] as const)("本地文件流上传%s，字节一致，不整文件读入上传", async (name) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "render-gcs-test-"));
    try {
      const file = path.join(dir, name); const bytes = Buffer.from("test-render-content");
      await fs.writeFile(file, bytes);
      mocks.upload.mockImplementation(async ({ stream, contentLength }) => {
        expect(contentLength).toBe(bytes.length);
        expect(Buffer.from(await new Response(stream).arrayBuffer())).toEqual(bytes);
      });
      const url = await uploadFileToPublicRenderMedia(file, name);
      expect(isPublicRenderObjectPath(new URL(url).searchParams.get("blobPath")!)).toBe(true);
      expect(mocks.upload).toHaveBeenCalledOnce();
      mocks.upload.mockImplementation(async ({stream}) => { await stream.cancel(); throw new Error("test-upload-failed"); });
      await expect(uploadFileToPublicRenderMedia(file, name)).rejects.toThrow("test-upload-failed");
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
