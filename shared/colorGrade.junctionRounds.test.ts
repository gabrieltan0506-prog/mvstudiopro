import { describe, expect, it } from "vitest";
import {
  applyJunctionAutoMatch, buildJunctionWarnings, checkJunctionConsistency, JUNCTION_FIX_LIMITS, JUNCTION_FIX_MAX_ROUNDS,
  matchJunctionsIteratively, parseSignalStats, type GradeSpan,
} from "./colorGrade";

const st = (y: number, sat = 20, u = 128, v = 128) => ({ ...parseSignalStats(""), YAVG: y, UAVG: u, VAVG: v, SATAVG: sat });

/**
 * 1110 实测形状（mvface-sunny ai-grade-20261110T035044）：7 段 6 个接点，5 个未过；
 * 26.9s（YAVG +28.9）与 41.1s（−14.1）标 unwanted，其余未过的为 intended（剧情转变）。
 */
const spans1110 = (): GradeSpan[] => [
  { startSec: 0, endSec: 8.2, correction: { exposure: 0.1 } },
  { startSec: 8.2, endSec: 17.5, correction: { saturation: 0.9 }, junctionIntent: "intended" },
  { startSec: 17.5, endSec: 26.9, correction: { color_temperature: 6000 }, junctionIntent: "intended" },
  { startSec: 26.9, endSec: 41.1, correction: { color_temperature: 7600, exposure: 0.1 }, junctionIntent: "unwanted" },
  { startSec: 41.1, endSec: 48, correction: { saturation: 0.85 }, junctionIntent: "unwanted" },
  { startSec: 48, endSec: 55.3, correction: null, junctionIntent: "intended" },
  { startSec: 55.3, endSec: 62, correction: { exposure: 0.2 }, junctionIntent: "intended" },
];
/** 各接点首检 YAVG 差（后 − 前）。 */
const BASE = [-9.4, 12.2, 28.9, -14.1, 2.1, 16.8];

/** 替身渲染：接点 YAVG 差 = 首检差 + gain × (过渡子段曝光 − 后段原曝光)；记录每轮渲染的 spans。 */
function fakeFilm(gainPerStop: number, opts: { stuck?: number[] } = {}) {
  const orig = spans1110();
  const renders: GradeSpan[][] = [];
  const measure = (spans: GradeSpan[]) => {
    const pairs = BASE.map((d, index) => {
      const ramp = spans.find(s => s.rampOf === index && s.startSec === orig[index + 1].startSec);
      const dE = ramp ? (ramp.correction?.exposure ?? 0) - (orig[index + 1].correction?.exposure ?? 0) : 0;
      const delta = opts.stuck?.includes(index) ? d : d + gainPerStop * dE;
      return { index, junctionSec: orig[index].endSec, before: st(100), after: st(100 + delta) };
    });
    return { ...checkJunctionConsistency(pairs), pairs };
  };
  return { orig, renders, first: measure(orig), render: async (spans: GradeSpan[]) => { renders.push(spans); return measure(spans); } };
}

