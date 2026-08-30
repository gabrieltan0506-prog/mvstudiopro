import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { prepareEpisodeVideos, type NativeDeepReadMediaPreparationDeps } from "./manhuaNativeDeepReadRunner.js";

const exec = promisify(execFile);
const WIDTH = 160;
const HEIGHT = 96;
const FPS = 25;

async function media(cmd: string, args: string[], timeout = 30_000, signal?: AbortSignal): Promise<string> {
  const result = await exec(cmd, args, { timeout, signal, maxBuffer: 16 * 1024 * 1024 });
  return result.stdout;
}

async function binary(args: string[]): Promise<Buffer> {
  const result = await exec("ffmpeg", ["-v", "error", ...args], {
    timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer",
  });
  return result.stdout;
}

async function makeSource(path: string, hasAudio: boolean): Promise<void> {
  // 八列明暗块编码每帧序号；无需字体或 drawtext，可逐帧定位真实原片坐标。
  const source = `nullsrc=s=${WIDTH}x${HEIGHT}:r=${FPS}:d=8.4,`
    + "geq=lum='16+219*mod(floor(N/pow(2,floor(X/20))),2)':cb=128:cr=128";
  await media("ffmpeg", [
    "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", source,
    ...(hasAudio ? ["-f", "lavfi", "-i",
      "aevalsrc=0.15*sin(2*PI*(200*t+40*t*t))|0.15*sin(2*PI*(300*t+30*t*t)):s=48000:d=8.4"] : []),
    "-map", "0:v:0", ...(hasAudio ? ["-map", "1:a:0"] : []),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-threads", "1",
    "-g", "250", "-keyint_min", "250", "-sc_threshold", "0",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-t", "8.4", path,
  ]);
}

