import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({
  sources: new Map<string, string>(),
  downloads: [] as Array<{ url: string; signal?: AbortSignal }>,
}));
vi.mock("./renderUtils.js", async importOriginal => {
  const original = await importOriginal<typeof import("./renderUtils.js")>();
  return {
    ...original,
    downloadFileToPath: async (
      url: string,
      target: string,
      signal?: AbortSignal
    ) => {
      media.downloads.push({ url, signal });
      const source = media.sources.get(url);
      if (!source) throw new Error("测试禁止访问真实媒体或网络");
      await fs.copyFile(source, target);
      return target;
    },
  };
});
import {
  renderSourceAudioFinal,
  resolveSourceTrim,
  resolveSourceVideoFacts,
} from "./renderSourceAudio";

const exec = promisify(execFile);
const available = ["ffmpeg", "ffprobe"].every(
  command => spawnSync(command, ["-version"]).status === 0
);
let fixtureDir: string;
let caseIndex = 0;

async function workDir() {
  const dir = path.join(fixtureDir, `result-${caseIndex++}`);
  await fs.mkdir(dir);
  return dir;
}

async function inspect(file: string) {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,duration:format=duration",
    "-of",
    "json",
    file,
  ]);
  const json = JSON.parse(stdout);
  return {
    video: Number(
      json.streams.find(
        (stream: { codec_type: string }) => stream.codec_type === "video"
      )?.duration
    ),
    audio: Number(
      json.streams.find(
        (stream: { codec_type: string }) => stream.codec_type === "audio"
      )?.duration
    ),
  };
}

async function audioWindow(file: string, at: number) {
  const { stdout } = await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(at),
      "-i",
      file,
      "-t",
      "0.16",
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 }
  );
  const samples = Array.from({ length: stdout.length / 4 }, (_, i) =>
    stdout.readFloatLE(i * 4)
  );
  return {
    rms: Math.sqrt(
      samples.reduce((sum, value) => sum + value * value, 0) / samples.length
    ),
    magnitude(frequency: number) {
      let real = 0;
      let imaginary = 0;
      samples.forEach((value, i) => {
        real += value * Math.cos((2 * Math.PI * frequency * i) / 8000);
        imaginary += value * Math.sin((2 * Math.PI * frequency * i) / 8000);
      });
      return (2 * Math.hypot(real, imaginary)) / samples.length;
    },
  };
}

describe("真实媒体边界", () => {
  it("流时长N/A时回到有效容器时长，缺视频或两个时长都无效则拒绝", () => {
    expect(
      resolveSourceVideoFacts({
        streams: [
          { codec_type: "video", duration: "N/A" },
          { codec_type: "audio" },
        ],
        format: { duration: "14.96" },
      })
    ).toEqual({ duration: 14.96, hasAudio: true });
    expect(() =>
      resolveSourceVideoFacts({
        streams: [{ codec_type: "audio" }],
        format: { duration: "15" },
      })
    ).toThrow();
    expect(() =>
      resolveSourceVideoFacts({
        streams: [{ codec_type: "video", duration: "N/A" }],
        format: { duration: "N/A" },
      })
    ).toThrow();
  });
  it("0.1秒剪点允许有界尾差，但不允许越过素材补造时长", () => {
    expect(resolveSourceTrim(14.96, 12, 15)).toEqual({
      start: 12,
      duration: 2.960000000000001,
    });
    expect(() => resolveSourceTrim(14.96, 12, 15.1)).toThrow(
      "裁切范围超过实际素材"
    );
    expect(() => resolveSourceTrim(14.96, 15, 15.05)).toThrow();
  });
});

