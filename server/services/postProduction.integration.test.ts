/**
 * 后期三件套本地媒体验证(真 ffmpeg,GCS 打桩):
 * - 横屏有声 + 竖屏无声 + 不同帧率素材统一后可拼接(无声补静音轨);
 * - 短音乐循环覆盖整片;晚入场时淡出仍对齐完整时间线;
 * - 无音轨返回 no_audio;坏媒体命令未完成 → 任务失败不装量过;
 * - 任务时限 signal 已中止 → 处理同步结束。
 * 机器没装 ffmpeg 时整组跳过(CI 兜底)。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const h = vi.hoisted(() => ({
  fixtures: new Map<string, string>(),
  uploads: new Map<string, Buffer>(),
}));

vi.mock("./gcs.js", () => ({
  downloadGcsObject: async ({ gcsUri }: { gcsUri: string }) => {
    const p = h.fixtures.get(gcsUri);
    if (!p) throw new Error(`gcs_download_failed:404:${gcsUri}`);
    return { buffer: await readFile(p) };
  },
  uploadBufferToGcs: async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
    h.uploads.set(objectName, buffer);
    return { gcsUri: `gs://itest/${objectName}` };
  },
  signGsUriV4ReadUrl: () => "https://signed.example/out",
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

async function probeBuffer(buf: Buffer): Promise<{
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}> {
  const p = path.join(dir, `probe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`);
  await writeFile(p, buf);
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", p,
  ]);
  const info = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const v = (info.streams || []).find((s) => s.codec_type === "video");
  return {
    durationSec: Number(info.format?.duration) || 0,
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    hasAudio: (info.streams || []).some((s) => s.codec_type === "audio"),
  };
}

beforeAll(async () => {
  if (!ffmpegOk) return;
  dir = await mkdtemp(path.join(tmpdir(), "pp-itest-"));
  const land = path.join(dir, "land.mp4");
  const port = path.join(dir, "port.mp4");
  const music = path.join(dir, "music.mp3");
  const corrupt = path.join(dir, "corrupt.mp4");
  // 横屏 1.5s 640x360 30fps + 正弦有声
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=1.5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", land,
  ]);
  // 竖屏 1.0s 360x640 24fps 无声
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=1",
    "-c:v", "libx264", "-preset", "ultrafast", "-an", port,
  ]);
  // 0.8s 短音乐(用于循环覆盖)
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=0.8", "-b:a", "96k", music,
  ]);
  await writeFile(corrupt, Buffer.from("this-is-not-a-video"));
  h.fixtures.set("gs://itest/land.mp4", land);
  h.fixtures.set("gs://itest/port.mp4", port);
  h.fixtures.set("gs://itest/music.mp3", music);
  h.fixtures.set("gs://itest/corrupt.mp4", corrupt);
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.runIf(ffmpegOk)("后期三件套本地媒体验证", () => {
  it(
    "横屏有声+竖屏无声、不同帧率统一拼接;无声段补静音轨",
    async () => {
      const out = await concatClips(
        { clips: ["gs://itest/land.mp4", "gs://itest/port.mp4"], width: 1280, height: 720, fps: 30 },
        "7",
      );
      expect(out.clipCount).toBe(2);
      const buf = h.uploads.get(out.gcsUri.replace("gs://itest/", ""));
      expect(buf).toBeTruthy();
      const meta = await probeBuffer(buf!);
      expect(meta.width).toBe(1280);
      expect(meta.height).toBe(720);
      expect(meta.hasAudio).toBe(true);
      expect(meta.durationSec).toBeGreaterThan(2.2);
      expect(meta.durationSec).toBeLessThan(2.9);
    },
    60_000,
  );

  it(
    "短音乐循环覆盖整片;晚入场淡出仍对齐完整时间线;成片长度以视频轨为准",
    async () => {
      const out = await mountBgm(
        {
          videoUri: "gs://itest/land.mp4",
          bgmUri: "gs://itest/music.mp3",
          bgmVolume: 0.48,
          entrySec: 0.5,
          fadeInSec: 0.2,
          fadeOutSec: 0.4,
        },
        "7",
      );
      const buf = h.uploads.get(out.gcsUri.replace("gs://itest/", ""));
      const meta = await probeBuffer(buf!);
      expect(meta.hasAudio).toBe(true);
      // 视频轨为准:不被 1.6s(0.8s×2循环)的音乐拉长
      expect(meta.durationSec).toBeGreaterThan(1.3);
      expect(meta.durationSec).toBeLessThan(1.8);
    },
    60_000,
  );

  it(
    "无声视频也能贴 BGM(对白轨用静音源顶位)",
    async () => {
      const out = await mountBgm(
        {
          videoUri: "gs://itest/port.mp4",
          bgmUri: "gs://itest/music.mp3",
          bgmVolume: 0.48,
          entrySec: 0,
          fadeInSec: 0.2,
          fadeOutSec: 0.3,
        },
        "7",
      );
      const buf = h.uploads.get(out.gcsUri.replace("gs://itest/", ""));
      const meta = await probeBuffer(buf!);
      expect(meta.hasAudio).toBe(true);
    },
    60_000,
  );

  it(
    "有声素材响度报告:status=ok 带整体 LUFS 与分窗 RMS;窗口末端超长被裁切",
    async () => {
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
    },
    60_000,
  );

  it("无音轨素材返回 no_audio,不硬量", async () => {
    const rep = await loudnessCheck({ videoUri: "gs://itest/port.mp4", windows: [] });
    expect(rep).toMatchObject({ status: "no_audio", integratedLufs: null, windows: [] });
  }, 60_000);

  it("窗口起点超出视频时长 → 任务失败", async () => {
    await expect(
      loudnessCheck({
        videoUri: "gs://itest/land.mp4",
        windows: [{ startSec: 99, durationSec: 1 }],
      }),
    ).rejects.toThrow(/超出视频时长/);
  }, 60_000);

  it("坏素材媒体命令未完成 → 抛错,不记录为正常完成", async () => {
    await expect(
      loudnessCheck({ videoUri: "gs://itest/corrupt.mp4", windows: [] }),
    ).rejects.toThrow();
  }, 60_000);

  it("任务时限 signal 已中止 → 处理同步结束,不重做", async () => {
    const c = new AbortController();
    c.abort(new Error("task limit"));
    await expect(
      concatClips(
        { clips: ["gs://itest/land.mp4", "gs://itest/port.mp4"], width: 1280, height: 720, fps: 30 },
        "7",
        { signal: c.signal },
      ),
    ).rejects.toThrow();
  }, 60_000);
});
