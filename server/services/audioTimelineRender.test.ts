import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { audioTimelineParamsSchema, audioTrimParamsSchema } from "../jobs/postProdInput";
import { buildAudioTimelineArgs, buildAudioTrimArgs } from "./audioTimelineRender";

const h = vi.hoisted(() => ({ source: Buffer.alloc(0), outputs: [] as Buffer[] }));
vi.mock("./gcs.js", () => ({
  signGsUriV4ReadUrl: (uri: string) => `https://storage.googleapis.com/${uri.slice(5)}`,
  uploadBufferToGcs: async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
    h.outputs.push(buffer);
    return { gcsUri: `gs://test-bucket/${objectName}` };
  },
}));
import { trimAudio, renderAudioTimeline, normalizeDialogueAudio } from "./postProduction";

const clip = { audioUri: "gs://test-bucket/uploads/u7/a.wav", sourceStartSec: 0.25, sourceEndSec: 1.25 };

describe("音频裁段与秒锁输入", () => {
  it("保持单段默认音量，不自动添加淡入淡出", () => {
    expect(audioTrimParamsSchema.parse(clip)).toEqual({ ...clip, volume: 1, fadeInSec: 0, fadeOutSec: 0 });
  });
  it("拒绝空段、反向、无穷值、过长淡出及未知字段", () => {
    for (const bad of [{ sourceEndSec: .25 }, { sourceStartSec: 2 }, { volume: Infinity }, { fadeOutSec: 2 }, { loop: true }]) {
      expect(audioTrimParamsSchema.safeParse({ ...clip, ...bad }).success).toBe(false);
    }
  });
  it("拒绝超时间轴、超过30秒以及没有片段", () => {
    expect(audioTimelineParamsSchema.safeParse({ durationSec: 1, clips: [{ ...clip, startSec: .5 }] }).success).toBe(false);
    expect(audioTimelineParamsSchema.safeParse({ durationSec: 31, clips: [{ ...clip, startSec: 0 }] }).success).toBe(false);
    expect(audioTimelineParamsSchema.safeParse({ durationSec: 2, clips: [] }).success).toBe(false);
  });
  it("所有裁段/补白/输出使用有限样本和时长，路径保持独立argv", () => {
    const args = buildAudioTrimArgs(clip, "/tmp/a;evil.wav", "/tmp/out.wav");
    expect(args).toContain("/tmp/a;evil.wav");
    expect(args.join(" ")).toContain("atrim=start_sample=12000:end_sample=60000");
    expect(args).not.toContain("-stream_loop");
    const timeline = buildAudioTimelineArgs({ durationSec: 3, clips: [{ ...clip, startSec: 1 }] }, ["/tmp/c.wav"], "/tmp/o.wav");
    expect(timeline.join(" ")).toContain("adelay=48000S:all=1,apad=whole_len=144000,atrim=end_sample=144000");
    expect(timeline.slice(-3)).toEqual(["-t", "3", "/tmp/o.wav"]);
  });
});

// 真实 ffmpeg 的传输/上传仅以内存隔离，不接生产存储或凭证。
let dir = "";
let mediaToolsAvailable = false;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  mediaToolsAvailable = true;
} catch { /* 不具备媒体工具的测试机显式跳过，生产镜像已安装。 */ }
describe.skipIf(!mediaToolsAvailable)("音频裁段与秒锁真实媒体", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "audio-timeline-test-"));
    const sourcePath = path.join(dir, "source.wav");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:a", "pcm_s16le", sourcePath], { stdio: "ignore" });
    h.source = await readFile(sourcePath);
  });
  afterEach(() => { vi.unstubAllGlobals(); h.outputs.length = 0; });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
  function source() { vi.stubGlobal("fetch", async () => new Response(new Uint8Array(h.source))); }

  it("真实裁出1秒非空PCM及完整元数据，不覆盖源", async () => {
    source();
    const output = await trimAudio(clip, "7");
    expect(output.durationSec).toBe(1);
    expect(output.sourceDurationSec).toBe(2);
    expect(output.sourceStartSample).toBe(12000);
    expect(output.gcsUri).toMatch(/^gs:\/\/test-bucket\/post-prod\/7\/.+\.wav$/);
    expect(output.bytes).toBeGreaterThan(192000);
    expect(h.outputs[0].subarray(0, 4).toString()).toBe("RIFF");
    expect(h.outputs[0].some((byte) => byte > 127)).toBe(true);
  });
  it("拒绝超出源时长且不上传，不以静音补齐伪造成功", async () => {
    source();
    await expect(trimAudio({ ...clip, sourceEndSec: 2.1 }, "7")).rejects.toThrow("超出原音频");
    expect(h.outputs).toHaveLength(0);
  });
  it("非整秒MP3对白完整解码后用PCM真实时长合听，不消费四位门禁舍入值", async () => {
    const mp3 = path.join(dir, "fractional.mp3");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2.76", "-c:a", "libmp3lame", mp3], { stdio: "ignore" });
    const old = h.source;
    try {
      const normalized = await normalizeDialogueAudio(await readFile(mp3), new AbortController().signal);
      expect(normalized.durationSec).toBeCloseTo(2.76, 5);
      expect(normalized.buffer.subarray(0, 4).toString()).toBe("RIFF");
      h.source = normalized.buffer;
      source();
      const output = await renderAudioTimeline({ durationSec: 5, clips: [{ audioUri: "gs://test-bucket/post-prod/7/dialogue.wav", sourceStartSec: 0, sourceEndSec: normalized.durationSec, startSec: 1 }] }, "7");
      expect(output.durationSec).toBe(5);
      expect(output.clips[0].durationSec).toBe(normalized.durationSec);
    } finally { h.source = old; }
  });
  it("两个独立片段精确进场，3秒时间轴补空白且不是无限WAV", async () => {
    source();
    const output = await renderAudioTimeline({ durationSec: 3, clips: [{ ...clip, startSec: .5 }, { ...clip, startSec: 2, volume: .5 }] }, "7");
    expect(output.durationSec).toBe(3);
    expect(output.bytes).toBeGreaterThan(576000);
    expect(output.bytes).toBeLessThan(577000);
    expect(output.clips.map((c) => [c.startSample, c.endSec])).toEqual([[24000, 1.5], [96000, 3]]);
    // PCM 数据块按采样直接检查：0–0.4 秒全静音、0.6秒有声、1.6秒空白。
    const wav = h.outputs[0];
    const data = wav.indexOf(Buffer.from("data")) + 8;
    const samples = (a: number, b: number) => wav.subarray(data + a * 48000 * 4, data + b * 48000 * 4);
    expect(samples(0, .4).every((byte) => byte === 0)).toBe(true);
    expect(samples(.6, .7).some((byte) => byte !== 0)).toBe(true);
    expect(samples(1.6, 1.7).every((byte) => byte === 0)).toBe(true);
  });
  it("已中止任务不下载、不上传", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(); controller.abort();
    await expect(trimAudio(clip, "7", { signal: controller.signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled(); expect(h.outputs).toHaveLength(0);
  });
});
