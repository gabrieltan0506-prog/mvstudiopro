import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertManhuaBackupImage } from "./manhuaBackupImageValidation";
import { readAssetImageDimensions } from "./manhuaAssetImageSource";

vi.mock("./manhuaAssetImageSource", () => ({
  readAssetImageDimensions: vi.fn(),
}));

function pngBlob(type = "image/png") {
  // 真实 1×1 PNG 字节；本文件只模拟浏览器解码边界，不假称已在浏览器验图。
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
    ),
    ch => ch.charCodeAt(0)
  );
  return new Blob([bytes], { type });
}

describe("备份图片字节预检", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-backup-image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(readAssetImageDimensions).mockResolvedValue({
      sourceWidth: 1,
      sourceHeight: 1,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each(["text/html", "application/json", "video/mp4", "model/gltf-binary"])(
    "拒绝明确非图片类型%s，零解码零URL",
    async mime => {
      await expect(
        assertManhuaBackupImage(new Blob(["not-an-image"], { type: mime }))
      ).rejects.toThrow("不是图片内容");
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(readAssetImageDimensions).not.toHaveBeenCalled();
    }
  );

  it("manifest写png不能掩盖响应HTML，响应png也不能掩盖manifest JSON", async () => {
    await expect(
      assertManhuaBackupImage(
        new Blob(["<html>error</html>"], { type: "text/html" }),
        "image/png"
      )
    ).rejects.toThrow("不是图片内容");
    await expect(
      assertManhuaBackupImage(pngBlob(), "application/json")
    ).rejects.toThrow("不是图片内容");
    expect(readAssetImageDimensions).not.toHaveBeenCalled();
  });

  it.each(["image/png", "", "application/octet-stream"])(
    "%s类型使用原Blob实际解码并回收URL",
    async mime => {
      const blob = pngBlob(mime);
      await assertManhuaBackupImage(blob, mime);
      expect(blob.size).toBeGreaterThan(60);
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(readAssetImageDimensions).toHaveBeenCalledWith(
        "blob:test-backup-image"
      );
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(
        "blob:test-backup-image"
      );
    }
  );

  it("图片类型大小写和参数仍可解码", async () => {
    await assertManhuaBackupImage(pngBlob(), "IMAGE/PNG; charset=binary");
    expect(readAssetImageDimensions).toHaveBeenCalledTimes(1);
  });

  it("ZIP无类型字节按清单补SVG解码类型，不改原Blob或字节", async () => {
    const content =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';
    const source = new Blob([content]);
    await assertManhuaBackupImage(source, "image/svg+xml");
    const decodeBlob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(decodeBlob.type).toBe("image/svg+xml");
    expect(await decodeBlob.text()).toBe(content);
    expect(source.type).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("空图片在解码前拒绝", async () => {
    await expect(
      assertManhuaBackupImage(new Blob([], { type: "image/png" }))
    ).rejects.toThrow("内容为空");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("解码失败转换为备份错误并仍回收URL，不泄漏生成文案", async () => {
    vi.mocked(readAssetImageDimensions).mockRejectedValue(
      new Error("参考图无法读取，尚未提交生成")
    );
    await expect(assertManhuaBackupImage(pngBlob())).rejects.toThrow(
      "备份图片无法读取或已损坏"
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-backup-image");
  });

  it.each([
    [0, 1],
    [1, 0],
    [NaN, 1],
    [1, Infinity],
  ])("非有效正尺寸%s×%s不放行", async (sourceWidth, sourceHeight) => {
    vi.mocked(readAssetImageDimensions).mockResolvedValue({
      sourceWidth,
      sourceHeight,
    });
    await expect(assertManhuaBackupImage(pngBlob())).rejects.toThrow(
      "备份图片无法读取或已损坏"
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("创建URL失败使用备份语义，不回收未创建的URL", async () => {
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error("URL unavailable");
    });
    await expect(assertManhuaBackupImage(pngBlob())).rejects.toThrow(
      "备份图片无法读取或已损坏"
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
