import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ManhuaDirectorBoardOverlay,
  countVisibleManhuaOverlayLayers,
  nudgeManhuaOverlayPoint,
  updateManhuaOverlayPoint,
} from "../components/ManhuaDirectorBoardOverlay.js";
import {
  MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
  type ManhuaBoardMotionOverlayV1,
} from "../../../shared/manhuaDirectorBoardOverlay.js";

function sampleOverlay(
  patch: Partial<ManhuaBoardMotionOverlayV1> = {}
): ManhuaBoardMotionOverlayV1 {
  return {
    format: MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
    episodeIndex: 1,
    segmentIndex: 2,
    shotIndex: 4,
    imageSpace: "normalized",
    sourceRevision: "shot-04-v1",
    baseAspectRatio: "16:9",
    actorRoutes: [
      {
        routeId: "route-character-a",
        entityId: "character-a",
        entityKind: "character",
        points: [
          { x: 0.12, y: 0.7 },
          { x: 0.46, y: 0.44 },
          { x: 0.78, y: 0.66 },
        ],
        actionPhase: "contact",
        source: "structured",
        confidence: 0.92,
      },
    ],
    cameraPath: {
      move: "push",
      points: [
        { x: 0.1, y: 0.14 },
        { x: 0.5, y: 0.3 },
        { x: 0.82, y: 0.2 },
      ],
      source: "structured",
      confidence: 0.88,
    },
    axis: {
      entrance: { x: 0.04, y: 0.55 },
      exit: { x: 0.95, y: 0.55 },
      subjectAnchors: [{ entityId: "character-a", at: { x: 0.46, y: 0.55 } }],
      screenDirection: "left_to_right",
    },
    landingPoints: [
      {
        landingId: "landing-contact",
        kind: "contact",
        at: { x: 0.78, y: 0.66 },
        entityIds: ["character-a", "prop-a"],
      },
    ],
    userAdjusted: false,
    needsReview: false,
    ...patch,
  };
}

describe("ManhuaDirectorBoardOverlay UI", () => {
  it("renders the fixed route semantics and exposes only route endpoints as drag handles", () => {
    const html = renderToStaticMarkup(
      createElement(ManhuaDirectorBoardOverlay, {
        overlay: sampleOverlay(),
        onChange: () => undefined,
      })
    );

    expect(html).toContain('data-layer="actor-route"');
    expect(html).toContain('data-layer="camera-path"');
    expect(html).toContain('data-layer="spatial-axis"');
    expect(html).toContain('data-landing-point="contact"');
    expect(html).toContain("人物／道具");
    expect(html).toContain("摄影机");
    expect(html).toContain("空间轴线");
    expect(html).toContain("自动标注");
    expect(html.match(/data-drag-handle="endpoint"/g)).toHaveLength(4);
    expect(html.match(/role="button"/g)).toHaveLength(4);
    expect(html.match(/tabindex="0"/g)).toHaveLength(4);
    expect(html).toContain("data-route-waypoint");
    expect(html).not.toContain("画笔");
    expect(html).not.toContain("颜色盘");
    expect(html).not.toContain("线宽");
  });

  it("keeps a null overlay inert and hides disabled layers without inventing marks", () => {
    expect(
      renderToStaticMarkup(
        createElement(ManhuaDirectorBoardOverlay, { overlay: null })
      )
    ).toBe("");

    const html = renderToStaticMarkup(
      createElement(ManhuaDirectorBoardOverlay, {
        overlay: sampleOverlay(),
        layers: { actorRoutes: false, cameraPath: false, spatialAxis: true },
      })
    );
    expect(html).not.toContain('data-layer="actor-route"');
    expect(html).not.toContain('data-layer="camera-path"');
    expect(html).toContain('data-layer="spatial-axis"');
  });

  it("renders a fixed-camera status instead of a false camera route", () => {
    const html = renderToStaticMarkup(
      createElement(ManhuaDirectorBoardOverlay, {
        overlay: sampleOverlay({
          cameraPath: {
            move: "fixed",
            points: [
              { x: 0.5, y: 0.5 },
              { x: 0.5, y: 0.5 },
            ],
            source: "structured",
            confidence: 1,
          },
          needsReview: true,
        }),
      })
    );
    expect(html).toContain("固定机位");
    expect(html).toContain("待确认");
    expect(html).not.toContain('data-layer="camera-path"');
  });

  it("makes endpoints inert in read-only previews", () => {
    const html = renderToStaticMarkup(
      createElement(ManhuaDirectorBoardOverlay, {
        overlay: sampleOverlay({ userAdjusted: true }),
        onChange: () => undefined,
        readOnly: true,
      })
    );
    expect(html).toContain("已调整");
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex="0"');
  });

  it("nudges with keyboard-sized steps and clamps coordinates to the canvas", () => {
    expect(nudgeManhuaOverlayPoint({ x: 0.5, y: 0.5 }, "ArrowRight")).toEqual({
      x: 0.51,
      y: 0.5,
    });
    expect(
      nudgeManhuaOverlayPoint({ x: 0.98, y: 0.02 }, "ArrowRight", true)
    ).toEqual({
      x: 1,
      y: 0.02,
    });
    expect(
      nudgeManhuaOverlayPoint({ x: 0.98, y: 0.02 }, "ArrowUp", true)
    ).toEqual({
      x: 0.98,
      y: 0,
    });
  });

  it("updates only the requested endpoint and marks that route as user adjusted", () => {
    const overlay = sampleOverlay();
    const next = updateManhuaOverlayPoint(
      overlay,
      { kind: "actor_route", routeId: "route-character-a", pointIndex: 2 },
      { x: 1.2, y: -0.4 }
    );

    expect(next).not.toBe(overlay);
    expect(next.userAdjusted).toBe(true);
    expect(next.actorRoutes[0].source).toBe("user_adjusted");
    expect(next.actorRoutes[0].confidence).toBe(1);
    expect(next.actorRoutes[0].points).toEqual([
      { x: 0.12, y: 0.7 },
      { x: 0.46, y: 0.44 },
      { x: 1, y: 0 },
    ]);
    expect(next.cameraPath).toEqual(overlay.cameraPath);
  });

  it("counts only the visible semantic layers", () => {
    expect(
      countVisibleManhuaOverlayLayers(sampleOverlay(), {
        actorRoutes: true,
        cameraPath: false,
        spatialAxis: true,
      })
    ).toEqual({
      actorRoutes: 1,
      cameraPaths: 0,
      axisMarks: 3,
      landingPoints: 1,
    });
  });
});
