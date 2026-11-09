import { describe, expect, it } from "vitest";
import { beatsInRange, musicMvSingingPlacement, repairShotBeatWindows, singingWindowsFromLyricLines, snapShotCutsToBeats, snapSingingCutsToLyricLines } from "./canvasMusicMvBeats";
import { musicMvAdvisorInstructionsZh, musicMvHardConstraintsZh } from "./musicMvCraft";
import { musicMvShotSlices } from "./musicMvHighlight";
import { canvasMusicMvPlanSchema, mvShotNeedsStagingReference, musicMvPacingAt, musicMvLyricLineIssues, musicMvShotBeatIssues, type CanvasMusicMvPlan, type MusicMvShotBeat } from "./canvasMusicMv";
import { markChantFrom } from "./canvasMusicMvLyricKinds";
import { MV_SHOT_SCHEMA_MAX_SEC, mvShotPlanMaxSec } from "./canvasMusicMvReferences";
import { mvShotGenerateDurationSec } from "./canvasMusicMvShotPrompt";
import { normalizeShotDurations } from "./creativeProposalRepair";

const grid = { bpm: 129, beatSec: 60 / 129, phaseSec: 0.1, source: "creative_prompt" as const };
const w = (a: number, b: number, extra: Partial<MusicMvShotBeat> = {}): MusicMvShotBeat => ({ startSec: a, endSec: b, actionZh: "a", cameraZh: "c", lightingZh: "l", moodZh: "m", sfxZh: "s", ...extra });

describe("剪点吸附（节奏自适应）", () => {
  it("非演唱剪点吸附到最近拍点；与演唱镜/素材段相邻的剪点不动", () => {
    const shots = [
      { id: "a", startSec: 0, endSec: 5, kind: "generated" },
      { id: "b", startSec: 5, endSec: 10, kind: "generated" },
      { id: "c", startSec: 10, endSec: 15, kind: "singing" },
      { id: "d", startSec: 15, endSec: 20, kind: "footage" },
    ];
    const out = snapShotCutsToBeats(shots, grid);
    const beats = beatsInRange(grid, 4, 6);
    expect(beats).toContain(out.shots[1]!.startSec);
    expect(out.shots[0]!.endSec).toBe(out.shots[1]!.startSec);
    expect(out.shots[2]!.startSec).toBe(10);
    expect(out.shots[3]!.startSec).toBe(15);
  });
  it("phrase/free 段的剪点不吸附；覆盖字段优先", () => {
    const g = { ...grid, segments: [{ startSec: 0, endSec: 8, energy: 0.5, beatConfidence: 0.3, pacing: "phrase" as const }, { startSec: 8, endSec: 20, energy: 0.9, beatConfidence: 0.8, pacing: "beat" as const, pacingOverride: "free" as const }] };
    expect(musicMvPacingAt(g, 5)).toBe("phrase");
    expect(musicMvPacingAt(g, 9)).toBe("free");
    const out = snapShotCutsToBeats([{ id: "a", startSec: 0, endSec: 5 }, { id: "b", startSec: 5, endSec: 12 }, { id: "c", startSec: 12, endSec: 20 }], g);
    expect(out.fixes).toEqual([]);
  });
});

describe("窗界修复只动时间", () => {
  it("裁到镜头、无缝、吸附拍点、过短窗并入", () => {
    const shot = { id: "s", startSec: 10, endSec: 18, kind: "generated" };
    const out = repairShotBeatWindows(shot, [w(9, 12.4), w(12.6, 12.9), w(13, 18.5)], grid);
    expect(out.beats[0]!.startSec).toBe(10);
    expect(out.beats.at(-1)!.endSec).toBe(18);
    for (let i = 1; i < out.beats.length; i++) expect(out.beats[i]!.startSec).toBe(out.beats[i - 1]!.endSec);
    expect(out.beats.every(b => b.endSec - b.startSec >= 0.5)).toBe(true);
    expect(out.beats.map(b => b.actionZh).every(t => t === "a")).toBe(true);
  });
});

