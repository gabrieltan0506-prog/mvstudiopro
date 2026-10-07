/** Explicitly authorized isolated Fly probe. Never starts a worker, queues a user job, or calls a model. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { neon } from "@neondatabase/serverless";
import { renderManhuaVfx } from "../server/services/manhuaVfxRender";
import { renderManhuaTransitions } from "../server/services/manhuaTransitions";
import { runMediaTool } from "../server/services/postProduction";
import { blenderLaunchCommand, runPrevisProcess } from "../server/services/manhuaPrevisRender";
import { uploadBufferToGcs, downloadGcsObject } from "../server/services/gcs";
import { MANHUA_VFX_KINDS, type ManhuaVfxJob } from "../shared/manhuaVfx";
import { refreshManhuaAdvisorKnowledge, resolveManhuaAdvisorKnowledgeTemplate } from "../server/services/manhuaAdvisorKnowledge";

const [machine, runId, phase, manifestName = "source-manifest.json"] = process.argv.slice(2);
assert(machine && process.env.FLY_MACHINE_ID === machine, "Run only on the explicitly selected Fly machine");
assert(/^[a-zA-Z0-9_-]+$/.test(runId || ""), "Unique run ID required");
assert(/^(vfx|transition|cloth|explode|label|knowledge)(?:-r[2-9][0-9]*)?$/.test(phase), "Unknown probe phase");
const mode = phase.replace(/-r[0-9]+$/, "");
assert(/^source-manifest(?:-[a-zA-Z0-9]+)?\.json$/.test(manifestName), "Invalid manifest name");
assert(process.cwd().startsWith("/tmp/pr1675-isolated-"), "Refuse production working directory");
const sql = neon(process.env.DATABASE_URL!);
const pending = await sql`SELECT id,type,status FROM jobs WHERE status in ('queued','running')`;
assert.equal(pending.length, 0, "User work is in flight; probe not started");
const dir = path.resolve("evidence", phase);
await mkdir(dir, { recursive: false }); // Refuse accidental replay/overwrite, including failures.
const prefix = `post-prod/isolated-pr1675/probe-evidence/${runId}/${phase}`;
const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const receipts: Array<{ name: string; gcsUri: string; bytes: number; sha256: string; readBackVerified: boolean }> = [];
const signal = new AbortController().signal;
const startedAt = Date.now();
const save = async (name: string, buffer: Buffer, contentType = "application/json") => {
  await writeFile(path.join(dir, name), buffer, { flag: "wx" });
  const saved = await uploadBufferToGcs({ objectName: `${prefix}/${name}`, buffer, contentType });
  const read = await downloadGcsObject({ gcsUri: saved.gcsUri });
  assert.equal(hash(read.buffer), hash(buffer), `Cloud roundtrip ${name}`);
  const receipt = { name, gcsUri: saved.gcsUri, bytes: buffer.length, sha256: hash(buffer), readBackVerified: true };
  receipts.push(receipt);
  return saved.gcsUri;
};
const archiveDirectory = async (root: string, relative = "") => {
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    if (item.isDirectory()) await archiveDirectory(root, name);
    else if (/\.(json|png|log|blend)$/.test(name)) {
      const bytes = await readFile(path.join(root, name));
      await save(`scene-${name.replaceAll(path.sep, "--")}`, bytes, name.endsWith(".json") ? "application/json" : name.endsWith(".png") ? "image/png" : "application/octet-stream");
    }
  }
};
await save("preflight.json", Buffer.from(JSON.stringify({ at: new Date().toISOString(), machine, phase, pending, source: JSON.parse(await readFile(manifestName, "utf8")), boundary: "Authorized isolated worker probe with synthetic inputs and real cloud transports; not logged-in workflow acceptance" })));
console.log(JSON.stringify({ event: "started", phase, machine, runId }));
try {
  let result: Record<string, unknown>;
  if (mode === "vfx") {
    const source = path.join(dir, "source.mp4");
    await runMediaTool("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=blue:s=480x360:r=12:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source], signal);
    const sourceBytes = await readFile(source);
    const sourceObject = await uploadBufferToGcs({ objectName: `${prefix}/source.mp4`, buffer: sourceBytes, contentType: "video/mp4" });
    const image = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: .5 } } }).png().toBuffer();
    const imageUri = await save("overlay.png", image, "image/png");
    const request: ManhuaVfxJob = { action: "manhua_vfx", scopeKey: "isolated-pr1675", requestId: "c1007000-1234-4234-8234-123456789abc", params: {
      videoUri: sourceObject.gcsUri, sourceKey: `synthetic-${runId}`, composition: { version: 1, seed: 777, effects: MANHUA_VFX_KINDS.map((kind, index) => ({
        id: kind, kind, startSec: 1 / 12, durationSec: .75, color: "#67E8F9", scale: .2, intensity: 1.5,
        ...(kind === "image_overlay" ? { imageUri } : {}),
        anchor: { space: "screen", position: [((index % 4) + .5) / 4, (Math.floor(index / 4) + .5) / 3] },
      })) },
    } };
    await save("probe-request.json", Buffer.from(JSON.stringify(request)));
    // No dependency injection: real production service, downloader, Blender, FFmpeg and GCS upload.
    const output = await renderManhuaVfx(request, "isolated-pr1675", signal);
    const { buffer } = await downloadGcsObject({ gcsUri: output.gcsUri });
    const out = path.join(dir, "result.mp4"); await writeFile(out, buffer, { flag: "wx" });
    const audioHash = async (file: string, codec: string) => (await runMediaTool("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", codec, "-f", "hash", "-hash", "sha256", "-"], signal)).stdout.trim();
    const audio = { sourcePackets: await audioHash(source, "copy"), resultPackets: await audioHash(out, "copy"), sourcePcm: await audioHash(source, "pcm_s16le"), resultPcm: await audioHash(out, "pcm_s16le") };
    assert.equal(audio.sourcePackets, audio.resultPackets); assert.equal(audio.sourcePcm, audio.resultPcm);
    const serviceReceipts = [...output.evidence, output.resultEvidence];
    for (const receipt of serviceReceipts) {
      const read = await downloadGcsObject({ gcsUri: receipt.gcsUri });
      assert.equal(read.buffer.length, receipt.bytes); assert.equal(hash(read.buffer), receipt.sha256);
      await writeFile(path.join(dir, `service-${receipt.name}`), read.buffer, { flag: "wx" });
    }
    const manifest = JSON.parse(await readFile(path.join(dir, "service-renderer-manifest.parsed.json"), "utf8"));
    assert.equal(manifest.frameCount, 12); assert.equal(manifest.frames.length, 12);
    assert(manifest.frames.every((row: { effects: unknown[] }) => row.effects.length === 12));
    const visual = [];
    for (const frame of [1, 6, 12]) {
      const file = path.join(dir, `capture-${frame}.png`);
      await runMediaTool("ffmpeg", ["-v", "error", "-i", out, "-vf", `select=eq(n\\,${frame - 1})`, "-frames:v", "1", file], signal);
      const bytes = await readFile(file), pixels = await sharp(bytes).removeAlpha().raw().toBuffer();
      let altered = 0; for (let i = 0; i < pixels.length; i += 3) if (pixels[i] > 25 || pixels[i + 1] > 25) altered++;
      if (frame === 6) assert(altered > 500, "Active effects must change pixels"); else assert.equal(altered, 0, "Inactive window must preserve blue frame");
      visual.push({ frame, alteredPixels: altered, gcsUri: await save(`composite-${frame}.png`, bytes, "image/png") });
    }
    result = { gcsUri: output.gcsUri, bytes: buffer.length, sha256: hash(buffer), frameCount: 12, effectFrameEntries: 144, audio, visual, serviceReceipts, sourceGcsUri: sourceObject.gcsUri };
  } else if (mode === "transition") {
    const previous = JSON.parse(await readFile("evidence/vfx/result.json", "utf8"));
    const output = await renderManhuaTransitions({ clips: [previous.result.sourceGcsUri, previous.result.gcsUri], width: 480, height: 360, fps: 12, transition: { kind: "fade", durationSec: .25 } }, "isolated-pr1675", { signal });
    assert(Math.abs(output.durationSec - 1.75) < .09);
    for (const receipt of output.evidence) {
      const read = await downloadGcsObject({ gcsUri: receipt.gcsUri });
      assert.equal(hash(read.buffer), receipt.sha256);
      await writeFile(path.join(dir, `service-${path.basename(receipt.gcsUri)}`), read.buffer, { flag: "wx" });
    }
    result = { gcsUri: output.gcsUri, durationSec: output.durationSec, clipCount: output.clipCount, evidence: output.evidence };
  } else if (mode === "knowledge") {
    const cold = await refreshManhuaAdvisorKnowledge();
    await save("knowledge-cold.json", Buffer.from(JSON.stringify(cold)));
    assert.equal(cold.status, "ready", cold.error);
    const warm = await refreshManhuaAdvisorKnowledge();
    await save("knowledge-warm.json", Buffer.from(JSON.stringify(warm)));
    assert.equal(warm.status, "ready", warm.error);
    assert.equal(warm.changes?.downloadedCards, 0, "Unchanged metadata must not re-download all cards");
    assert.equal(warm.snapshot?.revision, cold.snapshot?.revision);
    const selected = cold.snapshot?.templates[0];
    let resolution: Record<string, unknown> | undefined;
    if (selected) {
      const resolved = await resolveManhuaAdvisorKnowledgeTemplate(selected.publicId);
      assert(!("error" in resolved), `Selected public card failed to resolve: ${"error" in resolved ? resolved.error : ""}`);
      assert.equal(resolved.resolution, "indexed");
      resolution = { publicId: resolved.appliedTemplate.publicId, resolution: resolved.resolution, generation: selected.generation, sha256: selected.contentSha256 };
    }
    result = { templateCount: cold.snapshot?.templates.length, directorCount: cold.snapshot?.directors.length, revision: cold.snapshot?.revision, coldDownloads: cold.changes?.downloadedCards, warmDownloads: warm.changes?.downloadedCards, selectedResolution: resolution, modelCalls: 0 };
  } else {
    const target = path.join(dir, "scene");
    const command = blenderLaunchCommand({ blender: "blender", useXvfb: true, lowPriority: true }, ["--background", "--factory-startup", "--disable-autoexec", "--threads", "2", "--python-exit-code", "1", "--python", path.resolve("server/scripts/previs_scene_effects_probe.py"), "--", mode, target]);
    // Capture failure stdout too: Blender emits Python tracebacks on stdout, while
    // the public production launcher deliberately returns only a friendly error.
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const log = path.join(dir, "blender-process.log");
    try { await runPrevisProcess("sh", ["-c", [command.command, ...command.args].map(quote).join(" ") + ` > ${quote(log)} 2>&1`], signal); }
    finally {
      if (await stat(log).catch(() => null)) await save("blender.log", await readFile(log), "text/plain");
      if (await stat(target).catch(() => null)) await archiveDirectory(target);
    }
    result = JSON.parse(await readFile(path.join(target, "result.json"), "utf8"));
  }
  const receipt = { phase, status: "passed", machine, elapsedMs: Date.now() - startedAt, boundary: "Isolated Fly worker; not user workflow acceptance", result, receipts };
  const gcsUri = await save("result.json", Buffer.from(JSON.stringify(receipt)));
  console.log(JSON.stringify({ event: "passed", phase, elapsedMs: receipt.elapsedMs, gcsUri }));
} catch (error) {
  const failure = { phase, status: "failed", elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error), receipts };
  await save("failure.json", Buffer.from(JSON.stringify(failure)));
  console.log(JSON.stringify({ event: "failed", phase, elapsedMs: failure.elapsedMs, message: "Evidence retained; no automatic retry" }));
  process.exitCode = 1;
}
