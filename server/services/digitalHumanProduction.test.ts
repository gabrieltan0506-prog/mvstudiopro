import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const state = vi.hoisted(() => ({ files: new Map<string, string>(), dir: "", counter: 0 }));
vi.mock("./postProduction", async importOriginal => {
  const actual = await importOriginal<typeof import("./postProduction")>();
  return { ...actual,
    fetchPostProdSourceToFile: async (uri: string, target: string) => {
      const path = state.files.get(uri); if (!path) throw new Error("测试素材未登记");
      await copyFile(path, target); return 1;
    },
    uploadResult: async (p: { filePath: string; ext: string }) => {
      const id = ++state.counter, target = join(state.dir, `result-${id}.${p.ext}`), gcsUri = `gs://test-only/post-prod/7/${id}.${p.ext}`;
      await copyFile(p.filePath, target); state.files.set(gcsUri, target);
      return { gcsUri, url: `https://example.test/${id}.${p.ext}`, bytes: (await readFile(target)).length };
    },
  };
});
import { renderDigitalHumanProduction, digitalHumanMixFilter, parseDigitalHumanSilences } from "./digitalHumanProduction";
import { runMediaTool, probeAudio, probe } from "./postProduction";
import { digitalHumanFinalParamsSchema } from "../../shared/digitalHumanProduction";

const id = "00000000-0000-4000-8000-000000000001";
const signal = () => AbortSignal.timeout(120_000);
const hasFfmpeg = process.env.DH_FFMPEG_TEST === "1";
it("解析静音回执，保留末尾静音；混音滤镜只接受受控参数", () => {
  expect(parseDigitalHumanSilences("silence_start: 1\nsilence_end: 2\nsilence_start: 5", 6)).toEqual([{ start: 1, end: 2 }, { start: 5, end: 6 }]);
  const p = digitalHumanFinalParamsSchema.parse({ audioUri: "gs://test/a", audioRequestId: id, clips: [{ videoUri: "gs://test/v", startSec: 0, endSec: 2 }], voice: { pan: -1, room: "cafe", volume: 1 }, tracks: [], aspectRatio: "9:16" });
  expect(digitalHumanMixFilter(p, 2)).toContain("c0=1.000000*c0|c1=0.000000*c0");
  expect(digitalHumanMixFilter(p, 2)).not.toContain("[0:a]");
});

describe.skipIf(!hasFfmpeg)("真实FFmpeg本地探针（合成测试信号，不调用云端）", () => {
  beforeAll(async () => { state.dir = await mkdtemp(join(tmpdir(), "dh-ffmpeg-test-")); });
  afterAll(async () => { await rm(state.dir, { recursive: true, force: true }); });
  it("66秒原声按真实静音切段，清单和每段音频完整可读", async () => {
    const path = join(state.dir, "long.wav");
    await runMediaTool("ffmpeg", ["-y", "-f", "lavfi", "-i", "aevalsrc=if(lt(mod(t\\,22)\\,20)\\,0.1*sin(2*PI*440*t)\\,0):s=48000:d=66", "-c:a", "pcm_s16le", path], signal());
    state.files.set("gs://test-only/long.wav", path);
    const result = await renderDigitalHumanProduction({ action: "digital_human_audio_split", params: { audioUri: "gs://test-only/long.wav", audioRequestId: id, script: "仅用于分段验证的合成音频信号" } }, "7", signal());
    if (!("manifest" in result)) throw new Error("没有清单");
    expect(result.manifest.durationSec).toBeCloseTo(66, 3); expect(result.manifest.segments.length).toBeGreaterThan(2);
    let sum = 0;
    for (const s of result.manifest.segments) { const duration = await probeAudio(state.files.get(s.audioUri)!, signal()); sum += duration; expect(duration).toBeLessThanOrEqual(30); expect(duration).toBeGreaterThanOrEqual(4); }
    expect(sum).toBeCloseTo(66, 2);
  }, 120_000);
  it("真实尾帧可读；最终声轨使用独立原声及BGM而不混入模型声音", async () => {
    const video = join(state.dir, "video.mp4"), voice = join(state.dir, "voice.wav"), music = join(state.dir, "music.wav");
    await runMediaTool("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", video], signal());
    for (const [frequency, path] of [[440, voice], [660, music]] as const) await runMediaTool("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=2`, "-c:a", "pcm_s16le", path], signal());
    state.files.set("gs://test-only/video", video); state.files.set("gs://test-only/voice", voice); state.files.set("gs://test-only/music", music);
    const frame = await renderDigitalHumanProduction({ action: "digital_human_continuity_frame", params: { videoUri: "gs://test-only/video", atSec: 2 } }, "7", signal());
    const png = await readFile(state.files.get(frame.gcsUri)!); expect(png.subarray(1, 4).toString()).toBe("PNG");
    await expect(renderDigitalHumanProduction({ action: "digital_human_continuity_frame", params: { videoUri: "gs://test-only/video", atSec: 4 } }, "7", signal())).rejects.toThrow("不足以覆盖");
    const result = await renderDigitalHumanProduction({ action: "digital_human_final", params: { audioUri: "gs://test-only/voice", audioRequestId: id, clips: [{ videoUri: "gs://test-only/video", startSec: 0, endSec: 2 }], voice: { pan: 0, room: "small", volume: 1 }, tracks: [{ source: "gs://test-only/music", name: "测试BGM", startSec: 0, sourceStartSec: 0, durationSec: 2, volume: 0.15, fadeInSec: 0.1, fadeOutSec: 0.1, duck: true }], aspectRatio: "16:9" } }, "7", signal());
    const target = state.files.get(result.gcsUri)!;
    expect(await probe(target, signal())).toMatchObject({ width: 1920, height: 1080, hasAudio: true });
    const pcm = join(state.dir, "final.f32");
    await runMediaTool("ffmpeg", ["-y", "-i", target, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", pcm], signal());
    const bytes = await readFile(pcm);
    function energy(hz: number) { let re = 0, im = 0; for (let i = 12000; i < 36000; i++) { const x = bytes.readFloatLE(i * 4), angle = 2 * Math.PI * hz * i / 48000; re += x * Math.cos(angle); im += x * Math.sin(angle); } return re * re + im * im; }
    expect(energy(440)).toBeGreaterThan(energy(880) * 1000);
    expect(energy(660)).toBeGreaterThan(energy(880) * 10);
  }, 120_000);
});