describe("演唱段：确认版歌词时间表即秒锁真源", () => {
  it("每句一窗、句间 ≥0.5 秒为过门窗、<0.5 秒并入换气；内容取重叠最多的顾问窗", () => {
    const shot = { id: "s", startSec: 60, endSec: 68 };
    const out = singingWindowsFromLyricLines(shot, [w(60, 64, { actionZh: "前" }), w(64, 68, { actionZh: "后" })], [
      { text: "第一句", startSec: 60.2, endSec: 62 }, { text: "第二句", startSec: 62.3, endSec: 64.5 }, { text: "第三句", startSec: 65.5, endSec: 67.9 },
    ]);
    expect(out.map(x => [x.startSec, x.endSec, x.lipSync, x.lyricZh ?? ""])).toEqual([
      [60, 62.2, true, "第一句"], [62.2, 64.5, true, "第二句"], [64.5, 65.5, false, ""], [65.5, 68, true, "第三句"],
    ]);
    expect(out[3]!.actionZh).toBe("后");
    expect(() => singingWindowsFromLyricLines(shot, [w(60, 68)], [])).toThrow(/先确认本段歌词/);
  });
  it("歌词时间表校验：顺序、重叠、越界", () => {
    expect(musicMvLyricLineIssues([{ text: "a", startSec: 141, endSec: 143 }, { text: "b", startSec: 142, endSec: 144 }], { startSec: 140, endSec: 185 })).toHaveLength(1);
    expect(musicMvLyricLineIssues([{ text: "a", startSec: 139, endSec: 141 }], { startSec: 140, endSec: 185 })[0]).toContain("超出");
  });
});

describe("演唱镜成片落位：按原歌绝对时间帧精确（≤1 帧）", () => {
  it("高光切边的演唱镜 trimIn=切入偏移，时间线起点 = 原歌秒 − 高光起点", () => {
    const plan = {
      version: 1, audioId: "a", audioDurationSec: 200, analysisBasis: "native_audio",
      shots: [
        { id: "g1", startSec: 0, endSec: 141.37, visualPrompt: "v", cameraPrompt: "c", lyricQuote: "", referenceIndices: [], kind: "generated" },
        { id: "s1", startSec: 141.37, endSec: 147.03, visualPrompt: "v", cameraPrompt: "c", lyricQuote: "", referenceIndices: [0], kind: "singing" },
        { id: "g2", startSec: 147.03, endSec: 160.5, visualPrompt: "v", cameraPrompt: "c", lyricQuote: "", referenceIndices: [], kind: "generated" },
        { id: "s2", startSec: 160.5, endSec: 200, visualPrompt: "v", cameraPrompt: "c", lyricQuote: "", referenceIndices: [0], kind: "singing" },
      ],
    } as CanvasMusicMvPlan;
    const range = { startSec: 140, endSec: 185 };
    const rows = musicMvShotSlices(plan, range);
    const placement = musicMvSingingPlacement(rows, range.startSec);
    expect(placement.map(p => p.shotId)).toEqual(["s1", "s2"]);
    for (const p of placement) expect(p.errorSec).toBeLessThanOrEqual(1 / 30 + 1e-9);
    const total = rows.reduce((s, r) => s + r.durationSec, 0);
    expect(Math.abs(total - 45)).toBeLessThanOrEqual(1 / 30);
  });
});

describe("站位参考阈值", () => {
  it("≥2 人、强动作、接触、≥2 机位或 ≥2 场景 → 必填", () => {
    const base = { people: 1, action: "light" as const, contact: false, cameraSetups: 1, scenes: 1 };
    expect(mvShotNeedsStagingReference(base)).toBe(false);
    expect(mvShotNeedsStagingReference(undefined)).toBe(false);
    expect(mvShotNeedsStagingReference({ ...base, people: 2 })).toBe(true);
    expect(mvShotNeedsStagingReference({ ...base, action: "strong" })).toBe(true);
    expect(mvShotNeedsStagingReference({ ...base, contact: true })).toBe(true);
    expect(mvShotNeedsStagingReference({ ...base, cameraSetups: 2 })).toBe(true);
    expect(mvShotNeedsStagingReference({ ...base, scenes: 2 })).toBe(true);
  });
});

