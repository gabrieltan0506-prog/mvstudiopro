import { describe, expect, it, vi } from "vitest";
import {
  collectPendingClipAutoDownloads,
  markClipAutoDownloaded,
  readClipAutoDownloadLedger,
  runPendingClipAutoDownloads,
} from "./manhuaClipAutoDownload";
import type { CanvasBlock } from "@/lib/canvasTypes";

function clip(id: string, url?: string, status: CanvasBlock["status"] = "done"): CanvasBlock {
  return {
    id,
    kind: "video",
    x: 0,
    y: 0,
    width: 160,
    height: 200,
    prompt: "成片",
    textModel: "gpt-5.6-terra",
    imageModel: "gpt-image-2",
    videoModel: "seedance-2.0-fast",
    aspectRatio: "9:16",
    imageMode: "generate",
    imageBatchCount: 1,
    uploadedAssets: [],
    outputUrls: url ? [url] : [],
    outputUrl: url,
    status,
    episodeIndex: 1,
  };
}

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("manhuaClipAutoDownload", () => {
  it("collects newly ready clip https URLs only", () => {
    const storage = memoryStorage();
    const prev = [clip("clip-e01-g01", undefined, "running")];
    const next = [clip("clip-e01-g01", "https://cdn.example/a.mp4?X-Goog-Signature=1")];
    const pending = collectPendingClipAutoDownloads({
      prev,
      next,
      seriesTitle: "山河",
      storage,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.fileNameBase).toContain("第01集");
    expect(pending[0]?.fileNameBase).toContain("第01段");
  });

  it("skips same URL already on previous frame (refresh)", () => {
    const storage = memoryStorage();
    const url = "https://cdn.example/a.mp4";
    const blocks = [clip("clip-e01-g01", url)];
    expect(
      collectPendingClipAutoDownloads({ prev: blocks, next: blocks, storage }),
    ).toHaveLength(0);
  });

  it("skips when ledger already recorded path", () => {
    const storage = memoryStorage();
    const url = "https://cdn.example/a.mp4?sig=old";
    markClipAutoDownloaded(url, "clip-e01-g01", storage);
    const prev = [clip("clip-e01-g01", undefined, "running")];
    const next = [clip("clip-e01-g01", "https://cdn.example/a.mp4?sig=new")];
    expect(
      collectPendingClipAutoDownloads({ prev, next, storage }),
    ).toHaveLength(0);
    expect(readClipAutoDownloadLedger(storage)["https://cdn.example/a.mp4"]).toBeTruthy();
  });

  it("runPendingClipAutoDownloads marks ledger and staggers", async () => {
    const storage = memoryStorage();
    const download = vi.fn(async () => ({ ok: true, via: "blob" as const }));
    const sleep = vi.fn(async () => undefined);
    const pending = collectPendingClipAutoDownloads({
      prev: [clip("clip-e01-g01", undefined, "running"), clip("clip-e01-g02", undefined, "running")],
      next: [
        clip("clip-e01-g01", "https://cdn.example/1.mp4"),
        clip("clip-e01-g02", "https://cdn.example/2.mp4"),
      ],
      storage,
    });
    const r = await runPendingClipAutoDownloads(pending, { storage, download, sleep, delayMs: 10 });
    expect(r.attempted).toBe(2);
    expect(r.ok).toBe(2);
    expect(download).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
