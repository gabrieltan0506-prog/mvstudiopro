import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetImageGcsUri,
  canKeepAssetImageDisplayUrl,
  resolveAssetImagePreviewUrl,
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
  it("已开放大图跟随同一资产ID的新地址，同名图和节点预览不串图", () => {
    const refs = [
      { id: "a", url: "https://fresh.example/a", labelZh: "同名" },
      { id: "b", url: "https://fresh.example/b", labelZh: "同名" },
    ];
    expect(
      resolveAssetImagePreviewUrl(
        { assetRefId: "b", url: "https://expired.example/b" },
        refs
      )
    ).toBe("https://fresh.example/b");
    expect(
      resolveAssetImagePreviewUrl({ url: "https://node.example/output" }, refs)
    ).toBe("https://node.example/output");
    expect(
      resolveAssetImagePreviewUrl(
        { assetRefId: "removed", url: "https://original.example/removed" },
        refs
      )
    ).toBe("https://original.example/removed");
  });
  it("七天有效原图不降为一小时签名，临近到期与已过期才续签", () => {
    const ref = {
      gcsUri: "gs://test-bucket/generated/current.png",
      url: "https://storage.googleapis.com/test-bucket/generated/current.png?X-Goog-Date=20260907T170620Z&X-Goog-Expires=604800&X-Goog-Signature=test-signature",
    };
    const now = Date.parse("2026-09-07T19:06:00Z");
    expect(canKeepAssetImageDisplayUrl(ref, now)).toBe(true);
    expect(
      canKeepAssetImageDisplayUrl(
        { ...ref, url: ref.url.replace("604800", "3600") },
        now
      )
    ).toBe(false);
    expect(
      canKeepAssetImageDisplayUrl(ref, Date.parse("2026-09-14T17:02:00Z"))
    ).toBe(false);
  });
  it("错误身份、伪主机、缺失或非法签名时间不能跳过原鉴权续签", () => {
    const ref = {
      gcsUri: "gs://test-bucket/generated/current.png",
      url: "https://storage.googleapis.com/test-bucket/generated/current.png?X-Goog-Date=20260907T170620Z&X-Goog-Expires=604800&X-Goog-Signature=test-signature",
    };
    const now = Date.parse("2026-09-07T19:06:00Z");
    for (const url of [
      ref.url.replace("current.png", "other.png"),
      ref.url.replace(
        "storage.googleapis.com",
        "storage.googleapis.com.evil.invalid"
      ),
      ref.url.replace("20260907T170620Z", "20260231T170620Z"),
      ref.url.replace("20260907T170620Z", "20270907T170620Z"),
      ref.url.replace("604800", "Infinity"),
      ref.url.replace("604800", "0"),
      ref.url.replace("&X-Goog-Signature=test-signature", ""),
      "blob:test-local",
      "https://storage.googleapis.com/test-bucket/generated/current.png",
    ])
      expect(canKeepAssetImageDisplayUrl({ ...ref, url }, now)).toBe(false);
  });
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
