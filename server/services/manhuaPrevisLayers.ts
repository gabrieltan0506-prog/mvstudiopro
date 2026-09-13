/** 固定遮罩与深度层包；所有名字、体积与解码尺寸均在读取和解压前校验。 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { z } from "zod";
import type { ManhuaPrevisSpec } from "../../shared/manhuaPrevis";
export const LAYER_PNG_LIMIT = 60 * 1024 * 1024;
export const LAYER_ZIP_LIMIT = 64 * 1024 * 1024;
export const LAYER_META_LIMIT = 1024 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const layerBundleSchema = z
  .object({
    gcsUri: z.string(),
    bytes: z.number().int().positive().max(LAYER_ZIP_LIMIT),
    sha256: digest,
    format: z.literal("previs-layers-v1"),
  })
  .strict();
export type PrevisLayerBundle = z.infer<typeof layerBundleSchema>;
const layerMetaSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("geometry_masks_depth_v1"),
    complete: z.literal(true),
    fps: z.literal(24),
    frameCount: z.number().int().min(48).max(192),
    selectedFrames: z.array(z.number().int()).max(192),
    width: z.number().int(),
    height: z.number().int(),
    sceneSha256: digest,
    depth: z
      .object({
        encoding: z.literal("linear_z_pass_clip_normalized_u16"),
        nearValue: z.literal(0),
        farValue: z.literal(1),
        backgroundValue: z.literal(1),
      })
      .strict(),
    cameras: z
      .array(
        z
          .object({
            frame: z.number().int(),
            clipStart: z.number().finite().positive(),
            clipEnd: z.number().finite().positive(),
          })
          .strict()
      )
      .max(192),
    files: z
      .array(
        z
          .object({
            layer: z.enum(["actors", "effects", "depth"]),
            frame: z.number().int(),
            path: z.string(),
            bytes: z.number().int().positive().max(LAYER_PNG_LIMIT),
            sha256: digest,
          })
          .strict()
      )
      .max(576),
    boundaryZh: z.string().min(1).max(2000),
  })
  .strict();
export const layerSha = (b: Buffer) =>
  createHash("sha256").update(b).digest("hex");
function metadata(raw: Buffer, spec: ManhuaPrevisSpec, sceneSha256: string) {
  if (
    !spec.exportLayers ||
    spec.actors.length > 3 ||
    spec.durationSec > 8 ||
    raw.length > LAYER_META_LIMIT
  )
    throw Error("分层输出配置或清单体积无效");
  const meta = layerMetaSchema.parse(JSON.parse(raw.toString("utf8")));
  const frames = spec.durationSec * 24,
    [width, height] = spec.aspect === "16:9" ? [960, 540] : [540, 960];
  if (
    meta.frameCount !== frames ||
    meta.width !== width ||
    meta.height !== height ||
    meta.sceneSha256 !== sceneSha256 ||
    meta.selectedFrames.length !== frames ||
    meta.cameras.length !== frames ||
    meta.files.length !== frames * 3
  )
    throw Error("分层清单与场景或帧数不一致");
  meta.selectedFrames.forEach((f, i) => {
    if (
      f !== i + 1 ||
      meta.cameras[i].frame !== f ||
      meta.cameras[i].clipStart >= meta.cameras[i].clipEnd
    )
      throw Error("分层相机或帧序号不完整");
  });
  const names = new Set<string>();
  let total = 0;
  for (const file of meta.files) {
    const expected = `${file.layer}/frame-${String(file.frame).padStart(4, "0")}.png`;
    if (
      file.frame < 1 ||
      file.frame > frames ||
      file.path !== expected ||
      names.has(file.path)
    )
      throw Error("分层文件身份缺失或重复");
    names.add(file.path);
    total += file.bytes;
  }
  if (total > LAYER_PNG_LIMIT) throw Error("分层PNG总量超过60MiB");
  return meta;
}
async function png(
  bytes: Buffer,
  file: { bytes: number; sha256: string; layer: string },
  width: number,
  height: number
) {
  if (
    bytes.length !== file.bytes ||
    layerSha(bytes) !== file.sha256 ||
    bytes.length < 33 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw Error("分层PNG字节或哈希不一致");
  if (
    bytes.readUInt32BE(16) !== width ||
    bytes.readUInt32BE(20) !== height ||
    bytes[24] !== (file.layer === "depth" ? 16 : 8) ||
    bytes[25] !== 0
  )
    throw Error("分层PNG尺寸、灰度或深度位数不一致");
  const image = sharp(bytes, {
    limitInputPixels: width * height,
    failOn: "warning",
  });
  const info = await image.metadata();
  if (info.width !== width || info.height !== height || info.format !== "png")
    throw Error("分层PNG无法正确解码");
  // 完整解码，而非只读伪造IHDR。一次只保留一帧解码数据。
  await image.raw().toBuffer();
}
/** 只接受本服务生成的STORE包，先校验中央目录和本地头，禁止解压炸弹及路径规范化偷换。 */
function zipNames(bytes: Buffer): string[] {
  if (bytes.length < 22 || bytes.length > LAYER_ZIP_LIMIT)
    throw Error("分层ZIP体积无效");
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 20) !== 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw Error("分层ZIP尾部或卷信息无效");
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    offset = bytes.readUInt32LE(end + 16);
  if (
    count !== bytes.readUInt16LE(end + 8) ||
    count > 577 ||
    offset + size !== end
  )
    throw Error("分层ZIP目录超限");
  const names: string[] = [];
  let p = offset,
    total = 0,
    localEnd = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || bytes.readUInt32LE(p) !== 0x02014b50)
      throw Error("分层ZIP目录损坏");
    const flags = bytes.readUInt16LE(p + 8),
      method = bytes.readUInt16LE(p + 10),
      compressed = bytes.readUInt32LE(p + 20),
      uncompressed = bytes.readUInt32LE(p + 24),
      nameLength = bytes.readUInt16LE(p + 28),
      extra = bytes.readUInt16LE(p + 30),
      comment = bytes.readUInt16LE(p + 32),
      local = bytes.readUInt32LE(p + 42);
    if (
      flags !== 0 ||
      method !== 0 ||
      compressed !== uncompressed ||
      extra !== 0 ||
      comment !== 0 ||
      p + 46 + nameLength > end ||
      local !== localEnd ||
      local + 30 > offset
    )
      throw Error("分层ZIP含不支持的压缩或文件结构");
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLength);
    if (
      !/^(meta\.json|(?:actors|effects|depth)\/frame-\d{4}\.png)$/.test(name) ||
      names.includes(name)
    )
      throw Error("分层ZIP文件名非法或重复");
    if (
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== 0 ||
      bytes.readUInt16LE(local + 8) !== 0 ||
      bytes.readUInt32LE(local + 18) !== compressed ||
      bytes.readUInt32LE(local + 22) !== uncompressed ||
      bytes.readUInt16LE(local + 26) !== nameLength ||
      bytes.readUInt16LE(local + 28) !== 0 ||
      bytes.toString("utf8", local + 30, local + 30 + nameLength) !== name ||
      bytes.readUInt32LE(local + 14) !== bytes.readUInt32LE(p + 16)
    )
      throw Error("分层ZIP本地文件头不一致");
    if (
      uncompressed > (name === "meta.json" ? LAYER_META_LIMIT : LAYER_PNG_LIMIT)
    )
      throw Error("分层ZIP单文件超限");
    localEnd = local + 30 + nameLength + compressed;
    if (localEnd > offset) throw Error("分层ZIP数据越界");
    total += uncompressed;
    if (total > LAYER_PNG_LIMIT + LAYER_META_LIMIT)
      throw Error("分层ZIP解压总量超限");
    names.push(name);
    p += 46 + nameLength;
  }
  if (p !== end || localEnd !== offset) throw Error("分层ZIP含额外数据");
  return names;
}
export async function validatePrevisLayerBundle(
  bytes: Buffer,
  spec: ManhuaPrevisSpec,
  sceneSha256: string
) {
  const names = zipNames(bytes);
  const zip = await JSZip.loadAsync(bytes, {
    checkCRC32: true,
    createFolders: false,
  });
  const entry = zip.file("meta.json");
  if (!entry) throw Error("分层ZIP缺少清单");
  const raw = await entry.async("nodebuffer"),
    meta = metadata(raw, spec, sceneSha256);
  if (
    names.length !== meta.files.length + 1 ||
    meta.files.some(f => !names.includes(f.path))
  )
    throw Error("分层ZIP文件不完整");
  for (const file of meta.files) {
    const item = zip.file(file.path);
    if (!item) throw Error("分层ZIP缺帧");
    await png(await item.async("nodebuffer"), file, meta.width, meta.height);
  }
  return meta;
}
async function localFile(file: string, max: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > max)
    throw Error("分层本地文件无效");
  const bytes = await readFile(file);
  if (bytes.length !== info.size) throw Error("分层本地文件变化");
  return bytes;
}
export async function buildPrevisLayerBundle(
  folder: string,
  raw: Buffer,
  spec: ManhuaPrevisSpec,
  sceneSha256: string
) {
  const meta = metadata(raw, spec, sceneSha256),
    zip = new JSZip();
  const root = await readdir(folder);
  if (
    root.length !== 4 ||
    ["actors", "effects", "depth", "meta.json"].some(n => !root.includes(n))
  )
    throw Error("分层目录含额外文件");
  zip.file("meta.json", raw, { createFolders: false });
  for (const layer of ["actors", "effects", "depth"]) {
    const dir = path.join(folder, layer),
      info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("分层目录无效");
    const names = await readdir(dir),
      expected = meta.files.filter(f => f.layer === layer);
    if (
      names.length !== expected.length ||
      expected.some(f => !names.includes(path.basename(f.path)))
    )
      throw Error("分层目录缺帧或含额外文件");
  }
  for (const file of meta.files) {
    const bytes = await localFile(path.join(folder, file.path), file.bytes);
    await png(bytes, file, meta.width, meta.height);
    zip.file(file.path, bytes, { createFolders: false });
  }
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
    streamFiles: false,
  });
  if (bytes.length > LAYER_ZIP_LIMIT) throw Error("分层ZIP超过64MiB");
  zipNames(bytes);
  return { bytes, meta };
}
