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

  it("segments：成片尾部接分段子图，接点前后 0.1s 取帧并留档", async () => {
    const out = await concatClips({ ...base, grade: { segments: [{ startSec: 0, endSec: 2, exposure: 0.5 }, { startSec: 2, endSec: 4, saturation: 0.8 }] } }, "7");
    const g = graphOf(h.calls[0]);
    expect(g).toContain("concat=n=2:v=1:a=1[vcat][ao];[vcat]split=2[gs0][gs1];");
    expect(g).toContain("[gg0][gg1]concat=n=2:v=1:a=0[vo]");
    // 逐段 vChain 不再插调色（分段在成片上做）
    expect(g).not.toMatch(/fps=30,curves/);
    const seek = h.calls.slice(1).map(a => a[a.indexOf("-ss") + 1]);
    expect(seek).toEqual(["1.9", "2.1"]);
    expect(out.gradeSegmentCheck?.check.junctions).toHaveLength(1);
    expect(h.uploads.filter(u => u.includes("/grade-evidence/")).map(u => u.split("/").slice(-2).join("/"))).toEqual([
      "pass-1/junction-0.before.signalstats.raw.txt", "pass-1/junction-0.before.signalstats.parsed.json",
      "pass-1/junction-0.after.signalstats.raw.txt", "pass-1/junction-0.after.signalstats.parsed.json",
    ]);
    expect(out.gradeSegmentCheck?.autoMatch).toBeUndefined();
  });

  it("autoMatchJunctions：未达标接点叠加修正后重渲 1 次并返回前后两次检查", async () => {
    h.yavg.push(120, 80, 120, 118);
    const out = await concatClips({ ...base, grade: { segments: [{ startSec: 0, endSec: 2 }, { startSec: 2, endSec: 4, saturation: 0.9 }], crossfadeSec: 0.4, autoMatchJunctions: true } }, "7");
    const renders = h.calls.filter(a => a.includes("-filter_complex"));
    expect(renders).toHaveLength(2);
    expect(graphOf(renders[0])).toContain("xfade=transition=fade:duration=0.4:offset=1.8[vo]");
    const r = out.gradeSegmentCheck!;
    expect(r.check.pass).toBe(false);
    expect(r.autoMatch?.adjusted).toEqual([1]);
    expect(r.autoMatch?.spans[1].correction).toMatchObject({ saturation: 0.9, exposure: 1 });
    expect(graphOf(renders[1])).toContain("curves=master='0/0 0.25/0.5 1/1'");
    expect(r.autoMatch?.check.pass).toBe(true);
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
