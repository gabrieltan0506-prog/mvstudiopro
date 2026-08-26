/**
 * 后期三件套本地媒体验证(真 ffmpeg;GCS 签名/上传打桩,fetch 从本地素材供流):
 * - 横屏有声 + 竖屏无声 + 不同帧率素材统一后可拼接(无声补静音轨);
 * - 音轨短于/长于画面都 apad+atrim 对齐;最后一段音轨短也覆盖到结尾;
 *   拼接总时长以各段画面时长之和为准;
 * - 短音乐循环覆盖整片;晚入场时淡出仍对齐完整时间线;
 * - 无音轨返回 no_audio;媒体命令未完成 → 抛错结束本次任务;
 * - 任务时限 signal 已中止 → 处理同步结束;上传步骤收到任务 signal。
 * 机器没装 ffmpeg 时整组跳过(CI 兜底)。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const h = vi.hoisted(() => ({
  fixtures: new Map<string, string>(),
  uploads: new Map<string, Buffer>(),
  uploadSignals: [] as Array<AbortSignal | undefined>,
}));

vi.mock("./gcs.js", () => ({
  // 现签短链:把 gs://itest/<name> 折成可识别的 https 标记,由 fetch 桩供流
  signGsUriV4ReadUrl: (gsUri: string) =>
    `https://storage.googleapis.com/${String(gsUri).replace(/^gs:\/\//, "")}?signed=1`,
  uploadBufferToGcs: async (params: {
    objectName: string;
    buffer: Buffer;
    signal?: AbortSignal;
  }) => {
    params.signal?.throwIfAborted();
    h.uploads.set(params.objectName, params.buffer);
    h.uploadSignals.push(params.signal);
    return { bucket: "itest", objectName: params.objectName, gcsUri: `gs://itest/${params.objectName}` };
  },
}));

import { concatClips, loudnessCheck, mountBgm } from "./postProduction";

let ffmpegOk = false;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  ffmpegOk = true;
} catch {
  ffmpegOk = false;
}

let dir = "";
const realFetch = globalThis.fetch;

/** fetch 桩:对 itest 标记链从本地素材文件供流;其余照走真实 fetch */
function installFetchStub() {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const m = url.match(/^https:\/\/storage\.googleapis\.com\/itest\/([^?]+)/);
    if (m) {
      const p = h.fixtures.get(`gs://itest/${m[1]}`);
      if (!p) return new Response("not found", { status: 404 });
      const buf = await readFile(p);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { "content-length": String(buf.length) },
      });
    }
    return realFetch(input as RequestInfo, init);
  });
}

async function probeBuffer(buf: Buffer): Promise<{
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  audioDurationSec: number;
}> {
  const p = path.join(dir, `probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`);
  await writeFile(p, buf);
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", p,
  ]);
  const info = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  };
  const v = (info.streams || []).find((s) => s.codec_type === "video");
  const a = (info.streams || []).find((s) => s.codec_type === "audio");
  return {
    durationSec: Number(info.format?.duration) || 0,
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    hasAudio: Boolean(a),
    audioDurationSec: Number(a?.duration) || 0,
  };
}

async function probeRmsDb(buf: Buffer, startSec: number, durationSec: number): Promise<number> {
  const p = path.join(dir, `rms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`);
  await writeFile(p, buf);
  const endSec = startSec + durationSec;
  const { stderr } = await execFileAsync("ffmpeg", [
    "-hide_banner", "-i", p,
    "-af",
    `atrim=start=${startSec}:end=${endSec},astats=metadata=1:reset=0:`
      + "measure_overall=RMS_level:measure_perchannel=none",
    "-f", "null", "-",
  ]);
  const matches = String(stderr).match(/RMS level dB:\s*(-?inf|-?\d+(?:\.\d+)?)/gi);
  const raw = matches?.at(-1)?.match(/(-?inf|-?\d+(?:\.\d+)?)/i)?.[1];
  if (!raw) throw new Error("测试素材未量到 RMS");
  return raw.toLowerCase() === "-inf" ? Number.NEGATIVE_INFINITY : Number(raw);
}

