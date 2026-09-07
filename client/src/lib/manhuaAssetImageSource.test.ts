import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetImageGcsUri,
  prepareAssetImageEdit,
  readAssetImageDimensions,
} from "./manhuaAssetImageSource";
import { resolveCanvasMaterialUrl } from "./omniCanvasApi";

vi.mock("./omniCanvasApi", () => ({ resolveCanvasMaterialUrl: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function image(width: number, height: number, fail = false) {
  const urls: string[] = [];
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = width;
      naturalHeight = height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        urls.push(value);
        queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()));
      }
    }
  );
  return urls;
}

describe("资产编辑原图预检", () => {
  it("旧稿无宽高：474×265 原图先续签，再按真实横图提交", async () => {
    const urls = image(474, 265);
    vi.mocked(resolveCanvasMaterialUrl).mockResolvedValue(
      "https://fresh.example/source.jpg"
    );
    const result = await prepareAssetImageEdit({
      url: "https://expired.example/source.jpg",
      gcsUri: "gs://test-bucket/uploads/u1/source.jpg",
    });
    expect(resolveCanvasMaterialUrl).toHaveBeenCalledWith(
      "gs://test-bucket/uploads/u1/source.jpg"
    );
    expect(urls).toEqual(["https://fresh.example/source.jpg"]);
    expect(result).toEqual({
      url: "https://fresh.example/source.jpg",
      sourceWidth: 474,
      sourceHeight: 265,
      aspectRatio: "16:9",
    });
  });
  it("仅存旧签名 URL 的编辑产物可还原长期身份，每次点击都重新续签", async () => {
    image(265, 474);
    vi.mocked(resolveCanvasMaterialUrl).mockResolvedValue(
      "https://fresh.example/generated.png"
    );
    const ref = {
      url: "https://storage.googleapis.com/test-bucket/generated/edit/old.png?X-Goog-Signature=test-signature",
    };
    expect((await prepareAssetImageEdit(ref)).aspectRatio).toBe("9:16");
    await prepareAssetImageEdit(ref);
    expect(resolveCanvasMaterialUrl).toHaveBeenCalledTimes(2);
    expect(resolveCanvasMaterialUrl).toHaveBeenCalledWith(
      "gs://test-bucket/generated/edit/old.png"
    );
  });
  it("续签失败不退回过期链接，解码失败不猜画幅", async () => {
    const urls = image(0, 0);
    vi.mocked(resolveCanvasMaterialUrl).mockRejectedValue(
      new Error("签名失败")
    );
    await expect(
      prepareAssetImageEdit({
        url: "https://old.example/a",
        gcsUri: "gs://test-bucket/a",
      })
    ).rejects.toThrow("签名失败");
    expect(urls).toEqual([]);
    await expect(
      prepareAssetImageEdit({ url: "https://public.example/a" })
    ).rejects.toThrow("无法读取图片尺寸");
    image(474, 265, true);
    await expect(
      readAssetImageDimensions("https://public.example/b")
    ).rejects.toThrow("参考图无法读取");
  });
  it("读取有界超时", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", class {});
    const assertion = expect(
      readAssetImageDimensions("https://public.example/a")
    ).rejects.toThrow("图片读取超时");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
  it("非存储主机与异常对象不生成存储身份", () => {
    expect(
      assetImageGcsUri("https://storage.googleapis.com.evil.example/b/a")
    ).toBeUndefined();
    expect(
      assetImageGcsUri("https://storage.googleapis.com/b/%5csecret")
    ).toBeUndefined();
    expect(
      assetImageGcsUri("https://storage.googleapis.com/b/a%20b.png?q=test")
    ).toBe("gs://b/a b.png");
  });
});
