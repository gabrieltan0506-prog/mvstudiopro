import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import sharp from "sharp";
import { manhuaVfxJobSchema, validateManhuaVfxSource, type ManhuaVfxComposition } from "../../shared/manhuaVfx";
import { uploadBufferToGcs } from "./gcs";
import { fetchPostProdSourceToFile, runMediaTool, uploadResult } from "./postProduction";
import { blenderLaunchCommand, blenderLowPriorityDefault, runPrevisProcess } from "./manhuaPrevisRender";
import { mediaRuntime } from "./postProdResources";

const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const frameSchema = z.object({ frame: z.number().int(), path: z.string(), bytes: z.number().int().positive().max(32 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const manifestSchema = z.object({
  complete: z.literal(true), width: z.number(), height: z.number(), fps: z.number(), frameCount: z.number().int(),
  files: z.array(frameSchema).max(1800), frames: z.array(z.object({ frame: z.number().int(), timeSec: z.number().finite(), effects: z.array(z.object({
    id: z.string(), kind: z.string(), active: z.boolean(), progress: z.number().finite(), opacity: z.number().finite(),
    position: z.tuple([z.number().finite(), z.number().finite()]),
  }).passthrough()).max(12) }).passthrough()).max(1800),
  alpha: z.literal("straight"), colorSpace: z.literal("sRGB"),
}).passthrough();
export function validateVfxManifest(raw: unknown, recipe: ManhuaVfxComposition, meta: { durationSec: number; width: number; height: number; fps: number }) {
  const manifest = manifestSchema.parse(raw);
  const expected = Math.ceil(meta.durationSec * meta.fps);
  if (manifest.frameCount !== expected || manifest.files.length !== expected || manifest.frames.length !== expected ||
      manifest.width !== meta.width || manifest.height !== meta.height || manifest.fps !== meta.fps)
    throw new Error("特效帧数或画幅不完整，未合成原片");
  for (let index = 0; index < expected; index++) {
    const row = manifest.frames[index];
    if (row.frame !== index + 1 || Math.abs(row.timeSec - index / meta.fps) > 1e-7 ||
        row.effects.length !== recipe.effects.length || new Set(row.effects.map(effect => effect.id)).size !== recipe.effects.length)
      throw new Error("特效逐帧证据缺失或时间不一致");
    for (const effect of recipe.effects) {
      const actual = row.effects.find(item => item.id === effect.id);
      const active = row.timeSec >= effect.startSec && row.timeSec < effect.startSec + effect.durationSec;
      if (!actual || actual.kind !== effect.kind || actual.active !== active) throw new Error("特效逐帧证据与本次方案不一致");
    }
  }
  return manifest;
}
async function fileDigest(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export function parseVfxVideoProbe(raw: string) {
  const json = JSON.parse(raw) as { format?: { duration?: string }; streams?: Array<{
    codec_type?: string; width?: number; height?: number; duration?: string; avg_frame_rate?: string;
    tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }>;
  }> };
  const video = json.streams?.find(row => row.codec_type === "video");
  if (!video) throw new Error("原片没有可用的视频轨道");
  const rotation = Number(video.tags?.rotate || video.side_data_list?.find(row => row.rotation !== undefined)?.rotation || 0);
  if (rotation % 360 !== 0) throw new Error("请先将原片转正后再添加特效，避免位置错位");
  const [n, d] = (video.avg_frame_rate || "").split("/").map(Number);
  return { durationSec: Number(video.duration || json.format?.duration), width: Number(video.width), height: Number(video.height), fps: n / d,
    hasAudio: Boolean(json.streams?.some(row => row.codec_type === "audio")) };
}
export function buildVfxCompositeArgs(source: string, layers: string, fps: number, output: string) {
  return ["-y", "-i", source, "-framerate", String(fps), "-start_number", "1", "-i", path.join(layers, "frame-%06d.png"),
    "-filter_complex", "[0:v:0][1:v:0]overlay=0:0:format=auto:alpha=straight:eof_action=pass:repeatlast=0[v]",
    "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output];
}
const renderDeps = { upload: uploadBufferToGcs, fetch: fetchPostProdSourceToFile, runBlender: runPrevisProcess, runMedia: runMediaTool, uploadResult };
/** One authoritative worker operation. All evidence uploads survive cancellation; no automatic model calls. */
export async function renderManhuaVfx(raw: unknown, userId: string, signal: AbortSignal, deps = renderDeps) {
  signal.throwIfAborted();
  const root = await mkdtemp(path.join(tmpdir(), "manhua-vfx-"));
  const safeUser = userId.replace(/[^0-9A-Za-z_-]/g, "");
  const prefix = `post-prod/${safeUser}/vfx-evidence/${randomUUID()}`;
  const receipts: Array<{ name: string; gcsUri: string; bytes: number; sha256: string }> = [];
  const preserved = new Set<string>();
  let evidenceFailed = false;
  let success = false;
  const preserve = async (name: string, bytes: Buffer) => {
    try {
      await writeFile(path.join(root, name.replaceAll("/", "-")), bytes);
      const uploaded = await deps.upload({ objectName: `${prefix}/${name}`, buffer: bytes, contentType: "application/json", signal: AbortSignal.timeout(120_000) });
      preserved.add(name);
      const receipt = { name, gcsUri: uploaded.gcsUri, bytes: bytes.length, sha256: sha(bytes) };
      receipts.push(receipt);
      return receipt;
    } catch (error) { evidenceFailed = true; throw error; }
  };
  const layers = path.join(root, "layers");
  await mkdir(layers);
  try {
    await preserve("request.raw.json", Buffer.from(JSON.stringify(raw)));
    const input = manhuaVfxJobSchema.parse(raw);
    await preserve("request.normalized.json", Buffer.from(JSON.stringify(input)));
    const source = path.join(root, "source.mp4");
    await deps.fetch(input.params.videoUri, source, { signal });
    const probeArgs = ["-v", "error", "-show_format", "-show_streams", "-of", "json"];
    const sourceProbe = await deps.runMedia("ffprobe", [...probeArgs, source], signal);
    await preserve("source-probe.raw.json", Buffer.from(sourceProbe.stdout));
    await preserve("source-probe.parsed.json", Buffer.from(JSON.stringify(JSON.parse(sourceProbe.stdout))));
    const meta = parseVfxVideoProbe(sourceProbe.stdout);
    validateManhuaVfxSource(input.params.composition, meta);
    const sourceIdentity = { videoUri: input.params.videoUri, bytes: (await stat(source)).size, sha256: await fileDigest(source) };
    const effects = [];
    const imageSources = [];
    for (const effect of input.params.composition.effects) {
      if (effect.kind !== "image_overlay" || !effect.imageUri) { effects.push(effect); continue; }
      const imageDir = path.join(root, "images"); await mkdir(imageDir, { recursive: true });
      const original = path.join(imageDir, `${effect.id}.source`), imagePath = path.join(imageDir, `${effect.id}.png`);
      await deps.fetch(effect.imageUri, original, { signal, budget: { remainingBytes: 32 * 1024 * 1024 } });
      const source = await readFile(original);
      const reader = sharp(source, { limitInputPixels: 4 * 1024 * 1024, animated: false });
      const metadata = await reader.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format || "") || (metadata.pages || 1) !== 1) throw new Error("叠图仅支持单帧PNG、JPG或WebP");
      const buffer = await reader.rotate().ensureAlpha().png().toBuffer();
      await writeFile(imagePath, buffer);
      imageSources.push({ id: effect.id, imageUri: effect.imageUri, bytes: source.length, sha256: sha(source), normalizedBytes: buffer.length, normalizedSha256: sha(buffer), width: metadata.width, height: metadata.height });
      effects.push({ ...effect, imagePath });
    }
    if (imageSources.length) await preserve("images.json", Buffer.from(JSON.stringify(imageSources)));
    const spec = { ...input.params.composition, effects, durationSec: meta.durationSec, width: meta.width, height: meta.height, fps: meta.fps };
    const specBytes = Buffer.from(JSON.stringify(spec));
    await preserve("spec.normalized.json", specBytes);
    const specPath = path.join(root, "spec.normalized.json");
    const state = mediaRuntime.getStore();
    if (state) state.phase = "vfx_render";
    const launch = blenderLaunchCommand({ blender: process.env.BLENDER_BIN || "blender", useXvfb: process.platform === "linux", lowPriority: blenderLowPriorityDefault() },
      ["--background", "--factory-startup", "--disable-autoexec", "--threads", "2", "--python-exit-code", "1", "--python", path.resolve("server/scripts/manhua_vfx.py"), "--", specPath, layers]);
    try {
      // Existing launcher strips production secrets and terminates the whole Blender/Xvfb group.
      await deps.runBlender(launch.command, launch.args, signal);
    } finally {
      // Raw renderer JSON is archived before parse, including incomplete/cancelled renders.
      for (const name of ["input.raw.json", "spec.normalized.json", "manifest.json"]) {
        const file = path.join(layers, name);
        const info = await stat(file).catch(() => null);
        if (!info) continue;
        if (info.size > 32 * 1024 * 1024) { evidenceFailed = true; throw new Error("特效证据超过大小限制，原始文件保留待处理"); }
        await preserve(`renderer-${name}`, await readFile(file));
      }
    }
    const parsedManifest: unknown = JSON.parse(await readFile(path.join(layers, "manifest.json"), "utf8"));
    await preserve("renderer-manifest.parsed.json", Buffer.from(JSON.stringify(parsedManifest)));
    const manifest = validateVfxManifest(parsedManifest, input.params.composition, meta);
    const expected = Math.ceil(meta.durationSec * meta.fps);
    for (let i = 0; i < expected; i++) {
      signal.throwIfAborted();
      const frame = manifest.files[i];
      const expectedName = `frame-${String(i + 1).padStart(6, "0")}.png`;
      if (frame.frame !== i + 1 || frame.path !== expectedName) throw new Error("特效帧顺序不完整");
      const file = path.join(layers, expectedName);
      const info = await stat(file);
      if (info.size !== frame.bytes || sha(await readFile(file)) !== frame.sha256) throw new Error("特效帧校验失败");
    }
    const outputPath = path.join(root, "result.mp4");
    await deps.runMedia("ffmpeg", buildVfxCompositeArgs(source, layers, meta.fps, outputPath), signal);
    const resultProbe = await deps.runMedia("ffprobe", [...probeArgs, outputPath], signal);
    await preserve("result-probe.raw.json", Buffer.from(resultProbe.stdout));
    await preserve("result-probe.parsed.json", Buffer.from(JSON.stringify(JSON.parse(resultProbe.stdout))));
    const actual = parseVfxVideoProbe(resultProbe.stdout);
    if (actual.width !== meta.width || actual.height !== meta.height || actual.hasAudio !== meta.hasAudio ||
      Math.abs(actual.durationSec - meta.durationSec) > 1 / meta.fps + 0.001)
      throw new Error("合成后时长、画幅或原音轨不一致，原片仍保留");
    const uploaded = await deps.uploadResult({ filePath: outputPath, userId, kind: "vfx", ext: "mp4", contentType: "video/mp4", signal });
    const result = { ...uploaded, ...meta, sha256: await fileDigest(outputPath), sourceIdentity,
      sourceKey: input.params.sourceKey, composition: input.params.composition,
      requestId: input.requestId, coordinateSpace: "screen", boundaryZh: "按设定轨迹叠加，不含自动跟踪或人物遮挡", evidence: [...receipts] };
    const resultEvidence = await preserve("result.json", Buffer.from(JSON.stringify(result)));
    success = true;
    return { ...result, resultEvidence };
  } catch (error) {
    console.error("[manhua-vfx] render failed", error instanceof Error ? error.message : "unknown");
    await preserve("failure.json", Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : "unknown", evidence: receipts }))).catch(() => {});
    throw new Error("特效处理未完成，原片与任务记录已保留；请查看原任务，不会自动重做");
  } finally {
    // Failed archival retains local raw JSON too. No cleanup ever deletes the permanent copies.
    if (!evidenceFailed && preserved.has("request.raw.json")) await rm(root, { recursive: true, force: true });
    else console.error("[manhua-vfx] evidence retained locally", root, success);
  }
}
