import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createManhuaAssetImageFallback,
  ManhuaAssetImage,
  readManhuaAssetImageBlob,
  renewManhuaAssetImageDisplayUrl,
} from "@/components/ManhuaAssetImage";
import * as canvasApi from "./omniCanvasApi";
import {
  __resetManhuaLocalMediaStoreForTests,
  getLocalMediaRecordBySource,
  importLocalMediaRecords,
  putLocalMediaRecord,
  makeLocalMediaRecordId,
} from "@/lib/manhuaLocalMediaStore";

function setup(readBlob: (source: string) => Promise<Blob | null>) {
  const display = vi.fn();
  const finalError = vi.fn();
  const createUrl = vi.fn((_blob: Blob) => "blob:test-restored");
  const revokeUrl = vi.fn();
  const fallback = createManhuaAssetImageFallback({
    source: "https://test.invalid/asset.png",
    readBlob,
    display,
    finalError,
    createUrl,
    revokeUrl,
  });
  return { fallback, display, finalError, createUrl, revokeUrl };
}

describe("工作台资产图片本机回退", () => {
  beforeEach(async () => {
    await __resetManhuaLocalMediaStoreForTests();
  });

  it("新签名按导演板长期身份读取原字节，旧槽位必须同源才回退", async () => {
    await importLocalMediaRecords([
      {
        sourceUrl: "gs://test-bucket/board.png",
        blob: new Blob(["board-bytes"]),
        mime: "image/png",
      },
    ]);
    await putLocalMediaRecord({
      id: makeLocalMediaRecordId("keyart-old", "output"),
      blockId: "keyart-old",
      slot: "output",
      sourceUrl: "https://test.invalid/old.png",
      blob: new Blob(["legacy-bytes"]),
      mime: "image/png",
      updatedAt: 1,
    });
    await __resetManhuaLocalMediaStoreForTests({ keepRecords: true });
    expect(
      await (
        await readManhuaAssetImageBlob(
          "https://storage.googleapis.com/test-bucket/board.png?test-signature=new"
        )
      )?.text()
    ).toBe("board-bytes");
    expect(
      await (
        await readManhuaAssetImageBlob(
          "https://test.invalid/old.png",
          "keyart-old"
        )
      )?.text()
    ).toBe("legacy-bytes");
    expect(
      await readManhuaAssetImageBlob(
        "https://test.invalid/other.png",
        "keyart-old"
      )
    ).toBeNull();
  });

  it("导入字节刷新后真实命中，远端失败不通知业务；卸载回收本组件URL", async () => {
    const source = "https://test.invalid/asset.png";
    await importLocalMediaRecords([
      {
        sourceUrl: source,
        blob: new Blob(["restored-image"]),
        mime: "image/png",
      },
    ]);
    await __resetManhuaLocalMediaStoreForTests({ keepRecords: true });
    const readBlob = vi.fn(
      async (url: string) =>
        (await getLocalMediaRecordBySource(url))?.blob || null
    );
    const state = setup(readBlob);
    expect(readBlob).not.toHaveBeenCalled();
    await state.fallback.fail("remote-error");
    expect(readBlob).toHaveBeenCalledTimes(1);
    expect(readBlob).toHaveBeenCalledWith(source);
    expect(await state.createUrl.mock.calls[0][0].text()).toBe(
      "restored-image"
    );
    expect(state.display).toHaveBeenCalledWith("blob:test-restored");
    expect(state.finalError).not.toHaveBeenCalled();
    state.fallback.dispose();
    state.fallback.dispose();
    expect(state.revokeUrl).toHaveBeenCalledTimes(1);
    expect(state.revokeUrl).toHaveBeenCalledWith("blob:test-restored");
  });

  it("换来源或卸载后迟到字节不创建URL，不覆盖新图，不误报旧错", async () => {
    let resolve!: (blob: Blob) => void;
    const state = setup(
      () =>
        new Promise<Blob>(done => {
          resolve = done;
        })
    );
    const pending = state.fallback.fail("old-error");
    state.fallback.dispose();
    resolve(new Blob(["late"]));
    await pending;
    expect(state.createUrl).not.toHaveBeenCalled();
    expect(state.display).not.toHaveBeenCalled();
    expect(state.finalError).not.toHaveBeenCalled();
  });

  it("并发错误只查一次；本机图也坏时只回调最终错误一次，不无限回退", async () => {
    let resolve!: (blob: Blob) => void;
    const readBlob = vi.fn(
      () =>
        new Promise<Blob>(done => {
          resolve = done;
        })
    );
    const state = setup(readBlob);
    const first = state.fallback.fail("remote");
    await state.fallback.fail("duplicate");
    expect(readBlob).toHaveBeenCalledTimes(1);
    resolve(new Blob(["broken-image"]));
    await first;
    await state.fallback.fail("local-broken");
    await state.fallback.fail("again");
    expect(state.finalError).toHaveBeenCalledTimes(1);
    expect(state.finalError).toHaveBeenCalledWith("local-broken");
    expect(readBlob).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "empty", "error"])(
    "本机%s时保留原始最终错误语义",
    async mode => {
      const state = setup(async () => {
        if (mode === "error") throw new Error("storage unavailable");
        return mode === "empty" ? new Blob([]) : null;
      });
      const event = { currentTarget: { naturalWidth: 0 } };
      await state.fallback.fail(event);
      expect(state.finalError).toHaveBeenCalledTimes(1);
      expect(state.finalError).toHaveBeenCalledWith(event);
      expect(state.display).not.toHaveBeenCalled();
    }
  );

  it("真实组件保留原始HTTPS与展示属性，不输出缓存身份或blob到持久字段", () => {
    const html = renderToStaticMarkup(
      React.createElement(ManhuaAssetImage, {
        src: "https://test.invalid/asset.png",
        alt: "墨屠",
        className: "asset-image",
        loading: "lazy",
        localMediaBlockId: "keyart-e01-s01",
        onLoad: () => {},
        onError: () => {},
      })
    );
    expect(html).toContain('src="https://test.invalid/asset.png"');
    expect(html).toContain('alt="墨屠"');
    expect(html).toContain('class="asset-image"');
    expect(html).not.toContain("localMediaBlockId");
    expect(html).not.toContain("blob:");
  });

  it.each(["gs://test-bucket/asset.png", "local-media:v1/source-id"])(
    "%s不作为浏览器图片请求发送",
    source => {
      const html = renderToStaticMarkup(
        React.createElement(ManhuaAssetImage, { src: source, alt: "恢复资产" })
      );
      expect(html).not.toContain("src=");
      expect(html).not.toContain(source);
    }
  );
});

