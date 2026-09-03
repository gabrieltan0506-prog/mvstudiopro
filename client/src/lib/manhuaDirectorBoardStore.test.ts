import { describe, expect, it } from "vitest";
import { MANHUA_BOARD_MOTION_OVERLAY_FORMAT } from "@shared/manhuaDirectorBoardOverlay";
import { normalizeDirectorBoardOverlayBySegment } from "./manhuaDirectorBoardStore";

function overlay(ep = 1, seg = 1) {
  return {
    format: MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
    episodeIndex: ep,
    segmentIndex: seg,
    shotIndex: 1,
    imageSpace: "normalized",
    sourceRevision: "rev-1",
    baseAspectRatio: "16:9",
    actorRoutes: [],
    cameraPath: null,
    axis: { subjectAnchors: [{ entityId: "甲", at: { x: 0.4, y: 0.6 } }] },
    landingPoints: [],
    userAdjusted: false,
    needsReview: true,
  };
}

describe("manhuaDirectorBoardStore overlay", () => {
  it("按集与段恢复合法矢量层", () => {
    expect(normalizeDirectorBoardOverlayBySegment({ 1: { 2: overlay(1, 2) } })[1]?.[2]).toMatchObject({
      episodeIndex: 1,
      segmentIndex: 2,
      needsReview: true,
    });
  });

  it("拒绝键位与合同身份不一致的幽灵轨迹", () => {
    expect(normalizeDirectorBoardOverlayBySegment({ 1: { 2: overlay(9, 9) } })).toEqual({});
  });

  it("旧稿缺字段保持惰性", () => {
    expect(normalizeDirectorBoardOverlayBySegment(null)).toEqual({});
    expect(normalizeDirectorBoardOverlayBySegment({ 1: { 1: { format: "old" } } })).toEqual({});
  });
});
