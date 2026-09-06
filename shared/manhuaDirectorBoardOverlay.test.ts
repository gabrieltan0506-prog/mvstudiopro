import { describe, expect, it } from "vitest";
import {
  MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
  MANHUA_BOARD_MOTION_OVERLAY_VISUAL,
  adjustManhuaBoardOverlayPoint,
  confirmManhuaBoardOverlayReview,
  formatManhuaBoardMotionOverlayPromptZh,
  parseManhuaBoardMotionOverlay,
  rebindManhuaBoardOverlayBase,
  type ManhuaBoardMotionOverlay,
  type ManhuaBoardOverlayPointTarget,
} from "./manhuaDirectorBoardOverlay";

function overlay(
  overrides: Partial<ManhuaBoardMotionOverlay> = {}
): ManhuaBoardMotionOverlay {
  return {
    format: MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
    episodeIndex: 1,
    segmentIndex: 2,
    shotIndex: 4,
    imageSpace: "normalized",
    sourceRevision: "source-a",
    baseAspectRatio: "16:9",
    actorRoutes: [
      {
        routeId: "route-1",
        entityId: "沈策",
        entityKind: "character",
        points: [
          { x: 0.1, y: 0.6 },
          { x: 0.8, y: 0.6 },
        ],
        actionPhase: "path",
        source: "structured",
        confidence: 0.9,
      },
    ],
    cameraPath: {
      move: "track",
      points: [
        { x: 0.08, y: 0.5 },
        { x: 0.75, y: 0.5 },
      ],
      source: "structured",
      confidence: 0.88,
    },
    axis: {
      entrance: { x: 0.1, y: 0.6 },
      exit: { x: 0.8, y: 0.6 },
      subjectAnchors: [{ entityId: "沈策", at: { x: 0.1, y: 0.6 } }],
      screenDirection: "left_to_right",
    },
    landingPoints: [
      {
        landingId: "landing-1",
        kind: "contact",
        at: { x: 0.8, y: 0.6 },
        entityIds: ["沈策", "韩廷玉"],
      },
    ],
    userAdjusted: false,
    needsReview: true,
    ...overrides,
  };
}