import { recommendMusicMvHighlight } from "./musicMvHighlight";
describe("推荐高光：只取有歌词的部分", () => {
  const lines = [
    { text: "主歌一", startSec: 17.4, endSec: 20.5 }, { text: "主歌二", startSec: 20.75, endSec: 24.75 },
    { text: "主歌三", startSec: 25.85, endSec: 29.45 }, { text: "主歌四", startSec: 29.6, endSec: 33.15 },
    { text: "副歌一", startSec: 60, endSec: 63 }, { text: "副歌二", startSec: 63.2, endSec: 66 }, { text: "副歌三", startSec: 66.3, endSec: 69 },
    { text: "副歌四", startSec: 69.2, endSec: 72 }, { text: "副歌五", startSec: 72.4, endSec: 75 },
  ];
  const segments = [{ startSec: 0, endSec: 50, energy: 0.5 }, { startSec: 50, endSec: 100, energy: 1 }];
  it("30–60 秒窗内句数最多且含副歌；起止对齐乐句边界", () => {
    const r = recommendMusicMvHighlight(lines, 200, segments)!;
    expect(r.endSec - r.startSec).toBeGreaterThanOrEqual(30);
    expect(r.endSec - r.startSec).toBeLessThanOrEqual(60);
    expect(r.peakEnergy).toBe(1);
    // 对外 0.1 秒精度
    expect(Number.isInteger(Math.round(r.startSec * 1000) / 100)).toBe(true);
    expect(Number.isInteger(Math.round(r.endSec * 1000) / 100)).toBe(true);
    expect(r.startSec).toBeLessThanOrEqual(60);
    expect(r.endSec).toBeGreaterThanOrEqual(75);
    // 起点不切进前一句、终点不切进后一句
    for (const l of lines) expect(l.startSec < r.startSec && l.endSec > r.startSec).toBe(false);
    for (const l of lines) expect(l.startSec < r.endSec && l.endSec > r.endSec).toBe(false);
  });
  it("没有歌词句：不推荐", () => {
    expect(recommendMusicMvHighlight([], 200, segments)).toBeUndefined();
  });
});

