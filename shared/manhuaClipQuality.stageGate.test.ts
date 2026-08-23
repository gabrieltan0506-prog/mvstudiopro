/**
 * 阶段门禁回归：合成与阶段判断必须用同一个判据。
 *
 * 0823 实况：合成路径已改成软质检（没报告也放行），阶段判断仍硬写 === "passed"，
 * 于是「片子能进成片坞、阶段却永远算不完成、剪辑永远待开始」。
 */
import { describe, expect, it } from "vitest";
import { manhuaClipQualityAllowsAssemble } from "./manhuaClipQuality";

/** 与 ManhuaScriptWorkbench 的 clip 阶段判据同构 */
const clipStageHas = (
  clips: Array<{ status: string; outputUrl?: string; quality?: unknown }>,
): boolean =>
  clips.some(
    (b) =>
      b.status === "done" &&
      manhuaClipQualityAllowsAssemble({
        outputUrl: b.outputUrl,
        quality: b.quality as never,
      }),
  );

describe("clip 阶段门禁与合成判据同源", () => {
  it("没盖质检报告的成片：能合成，阶段也必须算完成（此前会永远待开始）", () => {
    const clips = [{ status: "done", outputUrl: "https://x/seg1.mp4", quality: undefined }];
    expect(manhuaClipQualityAllowsAssemble({ outputUrl: clips[0]!.outputUrl })).toBe(true);
    expect(clipStageHas(clips)).toBe(true);
  });

  it("质检 failed 且用户未仍采用：不可合成，阶段也不算完成", () => {
    const clips = [
      { status: "done", outputUrl: "https://x/seg1.mp4", quality: { status: "failed" } },
    ];
    expect(clipStageHas(clips)).toBe(false);
  });

  it("质检 failed 但用户仍采用：两边都放行", () => {
    const clips = [
      {
        status: "done",
        outputUrl: "https://x/seg1.mp4",
        quality: { status: "failed", userAcceptedDespiteQc: true },
      },
    ];
    expect(clipStageHas(clips)).toBe(true);
  });

  it("垫图不算出片：没有 outputUrl 一律不通过", () => {
    expect(clipStageHas([{ status: "done", outputUrl: "", quality: { status: "passed" } }])).toBe(
      false,
    );
  });

  it("未完成的段不算数", () => {
    expect(clipStageHas([{ status: "running", outputUrl: "https://x/a.mp4" }])).toBe(false);
  });
});
