import { describe, expect, it, vi } from "vitest";
import {
  CANVAS_UPLOAD_CONCURRENCY,
  mapWithConcurrency,
  uploadCanvasFilesParallel,
} from "@/lib/canvasUpload";

vi.mock("@/lib/omniCanvasApi", () => ({
  uploadFileToSignedUrl: vi.fn(async () => undefined),
  resolveOmniMaterialUrl: vi.fn(async (gcsUri: string) => `https://signed.example/${encodeURIComponent(gcsUri)}`),
}));

describe("canvasUpload", () => {
  it("CANVAS_UPLOAD_CONCURRENCY 为 10", () => {
    expect(CANVAS_UPLOAD_CONCURRENCY).toBe(10);
  });

  it("mapWithConcurrency 同时活跃任务不超过并发上限", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);

    const results = await mapWithConcurrency(items, 10, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      return n + 1;
    });

    expect(results).toHaveLength(30);
    expect(results[0]).toBe(1);
    expect(results[29]).toBe(30);
    expect(maxActive).toBeLessThanOrEqual(10);
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it("uploadCanvasFilesParallel 10 路并行上传并汇总结果", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let signedCalls = 0;

    const files = Array.from({ length: 12 }, (_, i) => {
      const blob = new Blob(["fake"], { type: "image/png" });
      return new File([blob], `shot-${i + 1}.png`, { type: "image/png" });
    });

    const { assets, failed } = await uploadCanvasFilesParallel({
      files,
      concurrency: CANVAS_UPLOAD_CONCURRENCY,
      getSignedUploadUrl: async ({ fileName }) => {
        signedCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return {
          uploadUrl: `https://upload.example/${fileName}`,
          gcsUri: `gs://bucket/canvas/${fileName}`,
        };
      },
    });

    expect(failed).toHaveLength(0);
    expect(assets).toHaveLength(12);
    expect(signedCalls).toBe(12);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(assets[0]?.gcsUri).toContain("gs://bucket/canvas/shot-1.png");
    expect(assets[0]?.url).toContain("https://signed.example/");
  });

  it("uploadCanvasFilesParallel 部分失败时保留成功项", async () => {
    const files = [
      new File([new Blob(["a"])], "ok.png", { type: "image/png" }),
      new File([new Blob(["b"])], "bad.png", { type: "image/png" }),
    ];

    const { assets, failed } = await uploadCanvasFilesParallel({
      files,
      concurrency: 10,
      getSignedUploadUrl: async ({ fileName }) => {
        if (fileName === "bad.png") throw new Error("签名失败");
        return { uploadUrl: "https://upload.example/ok", gcsUri: "gs://bucket/ok.png" };
      },
    });

    expect(assets).toHaveLength(1);
    expect(assets[0]?.fileName).toBe("ok.png");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.fileName).toBe("bad.png");
  });
});
