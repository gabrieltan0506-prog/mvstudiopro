import { describe, expect, it } from "vitest";
import {
  parseManhuaCloudDraftPayload,
  sanitizeManhuaCloudDraftBlock,
  serializeManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "./manhuaCloudDraft";

/**
 * 复审 P0-1 / P1-3 回归:永久图链与长排队任务字段必须扛过
 * build → serialize → parse 全程,否则云备份/ZIP 悄悄丢生成图、换机丢任务。
 */
describe("manhuaCloudDraft · 稳定图链与任务字段往返", () => {
  const stableUrl = "/api/canvas-media/generated/canvas-gpt-image2/173_ab.png";

  it("sanitize 保留 /api/canvas-media/ 产物与 videoTask 三字段", () => {
    const out = sanitizeManhuaCloudDraftBlock({
      id: "keyart-e01-01",
      kind: "image",
      x: 0, y: 0, width: 420, height: 360,
      prompt: "p",
      outputUrl: stableUrl,
      outputUrls: [stableUrl],
      videoTaskId: "cv_abc",
      videoTaskEngine: "wan-3.0",
      videoTaskStatus: "running",
    });
    expect(out?.outputUrl).toBe(stableUrl);
    expect(out?.outputUrls).toContain(stableUrl);
    expect(out?.videoTaskId).toBe("cv_abc");
    expect(out?.videoTaskEngine).toBe("wan-3.0");
    expect(out?.videoTaskStatus).toBe("running");
  });

  it("serialize → parse 全程往返不丢字段", () => {
    const payload = {
      format: "mv-manhua-cloud-draft-v1",
      clientUpdatedAt: new Date(0).toISOString(),
      writerSession: {} as ManhuaCloudDraftPayload["writerSession"],
      canvas: {
        blocks: [
          sanitizeManhuaCloudDraftBlock({
            id: "clip-e01-s02",
            kind: "video",
            x: 0, y: 0, width: 420, height: 360,
            prompt: "p",
            refImageUrl: stableUrl,
            videoTaskId: "cv_xyz",
            videoTaskEngine: "wan-3.0",
            videoTaskStatus: "running",
          })!,
        ],
        edges: [],
      },
      factoryPrefs: null,
    } as ManhuaCloudDraftPayload;
    const restored = parseManhuaCloudDraftPayload(
      JSON.parse(serializeManhuaCloudDraftPayload(payload)),
    );
    const blk = restored?.canvas.blocks[0];
    expect(blk?.refImageUrl).toBe(stableUrl);
    expect(blk?.videoTaskId).toBe("cv_xyz");
    expect(blk?.videoTaskStatus).toBe("running");
  });
});
