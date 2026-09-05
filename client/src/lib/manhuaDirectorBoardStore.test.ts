import { describe, expect, it } from "vitest";
import { MANHUA_BOARD_MOTION_OVERLAY_FORMAT } from "@shared/manhuaDirectorBoardOverlay";
import {
  buildManhuaDirectorBoardBackupState,
  hasManhuaDirectorBoardBackupContent,
  markManhuaDirectorBoardOverlaysForReview,
  normalizeDirectorBoardOverlayBySegment,
  parseManhuaDirectorBoardBackupState,
  validateManhuaDirectorBoardBackupState,
} from "./manhuaDirectorBoardStore";

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

  it("同剧改稿保留手调坐标但强制重新复核", () => {
    const original = {
      ...overlay(1, 2),
      userAdjusted: true,
      needsReview: false,
      actorRoutes: [
        {
          routeId: "actor-1",
          entityId: "甲",
          entityKind: "character" as const,
          points: [
            { x: 0.2, y: 0.5 },
            { x: 0.8, y: 0.5 },
          ],
          actionPhase: "path" as const,
          source: "user_adjusted" as const,
          confidence: 1,
        },
      ],
    };
    const next = markManhuaDirectorBoardOverlaysForReview({ 1: { 2: original } });

    expect(next[1]?.[2]).toMatchObject({
      episodeIndex: 1,
      segmentIndex: 2,
      userAdjusted: true,
      needsReview: true,
      actorRoutes: original.actorRoutes,
    });
    expect(original.needsReview).toBe(false);
  });

  it("换剧备份三张导演板表可严格回填，旧包缺状态仍兼容", () => {
    const state = buildManhuaDirectorBoardBackupState({
      mainByEpisode: { 1: { gcsUri: "gs://bucket/main.png" } },
      bySegment: { 1: { 2: { gcsUri: "gs://bucket/seg-2.png" } } },
      motionOverlayBySegment: { 1: { 2: overlay(1, 2) } },
    });
    const restored = parseManhuaDirectorBoardBackupState(
      JSON.parse(JSON.stringify(state)),
    );

    expect(hasManhuaDirectorBoardBackupContent(restored)).toBe(true);
    expect(restored).toMatchObject({
      mainByEpisode: { 1: { gcsUri: "gs://bucket/main.png" } },
      bySegment: { 1: { 2: { gcsUri: "gs://bucket/seg-2.png" } } },
      motionOverlayBySegment: { 1: { 2: { episodeIndex: 1, segmentIndex: 2 } } },
    });
    expect(parseManhuaDirectorBoardBackupState({})).toBeNull();
  });

  it("有状态文件时拒绝未知版本与会被 normalizer 静默裁掉的坏 map", () => {
    expect(
      validateManhuaDirectorBoardBackupState({
        format: "unknown",
        mainByEpisode: {},
        bySegment: {},
        motionOverlayBySegment: {},
      }),
    ).toEqual({ ok: false, errorZh: "format 版本未知" });
    expect(
      validateManhuaDirectorBoardBackupState({
        format: "mv-manhua-director-board-backup-v1",
        mainByEpisode: { 1: { gcsUri: "not-gcs", url: "javascript:bad" } },
        bySegment: {},
        motionOverlayBySegment: {},
      }),
    ).toEqual({
      ok: false,
      errorZh: "mainByEpisode 含无效、缺失或会被截断的条目",
    });
  });
});
