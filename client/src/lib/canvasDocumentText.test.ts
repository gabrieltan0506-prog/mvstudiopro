import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCanvasDocumentTexts } from "./canvasDocumentText";
import type { CanvasUploadedAsset } from "./canvasTypes";

describe("loadCanvasDocumentTexts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads txt body for copy organize", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "part1\n重复句\npart2\n重复句\n新内容",
      })),
    );

    const assets: CanvasUploadedAsset[] = [
      {
        id: "1",
        url: "https://cdn.example.com/day3.txt",
        previewUrl: "https://cdn.example.com/day3.txt",
        fileName: "day3.txt",
        kind: "document",
        mimeType: "text/plain",
      },
    ];

    const texts = await loadCanvasDocumentTexts(assets);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("【文档 day3.txt】");
    expect(texts[0]).toContain("part1");
  });

  it("rejects pdf with actionable message", async () => {
    await expect(
      loadCanvasDocumentTexts([
        {
          id: "1",
          url: "https://cdn.example.com/a.pdf",
          previewUrl: "https://cdn.example.com/a.pdf",
          fileName: "a.pdf",
          kind: "document",
          mimeType: "application/pdf",
        },
      ]),
    ).rejects.toThrow(/TXT\/MD/);
  });
});
