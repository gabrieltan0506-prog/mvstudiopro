import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyJunctionAutoMatch, buildFilterChain, buildSegmentGradeGraph, checkJunctionConsistency, concatGradeSchema,
  junctionSampleTimes, parseSignalStats, planGradeSegments, SIGNALSTATS_FIRST_FRAME_FILTER, SIGNALSTATS_PRINT_FILTER, type GradeSpan,
} from "./colorGrade";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();

describe("分段调色（纯函数）", () => {
  it("planGradeSegments 补齐头尾空档并合并 all", () => {
    const g = concatGradeSchema.parse({ all: { contrast: 1.1 }, segments: [{ startSec: 1, endSec: 2, saturation: 0.5 }] });
    expect(planGradeSegments(g, 4)).toEqual([
      { startSec: 0, endSec: 1, correction: { contrast: 1.1 } },
      { startSec: 1, endSec: 2, correction: { contrast: 1.1, saturation: 0.5 } },
      { startSec: 2, endSec: 4, correction: { contrast: 1.1 } },
    ]);
    expect(() => planGradeSegments(concatGradeSchema.parse({ segments: [{ startSec: 0, endSec: 5 }] }), 4)).toThrow("超出成片时长");
    expect(() => planGradeSegments(concatGradeSchema.parse({ segments: [{ startSec: 0, endSec: 0.2 }, { startSec: 0.2, endSec: 4 }], crossfadeSec: 0.5 }), 4)).toThrow("长于渐变时长");
  });

  it("硬切滤镜串：split → 各段 trim+滤镜 → concat", () => {
    expect(buildSegmentGradeGraph("vin", "vout", [{ startSec: 0, endSec: 1.5, filter: "eq=saturation=0.5" }, { startSec: 1.5, endSec: 3, filter: "" }])).toBe(
      "[vin]split=2[gs0][gs1];[gs0]trim=end=1.5,setpts=PTS-STARTPTS,eq=saturation=0.5,format=yuv420p[gg0];" +
      "[gs1]trim=start=1.5,setpts=PTS-STARTPTS,format=yuv420p[gg1];[gg0][gg1]concat=n=2:v=1:a=0[vout]",
    );
  });

  it("crossfade：接点两侧各多取一半，xfade offset = 接点 − 一半", () => {
    const g = buildSegmentGradeGraph("v", "o", [{ startSec: 0, endSec: 2, filter: "a" }, { startSec: 2, endSec: 4, filter: "b" }, { startSec: 4, endSec: 6, filter: "c" }], 1);
    expect(g).toContain("[gs0]trim=end=2.5,");
    expect(g).toContain("[gs1]trim=start=1.5:end=4.5,");
    expect(g).toContain("[gs2]trim=start=3.5,");
    expect(g).toContain("[gg0][gg1]xfade=transition=fade:duration=1:offset=1.5[gx1]");
    expect(g).toContain("[gx1][gg2]xfade=transition=fade:duration=1:offset=3.5[o]");
  });

  it("逐段 crossfadeSec：每个接点各自渐变或硬切，时长守恒", () => {
    const g = concatGradeSchema.parse({ crossfadeSec: 0.4, segments: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 4, crossfadeSec: 1 }, { startSec: 4, endSec: 6, crossfadeSec: 0 }] });
    const spans = planGradeSegments(g, 8);
    expect(spans.map(s => s.crossfadeSec ?? 0)).toEqual([0, 1, 0, 0.4]);
    const graph = buildSegmentGradeGraph("v", "o", spans.map(s => ({ ...s, filter: "" })));
    expect(graph).toContain("[gs0]trim=end=2.5,");
    expect(graph).toContain("[gs1]trim=start=1.5:end=4,");
    expect(graph).toContain("[gs2]trim=start=4:end=6.2,");
    expect(graph).toContain("[gs3]trim=start=5.8,");
    expect(graph).toContain("[gg0][gg1]xfade=transition=fade:duration=1:offset=1.5[gx1]");
    expect(graph).toContain("[gx1][gg2]concat=n=2:v=1:a=0[gx2]");
    expect(graph).toContain("[gx2][gg3]xfade=transition=fade:duration=0.4:offset=5.8[o]");
  });

  it("接点取帧位置为接点前后 0.1 秒", () => {
    expect(junctionSampleTimes([{ startSec: 0, endSec: 1.5 }, { startSec: 1.5, endSec: 3 }, { startSec: 3, endSec: 4 }])).toEqual([
      { index: 0, junctionSec: 1.5, beforeSec: 1.4, afterSec: 1.6 },
      { index: 1, junctionSec: 3, beforeSec: 2.9, afterSec: 3.1 },
    ]);
  });

  it("autoMatch 只改未达标接点的后段，在原参数上叠加", () => {
    const s = (y: number, sat = 20) => ({ ...parseSignalStats(""), YAVG: y, UAVG: 128, VAVG: 128, SATAVG: sat });
    const spans: GradeSpan[] = [{ startSec: 0, endSec: 1, correction: null }, { startSec: 1, endSec: 2, correction: { lutId: "x", exposure: 0.2 } }, { startSec: 2, endSec: 3, correction: null }];
    const pairs = [{ index: 0, junctionSec: 1, before: s(100), after: s(80) }, { index: 1, junctionSec: 2, before: s(80), after: s(81) }];
    const report = checkJunctionConsistency(pairs);
    expect(report.junctions.map(j => j.pass)).toEqual([false, true]);
    const r = applyJunctionAutoMatch(spans, pairs, report);
    expect(r.adjusted).toEqual([1]);
    expect(r.spans[1].correction).toEqual({ lutId: "x", exposure: 0.7 });
    expect(r.spans[2].correction).toBeNull();
    expect(spans[1].correction).toEqual({ lutId: "x", exposure: 0.2 });
  });
});

