import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { probe, runMediaTool } from "./postProduction";
import { cutVideoSegmentToFile, type VideoSegmentCutDeps } from "./videoPartialEditCut";

/**
 * 真 ffmpeg：测试片每帧亮度 = 30 + 帧号（24fps、8 秒、关键帧每 2 秒、moov 在文件尾），
 * 音轨前 4 秒静音、之后 1kHz 蜂鸣——首帧亮度验证起点精确到帧，蜂鸣起点验证音画同步。
 */
const FPS = 24, START = 3.5, END = 6.5, BEEP_AT = 4;
let root = "", source = "", sourceBytes = 0;
const servers: Server[] = [];
const stats = { range206: 0, full200: 0, downloads: 0 };

function listen(handler: Parameters<typeof createServer>[1]) {
  return new Promise<string>(resolve => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/source.mp4`));
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vpe-cut-real-"));
  source = path.join(root, "source.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=black:s=64x64:r=${FPS}:d=8,format=yuv420p,geq=lum='30+N':cb=128:cr=128`,
    "-f", "lavfi", "-i", `sine=f=1000:r=48000:d=8,volume='if(gte(t,${BEEP_AT}),1,0)':eval=frame`,
    "-c:v", "libx264", "-g", "48", "-crf", "10", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
  sourceBytes = (await stat(source)).size;
});

afterAll(async () => {
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  await rm(root, { recursive: true, force: true });
});

const deps: VideoSegmentCutDeps = {
  runMediaTool, probe,
  download: async (_uri, file) => { stats.downloads += 1; await copyFile(source, file); },
  signRead: () => { throw new Error("unexpected sign"); },
};

function rangeServer() {
  return listen((req, res) => {
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ""));
    if (!m) { stats.full200 += 1; res.writeHead(200, { "content-length": sourceBytes, "accept-ranges": "bytes" }); createReadStream(source).pipe(res); return; }
    const from = Number(m[1]), to = m[2] ? Math.min(Number(m[2]), sourceBytes - 1) : sourceBytes - 1;
    stats.range206 += 1;
    res.writeHead(206, { "content-length": to - from + 1, "content-range": `bytes ${from}-${to}/${sourceBytes}`, "accept-ranges": "bytes" });
    createReadStream(source, { start: from, end: to }).pipe(res);
  });
}

function inspect(file: string) {
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { encoding: "utf8" }));
  const video = info.streams.find((s: any) => s.codec_type === "video"), audio = info.streams.find((s: any) => s.codec_type === "audio");
  // 首帧 Y 平面均值 → 原片帧号
  const yuv = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { maxBuffer: 1 << 20 });
  const firstLuma = yuv.subarray(0, 64 * 64).reduce((sum, v) => sum + v, 0) / (64 * 64);
  const frames = Number(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file], { encoding: "utf8" }));
  const silence = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-vn", "-af", "silencedetect=n=-40dB:d=0.1", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const beepAt = Number(/silence_end: ([\d.]+)/.exec(silence)?.[1]);
  return { video, audio, formatSec: Number(info.format.duration), firstFrame: firstLuma - 30, frames, beepAt };
}

function expectSegment(file: string) {
  const r = inspect(file);
  expect(r.audio, "有音轨").toBeTruthy();
  expect(r.audio.codec_name).toBe("aac");
  expect(r.video.codec_name).toBe("h264");
  expect(Math.abs(Number(r.video.duration) - (END - START))).toBeLessThanOrEqual(1 / FPS + 0.001);
  expect(Math.abs(Number(r.audio.duration) - (END - START))).toBeLessThanOrEqual(0.05);
  expect(Math.abs(r.formatSec - (END - START))).toBeLessThanOrEqual(0.05);
  expect(r.frames).toBe(Math.round((END - START) * FPS));
  // 首帧 = 原片第 START*FPS 帧（精确到帧）
  expect(Math.abs(r.firstFrame - START * FPS)).toBeLessThan(0.6);
  // 音画同起点：蜂鸣仍在原片第 4 秒处
  expect(Math.abs(Number(r.video.start_time))).toBeLessThan(0.001);
  expect(Math.abs(Number(r.audio.start_time))).toBeLessThan(0.03);
  expect(Math.abs(r.beepAt - (BEEP_AT - START))).toBeLessThan(0.05);
}

