import { describe, expect, it } from "vitest";
import { markChantFrom, partitionShotsByLyricKind, planMvHighlightFades, suggestLyricLineKind } from "./canvasMusicMvLyricKinds";
import { singingWindowsFromLyricLines } from "./canvasMusicMvBeats";

describe("歌词句类型", () => {
  it("吟唱建议：重复短词、语气词、拖长音；真歌词保持 lyric", () => {
    expect(suggestLyricLineKind("姿势 姿势")).toBe("chant");
    expect(suggestLyricLineKind("上升上升上升")).toBe("chant");
    expect(suggestLyricLineKind("啊～啊～")).toBe("chant");
    expect(suggestLyricLineKind("oh oh oh")).toBe("chant");
    expect(suggestLyricLineKind("别哀怨或伤感")).toBe("lyric");
    expect(suggestLyricLineKind("预备的动作 接着是一般的一切")).toBe("lyric");
  });
  it("从 36.0 秒起全部吟唱：跨 36.0 的句子切开，前半歌词后半吟唱", () => {
    const out = markChantFrom([
      { text: "a", startSec: 30, endSec: 32.5 }, { text: "跨句", startSec: 32.9, endSec: 38.2 }, { text: "b", startSec: 40, endSec: 42 },
    ], 36);
    expect(out.map(l => [l.text, l.startSec, l.endSec, l.kind])).toEqual([
      ["a", 30, 32.5, "lyric"], ["跨句", 32.9, 36, "lyric"], ["跨句", 36, 38.2, "chant"], ["b", 40, 42, "chant"],
    ]);
  });
});

describe("按句类型给镜头分工", () => {
  const lines = markChantFrom([
    { text: "一", startSec: 18.4, endSec: 20.9 }, { text: "二", startSec: 21, endSec: 23.7 }, { text: "三", startSec: 23.8, endSec: 26.3 },
    { text: "四", startSec: 26.5, endSec: 28.8 }, { text: "五", startSec: 29, endSec: 31.9 }, { text: "六", startSec: 32.9, endSec: 38.2 }, { text: "姿势 姿势", startSec: 40, endSec: 43 },
  ], 36);
  const shots = [
    { id: "s2", startSec: 15, endSec: 30, kind: "generated" as const, referenceIndices: [] as number[] },
    { id: "s3", startSec: 30, endSec: 44, kind: "generated" as const, referenceIndices: [] as number[] },
    { id: "s4", startSec: 44, endSec: 58.5, kind: "generated" as const, referenceIndices: [] as number[] },
  ];
  it("真歌词镜 → 演唱；跨吟唱起点的镜在 36.0 切开；吟唱镜 → 素材填充", () => {
    const { shots: out } = partitionShotsByLyricKind(shots, lines, { startSec: 18.2, endSec: 77.5 });
    expect(out.map(s => [s.id, s.startSec, s.endSec, s.kind, Boolean((s as any).fillRequested)])).toEqual([
      ["s2", 15, 30, "singing", false], ["s3a", 30, 36, "singing", false], ["s3b", 36, 44, "generated", true], ["s4", 44, 58.5, "generated", true],
    ]);
    expect(out[1]!.referenceIndices).toEqual([0]);
  });
  it("演唱窗只取歌词句，吟唱句不对口型", () => {
    const w = (a: number, b: number) => ({ startSec: a, endSec: b, actionZh: "a", cameraZh: "c", lightingZh: "l", moodZh: "m", sfxZh: "s" });
    const out = singingWindowsFromLyricLines({ id: "s3a", startSec: 30, endSec: 36 }, [w(30, 33), w(33, 36)], lines);
    expect(out.filter(x => x.lipSync).map(x => x.lyricZh)).toEqual(["五", "六"]);
  });
});

describe("高光淡入淡出", () => {
  const grid = { beatSec: 60 / 129, phaseSec: 0.12 };
  it("淡出 2–3 秒且起点落在拍点；起点在句中才短淡入；用户值优先", () => {
    const f = planMvHighlightFades({ range: { startSec: 18.2, endSec: 77.5 }, beatGrid: grid, lines: [{ text: "x", startSec: 18, endSec: 20 }] });
    expect(f.fadeOutSec).toBeGreaterThanOrEqual(2);
    expect(f.fadeOutSec).toBeLessThanOrEqual(3);
    const k = (f.fadeOutStartSec - grid.phaseSec) / grid.beatSec;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(0.01);
    expect(f.fadeInSec).toBe(0.4);
    expect(planMvHighlightFades({ range: { startSec: 18.2, endSec: 77.5 }, lines: [{ text: "x", startSec: 18.4, endSec: 20 }] }).fadeInSec).toBe(0);
    expect(planMvHighlightFades({ range: { startSec: 0, endSec: 40 }, fadeOutSec: 4 }).fadeOutSec).toBe(4);
  });
});
