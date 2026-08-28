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
  type ManhuaViralTemplateBeat,
  type ManhuaViralTemplateCard,
} from "./manhuaViralTemplateBank";

/** 长档 12 拍骨架 fixture（种子库已清空，卡片按学成模板口径手造） */
const grid: ManhuaViralTemplateBeat[] = Array.from({ length: 12 }, (_, i) => ({
  atSec: i * 15,
  conflictZh: i === 0 ? "开场定调" : i === 11 ? "片尾钩子" : `冲突${i + 1}`,
  visualZh: `可拍动作${i + 1}`,
}));

const hints = { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 };

const fixtureCard: ManhuaViralTemplateCard = {
  id: "tpl_series_tierfixture",
  nameZh: "档位折算样例",
  laneZh: "古言种田",
  summaryZh: "绝境开局→可见升级→片尾钩子。",
  hook3sZh: "开场即绝境，先落一个可见动作。",
  beatGrid: grid,
  scenePoolHints: ["边塞", "关隘"],
  castShape: { leadDesireZh: "活下去并翻盘", pressureZh: "环境压迫" },
  densityHints: { ...hints },
  sourceRefs: [{ url: "https://example.com/learned", fetchedAt: "2026-08-10" }],
  status: "approved",
  approvedAt: "2026-08-10T00:00:00.000Z",
};

const extras = [fixtureCard];

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
  it("长档原样保留 12 拍，时间戳仍是每 15s 一个", () => {
    const beats = fitManhuaViralBeatGridToSegments(grid, 12);
    expect(beats).toHaveLength(12);
    expect(beats.map((b) => b.atSec)).toEqual([0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]);
  });

  /** 段长恒定 15s，短档只缩放秒位，不删模板证据 */
  it("短档保留 12 拍并把完整时间轴缩放到 0–75s", () => {
    const beats = fitManhuaViralBeatGridToSegments(grid, 6);
    expect(beats).toHaveLength(12);
    expect(beats[0]?.atSec).toBe(0);
    expect(beats.at(-1)?.atSec).toBe(75);
    expect(beats.every((beat, index) => index === 0 || beat.atSec >= beats[index - 1]!.atSec)).toBe(true);
  });

  it("缩放时开场、过程与片尾全部保留", () => {
    const beats = fitManhuaViralBeatGridToSegments(grid, 6);
    expect(beats).toHaveLength(grid.length);
    expect(beats[0].conflictZh).toBe(grid[0].conflictZh);
    expect(beats[5].conflictZh).toBe(grid[5].conflictZh);
    expect(beats[beats.length - 1].conflictZh).toBe(grid[grid.length - 1].conflictZh);
  });

  it("段数比模板拍数还多时不注水", () => {
    expect(fitManhuaViralBeatGridToSegments(grid.slice(0, 3), 12)).toHaveLength(3);
  });

  it("注入块的密度建议跟着档位改口，不再写死 180 秒", () => {
    const short = formatManhuaViralTemplateWriterAddon("tpl_series_tierfixture", extras, "short");
    const long = formatManhuaViralTemplateWriterAddon("tpl_series_tierfixture", extras, "long");
    expect(short).toContain("约90秒/集·6段");
    expect(long).toContain("约180秒/集·12段");
    expect(short).not.toContain("165s");
  });
});

describe("密度建议不得低于门禁", () => {
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
    const short = formatManhuaViralTemplateWriterAddon("tpl_series_tierfixture", extras, "short");
    const floors = manhuaEpisodeDensityFloors(90);
    expect(short).toContain(`正文≥${floors.minBody}字`);
    expect(short).toContain(`对白≥${floors.minDlg}句`);
  });
});