describe.skipIf(!hasFfmpeg)("分段调色（真实 ffmpeg，合成色条）", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grade-seg-"));
  const src = path.join(dir, "bars.mp4");
  const run = (graph: string, out: string) => {
    const r = execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-filter_complex", graph, "-map", "[o]", "-map", "0:a", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", out]);
    return r;
  };
  const probe = (f: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,nb_frames", "-of", "json", f]).toString());
  const sstats = (file: string, t: number) => {
    const res = spawnSync("ffmpeg", ["-nostdin", "-ss", String(t), "-i", file, "-vf", SIGNALSTATS_FIRST_FRAME_FILTER, "-frames:v", "1", "-f", "null", "-"]);
    return parseSignalStats(res.stderr.toString());
  };

  it("硬切 / 渐变：时长与帧数不变、接点两侧确实不同、渐变中点居中", () => {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "smptebars=s=320x240:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", src]);
    const spans = [{ startSec: 0, endSec: 2, filter: buildFilterChain({ exposure: -0.8 }) }, { startSec: 2, endSec: 4, filter: buildFilterChain({ exposure: 0.8 }) }];
    const hard = path.join(dir, "hard.mp4"), soft = path.join(dir, "soft.mp4");
    run(buildSegmentGradeGraph("0:v", "o", spans, 0), hard);
    run(buildSegmentGradeGraph("0:v", "o", spans, 1), soft);
    const pIn = probe(src), pH = probe(hard), pS = probe(soft);
    const frames = (p: any) => Number(p.streams.find((s: any) => s.codec_type === "video").nb_frames);
    expect(frames(pH)).toBe(frames(pIn));
    expect(frames(pS)).toBe(frames(pIn));
    expect(Math.abs(Number(pS.format.duration) - Number(pIn.format.duration))).toBeLessThan(0.05);
    const [hB, hA] = junctionSampleTimes(spans).flatMap(j => [sstats(hard, j.beforeSec), sstats(hard, j.afterSec)]);
    const hardReport = checkJunctionConsistency([{ index: 0, junctionSec: 2, before: hB, after: hA }]);
    expect(hardReport.pass).toBe(false);
    const sB = sstats(soft, 1.9), sA = sstats(soft, 2.1), s0 = sstats(soft, 1.0), s3 = sstats(soft, 3.0);
    // 渐变区内亮度单调介于两端之间，且接点前后差远小于硬切
    expect(s0.YAVG).toBeLessThan(sB.YAVG);
    expect(sB.YAVG).toBeLessThan(sA.YAVG);
    expect(sA.YAVG).toBeLessThan(s3.YAVG);
    expect(Math.abs(sA.YAVG - sB.YAVG)).toBeLessThan(Math.abs(hA.YAVG - hB.YAVG) / 3);
    console.log("[grade-seg]", JSON.stringify({ hard: { before: hB.YAVG, after: hA.YAVG, delta: hardReport.junctions[0].delta }, soft: { at1: s0.YAVG, before: sB.YAVG, after: sA.YAVG, at3: s3.YAVG }, frames: frames(pIn), dur: [pIn.format.duration, pH.format.duration, pS.format.duration] }));
  }, 60_000);

  it("autoMatch 一轮：接点修正后复检 YAVG 差收敛", () => {
    const spans: GradeSpan[] = [{ startSec: 0, endSec: 2, correction: { exposure: -0.3 } }, { startSec: 2, endSec: 4, correction: { exposure: 0.4 } }];
    const graph = (sp: GradeSpan[]) => buildSegmentGradeGraph("0:v", "o", sp.map(s => ({ ...s, filter: s.correction ? buildFilterChain(s.correction) : "" })), 0);
    const p1 = path.join(dir, "p1.mp4"), p2 = path.join(dir, "p2.mp4");
    run(graph(spans), p1);
    const pair = (f: string) => ({ index: 0, junctionSec: 2, before: sstats(f, 1.9), after: sstats(f, 2.1) });
    const first = [pair(p1)], r1 = checkJunctionConsistency(first);
    expect(r1.pass).toBe(false);
    const m = applyJunctionAutoMatch(spans, first, r1);
    run(graph(m.spans), p2);
    const r2 = checkJunctionConsistency([pair(p2)]);
    console.log("[grade-automatch]", JSON.stringify({ before: r1.junctions[0].delta, after: r2.junctions[0].delta, corr: m.spans[1].correction }));
    expect(Math.abs(r2.junctions[0].delta.YAVG)).toBeLessThan(Math.abs(r1.junctions[0].delta.YAVG));
  }, 60_000);
});
