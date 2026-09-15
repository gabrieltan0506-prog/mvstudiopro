import { describe, expect, it } from "vitest";
import type { ManhuaBoardMotionOverlay } from "@shared/manhuaDirectorBoardOverlay";
import {
  buildManhuaActionPlanBindingContext,
  camerasFromOverlays,
  camerasFromPrevis,
  camerasFromShotIr,
  landingsFromOverlays,
} from "./manhuaActionPlanAdapter";

const overlay = (over: Partial<ManhuaBoardMotionOverlay> = {}): ManhuaBoardMotionOverlay =>
  ({
    format: "manhua_board_motion_overlay_v1",
    episodeIndex: 1,
    segmentIndex: 2,
    shotIndex: 3,
    imageSpace: "normalized",
    sourceRevision: "rev-a",
    baseAspectRatio: "16:9",
    actorRoutes: [],
    cameraPath: null,
    axis: null,
    landingPoints: [
      { landingId: "land-deck-1", kind: "land", at: { x: 0.4, y: 0.7 }, entityIds: ["actor-ambusher-1"] },
    ],
    userAdjusted: false,
    needsReview: false,
    ...over,
  }) as ManhuaBoardMotionOverlay;

describe("manhuaActionPlanAdapter · 落点", () => {
  it("导演板落点只给 screen 点，不冒充 world；boundActorId 取第一实体", () => {
    const [l] = landingsFromOverlays([overlay()]);
    expect(l.point).toEqual({ space: "screen", x: 0.4, y: 0.7 });
    expect(l.boundActorId).toBe("actor-ambusher-1");
    expect(l.sourceRevision).toBe("rev-a");
    expect(l.surfaceRef).toBeUndefined();
  });

  it("surfaceRef 只来自传入表面实体且唯一匹配；两个表面都声称覆盖 → 不填", () => {
    const one = landingsFromOverlays([overlay()], [
      { surfaceRef: "surf-deck-01", nameZh: "船头甲板", episodeIndex: 1, landingIds: ["land-deck-1"] },
    ]);
    expect(one[0].surfaceRef).toBe("surf-deck-01");
    expect(one[0].surfaceZh).toBe("船头甲板");
    const two = landingsFromOverlays([overlay()], [
      { surfaceRef: "surf-deck-01", nameZh: "船头甲板", episodeIndex: 1 },
      { surfaceRef: "surf-deck-02", nameZh: "船尾甲板", episodeIndex: 1 },
    ]);
    expect(two[0].surfaceRef).toBeUndefined();
    const otherEp = landingsFromOverlays([overlay()], [
      { surfaceRef: "surf-x", nameZh: "别集", episodeIndex: 9 },
    ]);
    expect(otherEp[0].surfaceRef).toBeUndefined();
  });
});

describe("manhuaActionPlanAdapter · 相机", () => {
  it("overlay 相机路径无秒数 → timedSamplesAvailable=false 且不带 coverage/sampling", () => {
    const cams = camerasFromOverlays([
      overlay({ cameraPath: { move: "push_in", points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }], source: "ai", confidence: 0.6 } as never }),
      overlay({ shotIndex: 4, cameraPath: null }),
    ]);
    expect(cams).toHaveLength(1);
    expect(cams[0]).toMatchObject({ source: "overlay_camera_path", sourceShotRef: "e1-s2-t3", timedSamplesAvailable: false });
    expect(cams[0].coverage).toBeUndefined();
    expect(cams[0].sampling).toBeUndefined();
  });

  it("previs 相机：覆盖成对、source 基准、discrete 24fps、截到 durationSec", () => {
    const [c] = camerasFromPrevis([
      { sourceShotRef: "previs-9", sourceRevision: "pv-1", durationSec: 6, cameras: [{ startSec: 0, endSec: 3 }, { startSec: 3, endSec: 8 }] },
    ]);
    expect(c).toMatchObject({
      source: "previs_cameras",
      coverage: { startSec: 0, endSec: 6 },
      coverageBasis: "source",
      sampling: { kind: "discrete", fps: 24 },
      timedSamplesAvailable: true,
    });
    const [empty] = camerasFromPrevis([{ sourceShotRef: "p", sourceRevision: "r", durationSec: 5, cameras: [] }]);
    expect(empty.timedSamplesAvailable).toBe(false);
  });

  it("ShotIR 相机只是文字：按呈现时长登记覆盖，不假称采样", () => {
    const cams = camerasFromShotIr([
      {
        episodeIndex: 1, segmentIndex: 2, sourceRevision: "ir-1",
        shots: [
          { index: 1, durationSec: 4, sceneZh: "", actionZh: "", cameraZh: "推" },
          { index: 2, durationSec: 5, sceneZh: "", actionZh: "" },
        ],
      },
    ]);
    expect(cams.map((c) => c.coverage)).toEqual([{ startSec: 0, endSec: 4 }, { startSec: 4, endSec: 9 }]);
    expect(cams.every((c) => c.coverageBasis === "presentation" && c.timedSamplesAvailable === false && !c.sampling)).toBe(true);
    expect(cams[1].sourceShotRef).toBe("e1-s2-t2");
  });
});

describe("buildManhuaActionPlanBindingContext", () => {
  it("产出过合同 schema；三种相机来源合并", () => {
    const ctx = buildManhuaActionPlanBindingContext({
      overlays: [overlay({ cameraPath: { move: "pan", points: [{ x: 0, y: 0 }], source: "user", confidence: 1 } as never })],
      previs: [{ sourceShotRef: "pv", sourceRevision: "r", durationSec: 3, cameras: [{ startSec: 0, endSec: 3 }] }],
      shotIr: [{ episodeIndex: 1, segmentIndex: 2, sourceRevision: "ir", shots: [{ index: 3, durationSec: 3, sceneZh: "", actionZh: "" }] }],
    });
    expect(ctx.landings).toHaveLength(1);
    expect(ctx.cameras.map((c) => c.source)).toEqual(["overlay_camera_path", "previs_cameras", "shot_ir"]);
    expect(buildManhuaActionPlanBindingContext({})).toEqual({ landings: [], cameras: [] });
  });
});
