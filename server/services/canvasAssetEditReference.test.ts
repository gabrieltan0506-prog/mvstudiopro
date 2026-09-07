import { describe, expect, it, vi } from "vitest";
import { refreshCanvasAssetEditReference } from "./canvasAssetEditReference";

describe("资产编辑队列执行前续签", () => {
  const source =
    "https://storage.googleapis.com/test-bucket/uploads/u1/source.jpg?X-Goog-Signature=test-expired";
  function dependencies() {
    return {
      bucket: () => "test-bucket",
      resolve: vi.fn(async () => "gs://test-bucket/uploads/u1/source.jpg"),
      sign: vi.fn(() => "https://fresh.example/source.jpg"),
    };
  }
  it("队列等候后先按任务用户验归属，再签7天链接", async () => {
    const deps = dependencies();
    expect(await refreshCanvasAssetEditReference(source, "1", deps)).toBe(
      "https://fresh.example/source.jpg"
    );
    expect(deps.resolve).toHaveBeenCalledWith({ userId: "1", source });
    expect(deps.sign).toHaveBeenCalledWith(
      "gs://test-bucket/uploads/u1/source.jpg",
      604800
    );
  });
  it("他人资产或存储故障明确失败，不签名、不回退旧地址", async () => {
    const deps = dependencies();
    deps.resolve.mockRejectedValue(new Error("素材尚未登记"));
    await expect(
      refreshCanvasAssetEditReference(source, "2", deps)
    ).rejects.toThrow("素材尚未登记");
    expect(deps.sign).not.toHaveBeenCalled();
  });
  it("外部公共参考保持原样，拒绝非HTTPS", async () => {
    const deps = dependencies();
    expect(
      await refreshCanvasAssetEditReference(
        "https://public.example/ref.jpg",
        "1",
        deps
      )
    ).toBe("https://public.example/ref.jpg");
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.sign).not.toHaveBeenCalled();
    await expect(
      refreshCanvasAssetEditReference("file:///secret", "1", deps)
    ).rejects.toThrow("参考图地址无效");
  });
});
