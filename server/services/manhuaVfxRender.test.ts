/** Offline pipeline evidence: synthetic source and injected RGBA renderer; no upstream/GCS calls. */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { renderManhuaVfx, parseVfxVideoProbe } from "./manhuaVfxRender";
import { runMediaTool } from "./postProduction";
import type { ManhuaVfxJob } from "../../shared/manhuaVfx";
const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const request: ManhuaVfxJob = { action: "manhua_vfx", scopeKey: "offline-scope", requestId: "12345678-1234-4234-8234-123456789abc", params: {
  sourceKey: "offline-source-v1", videoUri: "gs://offline-only/source.mp4", composition: { version: 1, seed: 1, effects: [{
    id: "shield", kind: "shield", startSec: 0, durationSec: 1, color: "#FF0000", scale: 0.2, intensity: 1, anchor: { space: "screen", position: [0.5, 0.5] },
  }] },
} };
describe("VFX render/composite boundary", () => {
  it("uses video duration and exact rational rate; rejects rotated source instead of misplacing effects", () => {
    const json = { format: { duration: "3" }, streams: [{ codec_type: "video", width: 64, height: 64, duration: "1", avg_frame_rate: "30000/1001" }, { codec_type: "audio" }] };
    expect(parseVfxVideoProbe(JSON.stringify(json))).toEqual({ durationSec: 1, width: 64, height: 64, fps: 30000 / 1001, hasAudio: true });
    expect(() => parseVfxVideoProbe(JSON.stringify({ ...json, streams: [{ ...json.streams[0], side_data_list: [{ rotation: 90 }] }] }))).toThrow("转正");
  });
  it("archives raw output before parsing, composites real pixels, and copies the source audio", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vfx-pipeline-evidence-"));
    const source = path.join(dir, "source.mp4"), output = path.join(dir, "output.mp4");
    const signal = AbortSignal.timeout(60_000);
    await runMediaTool("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=blue:s=64x64:r=12:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source], signal);
    const archived = new Map<string, Buffer>();
    const result = await renderManhuaVfx(request, "7", signal, {
      fetch: async (_uri, target) => { await copyFile(source, target); return (await stat(target)).size; },
      upload: async ({ objectName, buffer }) => {
        const name = path.basename(objectName); archived.set(name, Buffer.from(buffer)); await writeFile(path.join(dir, name), buffer);
        return { bucket: "offline-only", objectName, gcsUri: `gs://offline-only/${objectName}` };
      },
      runBlender: async (_command, args) => {
        const specPath = args[args.length - 2], layers = args[args.length - 1];
        const specBytes = await readFile(specPath), spec = JSON.parse(String(specBytes));
        expect(archived.has("request.raw.json")).toBe(true); expect(archived.has("spec.normalized.json")).toBe(true);
        const rgba = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
        const files = [];
        for (let frame = 1; frame <= 12; frame++) {
          const name = `frame-${String(frame).padStart(6, "0")}.png`; await writeFile(path.join(layers, name), rgba);
          files.push({ frame, path: name, bytes: rgba.length, sha256: hash(rgba) });
        }
        await writeFile(path.join(layers, "input.raw.json"), specBytes);
        await writeFile(path.join(layers, "spec.normalized.json"), specBytes);
        await writeFile(path.join(layers, "manifest.json"), JSON.stringify({ complete: true, width: spec.width, height: spec.height, fps: spec.fps, frameCount: 12, alpha: "straight", colorSpace: "sRGB", files, frames: files.map(row => ({ frame: row.frame, timeSec: (row.frame - 1) / 12, effects: [{ id: "shield", kind: "shield", active: true, progress: (row.frame - 1) / 12, opacity: 0.5, position: [0.5, 0.5] }] })) }));
        return "offline renderer fixture";
      },
      runMedia: async (command, args, taskSignal) => {
        if (command === "ffmpeg") expect(archived.has("renderer-manifest.json")).toBe(true);
        return runMediaTool(command, args, taskSignal);
      },
      uploadResult: async params => {
        await copyFile(params.filePath, output);
        return { gcsUri: "gs://offline-only/output.mp4", url: "https://example.invalid/output.mp4", bytes: (await stat(output)).size };
      },
    });
    expect(result.durationSec).toBe(1); expect(result.sourceKey).toBe(request.params.sourceKey); expect(result.composition).toEqual(request.params.composition);
    expect(JSON.parse(String(archived.get("renderer-manifest.parsed.json"))).files).toHaveLength(12);
    const audioHash = async (file: string) => (await runMediaTool("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "hash", "-hash", "sha256", "-"], signal)).stdout.trim();
    expect(await audioHash(output)).toBe(await audioHash(source));
    const png = path.join(dir, "frame.png");
    await runMediaTool("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", png], signal);
    const pixel = await sharp(png).extract({ left: 32, top: 32, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[0]).toBeGreaterThan(80); expect(pixel[2]).toBeGreaterThan(80); expect(pixel[1]).toBeLessThan(20);
    await mkdir("docs/evidence/manhua-vfx-1007", { recursive: true });
    await writeFile("docs/evidence/manhua-vfx-1007/offline-pipeline-receipt.json", JSON.stringify({ boundary: "synthetic source; injected renderer; real ffmpeg; no cloud or workflow acceptance", dir, result, audioHash: await audioHash(output), pixel: Array.from(pixel), archived: Array.from(archived).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) })) }, null, 2));
  }, 90_000);
});