describe("工作台资产图片有界续签", () => {
  const source =
    "https://storage.googleapis.com/test-bucket/image.png?X-Goog-Signature=expired";
  const renewed =
    "https://storage.googleapis.com/test-bucket/image.png?X-Goog-Signature=renewed";
  const signer = vi.spyOn(canvasApi, "resolveCanvasMaterialUrl");
  beforeEach(() => {
    signer.mockReset();
  });
  afterAll(() => {
    signer.mockRestore();
  });

  it("同一对象不同签名只合并在途请求，完成后允许重新续签", async () => {
    let resolve!: (url: string) => void;
    signer.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const first = renewManhuaAssetImageDisplayUrl(source);
    const second = renewManhuaAssetImageDisplayUrl(
      "gs://test-bucket/image.png"
    );
    await Promise.resolve();
    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer).toHaveBeenCalledWith("gs://test-bucket/image.png");
    resolve(renewed);
    expect(await Promise.all([first, second])).toEqual([renewed, renewed]);
    signer.mockResolvedValueOnce(renewed);
    await renewManhuaAssetImageDisplayUrl(source);
    expect(signer).toHaveBeenCalledTimes(2);
  });

  it.each([
    "local-media:v1/abc",
    "https://example.test/a.png",
    "blob:test",
    "gs://bucket/../x",
    "gs://bucket/%2e%2e/x",
    "gs://bucket/a?key=x",
  ])("不支持或不安全来源 %s 不发请求", async value => {
    expect(await renewManhuaAssetImageDisplayUrl(value)).toBeNull();
    expect(signer).not.toHaveBeenCalled();
  });

  it("拒绝空地址、换对象地址；请求失败不永久占用在途槽位", async () => {
    signer.mockRejectedValueOnce(new Error("offline"));
    await expect(renewManhuaAssetImageDisplayUrl(source)).rejects.toThrow(
      "offline"
    );
    signer.mockResolvedValueOnce("");
    await expect(renewManhuaAssetImageDisplayUrl(source)).rejects.toThrow();
    signer.mockResolvedValueOnce(
      "https://storage.googleapis.com/test-bucket/other.png"
    );
    await expect(renewManhuaAssetImageDisplayUrl(source)).rejects.toThrow();
    signer.mockResolvedValueOnce(renewed);
    expect(await renewManhuaAssetImageDisplayUrl(source)).toBe(renewed);
    expect(signer).toHaveBeenCalledTimes(4);
  });

  function setupRenew(blob: Blob | null) {
    const display = vi.fn();
    const finalError = vi.fn();
    const readBlob = vi.fn(async () => blob);
    const renewUrl = vi.fn(async () => renewed);
    const revokeUrl = vi.fn();
    const controller = createManhuaAssetImageFallback({
      source,
      readBlob,
      renewUrl,
      display,
      finalError,
      createUrl: () => "blob:local",
      revokeUrl,
    });
    return { controller, display, finalError, readBlob, renewUrl, revokeUrl };
  }

  it("无缓存续签一次，续签地址仍坏时最终错误只通知一次", async () => {
    const f = setupRenew(null);
    await f.controller.fail("original");
    expect(f.display).toHaveBeenCalledWith(renewed);
    expect(f.renewUrl).toHaveBeenCalledTimes(1);
    expect(f.finalError).not.toHaveBeenCalled();
    await f.controller.fail("renewed-broken");
    await f.controller.fail("duplicate");
    expect(f.finalError).toHaveBeenCalledTimes(1);
    expect(f.finalError).toHaveBeenCalledWith("renewed-broken");
    expect(f.renewUrl).toHaveBeenCalledTimes(1);
  });

  it("本机字节优先；只有本机解码失败后续签，不重读缓存", async () => {
    const f = setupRenew(new Blob(["broken"]));
    await f.controller.fail("original");
    expect(f.display).toHaveBeenCalledWith("blob:local");
    expect(f.renewUrl).not.toHaveBeenCalled();
    await f.controller.fail("local-broken");
    expect(f.display).toHaveBeenLastCalledWith(renewed);
    expect(f.readBlob).toHaveBeenCalledTimes(1);
    expect(f.renewUrl).toHaveBeenCalledTimes(1);
    expect(f.revokeUrl).toHaveBeenCalledTimes(1);
    expect(f.revokeUrl).toHaveBeenCalledWith("blob:local");
    expect(f.finalError).not.toHaveBeenCalled();
  });

  it("续签期间重复错误不重签，退役后的迟到结果不显示不误报", async () => {
    const f = setupRenew(null);
    let resolve!: (url: string) => void;
    f.renewUrl.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const pending = f.controller.fail("original");
    await Promise.resolve();
    await f.controller.fail("duplicate");
    expect(f.renewUrl).toHaveBeenCalledTimes(1);
    f.controller.dispose();
    resolve(renewed);
    await pending;
    expect(f.display).not.toHaveBeenCalled();
    expect(f.finalError).not.toHaveBeenCalled();
  });

  it("网络挂起15秒后有界结束，后续可再请求且旧返回不占槽", async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (url: string) => void;
      signer.mockImplementationOnce(
        () =>
          new Promise(done => {
            resolve = done;
          })
      );
      const pending = renewManhuaAssetImageDisplayUrl(source);
      const rejected = expect(pending).rejects.toThrow("图片地址刷新超时");
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      signer.mockResolvedValueOnce(renewed);
      expect(await renewManhuaAssetImageDisplayUrl(source)).toBe(renewed);
      resolve(renewed);
      await Promise.resolve();
      expect(signer).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("本机存储读取异常仍可续签，续签拒绝只通知一次", async () => {
    const f = setupRenew(null);
    f.readBlob.mockRejectedValueOnce(new Error("IDB denied"));
    f.renewUrl.mockRejectedValueOnce(new Error("sign denied"));
    await f.controller.fail("original");
    await f.controller.fail("duplicate");
    expect(f.renewUrl).toHaveBeenCalledTimes(1);
    expect(f.finalError).toHaveBeenCalledTimes(1);
    expect(f.finalError).toHaveBeenCalledWith("original");
    expect(f.display).not.toHaveBeenCalled();
  });
});
