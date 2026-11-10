import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeFile } from "node:fs/promises";
const h = vi.hoisted(() => ({ calls: [] as string[][], uploads: [] as string[], yavg: [] as number[] }));
vi.mock("./gcs.js", () => ({
  signGsUriV4ReadUrl: () => "https://example.test/source.mp4",
  uploadStreamToGcs: async ({ objectName, stream }: any) => {
    await new Response(stream).arrayBuffer();
    return { bucket: "test", objectName, gcsUri: `gs://test/${objectName}` };
  },
  uploadBufferToGcs: async ({ objectName }: any) => { h.uploads.push(objectName); return { gcsUri: `gs://test/${objectName}` }; },
}));
vi.mock("./runChildUntilClosed", () => ({
  runChildUntilClosed: async (command: string, args: string[]) => {
    if (command === "ffprobe")
      return { stdout: JSON.stringify({ format: { duration: "2" }, streams: [{ codec_type: "video", width: 320, height: 240 }, { codec_type: "audio" }] }), stderr: "" };
    h.calls.push(args);
    if (args.includes("-filter_complex")) { await writeFile(args.at(-1)!, Buffer.from("test-output-media")); return { stdout: "", stderr: "" }; }
    const y = h.yavg.shift() ?? 100;
    return { stdout: "", stderr: `lavfi.signalstats.YAVG=${y}\nlavfi.signalstats.UAVG=128\nlavfi.signalstats.VAVG=128\nlavfi.signalstats.SATAVG=10\n` };
  },
}));
import { concatClips, resolveGradeLutPaths } from "./postProduction";
import { buildFilterChain, SIGNALSTATS_FIRST_FRAME_FILTER } from "../../shared/colorGrade";
import { concatParamsSchema } from "../jobs/postProdInput";

const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1];
const base = { clips: ["gs://test/a.mp4", "gs://test/b.mp4"], width: 320, height: 240, fps: 30 };
/** e55d2a81 concatClips 在同一输入下的 filter_complex（逐字，经旧树实跑取得）。 */
const GOLDEN_E55 =
  "[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS,scale=w=320:h=240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v0];" +
  "[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=start=0:end=2,asetpts=PTS-STARTPTS,atrim=0:2.000,asetpts=PTS-STARTPTS[a0];" +
  "[1:v]trim=start=0:end=2,setpts=PTS-STARTPTS,scale=w=320:h=240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v1];" +
  "[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=start=0:end=2,asetpts=PTS-STARTPTS,atrim=0:2.000,asetpts=PTS-STARTPTS[a1];" +
  "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vo][ao]";

