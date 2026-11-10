/**
 * 真实 ffmpeg 小样：lavfi 生成两段亮度不同的片拼成一条（接点 3s），接点标 unwanted，
 * 走 matchJunctionsIteratively 真渲染、真取样，验证多轮收敛；压不住的大跳变给警告。不调任何模型、不联网。
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildFilterChain, buildSegmentGradeGraph, checkJunctionConsistency, GRADE_CONSISTENCY_TOLERANCE, JUNCTION_FIX_LIMITS, junctionSampleWindows,
  matchJunctionsIteratively, meanSignalStats, parseSignalStats, SIGNALSTATS_FIRST_FRAME_FILTER, type GradeSpan,
} from "./colorGrade";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();

describe.skipIf(!hasFfmpeg)("接点多轮修正（真实 ffmpeg，两段亮度不同的片）", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grade-rounds-"));
  /**
   * 同一画面前 3 秒原样、后 3 秒整体提亮 brightness，拼成 6 秒成片。
   * testsrc2 原样是满幅纯色（大量 0/255 像素，曝光曲线几乎推不动），先压对比与饱和成接近实拍的中间调画面。
   */
  const makeSrc = (name: string, brightness: number) => {
    const f = path.join(dir, name);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=3", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=3",
      "-filter_complex", `[0:v]eq=contrast=0.35,hue=s=0.3,format=yuv420p[a];[1:v]eq=contrast=0.35:brightness=${brightness},hue=s=0.3,format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[o]`,
      "-map", "[o]", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", f]);
    return f;
  };
  const sstats = (file: string, t: number) => parseSignalStats(spawnSync("ffmpeg", ["-nostdin", "-ss", String(t), "-i", file, "-vf", SIGNALSTATS_FIRST_FRAME_FILTER, "-frames:v", "1", "-f", "null", "-"]).stderr.toString());
  const spans: GradeSpan[] = [{ startSec: 0, endSec: 3, correction: null }, { startSec: 3, endSec: 6, correction: null, junctionIntent: "unwanted" }];
  const measure = (file: string) => {
    const pairs = junctionSampleWindows(spans, {}).map(w => ({ index: w.index, junctionSec: w.junctionSec, before: meanSignalStats(w.before.times.map(t => sstats(file, t))), after: meanSignalStats(w.after.times.map(t => sstats(file, t))) }));
    return { ...checkJunctionConsistency(pairs), pairs };
  };
  const runRounds = async (src: string, tag: string) => {
    const first = measure(src);
    let last = src;
    const r = await matchJunctionsIteratively({
      spans, first,
      render: async (next, round) => {
        last = path.join(dir, `${tag}-round${round}.mp4`);
        const graph = buildSegmentGradeGraph("0:v", "o", next.map(s => ({ ...s, filter: s.correction ? buildFilterChain(s.correction) : "" })), 0);
        execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-filter_complex", graph, "-map", "[o]", "-c:v", "libx264", "-crf", "16", last]);
        return measure(last);
      },
    });
    return { first, r, last };
  };

  it("中等跳变（1110 的 26.9s 量级）：多轮后达标，单轮步长不超限，过渡区之后画面不变", async () => {
    const src = makeSrc("mid.mp4", 0.115);
    const { first, r, last } = await runRounds(src, "mid");
    const trace = [first.junctions[0].delta.YAVG, ...r.rounds.map(x => x.check.junctions[0].delta.YAVG)];
    console.log("[grade-rounds-real] mid", JSON.stringify({ yavg: trace, sat: [first.junctions[0].delta.SATAVG, ...r.rounds.map(x => x.check.junctions[0].delta.SATAVG)], steps: r.rounds.map(x => x.junctions[0].step), warnings: r.warnings.map(w => w.messageZh) }));
    expect(Math.abs(first.junctions[0].delta.YAVG)).toBeGreaterThan(20);
    expect(r.rounds.length).toBeGreaterThanOrEqual(2);
    expect(r.check!.junctions[0].pass).toBe(true);
    expect(r.warnings).toEqual([]);
    for (let i = 1; i < trace.length; i++) expect(Math.abs(trace[i])).toBeLessThan(Math.abs(trace[i - 1])); // 单调收敛，不振荡
    for (const round of r.rounds) expect(Math.abs(round.junctions[0].step?.exposure ?? 0)).toBeLessThanOrEqual(JUNCTION_FIX_LIMITS.exposure);
    expect(Math.abs(sstats(last, 5).YAVG - sstats(src, 5).YAVG)).toBeLessThan(0.8); // 余段回到原参数
    expect(Math.abs(sstats(last, 1).YAVG - sstats(src, 1).YAVG)).toBeLessThan(0.8); // 前段不动
  }, 120_000);

  it("超大跳变：3 轮限步长压不住，给结构化警告而不是静默交付", async () => {
    const src = makeSrc("big.mp4", 0.4);
    const { first, r } = await runRounds(src, "big");
    console.log("[grade-rounds-real] big", JSON.stringify({ yavg: [first.junctions[0].delta.YAVG, ...r.rounds.map(x => x.check.junctions[0].delta.YAVG)], warnings: r.warnings }));
    expect(r.rounds).toHaveLength(3);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ atSec: 3, rounds: 3, reason: "max_rounds", intent: "unwanted" });
    const y = r.warnings[0].failing.find(f => f.key === "YAVG")!;
    expect(y.delta).toBe(r.check!.junctions[0].delta.YAVG);
    expect(Math.abs(y.delta)).toBeGreaterThan(GRADE_CONSISTENCY_TOLERANCE.YAVG);
    expect(Math.abs(y.delta)).toBeLessThan(Math.abs(first.junctions[0].delta.YAVG));
  }, 120_000);
});
