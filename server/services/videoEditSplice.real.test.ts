/**
 * 真实 ffmpeg 集成测试：流复制拼回 vs 整片重编码回退。
 * 测试片由 lavfi 生成，写到 os.tmpdir()，不联网、不调用任何上游。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inspectStreamCopySource, pickUntouchedSampleFrames, planStreamCopySplice, spliceByStreamCopy, type MediaRun } from "./videoEditSplice";
import { renderVideoPartialEdit, type VideoPartialEditRenderDeps } from "./videoPartialEdit";
import { buildVideoEditSpliceConcat, videoPartialEditJobSchema } from "../../shared/videoEditPricing";

const exec = promisify(execFile);
const run: MediaRun = async (command, args) => {
  const { stdout, stderr } = await exec(command, args, { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  return { stdout, stderr };
};
const signal = new AbortController().signal;
const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
const probeJson = (file: string, entries: string, extra: string[] = []) =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", ...extra, "-show_entries", entries, "-of", "json", file], { encoding: "utf8" }));
const videoFrames = (file: string) => Number(probeJson(file, "stream=nb_read_packets", ["-count_packets", "-select_streams", "v:0"]).streams[0].nb_read_packets);
const videoDuration = (file: string) => Number(probeJson(file, "stream=duration", ["-select_streams", "v:0"]).streams[0].duration);
/** 音轨逐包 md5（不解码、不重封装内容）。 */
const audioMd5 = (file: string) => execFileSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a", "-c", "copy", "-f", "md5", "-"], { encoding: "utf8" }).trim();
/** 逐帧 SSIM（成片 vs 原片，同帧对位）。 */
function ssimPerFrame(out: string, src: string): number[] {
  const text = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-i", src, "-an", "-lavfi", "[0:v][1:v]ssim=stats_file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return text.split("\n").filter(l => l.startsWith("n:")).map(l => Number(/All:([0-9.]+)/.exec(l)![1]));
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

let root = "";
const file = (name: string) => path.join(root, name);
const workdir = async (name: string) => { const dir = file(name); await mkdir(dir, { recursive: true }); return dir; };

/** 生成带音轨的 h264 测试片：testsrc2 每帧都在变，差一帧 SSIM 立刻掉。 */
function makeSource(name: string, opts: { size?: string; fps?: string; sec?: number; gop?: number; x264?: string[]; audio?: boolean } = {}) {
  const { size = "640x360", fps = "30", sec = 20, gop = 60, x264 = [], audio = true } = opts;
  ff(["-f", "lavfi", "-i", `testsrc2=s=${size}:r=${fps}:d=${sec}`,
    ...(audio ? ["-f", "lavfi", "-i", `sine=f=440:d=${sec}`] : []),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", String(gop), "-pix_fmt", "yuv420p", ...x264,
    ...(audio ? ["-c:a", "aac", "-b:a", "128k", "-shortest"] : []), file(name)]);
  return file(name);
}
/** 编辑通道出片替身：不同画面、不同帧率/分辨率、时长略有出入。 */
function makeEdited(name: string, sec: number, size = "960x540", fps = "24") {
  ff(["-f", "lavfi", "-i", `smptebars=s=${size}:r=${fps}:d=${sec}`, "-f", "lavfi", "-i", `sine=f=880:d=${sec}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file(name)]);
  return file(name);
}

/** 与生产回退路径同参数的整片重编码（restoreSegmentAudio crf16 → concatClips 的 filter 图 crf18），仅作对照。 */
function reencodeBaseline(src: string, edited: string, startSec: number, endSec: number, dir: string) {
  const info = probeJson(src, "stream=width,height,avg_frame_rate,duration", ["-select_streams", "v:0"]).streams[0];
  const [n, d] = String(info.avg_frame_rate).split("/").map(Number);
  const segmentSec = endSec - startSec, seg = path.join(dir, "seg.mp4"), restored = path.join(dir, "restored.mp4"), out = path.join(dir, "out.mp4");
  ff(["-i", src, "-ss", startSec.toFixed(3), "-to", endSec.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", seg]);
  const t0 = Date.now();
  ff(["-i", edited, "-i", seg, "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-vf", "tpad=stop_mode=clone:stop_duration=1",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-t", segmentSec.toFixed(3), restored]);
  const c = buildVideoEditSpliceConcat({ sourceUri: src, editedUri: restored, startSec, endSec, sourceDurationSec: Number(info.duration), width: info.width, height: info.height, fps: n / d });
  const v = (i: number) => `[${i}:v]trim=start=${c.trims[i].startSec}:end=${c.trims[i].endSec},setpts=PTS-STARTPTS,scale=w=${c.width}:h=${c.height}:force_original_aspect_ratio=decrease,pad=${c.width}:${c.height}:(ow-iw)/2:(oh-ih)/2,fps=${c.fps},format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v${i}]`;
  const a = (i: number) => `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=start=${c.trims[i].startSec}:end=${c.trims[i].endSec},asetpts=PTS-STARTPTS[a${i}]`;
  ff([...c.clips.flatMap(clip => ["-i", clip]), "-filter_complex",
    `${c.clips.map((_c, i) => `${v(i)};${a(i)}`).join(";")};${c.clips.map((_c, i) => `[v${i}][a${i}]`).join("")}concat=n=${c.clips.length}:v=1:a=1[vo][ao]`,
    "-map", "[vo]", "-map", "[ao]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "256k", out]);
  return { out, elapsedMs: Date.now() - t0 };
}

beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "vpe-splice-real-")); });
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe("流复制拼回（真实 ffmpeg）", () => {
  it("含 B 帧的 720p 原片：帧数/时间戳/时长一致，音轨 md5 不变，未改区间逐帧 SSIM≥0.99，并与整片重编码对照", async () => {
    const src = makeSource("b-720.mp4", { size: "1280x720" });
    const edited = makeEdited("edited-4.mp4", 3.96);
    const dir = await workdir("b-720");
    const r = await spliceByStreamCopy({ sourceFile: src, editedFile: edited, startSec: 8.5, endSec: 12.5, dir }, run, signal);
    if (!r.ok) throw new Error(`unexpected fallback: ${r.reason}`);
    // 30fps、GOP 60：编辑帧 [255,375)，重编码区间向外扩到关键帧 [240,420)，其余原样复制
    expect(r.stats.frames).toEqual({ total: 600, headCopied: 240, reencoded: 180, edited: 120, tailCopied: 180 });
    expect(r.stats.encode).toMatchObject({ profile: "high", pixFmt: "yuv420p", fps: "30/1", delayFrames: 2 });
    expect(r.stats.ssim).toHaveLength(3);
    expect(r.stats.minSsim).toBeGreaterThanOrEqual(0.99);
    expect(videoFrames(r.outPath)).toBe(videoFrames(src));
    expect(Math.abs(videoDuration(r.outPath) - videoDuration(src))).toBeLessThanOrEqual(0.25);
    expect(videoDuration(r.outPath)).toBeCloseTo(videoDuration(src), 3);
    expect(audioMd5(r.outPath)).toBe(audioMd5(src));
    // 整片解码无错，且成片参数与原片一致
    expect(execFileSync("ffmpeg", ["-v", "error", "-i", r.outPath, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).toBe("");
    const fields = "stream=codec_name,profile,level,pix_fmt,width,height,r_frame_rate,time_base,has_b_frames";
    expect(probeJson(r.outPath, fields, ["-select_streams", "v:0"]).streams[0]).toEqual(probeJson(src, fields, ["-select_streams", "v:0"]).streams[0]);

    const fast = ssimPerFrame(r.outPath, src);
    const untouched = (xs: number[]) => xs.filter((_x, i) => i < 255 || i >= 375);
    const copied = fast.filter((_x, i) => i < 240 || i >= 420);
    expect(fast).toHaveLength(600);
    expect(Math.min(...copied)).toBe(1); // 流复制帧与原片逐像素一致
    expect(Math.min(...untouched(fast))).toBeGreaterThanOrEqual(0.99);
    expect(Math.max(...fast.slice(255, 375))).toBeLessThan(0.9); // 编辑段确实被替换，且边界不差帧

    const base = reencodeBaseline(src, edited, 8.5, 12.5, await workdir("b-720-base"));
    const slow = ssimPerFrame(base.out, src);
    const baseAudioSame = audioMd5(base.out) === audioMd5(src);
    expect(mean(untouched(fast))).toBeGreaterThan(mean(untouched(slow)));
    expect(baseAudioSame).toBe(false); // 旧路径音轨被重新编码
    console.log(JSON.stringify({
      bench: "1280x720 30fps 20s, edit 8.5-12.5s",
      streamCopy: { elapsedMs: r.stats.elapsedMs, untouchedSsimMean: Number(mean(untouched(fast)).toFixed(6)), untouchedSsimMin: Number(Math.min(...untouched(fast)).toFixed(6)), bitExactFrames: copied.length, reencodedFrames: r.stats.frames.reencoded, bytes: (await stat(r.outPath)).size, audioMd5Same: true, sampled: r.stats.ssim },
      fullReencode: { elapsedMs: base.elapsedMs, untouchedSsimMean: Number(mean(untouched(slow)).toFixed(6)), untouchedSsimMin: Number(Math.min(...untouched(slow)).toFixed(6)), bitExactFrames: slow.filter(x => x === 1).length, reencodedFrames: videoFrames(base.out), bytes: (await stat(base.out)).size, audioMd5Same: baseAudioSame },
      sourceBytes: (await stat(src)).size,
    }));
  }, 180_000);

  it("无 B 帧原片、编辑段贴片头（没有前段可复制）且原片无音轨", async () => {
    const src = makeSource("nob.mp4", { x264: ["-bf", "0"], sec: 12, audio: false });
    const dir = await workdir("nob");
    const r = await spliceByStreamCopy({ sourceFile: src, editedFile: makeEdited("edited-4b.mp4", 4.2), startSec: 0, endSec: 4, dir }, run, signal);
    if (!r.ok) throw new Error(`unexpected fallback: ${r.reason}`);
    expect(r.stats.frames).toEqual({ total: 360, headCopied: 0, reencoded: 120, edited: 120, tailCopied: 240 });
    expect(r.stats.encode.delayFrames).toBe(0);
    expect(videoFrames(r.outPath)).toBe(360);
    expect(videoDuration(r.outPath)).toBeCloseTo(12, 3);
    expect(probeJson(r.outPath, "stream=codec_type").streams.map((s: any) => s.codec_type)).toEqual(["video"]);
    const s = ssimPerFrame(r.outPath, src);
    expect(Math.min(...s.slice(120))).toBe(1);
    expect(Math.max(...s.slice(0, 120))).toBeLessThan(0.9);
  }, 120_000);

  it("29.97fps、编辑段贴片尾（没有后段可复制）、切点不在关键帧上", async () => {
    const src = makeSource("ntsc.mp4", { fps: "30000/1001", sec: 12, gop: 45 });
    const dir = await workdir("ntsc");
    const total = videoFrames(src), duration = videoDuration(src);
    const r = await spliceByStreamCopy({ sourceFile: src, editedFile: makeEdited("edited-5.mp4", 5.1), startSec: 7, endSec: Math.floor(duration * 10) / 10, dir }, run, signal);
    if (!r.ok) throw new Error(`unexpected fallback: ${r.reason}`);
    expect(r.stats.frames.total).toBe(total);
    expect(r.stats.frames.headCopied).toBe(180); // 7s≈第 210 帧，前一个关键帧在 180
    expect(r.stats.frames.headCopied + r.stats.frames.reencoded + r.stats.frames.tailCopied).toBe(total);
    expect(videoFrames(r.outPath)).toBe(total);
    expect(videoDuration(r.outPath)).toBeCloseTo(duration, 3);
    expect(audioMd5(r.outPath)).toBe(audioMd5(src));
    const s = ssimPerFrame(r.outPath, src);
    const { start, end } = r.stats.editedFrameRange;
    expect(Math.min(...s.filter((_x, i) => i < start || i >= end))).toBeGreaterThanOrEqual(0.99);
    expect(Math.min(...s.slice(0, 180))).toBe(1);
  }, 120_000);

  it("不满足条件的原片给出回退原因，不产出成片", async () => {
    const edited = makeEdited("edited-4c.mp4", 4.1);
    const attempt = async (name: string, src: string, startSec = 2, endSec = 6) =>
      spliceByStreamCopy({ sourceFile: src, editedFile: edited, startSec, endSec, dir: await workdir(name) }, run, signal);

    ff(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=8", "-c:v", "mpeg4", "-q:v", "4", file("mpeg4.mp4")]);
    expect(await attempt("mpeg4", file("mpeg4.mp4"))).toEqual({ ok: false, reason: "codec_mpeg4" });

    ff(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=8", "-vf", "select='not(eq(mod(n\\,7)\\,3))'", "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", file("vfr.mp4")]);
    expect(await attempt("vfr", file("vfr.mp4"))).toEqual({ ok: false, reason: "variable_frame_rate" });

    ff(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=8", "-c:v", "libx264", "-pix_fmt", "yuv444p", file("444.mp4")]);
    expect((await attempt("444", file("444.mp4"))).ok).toBe(false);

    // 整片只有一个关键帧：没有可原样复制的区间
    const oneGop = makeSource("one-gop.mp4", { size: "320x240", sec: 8, gop: 600, x264: ["-sc_threshold", "0"] });
    expect(await attempt("one-gop", oneGop)).toEqual({ ok: false, reason: "no_copyable_range" });

    // 编辑结果明显短于选段：交回原路径按原口径报错
    const ok = makeSource("short-edit-src.mp4", { size: "320x240", sec: 12 });
    expect(await attempt("short-edit", ok, 2, 8)).toEqual({ ok: false, reason: "edited_too_short" });
  }, 120_000);

  it("切点规划与抽帧：重编码区间落在关键帧上，抽样帧都在未改区间", async () => {
    const src = makeSource("plan.mp4", { size: "320x240", sec: 10 });
    const inspected = await inspectStreamCopySource(src, run, signal);
    if (!inspected.ok) throw new Error(inspected.reason);
    expect(inspected.source).toMatchObject({ frameCount: 300, fpsNum: 30, fpsDen: 1, hasAudio: true });
    const plan = planStreamCopySplice(inspected.source, 4, 8);
    if ("ok" in plan) throw new Error(plan.reason);
    expect(plan).toMatchObject({ editStart: 120, editEnd: 240, encodeStart: 120, encodeEnd: 240 }); // 切点正好在关键帧：只编码编辑段
    const picks = pickUntouchedSampleFrames(plan);
    expect(picks).toHaveLength(3);
    expect(picks.every(i => i < 120 || i >= 240)).toBe(true);
    expect(picks).toEqual(expect.arrayContaining([119, 240]));
  }, 60_000);
});

describe("renderVideoPartialEdit：两条拼回路径与回退（真实 ffmpeg，上传/通道用替身）", () => {
  const REQ = "3f2b8c1e-6c1d-4b7a-9a51-0d7c2f4e8a10";
  function setup(src: string, edited: string, meta: { sourceDurationSec: number; startSec: number; endSec: number }) {
    const evidence = new Map<string, any>();
    const job = videoPartialEditJobSchema.parse({
      action: "video_partial_edit", requestId: REQ,
      params: { videoUri: "gs://bucket/post-prod/42/source.mp4", referenceImageUris: [], promptZh: "换背景", ...meta, segmentSec: meta.endSec - meta.startSec, expanded: false,
        width: 640, height: 360, fps: 30, hasAudio: true, charge: { credits: 60, chargeKey: `videoPartialEdit/42/${REQ}`, source: "personal" } },
    });
    let splicedFile = "";
    const deps: VideoPartialEditRenderDeps = {
      runVideoEditWithFallback: vi.fn(async () => ({ videoUrl: "https://signed/edited.mp4", channel: "test", attempts: [] })),
      cutSegment: vi.fn(async () => ({ url: "https://signed/segment.mp4", gcsUri: "gs://bucket/seg.mp4", filePath: "/nonexistent/seg.mp4" })),
      restoreSegmentAudio: vi.fn(async () => ({ gcsUri: "gs://bucket/restored.mp4", durationSec: meta.endSec - meta.startSec })),
      concat: vi.fn(async params => ({ gcsUri: "gs://bucket/concat.mp4", url: "https://signed/concat.mp4", bytes: 1, durationSec: params.totalSec })),
      signRead: (u: string) => u,
      refund: vi.fn(async () => {}),
      writeEvidence: vi.fn(async (name: string, value: unknown) => { evidence.set(name, value); }),
      // 与生产实现同一套拼回函数；只把下载/上传换成本地文件
      async spliceStreamCopy({ startSec, endSec, dir, signal: s }) {
        const r = await spliceByStreamCopy({ sourceFile: src, editedFile: edited, startSec, endSec, dir }, run, s);
        if (!r.ok) return r;
        splicedFile = file(`render-${path.basename(src)}`);
        ff(["-i", r.outPath, "-c", "copy", splicedFile]);
        return { ok: true, gcsUri: "gs://bucket/spliced.mp4", url: "https://signed/spliced.mp4", bytes: (await stat(r.outPath)).size, durationSec: r.stats.durationSec, editedUri: "gs://bucket/edited-raw.mp4", stats: r.stats };
      },
    };
    return { deps, job, evidence, spliced: () => splicedFile };
  }

  it("原片满足条件 → 走流复制，不调用整片重编码；debug 与证据记路径", async () => {
    const src = makeSource("render-ok.mp4", { sec: 12 });
    const t = setup(src, makeEdited("render-edited.mp4", 4.1), { sourceDurationSec: 12, startSec: 4.5, endSec: 8.5 });
    const out = await renderVideoPartialEdit(t.job, "42", "vpe_test", signal, t.deps);
    expect(out.debug.splice).toMatchObject({ path: "stream_copy", frames: { total: 360, edited: 120 } });
    expect((out.debug.splice as any).minSsim).toBeGreaterThanOrEqual(0.99);
    expect(out.gcsUri).toBe("gs://bucket/spliced.mp4");
    expect(Math.abs(out.durationSec - 12)).toBeLessThanOrEqual(0.25);
    expect(t.deps.restoreSegmentAudio).not.toHaveBeenCalled();
    expect(t.deps.concat).not.toHaveBeenCalled();
    expect(t.deps.refund).not.toHaveBeenCalled();
    expect(videoFrames(t.spliced())).toBe(360);
    expect(audioMd5(t.spliced())).toBe(audioMd5(src));
    const result = t.evidence.get(Array.from(t.evidence.keys()).find(k => k.endsWith("/result.json"))!);
    expect(result.output.debug.splice.path).toBe("stream_copy");
    expect(result.editedSegmentUri).toBe("gs://bucket/edited-raw.mp4");
  }, 120_000);

  it("原片不满足条件 → 回退整片重编码，debug 记回退原因，不退款", async () => {
    ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=12", "-f", "lavfi", "-i", "sine=f=440:d=12", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "aac", "-shortest", file("render-mpeg4.mp4")]);
    const t = setup(file("render-mpeg4.mp4"), makeEdited("render-edited2.mp4", 4.1), { sourceDurationSec: 12, startSec: 4.5, endSec: 8.5 });
    const out = await renderVideoPartialEdit(t.job, "42", "vpe_test", signal, t.deps);
    expect(out.debug.splice).toEqual({ path: "reencode", fallbackReason: "codec_mpeg4" });
    expect(out.gcsUri).toBe("gs://bucket/concat.mp4");
    expect(t.deps.restoreSegmentAudio).toHaveBeenCalledTimes(1);
    expect(t.deps.concat).toHaveBeenCalledTimes(1);
    expect(t.deps.refund).not.toHaveBeenCalled();
    const result = t.evidence.get(Array.from(t.evidence.keys()).find(k => k.endsWith("/result.json"))!);
    expect(result.concatParams.clips).toHaveLength(3);
    expect(result.editedSegmentUri).toBe("gs://bucket/restored.mp4");
  }, 120_000);

  it("流复制步骤抛错 → 同样回退；未注入流复制依赖时走原路径", async () => {
    const src = makeSource("render-err.mp4", { sec: 12 });
    const t = setup(src, file("missing-edited.mp4"), { sourceDurationSec: 12, startSec: 4.5, endSec: 8.5 });
    const out = await renderVideoPartialEdit(t.job, "42", "vpe_test", signal, t.deps);
    expect(out.debug.splice.path).toBe("reencode");
    expect(String(out.debug.splice.fallbackReason)).toMatch(/^error: /);
    expect(t.deps.concat).toHaveBeenCalledTimes(1);

    const legacy = setup(src, file("missing-edited.mp4"), { sourceDurationSec: 12, startSec: 4.5, endSec: 8.5 });
    delete legacy.deps.spliceStreamCopy;
    const out2 = await renderVideoPartialEdit(legacy.job, "42", "vpe_test", signal, legacy.deps);
    expect(out2.debug.splice).toEqual({ path: "reencode", fallbackReason: "unavailable" });
  }, 120_000);
});