describe.skipIf(!available)(
  "漫剧原声合成（本地真实 ffmpeg，无模型/网络）",
  () => {
    beforeAll(async () => {
      fixtureDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "manhua-original-audio-test-")
      );
      const first = path.join(fixtureDir, "first.mp4");
      await exec("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=160x90:r=24:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=660:sample_rate=48000:duration=1",
        "-filter_complex",
        "[1:a][2:a]concat=n=2:v=0:a=1[a]",
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        first,
      ]);
      const last = path.join(fixtureDir, "last.mp4");
      await exec("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=green:s=160x90:r=30:d=1.2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=44100:duration=1.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        last,
      ]);
      const silent = path.join(fixtureDir, "silent.mp4");
      await exec("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=160x90:r=25:d=0.8",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        silent,
      ]);
      const music = path.join(fixtureDir, "short-music.wav");
      await exec("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1200:sample_rate=48000:duration=0.35",
        music,
      ]);
      const still = path.join(fixtureDir, "still.png");
      await exec("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=yellow:s=160x90",
        "-frames:v",
        "1",
        still,
      ]);
      for (const [key, value] of Object.entries({
        first,
        last,
        silent,
        music,
        still,
      }))
        media.sources.set(`https://test.invalid/${key}`, value);
    }, 30_000);

    it("手动裁切取到后半段真实原声；有声、无声、不同帧率片段拼接后不串位", async () => {
      const result = await renderSourceAudioFinal(
        {
          sceneVideos: [
            {
              url: "https://test.invalid/first",
              trimInSec: 1.2,
              trimOutSec: 1.8,
            },
            { url: "https://test.invalid/silent" },
            { url: "https://test.invalid/last" },
          ],
          transition: "cut",
        },
        { width: 160, height: 90 },
        await workDir()
      );
      const durations = await inspect(result);
      expect(durations.video).toBeCloseTo(2.6, 1);
      expect(Math.abs(durations.video - durations.audio)).toBeLessThan(0.05);
      const trimmed = await audioWindow(result, 0.2);
      expect(trimmed.magnitude(660)).toBeGreaterThan(0.03);
      expect(trimmed.magnitude(660)).toBeGreaterThan(
        trimmed.magnitude(440) * 8
      );
      expect((await audioWindow(result, 0.9)).rms).toBeLessThan(0.001);
      expect((await audioWindow(result, 1.8)).magnitude(880)).toBeGreaterThan(
        0.03
      );
    }, 30_000);

    it("淡化转场同步混合原声，短镜也不会被一秒转场吞光", async () => {
      const result = await renderSourceAudioFinal(
        {
          sceneVideos: [
            {
              url: "https://test.invalid/first",
              trimInSec: 0,
              trimOutSec: 0.6,
            },
            { url: "https://test.invalid/last" },
          ],
          transition: "fade",
        },
        { width: 160, height: 90 },
        await workDir()
      );
      const durations = await inspect(result);
      expect(durations.video).toBeCloseTo(1.5, 1);
      expect(Math.abs(durations.video - durations.audio)).toBeLessThan(0.06);
      expect((await audioWindow(result, 0.05)).magnitude(440)).toBeGreaterThan(
        0.03
      );
      expect((await audioWindow(result, 1.1)).magnitude(880)).toBeGreaterThan(
        0.03
      );
    }, 30_000);

    it("短配乐叠加而非替换原声，错误标注的0.2秒时长和-shortest均不得截尾", async () => {
      const result = await renderSourceAudioFinal(
        {
          sceneVideos: [{ url: "https://test.invalid/first", duration: 0.2 }],
          musicUrl: "https://test.invalid/music",
          musicVolume: 0.5,
        },
        { width: 160, height: 90 },
        await workDir()
      );
      const durations = await inspect(result);
      expect(durations.video).toBeCloseTo(2, 1);
      expect(Math.abs(durations.video - durations.audio)).toBeLessThan(0.06);
      const start = await audioWindow(result, 0.08);
      expect(start.magnitude(440)).toBeGreaterThan(0.03);
      expect(start.magnitude(1200)).toBeGreaterThan(0.02);
      expect((await audioWindow(result, 1.6)).magnitude(660)).toBeGreaterThan(
        0.03
      );
    }, 30_000);

    it("同源两镜仅下载一次，全部媒体下载携带取消时限", async () => {
      media.downloads.length = 0;
      const result = await renderSourceAudioFinal(
        {
          sceneVideos: [
            { url: "https://test.invalid/first", trimInSec: 0, trimOutSec: 1 },
            { url: "https://test.invalid/first", trimInSec: 1, trimOutSec: 2 },
          ],
          transition: "cut",
        },
        { width: 160, height: 90 },
        await workDir()
      );
      expect(media.downloads).toHaveLength(1);
      expect(media.downloads[0].signal).toBeInstanceOf(AbortSignal);
      expect((await inspect(result)).video).toBeCloseTo(2, 1);
      expect((await audioWindow(result, 0.3)).magnitude(440)).toBeGreaterThan(
        0.03
      );
      expect((await audioWindow(result, 1.4)).magnitude(660)).toBeGreaterThan(
        0.03
      );
    }, 30_000);

    it("静帧保持等长静音并保留前段声音，缺损裁切明确失败", async () => {
      const result = await renderSourceAudioFinal(
        {
          sceneVideos: [
            {
              url: "https://test.invalid/last",
              stillImageUrl: "https://test.invalid/still",
              stillDuration: 0.6,
            },
          ],
          transition: "cut",
        },
        { width: 160, height: 90 },
        await workDir()
      );
      expect((await inspect(result)).video).toBeCloseTo(1.8, 1);
      expect((await audioWindow(result, 0.4)).magnitude(880)).toBeGreaterThan(
        0.03
      );
      expect((await audioWindow(result, 1.4)).rms).toBeLessThan(0.001);
      await expect(
        renderSourceAudioFinal(
          {
            sceneVideos: [
              {
                url: "https://test.invalid/first",
                trimInSec: 0,
                trimOutSec: 5,
              },
            ],
          },
          { width: 160, height: 90 },
          await workDir()
        )
      ).rejects.toThrow("裁切范围超过实际素材");
    }, 30_000);
  }
);