describe("concat 调色（服务端）", () => {
  beforeEach(() => { h.calls.length = 0; h.uploads.length = 0; h.yavg.length = 0; vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3]))); });

  it("不传 grade 时整条参数与 e55d2a81 逐字一致", async () => {
    const out = await concatClips(base, "7");
    expect(h.calls).toHaveLength(1);
    expect(graphOf(h.calls[0])).toBe(GOLDEN_E55);
    expect(out).not.toHaveProperty("gradeCheck");
    expect(out).not.toHaveProperty("gradeSegmentCheck");
  });

  it("真实 manifest lutId 解析为白名单 .cube；非白名单拒绝", async () => {
    const m = await resolveGradeLutPaths(["basic_cool"]);
    expect(m.get("basic_cool")).toMatch(/server\/assets\/luts\/basic_cool\.cube$/);
    await expect(resolveGradeLutPaths(["not_in_manifest"])).rejects.toThrow("调色预设不存在");
    await expect(resolveGradeLutPaths(["../etc/passwd"])).rejects.toThrow("调色预设编号不正确");
  });

  it("clips+referenceClipIndex：旧逻辑每段 1 秒取帧，原始与解析分别留档", async () => {
    const out = await concatClips({ ...base, grade: { clips: [{ saturation: 1.1 }, null], referenceClipIndex: 0 } }, "7");
    expect(out.gradeCheck?.evidence.map(e => e.atSec)).toEqual([1, 3]);
    expect(h.uploads.filter(u => u.includes("/grade-evidence/")).map(u => u.split("/").pop())).toEqual([
      "clip-0.signalstats.raw.txt", "clip-0.signalstats.parsed.json", "clip-1.signalstats.raw.txt", "clip-1.signalstats.parsed.json",
    ]);
  });

  it("segments：成片尾部接分段子图，接点前后各 0.5s 均匀 5 帧取均值并按窗留档", async () => {
    const out = await concatClips({ ...base, grade: { segments: [{ startSec: 0, endSec: 2, exposure: 0.5 }, { startSec: 2, endSec: 4, saturation: 0.8 }] } }, "7");
    const g = graphOf(h.calls[0]);
    expect(g).toContain("concat=n=2:v=1:a=1[vcat][ao];[vcat]split=2[gs0][gs1];");
    expect(g).toContain("[gg0][gg1]concat=n=2:v=1:a=0[vo]");
    // 逐段 vChain 不再插调色（分段在成片上做）
    expect(g).not.toMatch(/fps=30,curves/);
    const seek = h.calls.slice(1).map(a => a[a.indexOf("-ss") + 1]);
    expect(seek).toEqual(["1.55", "1.65", "1.75", "1.85", "1.95", "2.05", "2.15", "2.25", "2.35", "2.45"]);
    expect(h.calls.slice(1).every(a => a.includes(SIGNALSTATS_FIRST_FRAME_FILTER))).toBe(true);
    expect(out.gradeSegmentCheck?.check.junctions).toHaveLength(1);
    expect(h.uploads.filter(u => u.includes("/grade-evidence/")).map(u => u.split("/").slice(-2).join("/"))).toEqual([
      "pass-1/junction-0.before.signalstats.raw.txt", "pass-1/junction-0.before.signalstats.parsed.json",
      "pass-1/junction-0.after.signalstats.raw.txt", "pass-1/junction-0.after.signalstats.parsed.json",
    ]);
    expect(out.gradeSegmentCheck?.autoMatch).toBeUndefined();
  });

  it("autoMatchJunctions：unwanted 接点限步长局部修正后重渲 1 次，复检按原接点位置；余段参数不变", async () => {
    h.yavg.push(...Array(5).fill(120), ...Array(5).fill(80), ...Array(5).fill(120), ...Array(5).fill(118));
    const out = await concatClips({ ...base, grade: { segments: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 4, saturation: 0.9, junctionIntent: "unwanted" }], crossfadeSec: 0.4, autoMatchJunctions: true } }, "7");
    const renders = h.calls.filter(a => a.includes("-filter_complex"));
    expect(renders).toHaveLength(2);
    expect(graphOf(renders[0])).toContain("xfade=transition=fade:duration=0.4:offset=1.8[vo]");
    const r = out.gradeSegmentCheck!;
    expect(r.check.pass).toBe(false);
    expect(r.autoMatch?.adjusted).toEqual([1]);
    expect(r.autoMatch?.junctions[0]).toMatchObject({ action: "fixed", intent: "unwanted", step: { exposure: 0.25 }, rampFromSec: 2.2, rampToSec: 3.2 });
    expect(r.autoMatch?.spans.map(s => [s.startSec, s.endSec, s.correction])).toEqual([[0, 2, null], [2, 2.7, { saturation: 0.9, exposure: 0.25 }], [2.7, 4, { saturation: 0.9 }]]);
    const g2 = graphOf(renders[1]);
    expect(g2).toContain(`[gs1]trim=start=1.8:end=3.2,setpts=PTS-STARTPTS,${buildFilterChain({ saturation: 0.9, exposure: 0.25 })},`);
    expect(g2).toContain("[gs2]trim=start=2.2,setpts=PTS-STARTPTS,eq=saturation=0.9,format=yuv420p[gg2]");
    expect(g2).toContain("[gx1][gg2]xfade=transition=fade:duration=1:offset=2.2[vo]");
    // 复检：仍是原来 1 个接点、同一组取样位置
    const seeks = h.calls.filter(a => !a.includes("-filter_complex")).map(a => a[a.indexOf("-ss") + 1]);
    expect(seeks.slice(10)).toEqual(seeks.slice(0, 10));
    expect(r.autoMatch?.check?.junctions).toHaveLength(1);
    expect(r.autoMatch?.check?.pass).toBe(true);
  });

  it("autoMatchJunctions 多轮：未达标按实测差继续重渲，最多 3 轮；逐轮留档；仍未达标给结构化警告", async () => {
    const seg = { segments: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 4, junctionIntent: "unwanted" as const }], autoMatchJunctions: true };
    const five = (before: number, after: number) => [...Array(5).fill(before), ...Array(5).fill(after)];
    // 第 3 轮才达标：首检 + 3 轮复检，共 4 次渲染
    h.yavg.push(...five(120, 80), ...five(120, 95), ...five(120, 108), ...five(120, 118));
    const ok = (await concatClips({ ...base, grade: seg }, "7")).gradeSegmentCheck!;
    expect(h.calls.filter(a => a.includes("-filter_complex"))).toHaveLength(4);
    expect(ok.autoMatch?.rounds.map(r => [r.round, r.check.pass])).toEqual([[1, false], [2, false], [3, true]]);
    expect(ok.autoMatch?.check?.pass).toBe(true);
    expect(ok.autoMatch?.maxRounds).toBe(3);
    expect(ok.warnings).toEqual([]);
    expect(Array.from(new Set(h.uploads.filter(u => u.includes("/grade-evidence/")).map(u => u.split("/").at(-2))))).toEqual(["pass-1", "pass-2", "pass-3", "pass-4"]);
    // 始终压不住：满 3 轮即停（不再渲第 5 次），警告写明秒位、差值、轮数
    h.calls.length = 0; h.uploads.length = 0; h.yavg.length = 0;
    h.yavg.push(...five(120, 60), ...five(120, 70), ...five(120, 80), ...five(120, 90));
    const bad = (await concatClips({ ...base, grade: seg }, "7")).gradeSegmentCheck!;
    expect(h.calls.filter(a => a.includes("-filter_complex"))).toHaveLength(4);
    expect(bad.autoMatch?.rounds).toHaveLength(3);
    expect(bad.warnings).toMatchObject([{
      index: 0, atSec: 2, intent: "unwanted", rounds: 3, maxRounds: 3, reason: "max_rounds",
      failing: [{ key: "YAVG", labelZh: "亮度", delta: -30, tolerance: 5, overBy: 25 }],
      messageZh: "2.0 秒接点仍有跳变：亮度差 -30（允许 ±5），已自动修正 3 轮仍未压住",
    }]);
    // 未开自动修正：不重渲，同样给警告（not_attempted）
    h.calls.length = 0; h.yavg.length = 0; h.yavg.push(...five(120, 60));
    const off = (await concatClips({ ...base, grade: { ...seg, autoMatchJunctions: false } }, "7")).gradeSegmentCheck!;
    expect(h.calls.filter(a => a.includes("-filter_complex"))).toHaveLength(1);
    expect(off.warnings).toMatchObject([{ atSec: 2, rounds: 0, reason: "not_attempted" }]);
  });

  it("autoMatchJunctions：未提供意图（或 intended）不修、不重渲，并标注原因", async () => {
    h.yavg.push(...Array(5).fill(120), ...Array(5).fill(80));
    const out = await concatClips({ ...base, grade: { segments: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 4, saturation: 0.9 }], autoMatchJunctions: true } }, "7");
    expect(h.calls.filter(a => a.includes("-filter_complex"))).toHaveLength(1);
    const a = out.gradeSegmentCheck!.autoMatch!;
    expect(a.adjusted).toEqual([]);
    expect(a.junctions[0]).toMatchObject({ action: "no_intent", noteZh: "未提供意图，未修正" });
    expect(a.check).toBeUndefined();
  });

  it("schema：分段须首尾相接、一位小数，且不与逐段调色混用", () => {
    const bad = (grade: unknown) => concatParamsSchema.safeParse({ ...base, grade }).success;
    expect(bad({ segments: [{ startSec: 0, endSec: 1 }, { startSec: 1.5, endSec: 3 }] })).toBe(false);
    expect(bad({ segments: [{ startSec: 0, endSec: 1.25 }] })).toBe(false);
    expect(bad({ segments: [{ startSec: 0, endSec: 1 }], clips: [null, null] })).toBe(false);
    expect(bad({ crossfadeSec: 0.5 })).toBe(false);
    expect(bad({ segments: [{ startSec: 0, endSec: 1 }], crossfadeSec: 2.5 })).toBe(false);
    expect(bad({ segments: [{ startSec: 0.5, endSec: 1.5, lutId: "basic_cool" }, { startSec: 1.5, endSec: 3 }], crossfadeSec: 0.5 })).toBe(true);
  });
});
