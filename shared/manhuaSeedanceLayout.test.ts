import { describe, expect, it } from "vitest";
import { CANVAS_VIDEO_MODEL_HAILUO_H3 } from "./hailuoOpenRouterModels.js";
import { CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1 } from "./happyHorseOpenRouterModels.js";
import {
  clampManhuaClipDurationSecForVideoModel,
  hasManhuaSeedanceLayoutChoice,
  MANHUA_SEEDANCE_LAYOUT_CHOICES,
  manhuaClipMaxDurationSecForVideoModel,
  manhuaSeedanceLayoutPinsSegmentTable,
  migrateRetiredManhuaLayoutVideoModel,
  resolveManhuaFactoryDefaultVideoModel,
  resolveManhuaSeedanceLayoutProfile,
} from "./manhuaSeedanceLayout.js";
import { SEEDANCE_25_LAUNCH_AT_MS } from "./seedance25Access.js";

const BEFORE = SEEDANCE_25_LAUNCH_AT_MS - 60_000;
const AFTER = SEEDANCE_25_LAUNCH_AT_MS + 60_000;

describe("manhuaSeedanceLayout", () => {
  it("exposes the manhua engines with formal product labels", () => {
    const labels = MANHUA_SEEDANCE_LAYOUT_CHOICES.map((c) => c.labelZh);
    expect(labels).toEqual([
      "Seedance 2.0 mini（草稿档）",
      "Seedance 2.0",
      "Seedance 2.0 fast",
      "Seedance 2.5",
      "Wan 3.0",
      "Minimax H3",
    ]);
  });

  /**
   * 用户 2026-08-06 拍板、2026-08-09 复核维持：Happy Horse 不做整集流水线引擎。
   * 这条锁的是「不能再被悄悄加回段表」，而不是某个具体段数。
   */
  it("keeps Happy Horse out of the manhua segment table", () => {
    expect(
      MANHUA_SEEDANCE_LAYOUT_CHOICES.some(
        (c) => String(c.videoModel) === CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1,
      ),
    ).toBe(false);
    expect(hasManhuaSeedanceLayoutChoice(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1)).toBe(false);
  });

  /**
   * 旧 Happy Horse 会话必须迁到 2.0-fast（同 6×15s 段表、同段价），
   * 不能因为「不认得」而落到画布默认的 2.5——那会悄悄改段表、改权限门。
   */
  it("migrates retired Happy Horse sessions to the equivalent 2.0-fast tier", () => {
    for (const alias of [
      "happyhorse-1.1",
      "happyhorse",
      "happy-horse",
      "alibaba/happyhorse-1.1",
      "Happy-Horse",
    ]) {
      expect(migrateRetiredManhuaLayoutVideoModel(alias)).toBe("seedance-2.0-fast");
    }
    const migrated = resolveManhuaSeedanceLayoutProfile(
      migrateRetiredManhuaLayoutVideoModel(CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1),
    );
    expect(migrated).toMatchObject({ segmentCount: 6, durationSecPerSegment: 15, targetSec: 90 });
  });

  it("keeps known models as-is and leaves unknown ones unselected", () => {
    expect(migrateRetiredManhuaLayoutVideoModel("seedance-2.5")).toBe("seedance-2.5");
    expect(migrateRetiredManhuaLayoutVideoModel("seedance-2.0-mini")).toBe("seedance-2.0-mini");
    expect(migrateRetiredManhuaLayoutVideoModel(CANVAS_VIDEO_MODEL_HAILUO_H3)).toBe(
      CANVAS_VIDEO_MODEL_HAILUO_H3,
    );
    expect(migrateRetiredManhuaLayoutVideoModel("")).toBe("");
    expect(migrateRetiredManhuaLayoutVideoModel("not-a-model")).toBe("");
    expect(migrateRetiredManhuaLayoutVideoModel(null)).toBe("");
  });

  it("maps mini / 2.0 / fast to 15s segments and 2.5 to 4×30", () => {
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0-mini")).toMatchObject({
      videoModel: "seedance-2.0-mini",
      segmentCount: 6,
      segmentMin: 6,
      segmentMax: 6,
      durationSecPerSegment: 15,
      targetSec: 90,
    });
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

  it("pins mini / H3 / 2.5 away from long lengthTier", () => {
    // Mini 必须钉死 6 段：整集草稿包 168 是按 6×28 报的，放到 12 段就变成假话
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0-mini", "long").segmentCount).toBe(6);
    expect(resolveManhuaSeedanceLayoutProfile(CANVAS_VIDEO_MODEL_HAILUO_H3, "long").segmentCount).toBe(
      8,
    );
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.5", "long").segmentCount).toBe(4);
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0", "long").segmentCount).toBe(12);
    expect(manhuaSeedanceLayoutPinsSegmentTable("seedance-2.0-mini")).toBe(true);
    expect(manhuaSeedanceLayoutPinsSegmentTable(CANVAS_VIDEO_MODEL_HAILUO_H3)).toBe(true);
    expect(manhuaSeedanceLayoutPinsSegmentTable("seedance-2.5")).toBe(true);
    expect(manhuaSeedanceLayoutPinsSegmentTable("seedance-2.0")).toBe(false);
  });

  it("empty / unknown model falls back to explicit mini profile（不靠数组[0]）", () => {
    expect(resolveManhuaSeedanceLayoutProfile("")).toMatchObject({
      videoModel: "seedance-2.0-mini",
      segmentCount: 6,
      durationSecPerSegment: 15,
      targetSec: 90,
    });
    expect(resolveManhuaSeedanceLayoutProfile("not-a-model")).toMatchObject({
      videoModel: "seedance-2.0-mini",
    });
  });

  it("requires explicit choice before expand", () => {
    expect(hasManhuaSeedanceLayoutChoice("")).toBe(false);
    expect(hasManhuaSeedanceLayoutChoice("seedance-2.5")).toBe(true);
    expect(hasManhuaSeedanceLayoutChoice("seedance-2.0-mini")).toBe(true);
  });

  it("clamps clip duration: only 2.5 may exceed 15s", () => {
    expect(manhuaClipMaxDurationSecForVideoModel("seedance-2.5")).toBe(30);
    expect(manhuaClipMaxDurationSecForVideoModel("seedance-2.0")).toBe(15);
    expect(manhuaClipMaxDurationSecForVideoModel("seedance-2.0-mini")).toBe(15);
    expect(clampManhuaClipDurationSecForVideoModel("seedance-2.0-mini", 40)).toBe(15);
    expect(clampManhuaClipDurationSecForVideoModel("seedance-2.5", 40)).toBe(30);
    expect(clampManhuaClipDurationSecForVideoModel("seedance-2.0-fast", 40)).toBe(15);
    expect(clampManhuaClipDurationSecForVideoModel(CANVAS_VIDEO_MODEL_HAILUO_H3, 20)).toBe(15);
  });

  it("默认一律 mini：不再按 2.5 权限分流", () => {
    // mini 无闸门、人人可用，所以 plan / role / 时点都不影响默认档；
    // 2.5 的权限校验移回选项过滤与服务端扣费闸门，用户必须自己点才用得上。
    for (const access of [
      { plan: "pro", now: AFTER },
      { plan: "enterprise", now: AFTER },
      { plan: "free", now: AFTER },
      { plan: "pro", now: BEFORE },
      { plan: "free", role: "supervisor", now: BEFORE },
    ] as const) {
      expect(resolveManhuaFactoryDefaultVideoModel(access)).toBe("seedance-2.0-mini");
    }
    expect(resolveManhuaFactoryDefaultVideoModel()).toBe("seedance-2.0-mini");
  });
});