beforeAll(async () => {
  if (!ffmpegOk) return;
  dir = await mkdtemp(path.join(tmpdir(), "pp-itest-"));
  const make = async (name: string, args: string[]) => {
    const p = path.join(dir, name);
    await execFileAsync("ffmpeg", ["-y", ...args, p]);
    h.fixtures.set(`gs://itest/${name}`, p);
  };
  // 横屏 1.5s 640x360 30fps,音轨与画面等长
  await make("land.mp4", [
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=1.5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest",
  ]);
  // 竖屏 1.0s 360x640 24fps 无声
  await make("port.mp4", [
    "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=1",
    "-c:v", "libx264", "-preset", "ultrafast", "-an",
  ]);
  // 画面 1.5s、音轨只有 0.5s(音轨短于画面)
  await make("short-audio.mp4", [
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1.5",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=0.5",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
  ]);
  // 画面 1.0s、音轨 2s(音轨长于画面)
  await make("long-audio.mp4", [
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1",
    "-f", "lavfi", "-i", "sine=frequency=550:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
  ]);
  // 0.8s 短音乐(用于循环覆盖)
  await make("music.mp3", ["-f", "lavfi", "-i", "sine=frequency=660:duration=0.8", "-b:a", "96k"]);
  // 非视频字节(媒体命令未完成场景)
  const badPath = path.join(dir, "not-a-video.mp4");
  await writeFile(badPath, Buffer.from("not-a-video"));
  h.fixtures.set("gs://itest/not-a-video.mp4", badPath);
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.runIf(ffmpegOk)("后期三件套本地媒体验证", () => {
  it("横屏有声+竖屏无声、不同帧率统一拼接;无声段补静音轨;总时长=各段画面之和", async () => {
    installFetchStub();
    const out = await concatClips(
      { clips: ["gs://itest/land.mp4", "gs://itest/port.mp4"], width: 1280, height: 720, fps: 30 },
      "7",
    );
    expect(out.clipCount).toBe(2);
    const buf = h.uploads.get(out.gcsUri.replace("gs://itest/", ""));
    const meta = await probeBuffer(buf!);
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
    expect(meta.hasAudio).toBe(true);
    // 1.5s + 1.0s = 2.5s 上下(编码取整误差)
    expect(meta.durationSec).toBeGreaterThan(2.3);
    expect(meta.durationSec).toBeLessThan(2.8);
  }, 60_000);

  it("音轨短于画面 + 音轨长于画面:apad/atrim 对齐;最后一段音轨短也覆盖到结尾", async () => {
    installFetchStub();
    const out = await concatClips(
      {
        clips: ["gs://itest/long-audio.mp4", "gs://itest/short-audio.mp4"],
        width: 640,
        height: 480,
        fps: 25,
      },
      "7",
    );
    const buf = h.uploads.get(out.gcsUri.replace("gs://itest/", ""));
    const meta = await probeBuffer(buf!);
    // 画面 1.0 + 1.5 = 2.5s;2s 音轨被裁到 1.0s,0.5s 音轨补静音到 1.5s
    expect(meta.durationSec).toBeGreaterThan(2.3);
    expect(meta.durationSec).toBeLessThan(2.8);
    // 成片音轨覆盖到结尾(音轨时长≈画面时长,不因末段音轨短而缩)
    expect(meta.audioDurationSec).toBeGreaterThan(meta.durationSec - 0.3);
  }, 60_000);

  it("短音乐循环覆盖整片;晚入场淡出仍对齐完整时间线;成片长度以视频轨为准", async () => {
    installFetchStub();
    const out = await mountBgm(
      {
        videoUri: "gs://itest/land.mp4",
        bgmUri: "gs://itest/music.mp3",
        bgmVolume: 0.48,
        entrySec: 0.5,
        bgmSeekSec: 0.1,
        fadeInSec: 0.2,
        fadeOutSec: 0.4,
        volumeExpr: "if(between(t,0.7,0.9),0,if(between(t,0.9,1.1),0.18,0.42))",
      },
      "7",
    );
    const buf = h.uploads.get(out.gcsUri.replace("gs://itest/", ""));
    const meta = await probeBuffer(buf!);
    expect(meta.hasAudio).toBe(true);
    expect(meta.durationSec).toBeGreaterThan(1.3);
    expect(meta.durationSec).toBeLessThan(1.8);
  }, 60_000);

  it("无声视频也能贴 BGM；实测硬静音、对白避让、高潮增益；上传收到 signal", async () => {
    installFetchStub();
    h.uploadSignals.length = 0;
    const controller = new AbortController();
    const out = await mountBgm(
      {
        videoUri: "gs://itest/port.mp4",
        bgmUri: "gs://itest/music.mp3",
        bgmVolume: 0.48,
        entrySec: 0,
        bgmSeekSec: 0,
        fadeInSec: 0,
        fadeOutSec: 0,
        volumeExpr:
          "if(between(t,0.3,0.5),0,if(between(t,0.55,0.7),0.18,"
          + "if(between(t,0.72,0.85),0.52,0.42)))",
      },
      "7",
      { signal: controller.signal },
    );
    const buf = h.uploads.get(out.gcsUri.replace("gs://itest/", ""));
    expect((await probeBuffer(buf!)).hasAudio).toBe(true);
    const baseDb = await probeRmsDb(buf!, 0.12, 0.1);
    const silentDb = await probeRmsDb(buf!, 0.35, 0.1);
    const dialogueDb = await probeRmsDb(buf!, 0.58, 0.08);
    const peakDb = await probeRmsDb(buf!, 0.75, 0.08);
    expect(silentDb).toBeLessThan(baseDb - 45);
    expect(dialogueDb).toBeLessThan(baseDb - 5);
    expect(peakDb).toBeGreaterThan(baseDb + 1);
    expect(h.uploadSignals[0]).toBe(controller.signal);
  }, 60_000);

  it("有声素材响度报告:status=ok 带整体 LUFS 与分窗 RMS;窗口末端超长被裁切", async () => {
    installFetchStub();
    const rep = await loudnessCheck({
      videoUri: "gs://itest/land.mp4",
      windows: [{ startSec: 0.2, durationSec: 600 }],
    });
    expect(rep.status).toBe("ok");
    if (rep.status !== "ok") return;
    expect(Number.isFinite(rep.integratedLufs)).toBe(true);
    expect(rep.windows).toHaveLength(1);
    expect(Number.isFinite(rep.windows[0].rmsDb)).toBe(true);
    expect(rep.windows[0].durationSec).toBeLessThan(1.5);
  }, 60_000);

  it("无音轨素材返回 no_audio,不硬量", async () => {
    installFetchStub();
    const rep = await loudnessCheck({ videoUri: "gs://itest/port.mp4", windows: [] });
    expect(rep).toMatchObject({ status: "no_audio", integratedLufs: null, windows: [] });
  }, 60_000);

  it("窗口起点超出视频时长 → 任务失败", async () => {
    installFetchStub();
    await expect(
      loudnessCheck({ videoUri: "gs://itest/land.mp4", windows: [{ startSec: 99, durationSec: 1 }] }),
    ).rejects.toThrow(/超出视频时长/);
  }, 60_000);

  it("媒体命令未完成(非视频字节)→ 抛错,不记录为正常完成", async () => {
    installFetchStub();
    await expect(
      loudnessCheck({ videoUri: "gs://itest/not-a-video.mp4", windows: [] }),
    ).rejects.toThrow();
  }, 60_000);

  it("任务时限 signal 已中止 → 处理同步结束,不重做", async () => {
    installFetchStub();
    const c = new AbortController();
    c.abort(new DOMException("任务时限结束", "AbortError"));
    await expect(
      concatClips(
        { clips: ["gs://itest/land.mp4", "gs://itest/port.mp4"], width: 1280, height: 720, fps: 30 },
        "7",
        { signal: c.signal },
      ),
    ).rejects.toThrow();
  }, 60_000);
});
