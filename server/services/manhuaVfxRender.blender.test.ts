import { beforeEach as beforeWorkerTest, afterEach as afterWorkerTest, vi as workerEnv } from "vitest";
beforeWorkerTest(() => { workerEnv.stubEnv("JOB_WORKER_ROLE", "rig"); workerEnv.stubEnv("FLY_MACHINE_ID", "test-vfx-worker"); workerEnv.stubEnv("MANHUA_HEAVY_MACHINE_ID", "test-vfx-worker"); });
afterWorkerTest(() => workerEnv.unstubAllEnvs());
/** Opt-in local integration; actual production launcher/renderer/gates/FFmpeg, synthetic transports only. */
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { renderManhuaVfx } from "./manhuaVfxRender";
import { runMediaTool } from "./postProduction";
import { runPrevisProcess } from "./manhuaPrevisRender";
import type { ManhuaVfxJob } from "../../shared/manhuaVfx";

it.skipIf(process.env.MANHUA_VFX_REAL_BLENDER_PROBE !== "1")("actual Blender image overlay passes service manifest gate and preserves source audio", async () => {
  const dir = path.resolve(process.env.MANHUA_VFX_PROBE_OUTPUT || "docs/evidence/manhua-vfx-1007/real-blender-service");
  await mkdir(dir, { recursive: false }); // Never overwrite a prior development receipt.
  const source = path.join(dir, "synthetic-source.mp4"), asset = path.join(dir, "synthetic-rgba.png"), output = path.join(dir, "result.mp4");
  const signal = AbortSignal.timeout(120_000);
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  await runMediaTool("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=blue:s=160x120:r=12:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source], signal);
  await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: .5 } } }).png().toFile(asset);
  const request: ManhuaVfxJob = { action: "manhua_vfx", scopeKey: "synthetic-development-only", requestId: "a1234567-1234-4234-8234-123456789abc", params: {
    videoUri: "gs://synthetic-only/source.mp4", sourceKey: "synthetic-source-v1", composition: { version: 1, seed: 7, effects: [{
      id: "image", kind: "image_overlay", imageUri: "gs://synthetic-only/image.png", startSec: .25, durationSec: .5,
      color: "#FFFFFF", scale: .3, intensity: 1, anchor: { space: "screen", position: [.5, .5] },
    }] },
  } };
  const archived: Array<{ name: string; bytes: number; sha256: string }> = [];
  let blenderRuns = 0;
  const result = await renderManhuaVfx(request, "7", signal, {
    fetch: async (uri, target) => {
      const input = uri === request.params.videoUri ? source : uri === request.params.composition.effects[0].imageUri ? asset : undefined;
      if (!input) throw new Error("Unexpected synthetic transport source");
      await copyFile(input, target); return (await stat(target)).size;
    },
    upload: async ({ objectName, buffer }) => {
      const name = path.basename(objectName); await writeFile(path.join(dir, name), buffer, { flag: "wx" });
      archived.push({ name, bytes: buffer.length, sha256: hash(buffer) });
      return { bucket: "synthetic-only", objectName, gcsUri: `gs://synthetic-only/${objectName}` };
    },
    runBlender: async (command, args, taskSignal) => {
      blenderRuns++;
      await writeFile(path.join(dir, "blender-command.json"), JSON.stringify({ command, args }));
      const log = await runPrevisProcess(command, args, taskSignal);
      await writeFile(path.join(dir, "blender.stdout.log"), log);
      // Preserve the real generated sequence and packed inspection scene before production cleanup.
      await cp(path.dirname(args[args.length - 1]), path.join(dir, "worker-output"), { recursive: true, errorOnExist: true });
      return log;
    },
    runMedia: runMediaTool,
    uploadResult: async params => {
      await copyFile(params.filePath, output);
      return { gcsUri: "gs://synthetic-only/result.mp4", url: "https://example.invalid/result.mp4", bytes: (await stat(output)).size };
    },
  });
  expect(blenderRuns).toBe(1);
  expect(result).toMatchObject({ width: 160, height: 120, fps: 12, durationSec: 1, hasAudio: true });
  const manifest = JSON.parse(await readFile(path.join(dir, "renderer-manifest.parsed.json"), "utf8"));
  expect(manifest.files).toHaveLength(12); expect(manifest.frames).toHaveLength(12);
  expect(manifest.frames.filter((frame: { effects: { active: boolean }[] }) => frame.effects[0].active).map((frame: { frame: number }) => frame.frame)).toEqual([4, 5, 6, 7, 8, 9]);
  expect(manifest.imageAssets).toHaveLength(1);
  const audioHash = async (file: string, codec: string) => (await runMediaTool("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", codec, "-f", "hash", "-hash", "sha256", "-"], signal)).stdout.trim();
  const audio = { sourcePackets: await audioHash(source, "copy"), outputPackets: await audioHash(output, "copy"),
    sourcePcm: await audioHash(source, "pcm_s16le"), outputPcm: await audioHash(output, "pcm_s16le") };
  expect(audio.outputPackets).toBe(audio.sourcePackets); expect(audio.outputPcm).toBe(audio.sourcePcm);
  const pixelReceipts = [];
  for (const frame of [1, 7, 12]) {
    const png = path.join(dir, `composite-${frame}.png`);
    await runMediaTool("ffmpeg", ["-v", "error", "-i", output, "-vf", `select=eq(n\\,${frame - 1})`, "-frames:v", "1", png], signal);
    const center = Array.from(await sharp(png).extract({ left: 80, top: 60, width: 1, height: 1 }).raw().toBuffer());
    const outside = Array.from(await sharp(png).extract({ left: 8, top: 8, width: 1, height: 1 }).raw().toBuffer());
    if (frame === 7) { expect(center[0]).toBeGreaterThan(90); expect(center[2]).toBeGreaterThan(90); expect(center[1]).toBeLessThan(20); }
    else { expect(center[0]).toBeLessThan(8); expect(center[2]).toBeGreaterThan(240); }
    expect(outside[0]).toBeLessThan(8); expect(outside[2]).toBeGreaterThan(240);
    pixelReceipts.push({ frame, center, outside });
  }
  const receipt = { boundary: "Synthetic media; only GCS fetch/upload transports replaced; actual production Blender launcher, fixed Python, full manifest gate and FFmpeg. Not online workflow acceptance; Linux untested.",
    blenderRuns, result, frameCount: manifest.frameCount, activeFrames: [4, 5, 6, 7, 8, 9], audio, pixelReceipts, archived };
  await writeFile(path.join(dir, "probe-result.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  await mkdir("docs/evidence/manhua-vfx-1007", { recursive: true });
  await writeFile("docs/evidence/manhua-vfx-1007/real-blender-service-receipt.json", JSON.stringify({ ...receipt, evidenceDirectory: dir }, null, 2), { flag: "wx" });
}, 150_000);
