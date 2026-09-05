import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadFileToSignedUrl } from "./omniCanvasApi";

class UploadRequest {
  static last: UploadRequest;
  status = 200;
  responseText = "";
  onload?: () => void;
  onerror?: () => void;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn(() => this.onload?.());
  constructor() {
    UploadRequest.last = this;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("GCS 直传 MIME 与签名一致", () => {
  it.each(["", "application/octet-stream", "model/gltf-binary"])(
    "GLB 浏览器类型为 %s 时 PUT 仍使用签名类型",
    async (browserMime) => {
      vi.stubGlobal("XMLHttpRequest", UploadRequest);
      const file = new File([new Uint8Array(12)], "horse.glb", { type: browserMime });
      await uploadFileToSignedUrl({
        file,
        uploadUrl: "https://example.test/upload",
        contentType: "model/gltf-binary",
      });
      expect(UploadRequest.last.open).toHaveBeenCalledWith(
        "PUT",
        "https://example.test/upload",
        true,
      );
      expect(UploadRequest.last.setRequestHeader.mock.calls).toEqual([
        ["Content-Type", "model/gltf-binary"],
      ]);
      expect(UploadRequest.last.send).toHaveBeenCalledWith(file);
    },
  );

  it("签名头覆盖默认值且 Content-Type 不重复追加，保留计费项目头", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    await uploadFileToSignedUrl({
      file: new File(["test"], "image.png", { type: "image/png" }),
      uploadUrl: "https://example.test/upload",
      headers: { "content-type": "model/gltf-binary", "x-goog-user-project": "test-project" },
    });
    expect(UploadRequest.last.setRequestHeader.mock.calls).toEqual([
      ["Content-Type", "model/gltf-binary"],
      ["x-goog-user-project", "test-project"],
    ]);
  });

  it.each(["image/png", ""])("未指定 MIME 的既有调用保持默认：%s", async (mime) => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    await uploadFileToSignedUrl({
      file: new File(["test"], "asset", { type: mime }),
      uploadUrl: "https://example.test/upload",
    });
    expect(UploadRequest.last.setRequestHeader).toHaveBeenCalledWith(
      "Content-Type",
      mime || "application/octet-stream",
    );
  });
});