describe("接点多轮修正（1110 数据形状）", () => {
  it("首检：6 个接点 5 个未过", () => {
    const f = fakeFilm(40);
    expect(f.first.junctions.filter(j => !j.pass).map(j => j.junctionSec)).toEqual([8.2, 17.5, 26.9, 41.1, 55.3]);
  });

  it("unwanted 接点多轮后达标：每轮用上一轮实测差继续，单轮步长 ≤0.25 档；达标即停、无警告", async () => {
    const f = fakeFilm(40); // 每档 40：26.9s 需 −0.6 档以上，至少 3 轮；41.1s 两轮
    const r = await matchJunctionsIteratively({ spans: f.orig, first: f.first, render: f.render });
    expect(r.rounds.map(x => x.round)).toEqual([1, 2, 3]);
    const y = (round: number, index: number) => r.rounds[round - 1].check.junctions[index].delta.YAVG;
    expect([y(1, 2), y(2, 2), y(3, 2)]).toEqual([18.9, 8.9, -0.02]); // 第 3 轮按剩余差 8.9 只下发 −0.223 档
    expect([y(1, 3), y(2, 3)]).toEqual([-4.1, -4.1]); // 41.1s 第 1 轮即达标，之后保留修正、不再加步
    for (const round of r.rounds) for (const n of round.junctions) if (n.step?.exposure != null) expect(Math.abs(n.step.exposure)).toBeLessThanOrEqual(JUNCTION_FIX_LIMITS.exposure);
    expect(r.rounds[1].junctions.find(n => n.index === 3)).toMatchObject({ action: "fixed", rounds: 1 });
    expect(r.rounds[1].junctions.find(n => n.index === 3)?.step).toBeUndefined();
    expect(r.check!.junctions.filter(j => !j.pass).map(j => j.junctionSec)).toEqual([8.2, 17.5, 55.3]); // 只剩 intended
    expect(r.adjusted).toEqual([3, 4]);
    expect(r.warnings).toEqual([]);
    // 过渡子段只在接点后 1 秒内，余段回到原参数
    const ramp = r.spans.filter(s => s.rampOf === 2);
    expect(ramp.map(s => [s.startSec, s.endSec])).toEqual([[26.9, 27.4], [27.4, 41.1]]);
    expect(ramp[1].correction).toEqual({ color_temperature: 7600, exposure: 0.1 });
    expect(ramp[0].correction).toEqual({ color_temperature: 7600, exposure: -0.623 }); // 0.1 − 0.25 − 0.25 − 0.223
  });

  it("intended 接点不被修：多轮下来参数、位置逐字不变，也不进警告", async () => {
    const f = fakeFilm(40);
    const r = await matchJunctionsIteratively({ spans: f.orig, first: f.first, render: f.render });
    for (const spans of f.renders) {
      expect(spans.filter(s => s.rampOf == null)).toEqual([f.orig[0], f.orig[1], f.orig[2], f.orig[5], f.orig[6]]);
      expect(spans.filter(s => s.rampOf != null).every(s => s.rampOf === 2 || s.rampOf === 3)).toBe(true);
    }
    expect(r.junctions.filter(n => n.action === "intended").map(n => n.index)).toEqual([0, 1, 5]);
    expect(f.orig).toEqual(spans1110()); // 入参不被改写
    expect(r.warnings.some(w => [8.2, 17.5, 55.3].includes(w.atSec))).toBe(false);
  });

  it("修过头不振荡：实际增益是公式的 3 倍时，第二轮按实测缩步收回，不来回跳", async () => {
    const f = fakeFilm(120); // 26.9s 首轮 −0.25 档 → +28.9 − 30 = −1.1 直接达标；41.1s 首轮 +0.25 档 → −14.1 + 30 = +15.9 过冲
    const r = await matchJunctionsIteratively({ spans: f.orig, first: f.first, render: f.render });
    const ys = r.rounds.map(x => x.check.junctions[3].delta.YAVG);
    expect(ys[0]).toBe(15.9);
    expect(Math.abs(ys[1])).toBeLessThanOrEqual(5);
    expect(r.rounds).toHaveLength(2);
    expect(r.rounds[1].junctions.find(n => n.index === 3)!.step!.exposure!).toBeLessThan(0);
    expect(Math.abs(r.rounds[1].junctions.find(n => n.index === 3)!.step!.exposure!)).toBeLessThan(0.25);
    expect(r.warnings).toEqual([]);
  });

  it("越修越差不交付更差的一版：最后一轮不如之前时回退到最好那版重渲（最好是原片则回原分段）", async () => {
    // 曝光越加接点越差（增益反号）：每轮都比首检差 → 回退到原分段
    const f = fakeFilm(-30);
    const r = await matchJunctionsIteratively({ spans: f.orig, first: f.first, render: f.render });
    expect(r.rounds).toHaveLength(JUNCTION_FIX_MAX_ROUNDS);
    expect(r.revertedToRound).toBe(0);
    expect(f.renders).toHaveLength(JUNCTION_FIX_MAX_ROUNDS + 1);
    expect(f.renders.at(-1)).toEqual(f.orig);
    expect(r.spans).toEqual(f.orig);
    expect(r.adjusted).toEqual([]);
    expect(r.check!.junctions.map(j => j.delta.YAVG)).toEqual(f.first.junctions.map(j => j.delta.YAVG));
    expect(r.warnings.map(w => [w.atSec, w.rounds, w.reason])).toEqual([[26.9, 3, "max_rounds"], [41.1, 3, "max_rounds"]]);
    // 正常收敛时不回退、不多渲
    const g = fakeFilm(40);
    const ok = await matchJunctionsIteratively({ spans: g.orig, first: g.first, render: g.render });
    expect(ok.revertedToRound).toBeUndefined();
    expect(g.renders).toHaveLength(ok.rounds.length);
  });

  it("仍不达标给结构化警告：哪一秒、哪项差多少、已试几轮；最多 3 轮重渲", async () => {
    const f = fakeFilm(40, { stuck: [2] }); // 26.9s 怎么修都压不住（1110：重渲后仍未压住）
    const r = await matchJunctionsIteratively({ spans: f.orig, first: f.first, render: f.render });
    expect(f.renders).toHaveLength(JUNCTION_FIX_MAX_ROUNDS);
    expect(r.warnings).toEqual([{
      index: 2, atSec: 26.9, intent: "unwanted", rounds: 3, maxRounds: 3, reason: "max_rounds",
      failing: [{ key: "YAVG", labelZh: "亮度", delta: 28.9, tolerance: 5, overBy: 23.9 }],
      delta: { YAVG: 28.9, UAVG: 0, VAVG: 0, SATAVG: 0 },
      messageZh: "26.9 秒接点仍有跳变：亮度差 +28.9（允许 ±5），已自动修正 3 轮仍未压住",
    }]);
    expect(r.check!.junctions[3].pass).toBe(true); // 41.1s 照常修好
    expect(r.warnings[0].messageZh).not.toMatch(/YAVG|ffmpeg|signalstats/i);
  });

  it("后段过短 / 未开自动修正：同样给警告并写明原因，rounds=0", async () => {
    const spans: GradeSpan[] = [{ startSec: 0, endSec: 2, correction: null }, { startSec: 2, endSec: 2.4, correction: null, crossfadeSec: 0.4, junctionIntent: "unwanted" }, { startSec: 2.4, endSec: 4, correction: null, crossfadeSec: 0.4, junctionIntent: "intended" }];
    const pairs = [{ index: 0, junctionSec: 2, before: st(100), after: st(60) }, { index: 1, junctionSec: 2.4, before: st(60), after: st(100) }];
    const first = { ...checkJunctionConsistency(pairs), pairs };
    let renders = 0;
    const r = await matchJunctionsIteratively({ spans, first, render: async () => { renders++; return first; } });
    expect(renders).toBe(0);
    expect(r.check).toBeUndefined();
    expect(r.spans).toEqual(spans);
    expect(r.warnings).toMatchObject([{ atSec: 2, rounds: 0, reason: "too_short", messageZh: "2.0 秒接点仍有跳变：亮度差 -40（允许 ±5），后段过短放不下局部过渡，未能修正" }]);
    expect(buildJunctionWarnings(spans, first)).toMatchObject([{ atSec: 2, rounds: 0, reason: "not_attempted" }]);
  });

  it("applyJunctionAutoMatch 不传上一轮状态时与单轮旧行为一致（首轮步长 = 公式限幅）", () => {
    const f = fakeFilm(40);
    const one = applyJunctionAutoMatch(f.orig, f.first.pairs, f.first);
    expect(one.junctions.map(n => n.action)).toEqual(["intended", "intended", "fixed", "fixed", "pass", "intended"]);
    expect(one.junctions[2].step).toEqual({ exposure: -0.25 });
    expect(one.junctions[3].step).toEqual({ exposure: 0.25 });
    expect(one.stepped).toEqual([3, 4]);
  });
});
