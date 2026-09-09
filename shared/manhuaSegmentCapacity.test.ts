import { describe, expect, it } from "vitest";
import {
  MANHUA_SEGMENT_CAPACITY_MODE_DEFAULT,
  getManhuaSegmentCapacityMode,
  normalizeManhuaSegmentCapacityMode,
  normalizeManhuaSegmentCapacityModeByEpisode,
  planManhuaSegmentCapacity,
} from "./manhuaSegmentCapacity";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench";

/** 29 镜 / 130 秒的原稿：28 镜 × 4.5s + 1 镜 × 4s */
function build29Shots130Sec(): ManhuaWorkbenchShot[] {
  return Array.from({ length: 29 }, (_, i) => ({
    index: i + 1,
    durationSec: i === 28 ? 4 : 4.5,
    cameraZh: "中景",
    actionZh: `第${i + 1}镜动作：人物推门、对视、转身`,
    dialogueZh: i % 3 === 0 ? `苏照雪：「第${i + 1}句」` : undefined,
  }));
}

describe("manhuaSegmentCapacity · 模式归一化", () => {
  it("缺省 block_when_over；非法值回落缺省", () => {
    expect(MANHUA_SEGMENT_CAPACITY_MODE_DEFAULT).toBe("block_when_over");
    expect(normalizeManhuaSegmentCapacityMode(undefined)).toBe("block_when_over");
    expect(normalizeManhuaSegmentCapacityMode("whatever")).toBe("block_when_over");
    expect(normalizeManhuaSegmentCapacityMode("auto_by_source")).toBe("auto_by_source");
  });
  it("按集表只留合法集号与合法值", () => {
    const out = normalizeManhuaSegmentCapacityModeByEpisode({
      "1": "auto_by_source",
      "2": "nope",
      "0": "auto_by_source",
      x: "auto_by_source",
      "3": "block_when_over",
    });
    expect(out).toEqual({ "1": "auto_by_source", "3": "block_when_over" });
    expect(getManhuaSegmentCapacityMode(out, 1)).toBe("auto_by_source");
    expect(getManhuaSegmentCapacityMode(out, 2)).toBe("block_when_over");
    expect(getManhuaSegmentCapacityMode(null, 9)).toBe("block_when_over");
  });
});

describe("manhuaSegmentCapacity · 29 镜 / 130 秒 原稿", () => {
  it("auto_by_source（Seedance 2.5，30s/段）：一镜不丢、每段 ≤30s、段数 ≥ ceil(130/30)=5", () => {
    const plan = planManhuaSegmentCapacity({
      shots: build29Shots130Sec(),
      mode: "auto_by_source",
      videoModel: "seedance-2.5",
      episodeIndex: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.errorZh).toBe("");
    expect(plan.plannedShotCount).toBe(29);
    expect(plan.plannedSec).toBe(130);
    expect(plan.durationSecPerSegment).toBe(30);
    expect(plan.requiredSegmentCount).toBe(5);
    expect(plan.segments.length).toBeGreaterThanOrEqual(5);
    // 没有一镜被丢：所有镜号都落在某一段里
    const kept = new Set(plan.segments.flatMap((seg) => seg.shots.map((s) => s.index)));
    expect(kept.size).toBe(29);
    for (const seg of plan.segments) {
      const sec = seg.shots.reduce((n, s) => n + s.durationSec, 0);
      expect(sec).toBeLessThanOrEqual(30 + 1e-6);
    }
    // 原镜边界保持：段之间没有把同一镜拆开（单镜 ≤30s 不该拆）
    expect(plan.segments.every((seg) => seg.shots.every((s) => !s.continuation))).toBe(true);
    expect(plan.summaryZh).toContain("不丢镜");
  });

  it("block_when_over（Seedance 2.5 固定 4 段×30s=120s）：拒绝并写清 29 镜/130 秒 vs 容量", () => {
    const plan = planManhuaSegmentCapacity({
      shots: build29Shots130Sec(),
      mode: "block_when_over",
      videoModel: "seedance-2.5",
      episodeIndex: 2,
    });
    expect(plan.ok).toBe(false);
    expect(plan.overCapacity).toBe(true);
    expect(plan.segments).toEqual([]);
    expect(plan.capacitySegmentCount).toBe(4);
    expect(plan.capacitySec).toBe(120);
    // 0909：2.5 每段 6 镜，4 段容量 24 镜（29 镜仍超）
    expect(plan.capacityShotCount).toBe(24);
    expect(plan.errorZh).toContain("第2集");
    expect(plan.errorZh).toContain("29 镜");
    expect(plan.errorZh).toContain("130 秒");
    expect(plan.errorZh).toContain("4 段");
    expect(plan.errorZh).toContain("120 秒");
    expect(plan.errorZh).toContain("按原稿分段");
    expect(plan.errorZh).toContain("未扣费");
  });

  it("block_when_over（mini 固定 6 段×15s=90s/18 镜）：同样拦下，容量数字按引擎走", () => {
    const plan = planManhuaSegmentCapacity({
      shots: build29Shots130Sec(),
      mode: "block_when_over",
      videoModel: "seedance-2.0-mini",
    });
    expect(plan.ok).toBe(false);
    expect(plan.errorZh).toContain("6 段");
    expect(plan.errorZh).toContain("18 镜");
    expect(plan.errorZh).toContain("90 秒");
    expect(plan.errorZh).toContain("本集");
  });

  it("block_when_over 在容量内照常分段，不误拦", () => {
    const shots = build29Shots130Sec().slice(0, 12).map((s) => ({ ...s, durationSec: 5 }));
    const plan = planManhuaSegmentCapacity({
      shots,
      mode: "block_when_over",
      videoModel: "seedance-2.0-mini",
    });
    expect(plan.ok).toBe(true);
    expect(plan.plannedSec).toBe(60);
    expect(plan.segments.length).toBe(4);
    expect(plan.summaryZh).toContain("未超");
  });

  it("auto_by_source（Seedance 2.5）：29 镜 130 秒按 6 镜/30 秒一段排成 5 段，不是 10 段", () => {
    const plan = planManhuaSegmentCapacity({ shots: build29Shots130Sec(), mode: "auto_by_source", videoModel: "seedance-2.5" });
    expect(plan.segments.length).toBe(5);
    expect(plan.segments.every((seg) => seg.shots.length <= 6 && seg.durationSec <= 30)).toBe(true);
    expect(plan.segments.flatMap((seg) => seg.shots).length).toBe(29);
  });
  it("长档剧本按长档容量对照：2.0-fast 长档 36 镜/180 秒不该被短档拦下", () => {
    const shots = Array.from({ length: 36 }, (_, i) => ({ index: i + 1, durationSec: 5, cameraZh: "中景", actionZh: `动作 ${i + 1}` }));
    const blocked = planManhuaSegmentCapacity({ shots, mode: "block_when_over", videoModel: "seedance-2.0-fast" });
    expect(blocked.ok).toBe(false);
    const long = planManhuaSegmentCapacity({ shots, mode: "block_when_over", videoModel: "seedance-2.0-fast", lengthTierId: "long" });
    expect(long.ok).toBe(true);
  });
  it("空分镜不报错也不分段", () => {
    const plan = planManhuaSegmentCapacity({ shots: [], mode: "block_when_over" });
    expect(plan.ok).toBe(true);
    expect(plan.segments).toEqual([]);
  });
});
