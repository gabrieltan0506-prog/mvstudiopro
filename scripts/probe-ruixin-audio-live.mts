/** Authorized fixed-scope isolated provider probe; never a deployed workflow acceptance. No automatic resubmission. */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { synthesizeQwenDialogue } from "../server/services/qwenDialogueTts";
import { createManhuaBgmTask, resumeManhuaBgmTask } from "../server/services/manhuaScoringRoom";
import { uploadBufferToGcs, getGcsBucketName } from "../server/services/gcs";
import { fetchPostProdSourceToFile, probeAudio, runMediaTool } from "../server/services/postProduction";
import { buildCodeMotionAudioMixArgs } from "../server/services/codeMotionAudio";
import type { CodeMotionAudioSource, CodeMotionAudio } from "../shared/codeMotionAudio";
import type { ManhuaBgmBriefPayload } from "../server/jobs/manhuaBgmJobInput";

const root = "/tmp/ruixin-probe-1011";
const audioRoot = path.join(root, "audio");
const scope = "isolated-ruixin-1011";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
if (process.env.FLY_MACHINE_ID !== "7812595b294778") throw Error("Only the authorized existing rig may execute this probe");
await mkdir(audioRoot, { recursive: true });
const context = new AsyncLocalStorage<string>();
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const slot = context.getStore();
  const capture = slot && /openrouter\.ai\/api\/v1\/audio\/speech|api\.ttapi\.io\/suno\//.test(url);
  if (capture && init?.body) await writeFile(path.join(audioRoot, `${slot}.provider-request.json`), String(init.body));
  const response = await fetchOriginal(input, init);
  if (capture) {
    const raw = Buffer.from(await response.clone().arrayBuffer());
    const safe = /openrouter\.ai/.test(url) && response.ok ? raw : Buffer.from(raw.toString().replaceAll(process.env.OPENROUTER_API_KEY || "__NO_KEY__", "[REDACTED]").replaceAll(process.env.TTAPI_KEY || "__NO_KEY__", "[REDACTED]"));
    await writeFile(path.join(audioRoot, `${slot}.provider-raw.${response.ok && /openrouter/.test(url) ? "mp3" : "json"}`), safe);
    await writeFile(path.join(audioRoot, `${slot}.provider-receipt.json`), JSON.stringify({ status: response.status, generationId: response.headers.get("x-generation-id"), bytes: raw.length, sha256: sha(raw), at: new Date().toISOString() }, null, 2));
  }
  return response;
};
const heartbeat = setInterval(() => { void writeFile(path.join(audioRoot, "heartbeat.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), scope, status: "running" })); }, 10000);
await writeFile(path.join(audioRoot, "pid"), String(process.pid));
type Review = { qwen: { sceneIndex: number; requestId: string; body: { input: string; voice: string; seed: number } }[]; bgm: ManhuaBgmBriefPayload };
const results: Record<string, unknown> = {};
const media = new Map<string, { source: CodeMotionAudioSource; file: string; sceneIndex: number | null }[]>();
async function archive(name: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  await writeFile(path.join(audioRoot, name), bytes);
  const uploaded = await uploadBufferToGcs({ objectName: `post-prod/${scope}/evidence/${name}`, buffer: bytes, contentType: "application/json" });
  return uploaded.gcsUri;
}
async function adopt(tier: string, name: string, uri: string, sceneIndex: number | null) {
  const file = path.join(audioRoot, name + ".mp3");
  await fetchPostProdSourceToFile(uri, file, { signal: AbortSignal.timeout(180000), maxBytes: 64 * 1024 * 1024 });
  const decoded = path.join(audioRoot, name + ".decoded.wav");
  await runMediaTool("ffmpeg", ["-y", "-v", "error", "-i", file, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", decoded], AbortSignal.timeout(180000));
  const bytes = await readFile(file), duration = await probeAudio(decoded, AbortSignal.timeout(180000));
  if (sceneIndex !== null && duration > 5) throw Error(`${name}: actual speech ${duration}s exceeds five seconds; no cut or regeneration`);
  const source: CodeMotionAudioSource = { id: randomUUID(), name, gcsUri: uri, duration, sha256: sha(bytes), bytes: bytes.length, mimeType: "audio/mpeg" };
  media.get(tier)!.push({ source, file: decoded, sceneIndex });
  return source;
}
async function speech(tier: string, row: Review["qwen"][number]) {
  const slot = `${tier}.speech-${row.sceneIndex}`;
  await writeFile(path.join(audioRoot, `${slot}.submitted.json`), JSON.stringify({ scope, at: new Date().toISOString(), requestId: row.requestId, body: row.body, attempts: 1 }), { flag: "wx" });
  try {
    const result = await context.run(slot, () => synthesizeQwenDialogue(row.body));
    const source = await adopt(tier, slot, result.gcsUri, row.sceneIndex);
    const value = { status: "succeeded", source, generationId: result.generationId, voiceGate: result.voiceGate };
    results[slot] = value; await archive(`${slot}.result.json`, value);
  } catch (error) {
    const value = { status: "failed_or_unknown_no_retry", error: String(error).replace(/https?:\/\/\S+/g, "[URL]") };
    results[slot] = value; await archive(`${slot}.result.json`, value);
  }
}
async function bgm(tier: string, brief: ManhuaBgmBriefPayload) {
  const slot = `${tier}.bgm`;
  await writeFile(path.join(audioRoot, `${slot}.submitted.json`), JSON.stringify({ scope, at: new Date().toISOString(), brief, attempts: 1 }), { flag: "wx" });
  try {
    const created = await context.run(slot, () => createManhuaBgmTask(brief, { userId: scope, jobId: `${scope}-${tier}` }));
    await archive(`${slot}.task.json`, created);
    const result = await context.run(slot, () => resumeManhuaBgmTask({ taskId: created.taskId, userId: scope, brief }));
    await archive(`${slot}.variants.json`, { ...result, variants: result.variants.map(({ previewUrl: _url, ...variant }) => variant) });
    const variant = result.variants[0];
    if (!variant) throw Error("Suno returned no archived variant");
    const source = await adopt(tier, slot, variant.gcsUri, null);
    const value = { status: "succeeded", taskId: created.taskId, source, selectedVariant: 0, missingVariants: result.missingVariants };
    results[slot] = value; await archive(`${slot}.result.json`, value);
  } catch (error) {
    const value = { status: "failed_or_unknown_no_retry", error: String(error).replace(/https?:\/\/\S+/g, "[URL]") };
    results[slot] = value; await archive(`${slot}.result.json`, value);
  }
}
try {
  const bgmWork: Promise<void>[] = [];
  for (const tier of ["free", "paid"]) {
    media.set(tier, []);
    const review: Review = JSON.parse(await readFile(path.join(root, `${tier}.requests.review.json`), "utf8"));
    bgmWork.push(bgm(tier, review.bgm));
    // Two bounded TTS calls at a time, each has a durable one-attempt marker before calling the official producer.
    for (let i = 0; i < review.qwen.length; i += 2) await Promise.all(review.qwen.slice(i, i + 2).map(row => speech(tier, row)));
  }
  await Promise.all(bgmWork);
  for (const tier of ["free", "paid"]) {
    const sources = media.get(tier)!;
    if (sources.length !== 6) { await archive(`${tier}.mix-blocked.json`, { expected: 6, received: sources.length, reason: "Required real sound did not finish; do not substitute silence or fixture" }); continue; }
    const audio: CodeMotionAudio = { sources: sources.map(s => s.source), audioTimeline: sources.map(s => ({ sourceId: s.source.id,
      role: s.sceneIndex === null ? "bgm" : "narration", at: s.sceneIndex === null ? 0 : s.sceneIndex * 5,
      trimStart: 0, duration: s.sceneIndex === null ? Math.min(30, s.source.duration) : s.source.duration,
      volume: s.sceneIndex === null ? 0.25 : 1, fadeIn: s.sceneIndex === null ? 0.5 : 0, fadeOut: s.sceneIndex === null ? 1 : 0 })) };
    const mixed = path.join(audioRoot, `${tier}.mixed.wav`);
    const paths = new Map(sources.map(s => [s.source.id, s.file]));
    await runMediaTool("ffmpeg", buildCodeMotionAudioMixArgs(audio, 30, paths, mixed), AbortSignal.timeout(180000));
    await archive(`${tier}.audio-timeline.json`, audio);
    for (const sceneIndex of [2, 3]) {
      const output = path.join(audioRoot, `${tier}.scene-${sceneIndex}.wav`), at = sceneIndex * 5;
      await runMediaTool("ffmpeg", ["-y", "-v", "error", "-i", mixed, "-af", `atrim=start_sample=${at * 48000}:end_sample=${(at + 5) * 48000},asetpts=PTS-STARTPTS`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", output], AbortSignal.timeout(180000));
      const bytes = await readFile(output), duration = await probeAudio(output, AbortSignal.timeout(180000));
      if (Math.abs(duration - 5) > 1/48000) throw Error("Audio reference must be exactly five seconds");
      const { gcsUri } = await uploadBufferToGcs({ objectName: `post-prod/${scope}/reference-audio/${tier}-scene-${sceneIndex}-${sha(bytes)}.wav`, buffer: bytes, contentType: "audio/wav" });
      await archive(`${tier}.scene-${sceneIndex}.audio.json`, { gcsUri, sha256: sha(bytes), duration, at, bytes: bytes.length });
    }
  }
  await archive("audio-summary.json", { scope, completedAt: new Date().toISOString(), results });
} finally {
  clearInterval(heartbeat);
  await writeFile(path.join(audioRoot, "heartbeat.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), scope, status: "finished" }));
}
