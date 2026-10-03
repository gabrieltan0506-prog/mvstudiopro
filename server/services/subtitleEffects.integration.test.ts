/** Real local ffmpeg, synthetic media only. Storage/network are stubbed, never production. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const exec = promisify(execFile);
const h = vi.hoisted(() => ({ uploads: new Map<string, Buffer>() }));
vi.mock("./gcs.js", () => ({
  signGsUriV4ReadUrl: () => "https://storage.googleapis.com/subtitle-test/source.mp4",
  uploadStreamToGcs: async (input: { objectName: string; stream: ReadableStream<Uint8Array>; signal?: AbortSignal }) => {
    input.signal?.throwIfAborted();
    h.uploads.set(input.objectName, Buffer.from(await new Response(input.stream).arrayBuffer()));
    return { gcsUri: `gs://subtitle-test/${input.objectName}` };
  },
}));
import { burnSubtitle } from "./postProduction";

let hasLibass = false;
try {
  hasLibass = /\bsubtitles\s+V->V/.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
} catch { hasLibass = false; }

let dir = "";
beforeAll(async () => {
  if (!hasLibass) return;
  dir = await mkdtemp(path.join(tmpdir(), "subtitle-effects-test-"));
  await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:size=360x640:rate=30:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", path.join(dir, "source.mp4")]);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function frame(file: string, time: number) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-i", file, "-ss", String(time), "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  const pixels = stdout as Buffer;
  let ink = 0, sum = 0, left = 360, right = 0, top = 640, bottom = 0;
  for (let i = 0; i < pixels.length; i++) {
    sum += pixels[i];
    if (pixels[i] > 40) { ink++; left = Math.min(left, i % 360); right = Math.max(right, i % 360); top = Math.min(top, Math.floor(i / 360)); bottom = Math.max(bottom, Math.floor(i / 360)); }
  }
  return { ink, sum, left, right, top, bottom, hash: createHash("sha256").update(pixels).digest("hex") };
}

async function audioHash(file: string) {
  return (await exec("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "copy", "-f", "hash", "-hash", "sha256", "pipe:1"])).stdout.trim();
}

describe.runIf(hasLibass)("字幕特效实际烧录", () => {
  it("两种特效确实改变入场帧，保留时间窗口/原音轨/尺寸/帧率，长句不裁切", async () => {
    const source = path.join(dir, "source.mp4");
    const sourceBytes = await readFile(source);
    vi.stubGlobal("fetch", async (url: unknown) => {
      if (String(url) !== "https://storage.googleapis.com/subtitle-test/source.mp4") throw new Error("unexpected network request");
      return new Response(new Uint8Array(sourceBytes), { headers: { "content-length": String(sourceBytes.length) } });
    });
    const originalAudio = await audioHash(source);
    const results: Record<string, Awaited<ReturnType<typeof frame>>> = {};
    const evidence = process.env.SUBTITLE_EFFECT_EVIDENCE_DIR;
    if (evidence) await mkdir(evidence, { recursive: true });
    for (const effect of ["fade", "pop"] as const) {
      const result = await burnSubtitle({ videoUri: "gs://subtitle-test/source.mp4", effect,
        subtitleSrt: "1\n00:00:00,200 --> 00:00:01,700\n小杂种，该不会是要拿它来抵药钱吧\n",
        styleOverride: { fontSize: 16, outline: 0.35, marginV: 12, fontName: "Noto Sans CJK SC" },
      }, "test");
      expect(result.cueCount).toBe(1);
      const output = h.uploads.get(result.gcsUri.replace("gs://subtitle-test/", ""))!;
      const file = path.join(dir, `${effect}.mp4`);
      await writeFile(file, output);
      const meta = JSON.parse((await exec("ffprobe", ["-v", "quiet", "-show_streams", "-show_format", "-of", "json", file])).stdout);
      const video = meta.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
      expect([video.width, video.height, video.r_frame_rate]).toEqual([360, 640, "30/1"]);
      expect(Number(meta.format.duration)).toBeCloseTo(2, 1);
      expect(await audioHash(file)).toBe(originalAudio);
      const before = await frame(file, 0.1), early = await frame(file, 0.233333), mature = await frame(file, 0.65), late = await frame(file, 1.666667), after = await frame(file, 1.8);
      expect(before.ink).toBe(0); expect(after.ink).toBe(0);
      expect(mature.ink).toBeGreaterThan(100);
      expect(early.sum).toBeLessThan(mature.sum * 0.7);
      expect(late.sum).toBeLessThan(mature.sum * 0.7);
      expect(mature.left).toBeGreaterThan(15); expect(mature.right).toBeLessThan(345);
      expect(mature.top).toBeGreaterThan(0); expect(mature.bottom).toBeLessThan(630);
      results[effect] = early;
      if (evidence) {
        await writeFile(path.join(evidence, `${effect}-synthetic.mp4`), output);
        await writeFile(path.join(evidence, `${effect}-proof.json`), JSON.stringify({ result, video, originalAudio, before, early, mature, late, after }, null, 2));
        await exec("ffmpeg", ["-y", "-v", "error", "-i", file, "-ss", "0.65", "-frames:v", "1", path.join(evidence, `${effect}-synthetic.png`)]);
      }
    }
    // Different entry geometry is visible in actual pixels, not just ASS text.
    expect(results.fade.hash).not.toBe(results.pop.hash);
  }, 60_000);
});
