import { describe, expect, it } from "vitest";
import {
  MANHUA_EPISODE_LENGTH_TIERS,
  getManhuaEpisodeLengthTier,
  manhuaEpisodeDensityFloors,
  manhuaEpisodeSegmentsForTier,
} from "./manhuaEpisodeSegmentPlan";
import {
  fitManhuaViralBeatGridToSegments,
  fitManhuaViralDensityHintsToSegments,
  formatManhuaViralTemplateWriterAddon,
  getManhuaViralTemplate,
} from "./manhuaViralTemplateBank";

describe("单集时长档位", () => {
  it("两档：短档 90s/6 段，长档 180s/12 段", () => {
    expect(MANHUA_EPISODE_LENGTH_TIERS.map((t) => t.id)).toEqual(["short", "long"]);
    expect(manhuaEpisodeSegmentsForTier("short")).toBe(6);
    expect(manhuaEpisodeSegmentsForTier("long")).toBe(12);
  });

  it("档位 id 认不出时回落短档，不静默按 180s 走", () => {
    expect(getManhuaEpisodeLengthTier(undefined).id).toBe("short");
    expect(getManhuaEpisodeLengthTier("nope").id).toBe("short");
  });
});

describe("节拍格按档位缩放", () => {
  const grid = getManhuaViralTemplate("tpl_border_farm_revenge")!.beatGrid;

  it("长档原样保留 12 拍，时间戳仍是每 15s 一个", () => {
    const beats = fitManhuaViralBeatGridToSegments(grid, 12);
    expect(beats).toHaveLength(12);
    expect(beats.map((b) => b.atSec)).toEqual([0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]);
  });

  /** 段长恒定 15s，短档只是段数少；重打时间戳后不能还停在 165s */
  it("短档抽成 6 拍并重打时间戳到 0–75s", () => {
    const beats = fitManhuaViralBeatGridToSegments(grid, 6);
    expect(beats).toHaveLength(6);
    expect(beats.map((b) => b.atSec)).toEqual([0, 15, 30, 45, 60, 75]);
  });

  /** 开场定调、钩子留悬念，抽稀时这两拍丢了模板就废了 */
  it("抽稀必留开场与片尾钩子", () => {
    const beats = fitManhuaViralBeatGridToSegments(grid, 6);
    expect(beats[0].conflictZh).toBe(grid[0].conflictZh);
    expect(beats[beats.length - 1].conflictZh).toBe(grid[grid.length - 1].conflictZh);
  });

  it("段数比模板拍数还多时不注水", () => {
    expect(fitManhuaViralBeatGridToSegments(grid.slice(0, 3), 12)).toHaveLength(3);
  });

  it("注入块的密度建议跟着档位改口，不再写死 180 秒", () => {
    const short = formatManhuaViralTemplateWriterAddon("tpl_border_farm_revenge", null, "short");
    const long = formatManhuaViralTemplateWriterAddon("tpl_border_farm_revenge", null, "long");
    expect(short).toContain("约90秒/集·6段");
    expect(long).toContain("约180秒/集·12段");
    expect(short).not.toContain("165s");
  });
});

describe("密度建议不得低于门禁", () => {
  const hints = getManhuaViralTemplate("tpl_border_farm_revenge")!.densityHints;

  /**
   * 卡片手写的 8 句是长档估值，门禁按每段 3 句算要 30 句。
   * 照卡片写完必然被退回，编剧永远摸不到门禁线。
   */
  it("对白建议抬到门禁线，而不是照抄卡片的 8 句", () => {
    expect(hints.minDialogueLines).toBe(8);
    expect(fitManhuaViralDensityHintsToSegments(hints, 12).minDialogueLines).toBe(
      manhuaEpisodeDensityFloors(180).minDlg,
    );
    expect(fitManhuaViralDensityHintsToSegments(hints, 6).minDialogueLines).toBe(
      manhuaEpisodeDensityFloors(90).minDlg,
    );
  });

  it("正文字数按段数折算：长档 280 字、短档减半", () => {
    expect(fitManhuaViralDensityHintsToSegments(hints, 12).minBodyChars).toBe(280);
    expect(fitManhuaViralDensityHintsToSegments(hints, 6).minBodyChars).toBe(140);
  });

  it("注入块印的就是门禁那组数，两边不会各说各话", () => {
    const short = formatManhuaViralTemplateWriterAddon("tpl_border_farm_revenge", null, "short");
    const floors = manhuaEpisodeDensityFloors(90);
    expect(short).toContain(`正文≥${floors.minBody}字`);
    expect(short).toContain(`对白≥${floors.minDlg}句`);
  });
});