describe("manhuaDirectorBoardOverlay contract", () => {
  it("锁定人物／道具红实线与摄影机青色虚线语义", () => {
    expect(MANHUA_BOARD_MOTION_OVERLAY_VISUAL.actorRoute).toMatchObject({
      stroke: "#ef4444",
      strokeDasharray: "",
    });
    expect(MANHUA_BOARD_MOTION_OVERLAY_VISUAL.cameraPath).toMatchObject({
      stroke: "#22d3ee",
      strokeDasharray: "8 6",
    });
  });

  it("解析有效 v1 并剥离未知字段，不修改输入", () => {
    const raw = {
      ...overlay(),
      debugProvider: "不应保存",
      actorRoutes: [{ ...overlay().actorRoutes[0]!, extra: "strip-me" }],
    };
    const parsed = parseManhuaBoardMotionOverlay(raw);
    expect(parsed).toEqual(overlay());
    expect(parsed).not.toHaveProperty("debugProvider");
    expect(parsed?.actorRoutes[0]).not.toHaveProperty("extra");
    expect(raw.actorRoutes[0]).toHaveProperty("extra", "strip-me");
  });

  it("旧草稿缺 overlay、未知格式或坏主键都关闭式回落 null", () => {
    expect(parseManhuaBoardMotionOverlay(undefined)).toBeNull();
    expect(
      parseManhuaBoardMotionOverlay({ format: "mv-old-overlay" })
    ).toBeNull();
    expect(
      parseManhuaBoardMotionOverlay({ ...overlay(), episodeIndex: 0 })
    ).toBeNull();
  });

  it("坏子项不会拖垮整板：丢弃越界路线并强制待复核", () => {
    const parsed = parseManhuaBoardMotionOverlay({
      ...overlay({ needsReview: false }),
      actorRoutes: [
        overlay().actorRoutes[0],
        {
          ...overlay().actorRoutes[0],
          routeId: "route-bad",
          points: [
            { x: -0.1, y: 0.5 },
            { x: 0.5, y: 0.5 },
          ],
        },
      ],
    });
    expect(parsed?.actorRoutes.map(route => route.routeId)).toEqual([
      "route-1",
    ]);
    expect(parsed?.needsReview).toBe(true);
  });

  it("只有人工确认后的矢量层才进入成片短指令", () => {
    expect(formatManhuaBoardMotionOverlayPromptZh(overlay())).toBe("");
    expect(formatManhuaBoardMotionOverlayPromptZh(overlay({ needsReview: false }))).toBe(
      "【空间调度】人物沈策自画面左向右；摄影机跟移自画面左向右；方向轴左至右；关键落点=接触",
    );
  });

  it("拖端点会钳制坐标、标记人工来源，且不改原对象", () => {
    const original = overlay();
    const adjusted = adjustManhuaBoardOverlayPoint(
      original,
      { kind: "actor_route", routeId: "route-1", pointIndex: 1 },
      { x: 1.2, y: -0.3 }
    );
    expect(adjusted?.actorRoutes[0]?.points[1]).toEqual({ x: 1, y: 0 });
    expect(adjusted?.actorRoutes[0]?.source).toBe("user_adjusted");
    expect(adjusted?.actorRoutes[0]?.confidence).toBe(1);
    expect(adjusted?.userAdjusted).toBe(true);
    expect(original.actorRoutes[0]?.points[1]).toEqual({ x: 0.8, y: 0.6 });
  });

  it("运行时收到非有限拖动坐标时保持原点位，不把路线吸到原点", () => {
    const original = overlay();
    const adjusted = adjustManhuaBoardOverlayPoint(
      original,
      { kind: "actor_route", routeId: "route-1", pointIndex: 1 },
      { x: Number.NaN, y: 0.4 }
    );
    expect(adjusted).toEqual(original);
  });

  it.each<ManhuaBoardOverlayPointTarget>([
    { kind: "actor_route", routeId: "route-1", pointIndex: 0 },
    { kind: "camera_path", pointIndex: 0 },
    { kind: "axis_entrance" },
    { kind: "axis_exit" },
    { kind: "axis_anchor", entityId: "沈策" },
    { kind: "landing", landingId: "landing-1" },
  ])("已确认的 $kind 点位实际变化后，重新确认之前禁止进入生成指令", target => {
    const original = overlay({ needsReview: false });
    const adjusted = adjustManhuaBoardOverlayPoint(original, target, { x: 0.95, y: 0.9 });
    expect(adjusted?.needsReview).toBe(true);
    expect(adjusted?.userAdjusted).toBe(true);
    expect(formatManhuaBoardMotionOverlayPromptZh(adjusted)).toBe("");
    expect(parseManhuaBoardMotionOverlay(JSON.parse(JSON.stringify(adjusted)))?.needsReview).toBe(true);
    expect(formatManhuaBoardMotionOverlayPromptZh(confirmManhuaBoardOverlayReview(adjusted))).toContain("【空间调度】");
    expect(original.needsReview).toBe(false);
  });

  it("不变、无效目标和非有限坐标不撤销确认；方向变更确认后才进入成片", () => {
    const original = overlay({ needsReview: false });
    const unchangedTargets: Array<[ManhuaBoardOverlayPointTarget, { x: number; y: number }]> = [
      [{ kind: "actor_route", routeId: "route-1", pointIndex: 0 }, { x: 0.1, y: 0.6 }],
      [{ kind: "camera_path", pointIndex: 0 }, { x: 0.08, y: 0.5 }],
      [{ kind: "axis_entrance" }, { x: 0.1, y: 0.6 }],
      [{ kind: "axis_exit" }, { x: 0.8, y: 0.6 }],
      [{ kind: "axis_anchor", entityId: "沈策" }, { x: 0.1, y: 0.6 }],
      [{ kind: "landing", landingId: "landing-1" }, { x: 0.8, y: 0.6 }],
      [{ kind: "actor_route", routeId: "route-1", pointIndex: Number.NaN }, { x: 0.9, y: 0.6 }],
      [{ kind: "camera_path", pointIndex: 0.5 }, { x: 0.9, y: 0.6 }],
      [{ kind: "landing", landingId: "missing" }, { x: 0.9, y: 0.6 }],
      [{ kind: "camera_path", pointIndex: 0 }, { x: Number.NaN, y: 0.6 }],
    ];
    for (const [target, point] of unchangedTargets) {
      expect(adjustManhuaBoardOverlayPoint(original, target, point)).toEqual(original);
    }
    const adjusted = adjustManhuaBoardOverlayPoint(original, { kind: "camera_path", pointIndex: 0 }, { x: 0.95, y: 0.5 });
    expect(formatManhuaBoardMotionOverlayPromptZh(original)).toContain("摄影机跟移自画面左向右");
    expect(formatManhuaBoardMotionOverlayPromptZh(adjusted)).toBe("");
    expect(formatManhuaBoardMotionOverlayPromptZh(confirmManhuaBoardOverlayReview(adjusted))).toContain("摄影机跟移自画面右向左");
  });

  it("复核确认与换底图分工：确认可清标，修订变化只重新挂待复核", () => {
    const confirmed = confirmManhuaBoardOverlayReview(overlay());
    expect(confirmed?.needsReview).toBe(false);
    const same = rebindManhuaBoardOverlayBase(confirmed, {
      sourceRevision: "source-a",
      baseAspectRatio: "16:9",
    });
    expect(same?.needsReview).toBe(false);
    const rebound = rebindManhuaBoardOverlayBase(same, {
      sourceRevision: "source-b",
      baseAspectRatio: "9:16",
    });
    expect(rebound?.needsReview).toBe(true);
    expect(rebound?.actorRoutes).toEqual(overlay().actorRoutes);
  });
});
