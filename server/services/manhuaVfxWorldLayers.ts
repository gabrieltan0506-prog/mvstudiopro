import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { deflateSync, inflateSync } from "node:zlib";
import JSZip from "jszip";
import sharp from "sharp";
import { z } from "zod";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const limit = 512 * 1024 ** 2;
const fileSchema = z.object({ layer: z.enum(["plate", "fragments", "actors", "depth"]), frame: z.number().int().positive(), active: z.boolean(),
  path: z.string(), bytes: z.number().int().positive().max(32 * 1024 ** 2), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const separatedSchema = z.object({ version: z.literal(1), complete: z.literal(true), bytes: z.number().int().positive().max(limit),
  depthEncoding: z.literal("linear_z_pass_clip_normalized_u16"), frames: z.array(z.object({ frame: z.number().int().positive(), active: z.boolean(),
    clipStart: z.number().finite().positive(), clipEnd: z.number().finite().positive(),
    cameraMatrixWorld: z.array(z.array(z.number().finite()).length(4)).length(4), files: z.array(fileSchema).length(4),
  }).strict()).max(1800),
}).strict();

/** 差值保留同场阴影/反射；仅适用于相同资产、相机与像素位置，不是可自由换底的光照层。 */
export function makeVfxInteractionCorrection(beauty: Buffer, plate: Buffer, fragments: Buffer) {
  if (beauty.length !== plate.length || beauty.length !== fragments.length || beauty.length % 4 !== 0) throw new Error("分层像素长度不一致");
  const residual = Buffer.alloc(beauty.length / 4 * 6);
  for (let p = 0; p < beauty.length; p += 4) {
    if (beauty[p + 3] !== 255 || plate[p + 3] !== 255) throw new Error("同场受光图和底层必须不透明");
    const alpha = fragments[p + 3];
    for (let c = 0; c < 3; c++) {
      const base = Math.round((plate[p + c] * (255 - alpha) + fragments[p + c] * alpha) / 255);
      residual.writeInt16LE(beauty[p + c] - base, p / 4 * 6 + c * 2);
    }
  }
  return deflateSync(residual);
}
export function reconstructVfxWorldFrame(plate: Buffer, fragments: Buffer, correction: Buffer) {
  if (plate.length !== fragments.length || plate.length % 4 !== 0 || plate.length < 4) throw new Error("分层像素长度不一致");
  const residual = inflateSync(correction, { maxOutputLength: plate.length / 4 * 6 });
  if (residual.length !== plate.length / 4 * 6) throw new Error("相互受光差值长度不一致");
  const result = Buffer.alloc(plate.length);
  for (let p = 0; p < plate.length; p += 4) {
    if (plate[p + 3] !== 255) throw new Error("同场底层必须不透明");
    const alpha = fragments[p + 3];
    for (let c = 0; c < 3; c++) {
      const value = Math.round((plate[p + c] * (255 - alpha) + fragments[p + c] * alpha) / 255) + residual.readInt16LE(p / 4 * 6 + c * 2);
      if (value < 0 || value > 255) throw new Error("分层合成值越界");
      result[p + c] = value;
    }
    result[p + 3] = 255;
  }
  return result;
}

/** 真实读取生产层合成逐帧输出；校验后最终ffmpeg只消费此目录。 */
export async function composeVfxWorldLayers(dir: string, raw: unknown, meta: { width: number; height: number; fps: number; durationSec: number }, signal: AbortSignal) {
  const source = z.object({ eventId: z.string(), sceneJobId: z.string(), sceneSha256: z.string(), separated: separatedSchema,
    files: z.array(z.object({ frame: z.number(), sha256: z.string() })),
    frames: z.array(z.object({ effects: z.array(z.object({ active: z.boolean(), cameraClip: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
      cameraMatrixWorld: z.array(z.array(z.number().finite()).length(4)).length(4) })).length(1) })),
  }).parse(raw);
  const count = Math.ceil(meta.durationSec * meta.fps);
  if (source.separated.frames.length !== count || source.files.length !== count || source.frames.length !== count) throw new Error("分层缺帧");
  const target = path.join(dir, "composed"), archive = path.join(dir, "world-layers.zip");
  await mkdir(target);
  const zip = new JSZip(), receipts: Array<Record<string, unknown>> = [];
  let total = 0, renderedBytes = 0;
  const add = (name: string, bytes: Buffer) => {
    total += bytes.length;
    if (total > limit) throw new Error("分层归档超过512MiB，请缩短片段");
    zip.file(name, bytes, { createFolders: false, binary: true });
  };
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    const row = source.separated.frames[index], frame = index + 1, name = `frame-${String(frame).padStart(6, "0")}.png`;
    const camera = source.frames[index].effects[0];
    const active = camera.active;
    if (row.clipStart !== camera.cameraClip[0] || row.clipEnd !== camera.cameraClip[1] ||
      JSON.stringify(row.cameraMatrixWorld) !== JSON.stringify(camera.cameraMatrixWorld)) throw new Error("分层相机与完整受光图不一致");
    if (row.frame !== frame || row.active !== active || row.clipStart >= row.clipEnd || new Set(row.files.map(file => file.layer)).size !== 4) throw new Error("分层帧身份、时间窗或相机不一致");
    const pixels = new Map<string, Buffer>();
    for (const file of row.files) {
      const expected = `separated/${file.layer}/${name}`;
      if (file.frame !== frame || file.active !== active || file.path !== expected) throw new Error("分层路径或身份不一致");
      const info = await stat(path.join(dir, expected));
      if (info.size !== file.bytes) throw new Error("分层文件体积不一致");
      const bytes = await readFile(path.join(dir, expected));
      if (digest(bytes) !== file.sha256) throw new Error("分层文件校验失败");
      renderedBytes += bytes.length;
      const image = sharp(bytes, { limitInputPixels: 1920 * 1080 }), metadata = await image.metadata();
      if (metadata.format !== "png" || metadata.width !== meta.width || metadata.height !== meta.height ||
        (active && file.layer === "depth" && metadata.bitsPerSample !== 16) ||
        (["plate", "fragments"].includes(file.layer) && !metadata.hasAlpha)) throw new Error("分层画幅、透明度或深度精度不一致");
      if (active && ["plate", "fragments"].includes(file.layer)) pixels.set(file.layer, await image.ensureAlpha().raw().toBuffer());
      add(file.path, bytes);
    }
    const beautyBytes = await readFile(path.join(dir, name));
    if (source.files[index].frame !== frame || digest(beautyBytes) !== source.files[index].sha256) throw new Error("完整受光帧身份不一致");
    let bytes: Buffer = beautyBytes;
    let correctionReceipt: Record<string, unknown> | undefined;
    if (active) {
      const beauty = await sharp(beautyBytes).ensureAlpha().raw().toBuffer();
      const correction = makeVfxInteractionCorrection(beauty, pixels.get("plate")!, pixels.get("fragments")!);
      const reconstructed = reconstructVfxWorldFrame(pixels.get("plate")!, pixels.get("fragments")!, correction);
      if (!reconstructed.equals(beauty)) throw new Error("分层重组与同场完整受光图不一致");
      const correctionPath = `interactions/${name.replace(".png", ".rgb16le.zlib")}`;
      add(correctionPath, correction);
      correctionReceipt = { path: correctionPath, sha256: digest(correction), bytes: correction.length };
      bytes = await sharp(reconstructed, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toBuffer();
    }
    await writeFile(path.join(target, name), bytes, { flag: "wx" });
    add(`composed/${name}`, bytes);
    receipts.push({ ...row, correction: correctionReceipt, reconstructedSha256: digest(bytes), identicalPixels: active, passthrough: !active });
  }
  if (renderedBytes !== source.separated.bytes) throw new Error("分层总量回执不一致");
  const receipt = { version: 1, kind: "same-scene-composite-v1", eventId: source.eventId, sceneJobId: source.sceneJobId, sceneSha256: source.sceneSha256,
    ...meta, frameCount: count, complete: true, encoding: "srgb8-straight-over-plus-signed-rgb16le-zlib",
    depthEncoding: source.separated.depthEncoding, frames: receipts,
    boundaryZh: "仅限同一资产、相机、时间轴与像素位置；相互受光差值保留同场阴影反射。改变底层、模型或相机后须重新渲染，不能盲叠到AI改写画面。" };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  add("manifest.json", receiptBytes);
  add("使用说明.txt", Buffer.from(`同场分层包\n\n帧率：${meta.fps}；帧数：${count}；画幅：${meta.width}×${meta.height}。\ncomposed目录是实际从分层重组并与完整受光图逐像素核对的PNG序列，可直接导入剪辑软件。\nseparated/plate为去碎片底层；fragments为保留几何遮挡的透明碎片；actors为可见角色遮罩；depth为相机裁剪范围归一化的16位Z通道。非活动帧仅透明占位，以manifest中的active为准。\ninteractions为同场阴影反射差值，格式是zlib压缩的小端有符号RGB16，每像素6字节。先在sRGB8数值空间计算round(底层×(255-alpha)/255+碎片×alpha/255)，再加差值。\n所有层只匹配本次相同角色、资产、相机和像素位置；改模型、改机位或换底后须重新渲染。此包不是AI画面自动对齐工具。\nmanifest记录每帧裁剪范围、相机矩阵、文件摘要和重组摘要。原片音轨在视频产物中保留，PNG包不包含音轨。\n`));
  await writeFile(path.join(dir, "composition.json"), receiptBytes, { flag: "wx" });
  signal.throwIfAborted();
  await pipeline(zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "STORE" }), createWriteStream(archive, { flags: "wx" }), { signal });
  const bytes = (await stat(archive)).size;
  if (bytes > limit) throw new Error("分层ZIP超过512MiB");
  return { directory: target, archive, bytes, receipt };
}
