import { describe, expect, it } from "vitest";
import {
  buildManhuaEditShotQcBoard,
  manhuaEditExportableClipIds,
  manhuaEditQcSuggestsReworkStill,
  summarizeManhuaEditQcBoard,
} from "./manhuaEditQcExport";
import { emptyManhuaClipQualityChecks } from "./manhuaClipQuality";

describe("manhuaEditQcExport", () => {
  it("classifies gates and exportable ids", () => {
    const checks = emptyManhuaClipQualityChecks();
    const rows = buildManhuaEditShotQcBoard([
      {
        shotIndex: 1,
        clipBlockId: "clip-e1-01",
        outputUrl: "https://x/a.mp4",
        quality: {
          status: "passed",
          checks,
          summary: "ok",
          attempts: 1,
          failedKeys: [],
        },
      },
      {
        shotIndex: 2,
        clipBlockId: "clip-e1-02",
        outputUrl: "https://x/b.mp4",
        quality: {
          status: "failed",
          checks,
          summary: "角色不符",
          attempts: 2,
          failedKeys: ["CHARACTER_MATCH"],
        },
      },
      {
        shotIndex: 3,
        clipBlockId: "clip-e1-03",
        outputUrl: "https://x/c.mp4",
        quality: {
          status: "failed",
          checks,
          summary: "略偏",
          attempts: 1,
          failedKeys: ["PLOT_MATCH"],
          userAcceptedDespiteQc: true,
        },
      },
      { shotIndex: 4 },
    ]);
    const sum = summarizeManhuaEditQcBoard(rows);
    expect(sum.passed).toBe(1);
    expect(sum.failed).toBe(1);
    expect(sum.accepted).toBe(1);
    expect(sum.missing).toBe(1);
    expect(sum.reworkIndexes).toEqual([2, 4]);
    expect(manhuaEditExportableClipIds(rows)).toEqual(["clip-e1-01", "clip-e1-03"]);
  });

  it("detects still rework hint", () => {
    expect(manhuaEditQcSuggestsReworkStill("首镜含违规文字，请重出静帧")).toBe(true);
    expect(manhuaEditQcSuggestsReworkStill("运镜偏弱")).toBe(false);
  });
});