async function cut(videoUri: string, options: Parameters<typeof cutVideoSegmentToFile>[2] = {}, signal = new AbortController().signal, d = deps) {
  const dir = await mkdtemp(path.join(root, "job-"));
  return cutVideoSegmentToFile({ videoUri, startSec: START, endSec: END, fps: FPS, dir, signal }, d, options);
}

describe("video partial edit segment cut (real ffmpeg)", () => {
  it("cuts the range straight from a Range-capable remote without downloading the source", async () => {
    const url = await rangeServer();
    Object.assign(stats, { range206: 0, full200: 0, downloads: 0 });
    const result = await cut(url, { allowInsecureHttp: true });
    expect(result).toMatchObject({ mode: "remote" });
    expect(result.fallbackReason).toBeUndefined();
    expect(stats.downloads).toBe(0);
    expect(stats.full200).toBe(0);
    expect(stats.range206).toBeGreaterThan(1);
    expectSegment(result.filePath);
  }, 60_000);

  it("signs gs:// before the remote read", async () => {
    const url = await rangeServer();
    Object.assign(stats, { downloads: 0 });
    const signed: string[] = [];
    const result = await cut("gs://bucket/source.mp4", { allowInsecureHttp: true }, undefined, { ...deps, signRead: uri => { signed.push(uri); return url; } });
    expect(signed).toEqual(["gs://bucket/source.mp4"]);
    expect(result.mode).toBe("remote");
    expect(stats.downloads).toBe(0);
    expectSegment(result.filePath);
  }, 60_000);

  it("falls back to download-then-cut when the server ignores Range", async () => {
    const url = await listen((_req, res) => { res.writeHead(200, { "content-length": sourceBytes }); createReadStream(source).pipe(res); });
    Object.assign(stats, { downloads: 0 });
    const result = await cut(url, { allowInsecureHttp: true });
    expect(result).toMatchObject({ mode: "download", fallbackReason: "no-range" });
    expect(stats.downloads).toBe(1);
    expectSegment(result.filePath);
  }, 60_000);

  it("falls back when the source is not https", async () => {
    const url = await rangeServer();
    Object.assign(stats, { range206: 0, downloads: 0 });
    for (const uri of [url, source]) {
      const result = await cut(uri);
      expect(result).toMatchObject({ mode: "download", fallbackReason: "not-https" });
      expectSegment(result.filePath);
    }
    expect(stats.range206).toBe(0);
    expect(stats.downloads).toBe(2);
  }, 60_000);

  it("falls back when the remote read stalls past the time limit", async () => {
    // 探测放行，随后的读取一律挂起
    const url = await listen((req, res) => {
      if (req.headers.range === "bytes=0-0") { res.writeHead(206, { "content-length": 1, "content-range": `bytes 0-0/${sourceBytes}` }); res.end("x"); }
    });
    Object.assign(stats, { downloads: 0 });
    const result = await cut(url, { allowInsecureHttp: true, remoteTimeoutMs: 1500 });
    expect(result).toMatchObject({ mode: "download", fallbackReason: "timeout" });
    expect(stats.downloads).toBe(1);
    expectSegment(result.filePath);
  }, 60_000);

  it("falls back when the remote read fails mid-way", async () => {
    const url = await listen((req, res) => {
      if (req.headers.range === "bytes=0-0") { res.writeHead(206, { "content-length": 1, "content-range": `bytes 0-0/${sourceBytes}` }); res.end("x"); }
      else { res.writeHead(500); res.end(); }
    });
    Object.assign(stats, { downloads: 0 });
    const result = await cut(url, { allowInsecureHttp: true });
    expect(result).toMatchObject({ mode: "download", fallbackReason: "remote-read-failed" });
    expect(stats.downloads).toBe(1);
    expectSegment(result.filePath);
  }, 60_000);

  it("does not fall back when the job itself is aborted", async () => {
    const url = await listen(() => {});
    Object.assign(stats, { downloads: 0 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("job stopped")), 300);
    await expect(cut(url, { allowInsecureHttp: true }, controller.signal)).rejects.toThrow("job stopped");
    expect(stats.downloads).toBe(0);
  }, 60_000);
});
