import { describe, expect, it } from "vitest";
import { beatsInRange, musicMvSingingPlacement, repairShotBeatWindows, singingWindowsFromLyricLines, snapShotCutsToBeats } from "./canvasMusicMvBeats";
import { musicMvShotSlices } from "./musicMvHighlight";
import { mvShotNeedsStagingReference, musicMvPacingAt, musicMvLyricLineIssues, type CanvasMusicMvPlan, type MusicMvShotBeat } from "./canvasMusicMv";

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
      [60, 62.3, true, "第一句"], [62.3, 64.5, true, "第二句"], [64.5, 65.5, false, ""], [65.5, 68, true, "第三句"],
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