describe("演唱分窗（1109 合并前必修）：引子/间奏单独成窗、窗不超上限、0.1 秒精度", () => {
  // 用户实例：65 BPM，高光 18.2–77.5 秒，36.0 秒后为吟唱
  const lines = markChantFrom([
    { text: "一", startSec: 18.4, endSec: 20.9 }, { text: "二", startSec: 21, endSec: 23.7 }, { text: "三", startSec: 24.15, endSec: 26.3 },
    { text: "四", startSec: 26.5, endSec: 28.8 }, { text: "五", startSec: 29, endSec: 31.9 }, { text: "六", startSec: 32.9, endSec: 38.2 }, { text: "姿势 姿势", startSec: 40, endSec: 43 },
  ], 36);
  const fmt = (out: MusicMvShotBeat[]) => out.map(x => [x.startSec, x.endSec, x.lyricZh ?? ""]);
  const tenths = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-6;
  it("引子（首句前纯音乐）单独成窗并按上限切分，不与首句并窗；镜头切在句首时唱句向引子借 ≤0.3 秒换气补足一窗", () => {
    const shot = { id: "s1", startSec: 4.6, endSec: 18.6, kind: "singing" as const };
    const out = singingWindowsFromLyricLines(shot, [w(4.6, 18.6)], lines);
    expect(fmt(out)).toEqual([[4.6, 9.1, ""], [9.1, 13.6, ""], [13.6, 18.1, ""], [18.1, 18.6, "一"]]);
    expect(out.every(x => x.endSec - x.startSec <= 6 + 1e-9)).toBe(true);
    expect(musicMvShotBeatIssues({ ...shot, beats: out })).toEqual([]);
    // 高光起点 18.2：0.2 秒引子作换气并入首句（≤0.3）
    const head = singingWindowsFromLyricLines({ id: "h", startSec: 18.2, endSec: 21 }, [w(18.2, 21)], lines);
    expect(fmt(head)).toEqual([[18.2, 21, "一"]]);
  });
  it("间奏不并进唱句窗：唱句窗只含唱句 + 前后 ≤0.3 秒换气，≥0.5 秒间奏单独成窗", () => {
    const shot = { id: "s2", startSec: 18.6, endSec: 36, kind: "singing" as const };
    const out = singingWindowsFromLyricLines(shot, [w(18.6, 27), w(27, 36)], lines);
    expect(fmt(out)).toEqual([
      [18.6, 21, "一"], [21, 23.9, "二"], [23.9, 26.4, "三"], [26.4, 28.9, "四"], [28.9, 31.9, "五"], [31.9, 32.9, ""], [32.9, 36, "六"],
    ]);
    for (const x of out.filter(x => x.lipSync)) {
      const l = lines.find(l => l.text === x.lyricZh && l.kind !== "chant")!;
      expect(Math.max(shot.startSec, l.startSec) - x.startSec).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(x.endSec - Math.min(shot.endSec, l.endSec)).toBeLessThanOrEqual(0.3 + 1e-9);
    }
    expect(out.find(x => x.startSec === 31.9)!.lipSync).toBe(false);
  });
  it("单窗上限取 min(逐窗上限, 所选模型单段上限, 显式上限)", () => {
    const shot = { id: "s1", startSec: 4.6, endSec: 18.6, kind: "singing" as const };
    const a = singingWindowsFromLyricLines(shot, [w(4.6, 18.6)], lines, { engine: "seedance-2.5" });
    expect(a.every(x => x.endSec - x.startSec <= 6 + 1e-9)).toBe(true);
    const b = singingWindowsFromLyricLines(shot, [w(4.6, 18.6)], lines, { engine: "seedance-2.0-mini", maxWindowSec: 3 });
    expect(b.filter(x => !x.lipSync)).toHaveLength(5);
    expect(b.every(x => x.endSec - x.startSec <= 3 + 1e-9)).toBe(true);
  });
  it("边界 0.1 秒精度：唱句窗向外取整到 0.1 秒（不切唱句），镜头内窗界全为一位小数", () => {
    const shot = { id: "p", startSec: 50, endSec: 60, kind: "singing" as const };
    const out = singingWindowsFromLyricLines(shot, [w(50, 60)], [
      { text: "甲", startSec: 50.73, endSec: 53.26 }, { text: "乙", startSec: 53.61, endSec: 55.02 }, { text: "丙", startSec: 56.18, endSec: 59.91 },
    ]);
    expect(fmt(out)).toEqual([[50, 50.7, ""], [50.7, 53.5, "甲"], [53.5, 55.1, "乙"], [55.1, 56.1, ""], [56.1, 60, "丙"]]);
    expect(out.every(x => tenths(x.startSec) && tenths(x.endSec))).toBe(true);
    expect(musicMvShotBeatIssues({ ...shot, beats: out })).toEqual([]);
  });
});

describe("MV 单镜时长按所选模型（不锁 15 秒，留随机短缺余量）", () => {
  it("规划上限 = 模型单段上限 − 1 秒余量；未知模型按 Mini", () => {
    expect(mvShotPlanMaxSec("seedance-2.5")).toBe(29);
    expect(mvShotPlanMaxSec("2.5")).toBe(29);
    expect(mvShotPlanMaxSec("wan-3.0")).toBe(29);
    expect(mvShotPlanMaxSec("seedance-2.0-mini")).toBe(14);
    expect(mvShotPlanMaxSec("minimax-h3")).toBe(14);
    expect(mvShotPlanMaxSec(undefined)).toBe(14);
    expect(mvShotPlanMaxSec("not-a-model")).toBe(14);
  });
  it("请求时长恒带余量且不超模型上限；超上限拦下", () => {
    expect(mvShotGenerateDurationSec("seedance-2.5", 29)).toBe(30);
    expect(mvShotGenerateDurationSec("seedance-2.5", 22.4)).toBe(24);
    expect(mvShotGenerateDurationSec("seedance-2.0-mini", 14)).toBe(15);
    expect(() => mvShotGenerateDurationSec("seedance-2.0-mini", 20)).toThrow(/单段上限 15 秒/);
  });
  it("顾问确定性拆镜按模型上限：2.5 下 25 秒镜不拆，Mini 下拆", () => {
    const plan = (len: number) => ({ concepts: [{ plan: { shots: [{ id: "a", startSec: 0, endSec: len }] } }] });
    const shots = (v: unknown) => (v as { concepts: Array<{ plan: { shots: unknown[] } }> }).concepts[0]!.plan.shots;
    expect(shots(normalizeShotDurations(plan(25), mvShotPlanMaxSec("seedance-2.5")).value)).toHaveLength(1);
    expect(shots(normalizeShotDurations(plan(25), mvShotPlanMaxSec("seedance-2.0-mini")).value)).toHaveLength(2);
  });
  it("方案落库上限为引擎表最大单段秒数（25 秒镜可存，旧 15 秒方案仍可读）", () => {
    expect(MV_SHOT_SCHEMA_MAX_SEC).toBe(30);
    const mk = (len: number) => ({ version: 1, audioId: "a", audioDurationSec: len, analysisBasis: "native_audio", shots: [{ id: "g", startSec: 0, endSec: len, visualPrompt: "v", cameraPrompt: "c", lyricQuote: "", referenceIndices: [], kind: "generated" }] });
    expect(canvasMusicMvPlanSchema.safeParse(mk(25)).success).toBe(true);
    expect(canvasMusicMvPlanSchema.safeParse(mk(15)).success).toBe(true);
    expect(canvasMusicMvPlanSchema.safeParse(mk(31)).success).toBe(false);
  });
});

