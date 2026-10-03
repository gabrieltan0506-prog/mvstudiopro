import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ uploaded: null as null | { metadata: any; audioHash: string; videoHashes: string[] } }));
vi.mock("./postProduction.js", async () => {
  const actual = await vi.importActual<typeof import("./postProduction.js")>("./postProduction.js");
  return {
    ...actual,
    fetchPostProdSourceToFile: async (source: string, target: string) => { await fs.copyFile(source, target); return 1; },
    uploadResult: async (input: { filePath: string }) => {
      state.uploaded = { metadata: await actual.probe(input.filePath, AbortSignal.timeout(10000)), audioHash: audioHash(input.filePath), videoHashes: videoHashes(input.filePath, true) };
      return { url: "https://test.invalid/final.mp4", gcsUri: "gs://test-only/final.mp4" };
    },
  };
});
import { assertEnhancedVideo, finalizeEnhancedVideo, interpolateVideo } from "./videoEnhanceOutput";
function audioHash(file: string) {
  return execFileSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"], { encoding: "utf8" }).trim();
}
function videoHashes(file: string, selectEven = false) {
  const args = ["-v", "error", "-i", file, "-map", "0:v:0", "-vf", selectEven ? "select=not(mod(n\\,2)),format=yuv420p" : "format=yuv420p", "-f", "framemd5", "-"];
  return execFileSync("ffmpeg", args, { encoding: "utf8" }).split("\n").filter(line => line && !line.startsWith("#")).map(line => line.split(",").at(-1)!.trim());
}
let dir: string | undefined;
afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); state.uploaded = null; });
async function fixture(fps = 24) {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "test-only-enhancement-"));
  const source = path.join(dir, "source.mp4"), enhanced = path.join(dir, "enhanced.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc2=s=120x160:r=${fps}`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1.2", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", source]);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=120x160:r=96", "-t", "1.2", "-c:v", "libx264", "-threads", "1", enhanced]);
  return { source, enhanced };
}
it("96帧供应商输出归一60帧，真实处理保留原音频包与尺寸", async () => {
  const input = await fixture();
  await finalizeEnhancedVideo({ ...input, userId: 7, targetFps: 60 });
  expect(state.uploaded!.metadata).toMatchObject({ width: 120, height: 160, fps: 60, hasAudio: true });
  expect(state.uploaded!.audioHash).toBe(audioHash(input.source));
});
it("FFmpeg保真插帧保持尺寸、60帧、原始帧像素和音频包", async () => {
  const { source } = await fixture(30);
  await interpolateVideo({ videoUri: source, targetFps: 60 }, "7");
  expect(state.uploaded!.metadata).toMatchObject({ width: 120, height: 160, fps: 60, hasAudio: true });
  expect(state.uploaded!.audioHash).toBe(audioHash(source));
  const originalHashes = videoHashes(source);
  expect(state.uploaded!.videoHashes.slice(0, originalHashes.length)).toEqual(originalHashes);
});
it("4K不足与改变画幅或时长均拒绝交付", () => {
  const source = { width: 720, height: 1280, fps: 30, durationSec: 106.168 };
  expect(() => assertEnhancedVideo(source, { ...source, width: 1440, height: 2560 }, "4k")).toThrow("未达到所选尺寸");
  expect(() => assertEnhancedVideo(source, { ...source, width: 2160, height: 3840, durationSec: 100 }, "4k")).toThrow("改变了原片时长");
});