async function decodedFrameIds(path: string): Promise<number[]> {
  const bytes = await binary(["-i", path, "-map", "0:v:0", "-fps_mode", "passthrough",
    "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
  const frameBytes = WIDTH * HEIGHT;
  expect(bytes.length % frameBytes).toBe(0);
  return Array.from({ length: bytes.length / frameBytes }, (_, frame) => {
    let id = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      if (bytes[frame * frameBytes + 48 * WIDTH + bit * 20 + 10]! > 128) id |= 1 << bit;
    }
    return id;
  });
}

async function decodedAudio(path: string): Promise<Buffer> {
  return binary(["-i", path, "-map", "0:a:0", "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"]);
}

function audioCorrelation(source: Buffer, slice: Buffer, sourceStartSec: number): number {
  const channels = 2;
  const sampleRate = 48_000;
  const sourceOffset = Math.round(sourceStartSec * sampleRate) * channels;
  const edge = Math.round(0.1 * sampleRate) * channels;
  const end = Math.min(slice.length / 4 - edge, source.length / 4 - sourceOffset - edge);
  let dot = 0;
  let sourcePower = 0;
  let slicePower = 0;
  for (let index = edge; index < end; index += 1) {
    const a = source.readFloatLE((sourceOffset + index) * 4);
    const b = slice.readFloatLE(index * 4);
    dot += a * b;
    sourcePower += a * a;
    slicePower += b * b;
  }
  return dot / Math.sqrt(sourcePower * slicePower);
}

describe("生产同源精确切片：本地真实 ffmpeg，无云、无模型", () => {
  it.each([true, false])("非关键帧切点逐帧无前滚/重复/漏尾，原尺寸原帧率，hasAudio=%s", async (hasAudio) => {
    const directory = await mkdtemp(join(tmpdir(), "native-cut-integration-"));
    try {
      const source = join(directory, "source.mp4");
      await makeSource(source, hasAudio);
      const keyframes = JSON.parse(await media("ffprobe", ["-v", "error", "-select_streams", "v:0",
        "-skip_frame", "nokey", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time",
        "-of", "json", source])) as { frames: Array<{ best_effort_timestamp_time: string }> };
      expect(keyframes.frames.map((frame) => Number(frame.best_effort_timestamp_time))).toEqual([0]);
      const uploadedPaths = new Map<string, string>();
      const deps: NativeDeepReadMediaPreparationDeps = {
        runMedia: media, statLocal: stat, readLocal: readFile, unlinkLocal: unlink,
        statfsTmp: async () => ({ freeBytes: 2 * 1024 ** 3 }),
        remove: vi.fn(async () => undefined),
        upload: vi.fn(async ({ objectName, buffer }) => {
          const path = join(directory, `uploaded-${uploadedPaths.size}.mp4`);
          await writeFile(path, buffer);
          uploadedPaths.set(objectName, path);
          return { bucket: "test-only", objectName, gcsUri: `gs://test-only/${objectName}` };
        }) as NativeDeepReadMediaPreparationDeps["upload"],
      };
      const rows = await prepareEpisodeVideos({
        episodeIndex: 1, resolveNodes: async () => [{ url: source }],
        segments: [{ startSec: 0, endSec: 3.2 }, { startSec: 3.2, endSec: 6.4 }, { startSec: 6.4, endSec: 8 }],
        // 原片 8.4 秒，计划为整数 8 秒：末片必须读到真实 EOF，不能裁掉最后十帧。
        sourceDurationSec: 8,
      }, undefined, deps, { cutConcurrency: 1, uploadConcurrency: 1 });
      const expectedRanges = [[0, 80], [80, 160], [160, 210]];
      const allFrames: number[] = [];
      const originalAudio = hasAudio ? await decodedAudio(source) : undefined;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const path = uploadedPaths.get(row.temporaryGcs.objectName)!;
        const ids = await decodedFrameIds(path);
        const [from, to] = expectedRanges[index]!;
        expect(ids).toEqual(Array.from({ length: to! - from! }, (_, offset) => from! + offset));
        allFrames.push(...ids);
        expect(row.hasAudio).toBe(hasAudio);
        const info = JSON.parse(await media("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]));
        const video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
        expect([video.width, video.height, video.avg_frame_rate]).toEqual([WIDTH, HEIGHT, "25/1"]);
        expect(Number(video.start_time)).toBeCloseTo(0, 4);
        const audio = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
        if (hasAudio) {
          expect([audio.sample_rate, audio.channels]).toEqual(["48000", 2]);
          const correlation = audioCorrelation(originalAudio!, await decodedAudio(path), row.startSec);
          expect(correlation).toBeGreaterThan(0.98);
          console.info(`[本地切片验收] 音轨 ${row.startSec}..${row.endSec}s correlation=${correlation.toFixed(6)}`);
        } else expect(audio).toBeUndefined();
        console.info(`[本地切片验收] hasAudio=${hasAudio} 计划=${row.startSec}..${row.endSec}s `
          + `实际=${video.duration}s frames=${ids.length} first=${ids[0]} last=${ids.at(-1)} 尺寸=${WIDTH}x${HEIGHT} fps=25`);
      }
      expect(allFrames).toEqual(Array.from({ length: 210 }, (_, index) => index));
      expect(deps.upload).toHaveBeenCalledTimes(3);
      expect(deps.remove).not.toHaveBeenCalled();
    } finally {
      // 只清理本测试创建的无凭证合成媒体；没有任何模型 JSON 或真实资产。
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("真实 ffmpeg 成功退出但只取得 1.2/3 秒，也必须零上传并保留失败", async () => {
    const directory = await mkdtemp(join(tmpdir(), "native-short-cut-integration-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const source = join(directory, "source.mp4");
      await makeSource(source, false);
      const upload = vi.fn(async () => { throw new Error("残片不应上传"); });
      const deps: NativeDeepReadMediaPreparationDeps = {
        runMedia: media, statLocal: stat, readLocal: readFile, unlinkLocal: unlink,
        statfsTmp: async () => ({ freeBytes: 2 * 1024 ** 3 }), upload,
        remove: vi.fn(async () => undefined),
      };
      await expect(prepareEpisodeVideos({
        episodeIndex: 1, resolveNodes: async () => [{ url: source }],
        segments: [{ startSec: 7.2, endSec: 10.2 }], sourceDurationSec: 20,
      }, undefined, deps, { cutConcurrency: 1 })).rejects.toThrow("视频流实际时长 1.2 秒与计划");
      expect(upload).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
