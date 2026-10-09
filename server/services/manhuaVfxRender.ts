import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import sharp from "sharp";
import { isManhuaVfxPixelKind, manhuaVfxFrameSpan, manhuaVfxJobSchema, validateManhuaVfxSource, type ManhuaVfxComposition, type ManhuaVfxEffect } from "../../shared/manhuaVfx";
import { uploadBufferToGcs } from "./gcs";
import { fetchPostProdSourceToFile, runMediaTool, uploadResult } from "./postProduction";
import { blenderLaunchCommand, blenderLowPriorityDefault, runPrevisProcess } from "./manhuaPrevisRender";
import { mediaRuntime } from "./postProdResources";
import { prepareManhuaVfxScene } from "./manhuaVfxSceneSource";

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
const xyz = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bulletManifestSchema = z.object({ complete: z.literal(true), eventId: z.string(), sceneJobId: z.string(), sceneSha256: digest, frozenGeometrySHA: digest,
  vertexFrames: z.number().int().positive().max(12_000_000),
  width: z.number(), height: z.number(), fps: z.number(), frameCount: z.number().int(), alpha: z.literal("straight"), colorSpace: z.literal("sRGB"),
  sourceGeometry: z.object({ meshes: z.number().int().positive().max(2048), vertices: z.number().int().min(4).max(2_000_000), minimum: xyz, maximum: xyz, nonPlanarThickness: z.number().finite().positive() }),
  sourceScene: z.object({ fps: z.number().finite().positive(), frameStart: z.number().int(), frameEnd: z.number().int(), freezeSec: z.number().finite(), frozenFrame: z.number().finite() }),
  visibilitySamples: z.array(z.object({ progress: z.number().finite().min(0).max(1), visibleVertices: z.number().int().positive() })).min(3).max(13),
  files: z.array(frameSchema).max(1800), frames: z.array(z.object({ frame: z.number().int(), timeSec: z.number().finite(), active: z.boolean(), frozenGeometrySHA: digest,
    camera: z.object({ type: z.literal("PERSP"), position: xyz, target: xyz, lensMm: z.number().finite(), frozenGeometrySHA: digest, matrixWorld: z.array(z.array(z.number().finite()).length(4)).length(4) }).nullable() })).max(1800),
}).passthrough();
export function validateVfxBullet3dManifest(raw: unknown, effect: Pick<ManhuaVfxEffect, "id" | "startSec" | "durationSec" | "bullet"> & { sceneSha256?: string }, meta: { width: number; height: number; fps: number; durationSec: number }) {
  const manifest = bulletManifestSchema.parse(raw), params = effect.bullet;
  const { first, stop } = manhuaVfxFrameSpan(effect.startSec, effect.durationSec, meta.fps), count = Math.ceil(meta.durationSec * meta.fps);
  if (!params || manifest.eventId !== effect.id || manifest.sceneJobId !== params.sceneJobId || manifest.sceneSha256 !== effect.sceneSha256 || manifest.width !== meta.width || manifest.height !== meta.height || manifest.fps !== meta.fps || manifest.frameCount !== count || manifest.frames.length !== count || manifest.files.length !== count || manifest.sourceScene.freezeSec !== params.freezeSec || Math.abs(manifest.sourceScene.frozenFrame - (manifest.sourceScene.frameStart + params.freezeSec * manifest.sourceScene.fps)) > 1e-7)
    throw new Error("三维环绕证据与本人场景、冻结时刻或画幅不一致");
  const samples = Math.max(3, Math.ceil(Math.abs(params.sweepDeg) / 30) + 1);
  if (manifest.vertexFrames !== manifest.sourceGeometry.vertices * (stop - first) || manifest.sourceScene.frameEnd < manifest.sourceScene.frameStart || params.freezeSec >= (manifest.sourceScene.frameEnd - manifest.sourceScene.frameStart + 1) / manifest.sourceScene.fps || manifest.sourceGeometry.minimum.some((value, axis) => value > manifest.sourceGeometry.maximum[axis]) || manifest.visibilitySamples.length !== samples || manifest.visibilitySamples.some((sample, index) => Math.abs(sample.progress - index / (samples - 1)) > 1e-7)) throw new Error("源三维时间轴、几何预算或环绕视角证据不完整");
  for (let index = 0; index < count; index++) {
    const row = manifest.frames[index], active = index >= first && index < stop;
    if (row.frame !== index + 1 || Math.abs(row.timeSec - index / meta.fps) > 1e-7 || row.active !== active || row.frozenGeometrySHA !== manifest.frozenGeometrySHA || Boolean(row.camera) !== active) throw new Error("三维环绕逐帧证据缺失或冻结几何变化");
    if (row.camera) {
      const angle = (params.startAngleDeg + params.sweepDeg * (index - first) / (stop - first - 1)) * Math.PI / 180;
      const position = [params.target[0] + params.radius * Math.cos(angle), params.target[1] + params.radius * Math.sin(angle), params.target[2] + params.height];
      if (row.camera.frozenGeometrySHA !== manifest.frozenGeometrySHA || row.camera.lensMm !== params.lensMm || position.some((value, axis) => Math.abs(value - row.camera!.position[axis]) > 1e-5 || Math.abs(value - row.camera!.matrixWorld[axis][3]) > 1e-4 || row.camera!.target[axis] !== params.target[axis])) throw new Error("实际三维相机没有执行本次环绕轨迹");
      const distance = Math.hypot(...position.map((value, axis) => params.target[axis] - value));
      if (position.some((value, axis) => Math.abs((params.target[axis] - value) / distance + row.camera!.matrixWorld[axis][2]) > 1e-4)) throw new Error("三维透视相机没有朝向本次目标");
    }
  }
  return manifest;
}
async function validateFrameFiles(dir: string, files: Array<z.infer<typeof frameSchema>>, signal: AbortSignal, meta: { width: number; height: number }) {
  for (let index = 0; index < files.length; index++) {
    signal.throwIfAborted(); const frame = files[index];
    const name = `frame-${String(index + 1).padStart(6, "0")}.png`;
    if (frame.frame !== index + 1 || frame.path !== name) throw new Error("特效帧顺序不完整");
    const file = path.join(dir, name), info = await stat(file);
    const bytes = await readFile(file);
    if (info.size !== frame.bytes || sha(bytes) !== frame.sha256) throw new Error("特效帧校验失败");
    const image = await sharp(bytes, { limitInputPixels: 1920 * 1080 }).metadata();
    if (image.format !== "png" || image.width !== meta.width || image.height !== meta.height || !image.hasAlpha) throw new Error("特效帧画幅或透明通道与原片不一致");
  }
}
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
export function buildVfxCompositeArgs(source: string, layers: string | undefined, fps: number, output: string, originalAudioSource?: string, sceneLayers?: string) {
  const args = ["-y", "-i", source]; let inputCount = 1; const filters: string[] = [];
  let video = "0:v:0";
  for (const dir of [layers, sceneLayers].filter((value): value is string => Boolean(value))) {
    args.push("-framerate", String(fps), "-start_number", "1", "-i", path.join(dir, "frame-%06d.png"));
    const label = `vfx${inputCount}`;
    filters.push(`[${video}][${inputCount}:v:0]overlay=0:0:format=auto:alpha=straight:eof_action=pass:repeatlast=0[${label}]`);
    video = label; inputCount++;
  }
  const audioIndex = originalAudioSource ? inputCount : 0;
  if (originalAudioSource) args.push("-i", originalAudioSource);
  if (filters.length) args.push("-filter_complex", filters.join(";"));
  return [...args, "-map", filters.length ? `[${video}]` : video, "-map", `${audioIndex}:a?`, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output];
}
const renderDeps = { upload: uploadBufferToGcs, fetch: fetchPostProdSourceToFile, runBlender: runPrevisProcess, runMedia: runMediaTool, uploadResult, prepareScene: prepareManhuaVfxScene };
/** One authoritative worker operation. All evidence uploads survive cancellation; no automatic model calls. */
export async function renderManhuaVfx(raw: unknown, userId: string, signal: AbortSignal, overrides: Omit<typeof renderDeps, "prepareScene"> & Partial<Pick<typeof renderDeps, "prepareScene">> = renderDeps) {
  const deps = { ...renderDeps, ...overrides };
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
      if (effect.kind === "bullet_time" && effect.bullet) {
        const scene = await deps.prepareScene(effect.bullet, effect.id, userId, root, signal);
        await preserve(`scene-source-${effect.id}.json`, Buffer.from(JSON.stringify(scene.receipt)));
        effects.push({ ...effect, scenePath: scene.scenePath, sceneSha256: scene.sceneSha256 });
        continue;
      }
      if (effect.kind !== "image_overlay" || !effect.imageUri) { effects.push(effect); continue; }
      const imageDir = path.join(root, "images"); await mkdir(imageDir, { recursive: true });
      const original = path.join(imageDir, `${effect.id}.source`), imagePath = path.join(imageDir, `${effect.id}.png`);
      await deps.fetch(effect.imageUri, original, { signal, budget: { remainingBytes: 32 * 1024 * 1024 } });
      const imageBytes = await readFile(original);
      const reader = sharp(imageBytes, { limitInputPixels: 4 * 1024 * 1024, animated: false });
      const metadata = await reader.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format || "") || (metadata.pages || 1) !== 1) throw new Error("叠图仅支持单帧PNG、JPG或WebP");
      const buffer = await reader.rotate().ensureAlpha().png().toBuffer();
      await writeFile(imagePath, buffer);
      imageSources.push({ id: effect.id, imageUri: effect.imageUri, bytes: imageBytes.length, sha256: sha(imageBytes), normalizedBytes: buffer.length, normalizedSha256: sha(buffer), width: metadata.width, height: metadata.height });
      effects.push({ ...effect, imagePath });
    }
    if (imageSources.length) await preserve("images.json", Buffer.from(JSON.stringify(imageSources)));
    const spec = { ...input.params.composition, effects, durationSec: meta.durationSec, width: meta.width, height: meta.height, fps: meta.fps };
    const specBytes = Buffer.from(JSON.stringify(spec));
    await preserve("spec.normalized.json", specBytes);
    const specPath = path.join(root, "spec.normalized.json");
    const state = mediaRuntime.getStore();
    let compositeSource = source;
    if (input.params.composition.effects.some(effect => isManhuaVfxPixelKind(effect.kind))) {
      if (state) state.phase = "vfx_source_pixels";
      const processed = path.join(root, "processed.mkv");
      const pixelLaunch = blenderLaunchCommand({ blender: process.env.BLENDER_BIN || "blender", useXvfb: process.platform === "linux", lowPriority: blenderLowPriorityDefault() },
        ["--background", "--factory-startup", "--disable-autoexec", "--threads", "2", "--python-exit-code", "1", "--python", path.resolve("server/scripts/manhua_vfx_liquid_ghost.py"), "--", specPath, source, processed]);
      try { await deps.runBlender(pixelLaunch.command, pixelLaunch.args, signal); }
      finally {
        const receiptPath = processed + ".json";
        const receiptInfo = await stat(receiptPath).catch(() => null);
        if (receiptInfo) {
          if (receiptInfo.size > 1024 * 1024) { evidenceFailed = true; throw new Error("像素处理回执超过限制"); }
          await preserve("source-pixels.raw.json", await readFile(receiptPath));
        }
      }
      const pixelReceipt = z.object({ version: z.literal(1), frames: z.number().int(), width: z.number().int(), height: z.number().int(), fps: z.number(), audio: z.literal("original-source-only"), bytes: z.number().int().positive().max(8 * 1024 ** 3), effects: z.array(z.string()), decodedOutputSha256: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough().parse(JSON.parse(await readFile(processed + ".json", "utf8")));
      const expectedIds = input.params.composition.effects.filter(effect => isManhuaVfxPixelKind(effect.kind)).map(effect => effect.id);
      if (pixelReceipt.frames !== Math.ceil(meta.durationSec * meta.fps) || pixelReceipt.width !== meta.width || pixelReceipt.height !== meta.height || pixelReceipt.fps !== meta.fps || JSON.stringify(pixelReceipt.effects) !== JSON.stringify(expectedIds) || (await stat(processed)).size !== pixelReceipt.bytes)
        throw new Error("原片像素处理回执与本次方案不一致");
      const pixelProbe = await deps.runMedia("ffprobe", [...probeArgs, processed], signal);
      await preserve("source-pixels-probe.raw.json", Buffer.from(pixelProbe.stdout));
      const processedMeta = parseVfxVideoProbe(pixelProbe.stdout);
      if (processedMeta.width !== meta.width || processedMeta.height !== meta.height || processedMeta.hasAudio || Math.abs(processedMeta.fps - meta.fps) > .0001 || Math.abs(processedMeta.durationSec - meta.durationSec) > 1 / meta.fps + .001)
        throw new Error("原片像素处理时长或画幅不一致");
      await preserve("source-pixels-identity.json", Buffer.from(JSON.stringify({ ...pixelReceipt, sourceVideoSha256: sourceIdentity.sha256, processedSha256: await fileDigest(processed) })));
      compositeSource = processed;
    }
    const bullet = effects.find(effect => effect.kind === "bullet_time");
    let sceneLayers: string | undefined;
    if (bullet) {
      if (state) state.phase = "vfx_real3d_orbit";
      sceneLayers = path.join(root, "scene-layers");
      const launch3d = blenderLaunchCommand({ blender: process.env.BLENDER_BIN || "blender", useXvfb: process.platform === "linux", lowPriority: blenderLowPriorityDefault() },
        ["--background", "--factory-startup", "--disable-autoexec", "--threads", "2", "--python-exit-code", "1", "--python", path.resolve("server/scripts/manhua_vfx_bullet3d.py"), "--", specPath, bullet.id, sceneLayers]);
      try { await deps.runBlender(launch3d.command, launch3d.args, signal); }
      finally {
        for (const name of ["input.raw.json", "manifest.json"]) {
          const file = path.join(sceneLayers, name); const info = await stat(file).catch(() => null);
          if (info) { if (info.size > 32 * 1024 * 1024) { evidenceFailed = true; throw new Error("三维证据超过限制"); } await preserve(`real3d-${name}`, await readFile(file)); }
        }
      }
      const manifest = validateVfxBullet3dManifest(JSON.parse(await readFile(path.join(sceneLayers, "manifest.json"), "utf8")), bullet, meta);
      await preserve("real3d-manifest.parsed.json", Buffer.from(JSON.stringify(manifest)));
      await validateFrameFiles(sceneLayers, manifest.files, signal, meta);
    }
    const layerEffects = effects.filter(effect => effect.kind !== "bullet_time");
    const layerRecipe = { ...input.params.composition, effects: input.params.composition.effects.filter(effect => effect.kind !== "bullet_time") };
    if (layerEffects.length) {
    const layerSpecPath = path.join(root, "spec.layers.json");
    await writeFile(layerSpecPath, JSON.stringify({ ...spec, effects: layerEffects }));
    if (state) state.phase = "vfx_render";
    const launch = blenderLaunchCommand({ blender: process.env.BLENDER_BIN || "blender", useXvfb: process.platform === "linux", lowPriority: blenderLowPriorityDefault() },
      ["--background", "--factory-startup", "--disable-autoexec", "--threads", "2", "--python-exit-code", "1", "--python", path.resolve("server/scripts/manhua_vfx.py"), "--", layerSpecPath, layers]);
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
    const manifest = validateVfxManifest(parsedManifest, layerRecipe, meta);
    await validateFrameFiles(layers, manifest.files, signal, meta);
    }
    const outputPath = path.join(root, "result.mp4");
    await deps.runMedia("ffmpeg", buildVfxCompositeArgs(compositeSource, layerEffects.length ? layers : undefined, meta.fps, outputPath, compositeSource === source ? undefined : source, sceneLayers), signal);
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
      requestId: input.requestId, coordinateSpace: bullet ? "screen-and-world3d" : "screen", boundaryZh: bullet ? "三维时窗使用本人场景冻结几何与真实透视相机；其余为画面坐标效果" : "按设定轨迹叠加或手动区域变形，不含自动跟踪或人物遮挡", evidence: [...receipts] };
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