describe("镜长与节拍/唱句对齐（1109 补完）", () => {
  const g1 = { bpm: 60, beatSec: 1, phaseSec: 0, source: "creative_prompt" as const };
  it("拍点吸附不得把镜头撑过所选模型单镜上限", () => {
    const shots = [{ id: "a", startSec: 0, endSec: 13.6, kind: "generated" }, { id: "b", startSec: 13.6, endSec: 20, kind: "generated" }];
    expect(snapShotCutsToBeats(shots, g1).shots[0]!.endSec).toBe(14);
    const capped = snapShotCutsToBeats(shots, g1, 0.5, 13.8);
    expect(capped.shots[0]!.endSec).toBe(13.6);
    expect(capped.fixes).toEqual([]);
    // 缩短方向不受限
    const shrink = snapShotCutsToBeats([{ id: "a", startSec: 0, endSec: 6.3, kind: "generated" }, { id: "b", startSec: 6.3, endSec: 20, kind: "generated" }], g1, 0.5, 14);
    expect(shrink.shots[1]!.startSec).toBe(6);
  });

  const lines = [
    { text: "第一句", startSec: 0.5, endSec: 3.2 },
    { text: "第二句", startSec: 3.8, endSec: 7.5 },
    { text: "第三句", startSec: 8.1, endSec: 11 },
  ];
  it("切在唱句中间的演唱镜剪点移到最近句间，两镜分窗都不切句", () => {
    const shots = [
      { id: "s1", startSec: 0, endSec: 6, kind: "singing", beats: [w(0, 3), w(3, 6)] },
      { id: "s2", startSec: 6, endSec: 12, kind: "singing", beats: [w(6, 9), w(9, 12)] },
    ];
    const out = snapSingingCutsToLyricLines(shots, lines, { maxShotSec: 14 });
    expect(out.shots[0]!.endSec).toBe(7.8);
    expect(out.shots[1]!.startSec).toBe(7.8);
    expect(out.fixes).toEqual([expect.objectContaining({ shotId: "s2", action: "lyric_cut", before: 6, after: 7.8 })]);
    expect(musicMvShotBeatIssues(out.shots[0]!)).toEqual([]);
    expect(musicMvShotBeatIssues(out.shots[1]!)).toEqual([]);
    const sung = out.shots.flatMap(s => singingWindowsFromLyricLines(s, s.beats!, lines).filter(x => x.lipSync));
    expect(sung.map(x => [x.lyricZh, x.startSec <= lines.find(l => l.text === x.lyricZh)!.startSec, x.endSec >= lines.find(l => l.text === x.lyricZh)!.endSec])).toEqual([
      ["第一句", true, true], ["第二句", true, true], ["第三句", true, true],
    ]);
    // 原数组不变
    expect(shots[0]!.endSec).toBe(6);
  });
  it("剪点已在句间、或两侧都不是演唱镜时不动；吟唱句不算唱句", () => {
    const between = [{ id: "a", startSec: 0, endSec: 3.5, kind: "singing" }, { id: "b", startSec: 3.5, endSec: 12, kind: "singing" }];
    expect(snapSingingCutsToLyricLines(between, lines).fixes).toEqual([]);
    const gen = [{ id: "a", startSec: 0, endSec: 6, kind: "generated" }, { id: "b", startSec: 6, endSec: 12, kind: "generated" }];
    expect(snapSingingCutsToLyricLines(gen, lines).fixes).toEqual([]);
    const chant = lines.map(l => (l.text === "第二句" ? { ...l, kind: "chant" } : l));
    expect(snapSingingCutsToLyricLines([{ id: "a", startSec: 0, endSec: 6, kind: "singing" }, { id: "b", startSec: 6, endSec: 12, kind: "generated" }], chant).fixes).toEqual([]);
  });
  it("移动会越界（演唱镜 <4 秒 / 超单镜上限）或邻接素材切片时保留剪点并记 unresolved", () => {
    const tight = [
      { text: "甲", startSec: 0.5, endSec: 3.6 },
      { text: "乙", startSec: 3.9, endSec: 5 },
      { text: "丙", startSec: 5.3, endSec: 8 },
    ];
    const short = snapSingingCutsToLyricLines([{ id: "a", startSec: 0, endSec: 4.4, kind: "singing" }, { id: "b", startSec: 4.4, endSec: 8.4, kind: "singing" }], tight);
    expect(short.shots[1]!.startSec).toBe(4.4);
    expect(short.fixes).toEqual([expect.objectContaining({ action: "lyric_cut_unresolved", before: 4.4 })]);
    // 往后移会让前镜 7.8 秒 > max(6, 7)；往前移会让后镜 8.5 秒 > max(6, 7)
    const capped = snapSingingCutsToLyricLines([{ id: "a", startSec: 0, endSec: 6, kind: "singing" }, { id: "b", startSec: 6, endSec: 12, kind: "singing" }], lines, { maxShotSec: 7 });
    expect(capped.shots[0]!.endSec).toBe(6);
    expect(capped.fixes[0]!.action).toBe("lyric_cut_unresolved");
    const footage = snapSingingCutsToLyricLines([{ id: "a", startSec: 0, endSec: 6, kind: "singing" }, { id: "b", startSec: 6, endSec: 12, kind: "footage" }], lines);
    expect(footage.shots[1]!.startSec).toBe(6);
    expect(footage.fixes[0]!.action).toBe("lyric_cut_unresolved");
  });
  it("剪点移动后相邻非演唱镜逐窗节拍：仍合规则裁齐，超窗上限则清空待重补", () => {
    const kept = snapSingingCutsToLyricLines([{ id: "g", startSec: 0, endSec: 6, kind: "generated", beats: [w(0, 3), w(3, 6)] }, { id: "s", startSec: 6, endSec: 12, kind: "singing" }], lines);
    expect(kept.shots[0]!.beats!.map(x => [x.startSec, x.endSec])).toEqual([[0, 3], [3, 7.8]]);
    const cleared = snapSingingCutsToLyricLines([{ id: "g", startSec: 0, endSec: 6, kind: "generated", beats: [w(0, 1), w(1, 6)] }, { id: "s", startSec: 6, endSec: 12, kind: "singing" }], lines);
    expect(cleared.shots[0]!.endSec).toBe(7.8);
    expect(cleared.shots[0]!.beats).toBeUndefined();
    expect(cleared.fixes[0]!.reasonZh).toContain("待重补");
  });
  it("顾问提示词的单镜上限按所选模型，不写死 15 秒", () => {
    const mini = musicMvAdvisorInstructionsZh(mvShotPlanMaxSec("seedance-2.0-mini"));
    const s25 = musicMvAdvisorInstructionsZh(mvShotPlanMaxSec("seedance-2.5"));
    expect(mini).toContain("每镜0.5至14秒");
    expect(mini).toContain("0.5 到 14 秒之间");
    expect(s25).toContain("每镜0.5至29秒");
    expect(s25).toContain("任何超过 29 秒的镜头必须拆成");
    expect(s25).not.toMatch(/至15秒|到 15 秒|超过 15 秒/);
    expect(musicMvHardConstraintsZh("refine", 29)).toContain("0.5 到 29 秒之间");
    expect(musicMvHardConstraintsZh("refine", 29)).toContain("照抄输入 candidate.sections");
    expect(() => musicMvAdvisorInstructionsZh(0)).toThrow(/无效/);
  });
});
