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
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("公开渲染产物固定空间", () => {
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

describe("API真实公开跳转分支", () => {
  it("合法路径302，不读取媒体；非法路径400且不签名", async () => {
    const source = await fs.readFile(new URL("../../api/jobs.ts", import.meta.url), "utf8");
    const start = source.indexOf('        if (blobPath.startsWith("gcs-renders/"))');
    // 结束标记：gcs-renders 分支之后就是「老 Blob 路径一律 410」那一行。
    // 0912 Blob 退场后原来的 proxyBlobAssetByPath 已删除，标记跟着改。
    const end = source.indexOf('        // 非 gcs- 前缀只可能是 Vercel Blob 时代的老路径', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const branch = new Function("blobPath", "res", "isPublicRenderObjectPath", "signPublicRenderMediaRedirect", source.slice(start, end));
    const res = { setHeader: vi.fn(), status: vi.fn(), end: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    mocks.sign.mockReturnValue("https://storage.test/fresh-signed");
    branch(object, res, isPublicRenderObjectPath, signPublicRenderMediaRedirect);
    expect(res.status).toHaveBeenLastCalledWith(302);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "https://storage.test/fresh-signed");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.end).toHaveBeenCalledOnce();
    mocks.sign.mockClear();
    branch("gcs-renders/../private.json", res, isPublicRenderObjectPath, signPublicRenderMediaRedirect);
    expect(res.status).toHaveBeenLastCalledWith(400);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
