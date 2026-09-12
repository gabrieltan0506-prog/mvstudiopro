import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const gcs = vi.hoisted(() => ({
  uploadBufferToGcs: vi.fn(),
  getGcsBucketName: vi.fn(() => "test-bucket"),
  signGcsObjectPathV4ReadUrl: vi.fn(() => "https://storage.example.test/signed"),
}));
vi.mock("./gcs", () => gcs);
import { buildPublicStoredMediaUrl, isPublicStoredObjectPath, putPublicStoredMedia, signPublicStoredMediaRedirect } from "./publicStoredMedia";
import { storagePut } from "../storage";
const objectName = "gcs-public/11111111-1111-4111-8111-111111111111/asset.mp4";
beforeEach(() => { vi.clearAllMocks(); gcs.uploadBufferToGcs.mockResolvedValue({}); });
afterEach(() => vi.unstubAllEnvs());

describe("原公开 Blob 写入转 GCS", () => {
  it("持久化真实字节和类型，返回带扩展名稳定地址，短期签名不写入回执", async () => {
    vi.stubEnv("OAUTH_SERVER_URL", "https://example.test/");
    const body = Buffer.from([1, 2, 3, 255]);
    const saved = await putPublicStoredMedia("refs/old-name.PNG", body, { access: "public", contentType: "image/png" });
    expect(saved.pathname).toMatch(/^gcs-public\/.+\/asset\.png$/);
    expect(isPublicStoredObjectPath(saved.pathname)).toBe(true);
    expect(saved.url).toBe(`https://example.test/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(saved.pathname)}`);
    expect(gcs.uploadBufferToGcs).toHaveBeenCalledTimes(1);
    expect(gcs.uploadBufferToGcs).toHaveBeenCalledWith(expect.objectContaining({ objectName: saved.pathname, buffer: body, contentType: "image/png", ifGenerationMatch: "0" }));
    expect(gcs.signGcsObjectPathV4ReadUrl).not.toHaveBeenCalled();
  });
  it("同旧key重试写不同对象，不覆盖已有产物", async () => {
    const a = await putPublicStoredMedia("same.mp3", Buffer.from("a"), { access: "public" });
    const b = await putPublicStoredMedia("same.mp3", Buffer.from("b"), { access: "public" });
    expect(a.pathname).not.toBe(b.pathname);
  });
  it("上传失败原样失败，不返回假URL或回退Blob", async () => {
    gcs.uploadBufferToGcs.mockRejectedValueOnce(new Error("test_upload_failed"));
    await expect(putPublicStoredMedia("a.png", Buffer.from("x"), { access: "public" })).rejects.toThrow("test_upload_failed");
  });
  it("空内容不写存储", async () => {
    await expect(putPublicStoredMedia("a.png", Buffer.alloc(0), { access: "public" })).rejects.toThrow("empty_public_media");
    expect(gcs.uploadBufferToGcs).not.toHaveBeenCalled();
  });
  it("只签当前桶的白名单路径", () => {
    expect(signPublicStoredMediaRedirect(objectName)).toBe("https://storage.example.test/signed");
    expect(gcs.signGcsObjectPathV4ReadUrl).toHaveBeenCalledWith("test-bucket", objectName, 3600);
  });
  it.each([
    "gs://other/private.json", "generated/user/private.png", `${objectName}/../private.json`,
    objectName.replace("asset.mp4", "%2e%2e"), objectName.replace("asset.mp4", "other.mp4"),
    objectName.replace("4111", "1111"), `${objectName}?bucket=other`, `${objectName}\n`,
  ])("拒绝私有/跨桶/编码/越界路径 %s", value => {
    expect(isPublicStoredObjectPath(value)).toBe(false);
    expect(() => signPublicStoredMediaRedirect(value)).toThrow("invalid_public_media_path");
    expect(() => buildPublicStoredMediaUrl(value)).toThrow("invalid_public_media_path");
    expect(gcs.signGcsObjectPathV4ReadUrl).not.toHaveBeenCalled();
  });
  it("共享storagePut无Blob凭证时仍走GCS，保留业务key与内容", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("MVSP_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const saved = await storagePut("/exports/test.json", '{"ok":true}', "application/json");
    expect(saved.key).toBe("exports/test.json");
    expect(saved.url).toContain("gcs-public");
    expect(gcs.uploadBufferToGcs).toHaveBeenCalledWith(expect.objectContaining({ buffer: Buffer.from('{"ok":true}'), contentType: "application/json" }));
  });
});
