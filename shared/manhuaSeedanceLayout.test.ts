import { describe, expect, it } from "vitest";
import { CANVAS_VIDEO_MODEL_HAILUO_H3 } from "./hailuoOpenRouterModels.js";
import {
  hasManhuaSeedanceLayoutChoice,
  resolveManhuaFactoryDefaultVideoModel,
  resolveManhuaSeedanceLayoutProfile,
} from "./manhuaSeedanceLayout.js";
import { SEEDANCE_25_LAUNCH_AT_MS } from "./seedance25Access.js";

const BEFORE = SEEDANCE_25_LAUNCH_AT_MS - 60_000;
const AFTER = SEEDANCE_25_LAUNCH_AT_MS + 60_000;

describe("manhuaSeedanceLayout", () => {
  it("maps 2.0 / fast to 5–6×15 and 2.5 to 4×30", () => {
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
  });

  it("maps 成片·高清 to 7–8×15 · 120s（对外文案不含供应商名）", () => {
    const h3 = resolveManhuaSeedanceLayoutProfile(CANVAS_VIDEO_MODEL_HAILUO_H3);
    expect(h3).toMatchObject({
      videoModel: CANVAS_VIDEO_MODEL_HAILUO_H3,
      segmentCount: 8,
      segmentMin: 7,
      segmentMax: 8,
      durationSecPerSegment: 15,
      targetSec: 120,
      labelZh: "成片·高清",
    });
    expect(h3.labelZh).not.toMatch(/MiniMax|海螺|Hailuo|OpenRouter|minimax/i);
    expect(h3.layoutHintZh).not.toMatch(/MiniMax|海螺|Hailuo|OpenRouter|minimax/i);
    expect(hasManhuaSeedanceLayoutChoice(CANVAS_VIDEO_MODEL_HAILUO_H3)).toBe(true);
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
  });

  it("有 2.5 权限时默认 2.5；无权限默认回落 2.0-fast", () => {
    expect(
      resolveManhuaFactoryDefaultVideoModel({ plan: "pro", now: AFTER }),
    ).toBe("seedance-2.5");
    expect(
      resolveManhuaFactoryDefaultVideoModel({ plan: "enterprise", now: AFTER }),
    ).toBe("seedance-2.5");
    expect(
      resolveManhuaFactoryDefaultVideoModel({ plan: "free", now: AFTER }),
    ).toBe("seedance-2.0-fast");
    expect(
      resolveManhuaFactoryDefaultVideoModel({ plan: "pro", now: BEFORE }),
    ).toBe("seedance-2.0-fast");
    expect(
      resolveManhuaFactoryDefaultVideoModel({
        plan: "free",
        role: "supervisor",
        now: BEFORE,
      }),
    ).toBe("seedance-2.5");
  });
});
