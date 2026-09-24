import { describe, expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { manhuaClipQualityAllowsAssemble } from "@shared/manhuaClipQuality";
import { createManhuaRegisteredSegmentClip, manhuaSegmentReferenceKindError, registerManhuaExistingClip } from "./manhuaSegmentRefs";
import { buildManhuaAutoSegmentBinding } from "@shared/manhuaAutoSegment";

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
    // 登记链同步进上传记录（带 gcsUri），统一重签才盖得到
    expect(out.uploadedAssets?.some((a) => a.url === entry.url && a.gcsUri === entry.gcsUri && a.kind === "video")).toBe(true);
    const again = registerManhuaExistingClip(out, { ...entry, url: "https://x.test/mojing-c.mp4?sig=2" });
    expect(again.uploadedAssets?.filter((a) => a.gcsUri === entry.gcsUri)).toHaveLength(1);
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
  it("无静帧节点时，已有视频仍按当前原稿第2段绑定，保持未质检不可合成", () => {
    const segment = {
      index: 2,
      durationSec: 30,
      sourceStartSec: 29,
      sourceEndSec: 59,
      shots: Array.from({ length: 6 }, (_, i) => ({
        index: i + 7,
        durationSec: 5,
        cameraZh: `镜位${i + 7}`,
        actionZh: `动作${i + 7}`,
      })),
    };
    const story = { ...defaultCanvasBlock("text", 100, 60), id: "story-e01-a" };
    const out = createManhuaRegisteredSegmentClip({
      episodeIndex: 1,
      episodeTitle: "坊市一掌",
      segment,
      videoModel: "seedance-2.5",
      parent: story,
      entry: { ...entry, durationSec: 29.95 },
    });
    expect(out.id).toMatch(/^clip-e01-g02-registered-/);
    expect(out.parentId).toBe(story.id);
    expect(out.manhuaAutoSegment).toEqual(buildManhuaAutoSegmentBinding(1, segment, "seedance-2.5"));
    expect(out.manhuaEditTrim).toMatchObject({ sourceDurationSec: 29.95, inSec: 0, outSec: 29.95 });
    expect(out.outputUrl).toBe(entry.url);
    expect(manhuaClipQualityAllowsAssemble({ outputUrl: out.outputUrl, quality: out.manhuaClipQuality })).toBe(false);
    expect(() => createManhuaRegisteredSegmentClip({
      episodeIndex: 1,
      segment,
      videoModel: "seedance-2.5",
      entry,
    })).toThrow(/视频时长/);
  });
});
