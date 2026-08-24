import { describe, expect, it } from "vitest";
import {
  BGM_VOLUME,
  beatTableToVolumeExpr,
  buildBeatTable,
  formatBeatTableMarkdown,
  readBgmStructure,
  type BgmLevelSample,
} from "./manhuaBeatTable";

/** 仿《十面埋伏》实测结构：0/2.5/3.5 三次拨弦，12.0 谷底，14 后淡出 */
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

describe("从瞬时电平读结构", () => {
  it("最强击点取 peak 最高的那格", () => {
    expect(readBgmStructure(samples)!.strongestAtSec).toBe(2.5);
  });

  it("谷底只在中段找 —— 首尾天然低，取到那儿没有对齐价值", () => {
    const st = readBgmStructure(samples)!;
    expect(st.valleyAtSec).toBe(12);
    expect(st.valleyMeanDb).toBeCloseTo(-23.8, 1);
  });

  it("衰减起点＝最后一次 peak 高于 −12dB 的位置", () => {
    expect(readBgmStructure(samples)!.decayStartSec).toBe(13);
  });

  it("样本太少返回 null，不硬凑一个结构", () => {
    expect(readBgmStructure([samples[0]!])).toBeNull();
  });
});

describe("卡点表对齐规则", () => {
  const st = readBgmStructure(samples)!;
  const table = buildBeatTable({
    structure: st,
    entrySec: 0,
    filmDurationSec: 26,
    events: [
      { atSec: 6.4, durationSec: 0.5, kind: "静音停顿", descZh: "撕布告，雨声骤停一拍" },
      { atSec: 7.0, durationSec: 3.25, kind: "对白窗", descZh: "台词「你早就来过这里。」" },
      { atSec: 21.2, kind: "断裂点", descZh: "纸做的他踏出门槛、抬头入灯" },
      { atSec: 24.1, kind: "终画面", descZh: "纸掌与血肉掌相距一指，定格" },
    ],
  });

  it("静音停顿是**硬切真空**，不是压低 —— 铁律一", () => {
    const row = table.find((r) => r.filmSec === 6.4)!;
    expect(row.volume).toBe(BGM_VOLUME.silent);
    expect(row.soundActionZh).toContain("anullsrc 真空");
    expect(row.soundActionZh).toContain("不是压低");
  });

  it("停顿后从原位置续入，不重头（重头会结构错位）", () => {
    expect(table.find((r) => r.filmSec === 6.9)!.bgmEventZh).toContain("不重头");
  });

  it("断裂点对齐全曲最强击点", () => {
    const row = table.find((r) => r.filmSec === 21.2)!;
    expect(row.bgmEventZh).toContain("最强击点");
    expect(row.bgmEventZh).toContain("2.5s");
    expect(row.volume).toBe(BGM_VOLUME.peak);
  });

  it("对白窗压到 0.18，结束后回基准", () => {
    expect(table.find((r) => r.filmSec === 7)!.volume).toBe(BGM_VOLUME.dialogue);
    expect(table.find((r) => r.filmSec === 10.25)!.volume).toBe(BGM_VOLUME.base);
  });

  it("终画面给出淡出参数，不写「淡出一下」", () => {
    expect(table.find((r) => r.filmSec === 24.1)!.soundActionZh).toContain("afade=t=out");
  });

  it("按片内时间排序", () => {
    const secs = table.map((r) => r.filmSec);
    expect([...secs].sort((a, b) => a - b)).toEqual(secs);
  });

  it("超出成片长度的事件不进表", () => {
    const t = buildBeatTable({
      structure: st,
      entrySec: 0,
      filmDurationSec: 10,
      events: [{ atSec: 99, kind: "断裂点", descZh: "越界" }],
    });
    expect(t.some((r) => r.filmEventZh === "越界")).toBe(false);
  });

  it("表头带换算式，四列齐全", () => {
    const md = formatBeatTableMarkdown(table, 0);
    expect(md).toContain("片内时间 = BGM 内时间 + 入点");
    expect(md).toContain("| 片内时间 | BGM 事件 | 画面事件 | 声音处理 |");
  });

  it("能产出分窗 volume 表达式 —— 这才是 bgm_mount 真正缺的东西", () => {
    const expr = beatTableToVolumeExpr(table);
    expect(expr).toContain("between(t,6.4,6.9)");
    expect(expr).toContain(String(BGM_VOLUME.silent));
    expect(expr).toContain(String(BGM_VOLUME.dialogue));
  });
});

describe("卡点表 → bgm_mount", () => {
  const st = readBgmStructure(samples)!;

  it("表达式带 between 窗口，能被 ffmpeg volume 消费", () => {
    const t = buildBeatTable({
      structure: st,
      entrySec: 0,
      filmDurationSec: 26,
      events: [{ atSec: 6.4, durationSec: 0.5, kind: "静音停顿", descZh: "雨声骤停" }],
    });
    const expr = beatTableToVolumeExpr(t);
    expect(expr).toMatch(/^if\(between\(t,/);
    expect(expr).toContain("6.4");
  });

  it("没有特殊窗口时退回基准值，不产出空表达式", () => {
    const t = buildBeatTable({ structure: st, entrySec: 0, filmDurationSec: 26, events: [] });
    expect(beatTableToVolumeExpr(t)).toBe(String(BGM_VOLUME.base));
  });
});
