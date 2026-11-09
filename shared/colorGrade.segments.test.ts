import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyJunctionAutoMatch, buildFilterChain, buildSegmentGradeGraph, checkJunctionConsistency, concatGradeSchema, JUNCTION_FIX_LIMITS,
  junctionSampleTimes, junctionSampleWindows, meanSignalStats, parseSignalStats, planGradeSegments, SIGNALSTATS_FIRST_FRAME_FILTER, SIGNALSTATS_PRINT_FILTER, type GradeSpan,
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
    // 硬切之后的渐变两路先统一时基（concat 输出 AVTB，否则真实 ffmpeg 报 timebase 不一致）
    expect(graph).toContain("[gx2]settb=AVTB[gt3a];[gg3]settb=AVTB[gt3b];[gt3a][gt3b]xfade=transition=fade:duration=0.4:offset=5.8[o]");
  });

  it("接点取帧位置为接点前后 0.1 秒", () => {
    expect(junctionSampleTimes([{ startSec: 0, endSec: 1.5 }, { startSec: 1.5, endSec: 3 }, { startSec: 3, endSec: 4 }])).toEqual([
      { index: 0, junctionSec: 1.5, beforeSec: 1.4, afterSec: 1.6 },
      { index: 1, junctionSec: 3, beforeSec: 2.9, afterSec: 3.1 },
    ]);
  });

  const st = (y: number, sat = 20, u = 128, v = 128) => ({ ...parseSignalStats(""), YAVG: y, UAVG: u, VAVG: v, SATAVG: sat });

  it("接点均值取样：前窗止于渐变窗左沿、后窗起于右沿，各 0.5 秒 5 帧取中心；不跨渐变窗外的镜头切换", () => {
    const spans = [
      { startSec: 0, endSec: 6 }, { startSec: 6, endSec: 14.6, crossfadeSec: 1.2 },
      { startSec: 14.6, endSec: 29.6, crossfadeSec: 0.5 }, { startSec: 29.6, endSec: 43.6, crossfadeSec: 0.5 }, { startSec: 43.6, endSec: 44.4 },
    ];
    const w = junctionSampleWindows(spans, { cutsSec: [29, 29.6, 30] });
    expect(w).toHaveLength(4);
    expect(w[0]).toEqual({ index: 0, junctionSec: 6, crossfadeSec: 1.2,
      before: { fromSec: 4.9, toSec: 5.4, times: [4.95, 5.05, 5.15, 5.25, 5.35] },
      after: { fromSec: 6.6, toSec: 7.1, times: [6.65, 6.75, 6.85, 6.95, 7.05] } });
    // 29.6：渐变窗 [29.35, 29.85] 内的切点（29.6）不算；窗外 29.0 / 30.0 截断前后窗
    expect(w[2].before).toEqual({ fromSec: 29, toSec: 29.35, times: [29.035, 29.105, 29.175, 29.245, 29.315] });
    expect(w[2].after).toEqual({ fromSec: 29.85, toSec: 30, times: [29.865, 29.895, 29.925, 29.955, 29.985] });
    // 硬切接点、末段到片尾：后窗止于片尾前 0.04 秒
    expect(w[3].before.toSec).toBe(43.6);
    expect(w[3].after).toEqual({ fromSec: 43.6, toSec: 44.1, times: [43.65, 43.75, 43.85, 43.95, 44.05] });
    expect(meanSignalStats([st(100, 10), st(110, 20)])).toMatchObject({ YAVG: 105, SATAVG: 15, UAVG: 128 });
    // 旧单帧取点函数保留
    expect(junctionSampleTimes([{ startSec: 0, endSec: 1.5 }, { startSec: 1.5, endSec: 3 }])).toEqual([{ index: 0, junctionSec: 1.5, beforeSec: 1.4, afterSec: 1.6 }]);
  });

  it("autoMatch：intended 与未提供意图不修；unwanted 限步长、只在接点后插局部过渡子段，其余参数不变", () => {
    const B = { lutId: "x", exposure: 0.2, saturation: 1.1 };
    const spans: GradeSpan[] = [
      { startSec: 0, endSec: 4, correction: null },
      { startSec: 4, endSec: 10, correction: { color_temperature: 7000 }, crossfadeSec: 0.5, junctionIntent: "intended" },
      { startSec: 10, endSec: 20, correction: B, crossfadeSec: 0.5, junctionIntent: "unwanted" },
      { startSec: 20, endSec: 24, correction: { exposure: -0.4 }, crossfadeSec: 0.5 },
      { startSec: 24, endSec: 30, correction: null },
    ];
    // 每个接点都大幅跳亮度（全量匹配会要 ±0.75 档），色度也偏
    const pairs = [
      { index: 0, junctionSec: 4, before: st(100), after: st(70) },
      { index: 1, junctionSec: 10, before: st(100, 20, 128, 128), after: st(70, 20, 120, 136) },
      { index: 2, junctionSec: 20, before: st(100), after: st(70) },
      { index: 3, junctionSec: 24, before: st(100), after: st(101) },
    ];
    const report = checkJunctionConsistency(pairs);
    const r = applyJunctionAutoMatch(spans, pairs, report);
    expect(r.junctions.map(j => [j.index, j.action])).toEqual([[0, "intended"], [1, "fixed"], [2, "no_intent"], [3, "pass"]]);
    expect(r.junctions[2].noteZh).toBe("未提供意图，未修正");
    expect(r.adjusted).toEqual([2]);
    const fix = r.junctions[1];
    expect(Math.abs(fix.step!.exposure!)).toBeLessThanOrEqual(JUNCTION_FIX_LIMITS.exposure);
    expect(fix.step!.exposure).toBe(0.25);
    for (const z of Object.values(fix.step!.color_balance ?? {})) for (const v of Object.values(z!)) expect(Math.abs(v)).toBeLessThanOrEqual(JUNCTION_FIX_LIMITS.balance);
    expect(fix).toMatchObject({ rampFromSec: 10.25, rampToSec: 11.25 });
    // 原 span 2 拆为：过渡子段 [10, 10.75]（B'）+ 余段 [10.75, 20]（原参数，逐字不变），二者渐变 1.0 秒
    expect(r.spans).toHaveLength(6);
    expect(r.spans[2]).toMatchObject({ startSec: 10, endSec: 10.75, crossfadeSec: 0.5, rampOf: 1, correction: { lutId: "x", exposure: 0.45, saturation: 1.1 } });
    expect(r.spans[3]).toEqual({ startSec: 10.75, endSec: 20, correction: B, crossfadeSec: 1, rampOf: 1 });
    // 其余段（含 intended / 无意图的后段）参数与位置不变，入参不被改写
    expect(r.spans.filter(s => s.rampOf == null)).toEqual([spans[0], spans[1], spans[3], spans[4]]);
    expect(spans[2].correction).toEqual({ lutId: "x", exposure: 0.2, saturation: 1.1 });
    // 渲染：过渡子段 trim 到 渐变结束+1s，B' → B 渐变 offset = 后段渐变结束
    const graph = buildSegmentGradeGraph("v", "o", r.spans.map(s => ({ ...s, filter: s.correction ? buildFilterChain(s.correction, () => "/x.cube") : "" })));
    expect(graph).toContain("[gs2]trim=start=9.75:end=11.25,");
    expect(graph).toContain("[gs3]trim=start=10.25:end=20.25,");
    expect(graph).toContain("[gx1][gg2]xfade=transition=fade:duration=0.5:offset=9.75[gx2]");
    expect(graph).toContain("[gx2][gg3]xfade=transition=fade:duration=1:offset=10.25[gx3]");
  });

  it("autoMatch：后段过短放不下局部过渡则不修", () => {
    const spans: GradeSpan[] = [{ startSec: 0, endSec: 2, correction: null }, { startSec: 2, endSec: 2.4, correction: null, crossfadeSec: 0.4, junctionIntent: "unwanted" }, { startSec: 2.4, endSec: 4, correction: null, crossfadeSec: 0.4 }];
    const pairs = [{ index: 0, junctionSec: 2, before: st(100), after: st(60) }, { index: 1, junctionSec: 2.4, before: st(60), after: st(60) }];
    const r = applyJunctionAutoMatch(spans, pairs, checkJunctionConsistency(pairs));
    expect(r.junctions[0].action).toBe("too_short");
    expect(r.adjusted).toEqual([]);
    expect(r.spans).toEqual(spans);
  });

  it("默认（不传 autoMatchJunctions）：带 junctionIntent 的分段滤镜与改前（f84bf8b4）逐字一致", () => {
    const BASE = "[vcat]split=5[gs0][gs1][gs2][gs3][gs4];[gs0]trim=end=6.6,setpts=PTS-STARTPTS,curves=master='0/0 0.4665164957684037/0.5 1/1',eq=saturation=0.9,format=yuv420p[gg0];[gs1]trim=start=5.4:end=14.85,setpts=PTS-STARTPTS,eq=contrast=1.1,colortemperature=temperature=7200,format=yuv420p[gg1];[gs2]trim=start=14.35:end=29.85,setpts=PTS-STARTPTS,curves=master='0/0 0.5743491774985175/0.5 1/1',colorbalance=rm=0.02:gm=0:bm=-0.03,format=yuv420p[gg2];[gs3]trim=start=29.35:end=43.6,setpts=PTS-STARTPTS,curves=master='0/0 0.40612619817811774/0.5 1/1',eq=saturation=1.1,format=yuv420p[gg3];[gs4]trim=start=43.6,setpts=PTS-STARTPTS,curves=master='0/0 0.5358867312681466/0.5 1/1',format=yuv420p[gg4];[gg0][gg1]xfade=transition=fade:duration=1.2:offset=5.4[gx1];[gx1][gg2]xfade=transition=fade:duration=0.5:offset=14.35[gx2];[gx2][gg3]xfade=transition=fade:duration=0.5:offset=29.35[gx3];[gx3][gg4]concat=n=2:v=1:a=0[vo]";
    const grade = concatGradeSchema.parse({ crossfadeSec: 0.5, segments: [
      { startSec: 0, endSec: 6, exposure: 0.1, saturation: 0.9 },
      { startSec: 6, endSec: 14.6, crossfadeSec: 1.2, color_temperature: 7200, contrast: 1.1, junctionIntent: "unwanted" },
      { startSec: 14.6, endSec: 29.6, exposure: -0.2, color_balance: { midtones: { r: 0.02, g: 0, b: -0.03 } }, junctionIntent: "intended" },
      { startSec: 29.6, endSec: 43.6, exposure: 0.3, saturation: 1.1, junctionIntent: "unwanted" },
      { startSec: 43.6, endSec: 59.3, crossfadeSec: 0, exposure: -0.1 } ] });
    const spans = planGradeSegments(grade, 59.3);
    expect(spans.map(s => s.junctionIntent ?? null)).toEqual([null, "unwanted", "intended", "unwanted", null]);
    expect(spans.every(s => !s.correction || !("junctionIntent" in s.correction))).toBe(true);
    expect(buildSegmentGradeGraph("vcat", "vo", spans.map(s => ({ startSec: s.startSec, endSec: s.endSec, crossfadeSec: s.crossfadeSec ?? 0, filter: s.correction ? buildFilterChain(s.correction) : "" })))).toBe(BASE);
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

  it("autoMatch 一轮（段均值）：unwanted 接点局部修正、步长受限，过渡区外画面与修正前一致；intended 不动", () => {
    const src6 = path.join(dir, "bars6.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "smptebars=s=320x240:r=30:d=6", "-f", "lavfi", "-i", "sine=f=440:d=6", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", src6]);
    const run6 = (graph: string, out: string) => execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src6, "-filter_complex", graph, "-map", "[o]", "-map", "0:a", "-c:v", "libx264", "-crf", "18", "-c:a", "aac", out]);
    const graph = (sp: GradeSpan[]) => buildSegmentGradeGraph("0:v", "o", sp.map(s => ({ ...s, filter: s.correction ? buildFilterChain(s.correction) : "" })), 0);
    const mk = (intent: "intended" | "unwanted"): GradeSpan[] => [{ startSec: 0, endSec: 2, correction: { exposure: -0.3 } }, { startSec: 2, endSec: 6, correction: { exposure: 0.6 }, junctionIntent: intent }];
    const meanAt = (f: string, times: number[]) => meanSignalStats(times.map(t => sstats(f, t)));
    const pairOf = (f: string, sp: GradeSpan[]) => junctionSampleWindows(sp).map(w => ({ index: w.index, junctionSec: w.junctionSec, before: meanAt(f, w.before.times), after: meanAt(f, w.after.times) }));
    const spans = mk("unwanted");
    const p1 = path.join(dir, "u1.mp4"), p2 = path.join(dir, "u2.mp4");
    run6(graph(spans), p1);
    const first = pairOf(p1, spans), r1 = checkJunctionConsistency(first);
    expect(r1.pass).toBe(false);
    const m = applyJunctionAutoMatch(spans, first, r1);
    expect(m.junctions[0].action).toBe("fixed");
    expect(Math.abs(m.junctions[0].step!.exposure!)).toBeLessThanOrEqual(JUNCTION_FIX_LIMITS.exposure);
    run6(graph(m.spans), p2);
    const second = pairOf(p2, spans), r2 = checkJunctionConsistency(second);
    const tail1 = meanAt(p1, [4, 4.5, 5]), tail2 = meanAt(p2, [4, 4.5, 5]);
    console.log("[grade-automatch-local]", JSON.stringify({ before: r1.junctions[0].delta, after: r2.junctions[0].delta, step: m.junctions[0].step, ramp: [m.junctions[0].rampFromSec, m.junctions[0].rampToSec], tailY: [tail1.YAVG, tail2.YAVG] }));
    expect(Math.abs(r2.junctions[0].delta.YAVG)).toBeLessThan(Math.abs(r1.junctions[0].delta.YAVG));
    expect(Math.abs(tail2.YAVG - tail1.YAVG)).toBeLessThan(0.5);
    // intended：不修，spans 原样
    const intended = mk("intended");
    const mi = applyJunctionAutoMatch(intended, first, r1);
    expect(mi.adjusted).toEqual([]);
    expect(graph(mi.spans)).toBe(graph(intended));
  }, 90_000);
});
