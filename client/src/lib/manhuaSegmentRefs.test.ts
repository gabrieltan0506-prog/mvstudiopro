import { describe, expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { manhuaClipQualityAllowsAssemble } from "@shared/manhuaClipQuality";
import { manhuaSegmentReferenceKindError, registerManhuaExistingClip } from "./manhuaSegmentRefs";

describe("registerManhuaExistingClip · 外部成片登记为本段版本", () => {
  const entry = { url: "https://x.test/mojing-c.mp4?sig=1", gcsUri: "gs://b/uploads/u1/mojing-c.mp4", fileName: "成片2.mp4", updatedAt: "2026-09-09T01:00:00Z" };
  it("旧成片进历史、状态 done、质检 unverified 默认不进坞，在途任务与尾帧清掉", () => {
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g03",
      status: "error" as const,
      error: "上次超时",
      outputUrl: "https://x.test/old.mp4",
      outputUrls: ["https://x.test/old.mp4", "https://x.test/older.mp4"],
      lastFrameUrl: "https://x.test/old-tail.png",
      videoTaskId: "cv_old",
      videoTaskEngine: "wan-3.0",
      videoTaskStatus: "running" as const,
      manhuaRetake: { variable: "camera" as const, attempt: 2, maxAttempts: 3 },
    };
    const out = registerManhuaExistingClip(block, entry);
    expect(out).toMatchObject({
      status: "done",
      error: undefined,
      outputUrl: entry.url,
      outputUrls: [entry.url, "https://x.test/old.mp4", "https://x.test/older.mp4"],
      lastFrameUrl: undefined,
      videoTaskId: undefined,
      videoTaskEngine: undefined,
      videoTaskStatus: undefined,
      manhuaRetake: undefined,
      manhuaSegmentRefs: { registered: entry },
    });
    expect(out.manhuaClipQuality).toMatchObject({ status: "unverified", failedKeys: [], userAcceptedDespiteQc: false, attempts: 0 });
    expect(manhuaClipQualityAllowsAssemble({ outputUrl: out.outputUrl, quality: out.manhuaClipQuality })).toBe(false);
    expect(
      manhuaClipQualityAllowsAssemble({
        outputUrl: out.outputUrl,
        quality: { ...out.manhuaClipQuality!, userAcceptedDespiteQc: true },
      }),
    ).toBe(true);
  });
  it("不是 https 的登记链直接拒绝", () => {
    expect(() => registerManhuaExistingClip(defaultCanvasBlock("video", 0, 0), { ...entry, url: "gs://b/x.mp4" })).toThrow(/https/);
  });
  it("槽位与文件种类对不上给中文原因", () => {
    expect(manhuaSegmentReferenceKindError("previs", "video")).toBeNull();
    expect(manhuaSegmentReferenceKindError("master", "audio")).toBeNull();
    expect(manhuaSegmentReferenceKindError("previs", "audio")).toMatch(/白模站位只收视频/);
    expect(manhuaSegmentReferenceKindError("master", "image")).toMatch(/预混母轨只收音频/);
    expect(manhuaSegmentReferenceKindError("registered", null)).toMatch(/已有成片只收视频/);
  });
});
