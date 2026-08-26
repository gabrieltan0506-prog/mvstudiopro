import { describe, expect, it } from "vitest";
import {
  BGM_VOLUME,
  beatTableToVolumeExpr,
  buildBeatTable,
  buildBgmAlignment,
  formatBeatTableMarkdown,
  readBgmStructure,
  type BgmLevelSample,
  type BgmStructure,
} from "./manhuaBeatTable";

const samples: BgmLevelSample[] = [
  { atSec: 0, peakDb: -2.1, meanDb: -12 },
  { atSec: 2.5, peakDb: -1.2, meanDb: -9 },
  { atSec: 3.5, peakDb: -2.3, meanDb: -11 },
  { atSec: 6, peakDb: -6.7, meanDb: -16 },
  { atSec: 12, peakDb: -20, meanDb: -23.8 },
  { atSec: 13, peakDb: -2.1, meanDb: -10 },
  { atSec: 16, peakDb: -30, meanDb: -35 },
  { atSec: 17, peakDb: -43, meanDb: -48 },
];

const structure: BgmStructure = {
  strongestAtSec: 8,
  strongestPeakDb: -0.4,
  valleyAtSec: 14,
  valleyMeanDb: -28,
  decayStartSec: 26,
  totalSec: 30,
};

describe("瞬时电平 → BGM 结构", () => {
  it("读出最强击点、中段谷底与末段衰减起点", () => {
    expect(readBgmStructure(samples)).toMatchObject({
      strongestAtSec: 2.5,
      strongestPeakDb: -1.2,
      valleyAtSec: 12,
      valleyMeanDb: -23.8,
      decayStartSec: 13,
    });
  });

  it("样本不足或平均电平无效时不硬凑", () => {
    expect(readBgmStructure([samples[0]!])).toBeNull();
    expect(readBgmStructure([
      samples[0]!,
      { atSec: 1, peakDb: -2, meanDb: Number.NaN },
    ])).toBeNull();
  });
});

describe("最强击点对齐", () => {
  it("音乐击点比画面早：用 entrySec 延后整轨", () => {
    expect(buildBgmAlignment(structure, [
      { atSec: 12, kind: "断裂点", descZh: "刀落" },
    ])).toEqual({ entrySec: 4, seekSec: 0, anchorFilmSec: 12, anchorBgmSec: 8 });
  });

  it("音乐击点比画面晚：用 bgmSeekSec 从曲内裁，不产生负入点", () => {
    expect(buildBgmAlignment(structure, [
      { atSec: 3, kind: "断裂点", descZh: "刀落" },
    ])).toEqual({ entrySec: 0, seekSec: 5, anchorFilmSec: 3, anchorBgmSec: 8 });
  });

  it("没有断裂点时从曲首、片首播放", () => {
    expect(buildBgmAlignment(structure, [
      { atSec: 3, kind: "对白窗", durationSec: 2, descZh: "他说" },
    ])).toEqual({ entrySec: 0, seekSec: 0, anchorFilmSec: 0, anchorBgmSec: 8 });
  });
});

describe("卡点表 → 可执行 volumeExpr", () => {
  const rows = buildBeatTable({
    structure,
    entrySec: 5,
    bgmSeekSec: 0,
    filmDurationSec: 30,
    events: [
      { atSec: 10, durationSec: 1, kind: "静音停顿", descZh: "雨声骤停" },
      { atSec: 10, durationSec: 3, kind: "对白窗", descZh: "他说：走" },
      { atSec: 10, durationSec: 0.5, kind: "断裂点", descZh: "刀落" },
      { atSec: 28, kind: "终画面", descZh: "定格" },
    ],
  });
  const expression = beatTableToVolumeExpr(rows);

  it("静音与对白窗使用片内秒位，不随 entrySec 再偏移", () => {
    expect(expression).toContain("between(t,10,11)");
    expect(expression).toContain("between(t,10,13)");
    expect(expression).not.toContain("between(t,15,16)");
  });

  it("精确静音优先于同秒对白与高潮，最外层命中 volume=0", () => {
    expect(expression.startsWith("if(between(t,10,11),0,")).toBe(true);
    expect(expression).toContain(`,${BGM_VOLUME.dialogue},`);
    expect(expression).toContain(`,${BGM_VOLUME.peak},`);
  });

  it("硬静音、对白避让、高潮击点与片尾淡出都有具体参数", () => {
    expect(rows.find((row) => row.action === "hard_silence")).toMatchObject({
      filmSec: 10,
      endFilmSec: 11,
      volume: 0,
    });
    expect(rows.find((row) => row.action === "dialogue_duck")?.volume).toBe(0.18);
    expect(rows.find((row) => row.action === "peak_hit")?.volume).toBe(0.52);
    expect(rows.find((row) => row.action === "fade_out")?.soundActionZh).toContain("afade=t=out");
  });

  it("无特殊窗时惰性退回基础音量", () => {
    const plain = buildBeatTable({
      structure,
      events: [],
      entrySec: 0,
      filmDurationSec: 30,
    });
    expect(beatTableToVolumeExpr(plain)).toBe(String(BGM_VOLUME.base));
  });

  it("四列表头写清 seek 与 entry 的完整换算式", () => {
    const markdown = formatBeatTableMarkdown(rows, 0, 5);
    expect(markdown).toContain("片内时间 = (BGM 内时间 - 曲内起播 5s) + 入点 0s");
    expect(markdown).toContain("| 片内时间 | BGM 事件 | 画面事件 | 声音处理 |");
  });
});
