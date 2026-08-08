import { describe, expect, it } from "vitest";
import { CANVAS_VIDEO_MODEL_HAILUO_H3 } from "./hailuoOpenRouterModels.js";
import { CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1 } from "./happyHorseOpenRouterModels.js";
import {
  clampManhuaClipDurationSecForVideoModel,
  hasManhuaSeedanceLayoutChoice,
  MANHUA_SEEDANCE_LAYOUT_CHOICES,
  manhuaClipMaxDurationSecForVideoModel,
  manhuaSeedanceLayoutPinsSegmentTable,
  resolveManhuaFactoryDefaultVideoModel,
  resolveManhuaSeedanceLayoutProfile,
} from "./manhuaSeedanceLayout.js";
import { SEEDANCE_25_LAUNCH_AT_MS } from "./seedance25Access.js";

const BEFORE = SEEDANCE_25_LAUNCH_AT_MS - 60_000;
const AFTER = SEEDANCE_25_LAUNCH_AT_MS + 60_000;

describe("manhuaSeedanceLayout", () => {
  it("exposes five engines with formal product labels", () => {
    const labels = MANHUA_SEEDANCE_LAYOUT_CHOICES.map((c) => c.labelZh);
    expect(labels).toEqual([
      "Seedance 2.0",
      "Seedance 2.0 fast",
      "Seedance 2.5",
      "Minimax H3",
      "Happy Horse 1.1",
    ]);
  });

  it("maps 2.0 / fast / Happy Horse to 5–6×15 and 2.5 to 4×30", () => {
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0-fast")).toMatchObject({
      segmentCount: 6,
      durationSecPerSegment: 15,
      targetSec: 90,
    });
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0")).toMatchObject({
      segmentCount: 6,
      durationSecPerSegment: 15,
    });
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.5")).toMatchObject({
      segmentCount: 4,
      durationSecPerSegment: 30,
      targetSec: 120,
    });
    expect(resolveManhuaSeedanceLayoutProfile(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1)).toMatchObject({
      videoModel: CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1,
      segmentCount: 6,
      durationSecPerSegment: 15,
      targetSec: 90,
      labelZh: "Happy Horse 1.1",
    });
  });

  it("maps Minimax H3 to 7–8×15 · 120s", () => {
    const h3 = resolveManhuaSeedanceLayoutProfile(CANVAS_VIDEO_MODEL_HAILUO_H3);
    expect(h3).toMatchObject({
      videoModel: CANVAS_VIDEO_MODEL_HAILUO_H3,
      segmentCount: 8,
      segmentMin: 7,
      segmentMax: 8,
      durationSecPerSegment: 15,
      targetSec: 120,
      labelZh: "Minimax H3",
    });
    expect(hasManhuaSeedanceLayoutChoice(CANVAS_VIDEO_MODEL_HAILUO_H3)).toBe(true);
  });

  it("pins H3 / Happy Horse / 2.5 away from long lengthTier", () => {
    expect(
      resolveManhuaSeedanceLayoutProfile(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1, "long").segmentCount,
    ).toBe(6);
    expect(resolveManhuaSeedanceLayoutProfile(CANVAS_VIDEO_MODEL_HAILUO_H3, "long").segmentCount).toBe(
      8,
    );
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.5", "long").segmentCount).toBe(4);
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0", "long").segmentCount).toBe(12);
    expect(manhuaSeedanceLayoutPinsSegmentTable(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1)).toBe(true);
    expect(manhuaSeedanceLayoutPinsSegmentTable(CANVAS_VIDEO_MODEL_HAILUO_H3)).toBe(true);
    expect(manhuaSeedanceLayoutPinsSegmentTable("seedance-2.5")).toBe(true);
    expect(manhuaSeedanceLayoutPinsSegmentTable("seedance-2.0")).toBe(false);
  });

  it("empty / unknown model falls back to explicit 2.5 profile（不靠数组[0]）", () => {
    expect(resolveManhuaSeedanceLayoutProfile("")).toMatchObject({
      videoModel: "seedance-2.5",
      segmentCount: 4,
      durationSecPerSegment: 30,
      targetSec: 120,
    });
    expect(resolveManhuaSeedanceLayoutProfile("not-a-model")).toMatchObject({
      videoModel: "seedance-2.5",
    });
  });

  it("requires explicit choice before expand", () => {
    expect(hasManhuaSeedanceLayoutChoice("")).toBe(false);
    expect(hasManhuaSeedanceLayoutChoice("seedance-2.5")).toBe(true);
    expect(hasManhuaSeedanceLayoutChoice(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1)).toBe(true);
  });

  it("clamps clip duration: only 2.5 may exceed 15s", () => {
    expect(manhuaClipMaxDurationSecForVideoModel("seedance-2.5")).toBe(30);
    expect(manhuaClipMaxDurationSecForVideoModel("seedance-2.0")).toBe(15);
    expect(manhuaClipMaxDurationSecForVideoModel(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1)).toBe(15);
    expect(clampManhuaClipDurationSecForVideoModel("seedance-2.5", 40)).toBe(30);
    expect(clampManhuaClipDurationSecForVideoModel("seedance-2.0-fast", 40)).toBe(15);
    expect(clampManhuaClipDurationSecForVideoModel(CANVAS_VIDEO_MODEL_HAILUO_H3, 20)).toBe(15);
  });

  it("有 2.5 权限时默认 2.5；无权限默认回落 2.0-fast", () => {
    expect(resolveManhuaFactoryDefaultVideoModel({ plan: "pro", now: AFTER })).toBe("seedance-2.5");
    expect(resolveManhuaFactoryDefaultVideoModel({ plan: "enterprise", now: AFTER })).toBe(
      "seedance-2.5",
    );
    expect(resolveManhuaFactoryDefaultVideoModel({ plan: "free", now: AFTER })).toBe(
      "seedance-2.0-fast",
    );
    expect(resolveManhuaFactoryDefaultVideoModel({ plan: "pro", now: BEFORE })).toBe(
      "seedance-2.0-fast",
    );
    expect(
      resolveManhuaFactoryDefaultVideoModel({
        plan: "free",
        role: "supervisor",
        now: BEFORE,
      }),
    ).toBe("seedance-2.5");
  });
});
