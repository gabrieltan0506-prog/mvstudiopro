import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn(), owner: vi.fn(), sign: vi.fn() }));
vi.mock("./photoMediaInput.js", () => ({ downloadPhotoMedia: mocks.download }));
vi.mock("./gcs.js", () => ({ getGcsBucketName: () => "test-bucket", uploadBufferToGcsIfAbsent: mocks.upload, signGcsObjectPathV4ReadUrl: mocks.sign }));
vi.mock("./canvasMediaOwnership.js", () => ({ registerCanvasMediaOwner: mocks.owner }));
import { normalizeSeedanceReferenceImage } from "./seedanceReferenceImageSize.js";

beforeEach(() => { vi.resetAllMocks(); mocks.upload.mockResolvedValue({ created: true }); mocks.owner.mockResolvedValue("created"); mocks.sign.mockReturnValue("https://test.invalid/normalized.png"); });
describe("Seedance 2.5实际参考图片尺寸归一化", () => {
  it.each([[480,270,960,540], [270,480,540,960], [100,100,400,400]])("%s×%s按2倍或4倍放大并登记隔离归属", async (width, height, expectedW, expectedH) => {
    mocks.download.mockResolvedValue(await sharp({ create: { width, height, channels: 3, background: "red" } }).png().toBuffer());
    expect(await normalizeSeedanceReferenceImage("https://test.invalid/source.png", 7)).toBe("https://test.invalid/normalized.png");
    const payload = mocks.upload.mock.calls[0][0];
    const metadata = await sharp(payload.buffer).metadata();
    expect([metadata.width,metadata.height]).toEqual([expectedW,expectedH]);
    expect(payload.objectName).toMatch(/^generated\/seedance-reference-size\/u7\/[a-f0-9]{64}\.png$/);
    expect(mocks.owner).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 7, objectPath: payload.objectName }));
  });
  it("达标图片保留原URL与内容，不上传新版本", async () => {
    mocks.download.mockResolvedValue(await sharp({ create: { width:512,height:768,channels:3,background:"red" } }).png().toBuffer());
    expect(await normalizeSeedanceReferenceImage("https://test.invalid/source.png",7)).toBe("https://test.invalid/source.png");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("归属冲突不生成可发送地址", async () => {
    mocks.download.mockResolvedValue(await sharp({ create:{width:480,height:270,channels:3,background:"red"} }).png().toBuffer());
    mocks.owner.mockResolvedValue("conflict");
    await expect(normalizeSeedanceReferenceImage("https://test.invalid/source.png",7)).rejects.toThrow("归属登记失败");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
