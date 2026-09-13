/** 虚构正弦测试媒体；真实 ffmpeg/ffprobe，不调用模型或网络。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { musicMvRenderDurationSec } from "../../shared/canvasMusicMv";

const fixture = vi.hoisted(() => ({
  root: "",
  sources: new Map<string, string>(),
  temps: [] as string[],
  outputCount: 0,
}));
vi.mock("./renderUtils.js", async load => ({
  ...(await load<typeof import("./renderUtils.js")>()),
  resolutionToSize: () => ({ width: 160, height: 90 }),
  makeTempDir: async () => {
    const dir = await fs.mkdtemp(path.join(fixture.root, "render-"));
    fixture.temps.push(dir);
    return dir;
  },
  downloadFileToPath: async (url: string, target: string) => {
    const source = fixture.sources.get(url);
    if (!source) throw new Error("测试禁止网络或真实素材");
    await fs.copyFile(source, target);
    return target;
  },
}));
vi.mock("../services/publicRenderMedia.js", () => ({
  uploadFileToPublicRenderMedia: async (file: string) => {
    const target = path.join(
      fixture.root,
      `final-${fixture.outputCount++}.mp4`
    );
    await fs.copyFile(file, target);
    return target;
  },
}));
import { runManhuaAssembleFinal } from "../services/manhuaAssembleFinalService";
import { buildManhuaAssembleJobInput } from "../../shared/manhuaAssembleJobInput";
import { renderSourceAudioFinal } from "./renderSourceAudio";

const exec = promisify(execFile);
async function inspect(file: string) {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,duration,nb_frames:format=duration,size",
    "-of",
    "json",
    file,
  ]);
  return JSON.parse(stdout);
}
async function measure(file: string, start: number) {
  const { stdout } = await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(start),
      "-i",
      file,
      "-t",
      "0.2",
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
    { encoding: "buffer" }
  );
  const samples = Array.from({ length: stdout.length / 4 }, (_, i) =>
    stdout.readFloatLE(i * 4)
  );
  const spectrum = (hz: number) => {
    let real = 0;
    let imaginary = 0;
    samples.forEach((value, i) => {
      real += value * Math.cos((2 * Math.PI * hz * i) / 8000);
      imaginary += value * Math.sin((2 * Math.PI * hz * i) / 8000);
    });
    return (2 * Math.hypot(real, imaginary)) / samples.length;
  };
  return {
    start,
    rms: Math.sqrt(
      samples.reduce((sum, value) => sum + value * value, 0) / samples.length
    ),
    source440: spectrum(440),
    source880: spectrum(880),
    song1400: spectrum(1400),
  };
}

describe("MV 仅歌曲合成真实媒体", () => {
  beforeAll(async () => {
    fixture.root = await fs.mkdtemp(
      path.join(os.tmpdir(), "music-only-proof-")
    );
    for (const [name, color, frequency, duration] of [
      ["a", "red", 440, 2.4],
      ["b", "blue", 880, 1.6],
    ] as const) {
      const file = path.join(fixture.root, `${name}.mp4`);
      await exec("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=160x90:r=30:d=${duration}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        file,
      ]);
      fixture.sources.set(`https://test.invalid/${name}`, file);
    }
    const song = path.join(fixture.root, "fictional-song.wav");
    await exec("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1400:sample_rate=48000:duration=4",
      "-c:a",
      "pcm_s16le",
      song,
    ]);
    fixture.sources.set("https://test.invalid/song", song);
  }, 30_000);

  it("共享任务参数经真实服务与渲染器保留完整歌曲，所有片段原声均移除", async () => {
    const started = Date.now();
    const payload = buildManhuaAssembleJobInput({
      clips: [
        {
          episodeIndex: 1,
          segmentIndex: 1,
          clipUrl: "https://test.invalid/a",
          trimInSec: 0,
          trimOutSec: 2.4,
        },
        {
          episodeIndex: 1,
          segmentIndex: 2,
          clipUrl: "https://test.invalid/b",
          trimInSec: 0,
          trimOutSec: 1.6,
        },
      ],
      transition: "cut",
      musicOnly: true,
      musicUrl: "https://test.invalid/song",
      musicVolume: 1,
      musicFadeInSec: 0,
      musicFadeOutSec: 0,
    });
    const result = await runManhuaAssembleFinal(payload.params);
    const probe = await inspect(result.finalVideoUrl);
    expect(
      Number(probe.streams.find((s: any) => s.codec_type === "video").duration)
    ).toBeCloseTo(4, 2);
    expect(
      Number(probe.streams.find((s: any) => s.codec_type === "audio").duration)
    ).toBeCloseTo(4, 1);
    const windows = await Promise.all(
      [0.4, 2.8, 3.6].map(start => measure(result.finalVideoUrl, start))
    );
    for (const window of windows) {
      expect(window.rms).toBeGreaterThan(0.05);
      expect(window.song1400).toBeGreaterThan(0.08);
      expect(window.source440).toBeLessThan(0.001);
      expect(window.source880).toBeLessThan(0.001);
    }
    // 普通合成原声路径仍须保留，避免音乐开关影响既有成片。
    const control = await runManhuaAssembleFinal({
      ...payload.params,
      musicOnly: false,
    });
    const controlWindows = await Promise.all(
      [0.4, 2.8].map(start => measure(control.finalVideoUrl, start))
    );
    expect(controlWindows[0]!.source440).toBeGreaterThan(0.08);
    expect(controlWindows[1]!.source880).toBeGreaterThan(0.08);
    for (const dir of fixture.temps)
      await expect(fs.access(dir)).rejects.toThrow();
    const bytes = await fs.readFile(result.finalVideoUrl);
    const evidence = {
      testMedia: "虚构正弦媒体，非歌曲或付费产物",
      file: result.finalVideoUrl,
      elapsedMs: Date.now() - started,
      probe,
      windows,
      controlWindows,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      renderTempDirectoriesRemoved: fixture.temps.length,
    };
    await fs.writeFile(
      path.join(fixture.root, "evidence.json"),
      JSON.stringify(evidence, null, 2)
    );
    console.info("真实MV仅歌曲合成回执", JSON.stringify(evidence));
  }, 30_000);

  it("底层也拒绝缺少选定歌曲，不静默泄回原声", async () => {
    await expect(
      renderSourceAudioFinal(
        { sceneVideos: [{ url: "https://test.invalid/a" }], musicOnly: true },
        { width: 160, height: 90 },
        fixture.root
      )
    ).rejects.toThrow("缺少选定歌曲");
  });
  it("十个0.53秒窗口先测独立取帧累积，再测绝对时间差分消除误差", async () => {
    const targetDuration = 5.3;
    const song = path.join(fixture.root, "fractional-song.wav");
    await exec("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1400:sample_rate=48000:duration=5.3",
      "-c:a",
      "pcm_s16le",
      song,
    ]);
    fixture.sources.set("https://test.invalid/fractional-song", song);
    const windows = Array.from({ length: 10 }, (_, index) => ({
      start: index * 0.53,
      end: (index + 1) * 0.53,
    }));
    const renderWindows = async (aligned: boolean) => {
      const clips = windows.map((window, index) => ({
        episodeIndex: 1,
        segmentIndex: index + 1,
        clipUrl: "https://test.invalid/a",
        trimInSec: 0,
        trimOutSec: aligned
          ? musicMvRenderDurationSec({
              startSec: window.start,
              endSec: window.end,
            })
          : window.end - window.start,
      }));
      const result = await runManhuaAssembleFinal(
        buildManhuaAssembleJobInput({
          clips,
          transition: "cut",
          musicOnly: true,
          musicUrl: "https://test.invalid/fractional-song",
          musicVolume: 1,
          musicFadeInSec: 0,
          musicFadeOutSec: 0,
        }).params
      );
      const probe = await inspect(result.finalVideoUrl);
      const video = probe.streams.find(
        (stream: any) => stream.codec_type === "video"
      );
      return {
        file: result.finalVideoUrl,
        frames: Number(video.nb_frames),
        durationSec: Number(video.duration),
        audioDurationSec: Number(
          probe.streams.find((stream: any) => stream.codec_type === "audio")
            .duration
        ),
        windows: clips.map(clip => clip.trimOutSec),
        tail: await measure(result.finalVideoUrl, 5.05),
      };
    };
    const original = await renderWindows(false);
    const cumulative = await renderWindows(true);
    const evidence = {
      targetDuration,
      expectedFrames: 159,
      original,
      cumulative,
    };
    await fs.writeFile(
      path.join(fixture.root, "fractional-timing.json"),
      JSON.stringify(evidence, null, 2)
    );
    console.info("真实MV分数镜长回执", JSON.stringify(evidence));
    expect(original.frames).toBe(160);
    expect(original.durationSec - targetDuration).toBeGreaterThan(0.03);
    expect(cumulative.frames).toBe(159);
    expect(
      Math.abs(cumulative.durationSec - targetDuration)
    ).toBeLessThanOrEqual(1 / 30);
    expect(cumulative.tail.song1400).toBeGreaterThan(0.08);
  }, 30_000);
});
