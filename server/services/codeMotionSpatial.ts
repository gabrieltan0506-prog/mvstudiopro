import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  CODE_MOTION_SPATIAL_MAX_BYTES,
  codeMotionSpatialAssetSchema,
  codeMotionSpatialFrameSchema,
  type CodeMotionSpatial,
} from "../../shared/codeMotionSpatial";
import type { CodeMotionProject } from "../../shared/codeMotion";
import { codeMotionStorage, type CodeMotionStoreDeps } from "./codeMotionStore";
import {
  getGcsBucketName,
  inspectGcsObjectBounded,
  uploadBufferToGcsIfAbsent,
} from "./gcs";
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { importCodeMotionFile } from "./codeMotionImport";

export function spatialPrefix(userId: string, projectId: string) {
  if (!/^[1-9][0-9]*$/.test(userId)) throw Error("账号无法确认");
  z.string().uuid().parse(projectId);
  return `code-motion/u${userId}/production/${projectId}/spatial/`;
}
export function spatialSceneDigest(
  scene: NonNullable<CodeMotionProject["plan"]>["scenes"][number]
) {
  return createHash("sha256").update(JSON.stringify(scene)).digest("hex");
}
export async function writeSpatialRecord(
  storage: CodeMotionStoreDeps,
  name: string,
  value: unknown
) {
  const bytes = Buffer.from(JSON.stringify(value));
  const old = await storage.read(name);
  if (old) {
    if (!old.body.equals(bytes)) throw Error("素材记录冲突，已有版本已保留");
    return;
  }
  try {
    await storage.write(name, bytes, "0");
  } catch (error) {
    const winner = await storage.read(name);
    if (!winner?.body.equals(bytes)) throw error;
  }
}
export async function readSpatialBytes(
  uri: string,
  maxBytes = CODE_MOTION_SPATIAL_MAX_BYTES
) {
  const chunks: Buffer[] = [];
  await inspectGcsObjectBounded({
    gcsUri: uri,
    maxBytes,
    timeoutMs: 90_000,
    onChunk: b => chunks.push(Buffer.from(b)),
  });
  return Buffer.concat(chunks);
}
export async function archiveSpatialBytes(
  name: string,
  bytes: Buffer,
  mime: string
) {
  const uri = `gs://${getGcsBucketName()}/${name}`;
  const result = await uploadBufferToGcsIfAbsent({
    objectName: name,
    buffer: bytes,
    contentType: mime,
    signal: AbortSignal.timeout(90_000),
  });
  if (!result.created && !(await readSpatialBytes(uri)).equals(bytes))
    throw Error("归档内容冲突，未覆盖原文件");
  return uri;
}
/** 拒绝外部资源引用；预览只能读取本账号已归档的单文件资产。 */
export function inspectSpatialAsset(bytes: Buffer, kind: "glb" | "spz") {
  if (!bytes.length || bytes.length > CODE_MOTION_SPATIAL_MAX_BYTES)
    throw Error("三维文件为空或超过250 MiB");
  if (kind === "spz") {
    const raw = gunzipSync(bytes, { maxOutputLength: 300_000_000 });
    if (
      raw.length < 16 ||
      raw.readUInt32LE(0) !== 0x5053474e ||
      ![2, 3].includes(raw.readUInt32LE(4)) ||
      raw.readUInt32LE(8) === 0
    )
      throw Error("不是支持的SPZ高斯文件");
    return;
  }
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length ||
    bytes.readUInt32LE(16) !== 0x4e4f534a
  )
    throw Error("不是完整的GLB 2.0文件");
  const length = bytes.readUInt32LE(12);
  if (20 + length > bytes.length) throw Error("GLB结构不完整");
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length).trim());
  if (!json.meshes?.length || !json.nodes?.length)
    throw Error("GLB没有可显示的模型");
  for (const value of [...(json.buffers || []), ...(json.images || [])]) {
    if (value.uri && !String(value.uri).startsWith("data:"))
      throw Error("GLB包含外部资源，请先打包为单个GLB文件");
  }
}
export const spatialImportDeps = {
  resolve: resolveRegisteredPostProdMediaSource,
  read: readSpatialBytes,
  archive: archiveSpatialBytes,
  storage: codeMotionStorage,
};
export async function importCodeMotionSpatialAsset(
  userId: string,
  input: {
    projectId: string;
    name: string;
    kind: "glb" | "spz";
    gcsUri: string;
  },
  deps = spatialImportDeps
) {
  const prefix = spatialPrefix(userId, input.projectId);
  const uri = await deps.resolve({ userId, source: input.gcsUri });
  const bytes = await deps.read(uri);
  inspectSpatialAsset(bytes, input.kind);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const gcsUri = await deps.archive(
    `${prefix}${sha256}.${input.kind}`,
    bytes,
    "application/octet-stream"
  );
  const asset = codeMotionSpatialAssetSchema.parse({
    id: sha256,
    kind: input.kind,
    name: input.name,
    gcsUri,
    sha256,
    bytes: bytes.length,
  });
  // 同字节不同文件名沿用首份归档，重复上传不产生新的资产身份。
  const record = `${prefix}assets/${sha256}.json`;
  const old = await deps.storage.read(record);
  if (old)
    return codeMotionSpatialAssetSchema.parse(JSON.parse(old.body.toString()));
  await writeSpatialRecord(deps.storage, record, asset);
  return asset;
}
export async function assertCodeMotionSpatial(
  userId: string,
  projectId: string,
  spatial: CodeMotionSpatial,
  storage = codeMotionStorage
) {
  const prefix = spatialPrefix(userId, projectId);
  const readOwned = async (
    kind: "assets" | "frames",
    id: string,
    value: unknown
  ) => {
    const own = await storage.read(`${prefix}${kind}/${id}.json`);
    if (own) return own;
    if (
      !(await storage.read(
        `code-motion/u${userId}/production/${projectId}/grant.json`
      ))
    )
      return null;
    const { codeMotionRevisionAssetParent } = await import(
      "./codeMotionRevision"
    );
    const parent = await codeMotionRevisionAssetParent(
      userId,
      projectId,
      kind === "assets" ? "spatialAsset" : "spatialFrame",
      value,
      storage
    );
    return parent
      ? storage.read(`${spatialPrefix(userId, parent)}${kind}/${id}.json`)
      : null;
  };
  for (const asset of spatial.assets) {
    const record = await readOwned("assets", asset.id, asset);
    if (
      !record ||
      JSON.stringify(JSON.parse(record.body.toString())) !==
        JSON.stringify(asset)
    )
      throw Error("三维素材不属于当前作品或记录已改变");
  }
  for (const frame of spatial.frames) {
    const record = await readOwned("frames", frame.id, frame);
    if (
      !record ||
      JSON.stringify(JSON.parse(record.body.toString())) !==
        JSON.stringify(frame)
    )
      throw Error("参考帧不属于当前作品或记录已改变");
    if (
      !spatial.assets.some(a => a.id === frame.worldId && a.kind === "spz") ||
      frame.actors.some(
        actor =>
          !spatial.assets.some(a => a.id === actor.assetId && a.kind === "glb")
      )
    )
      throw Error("参考帧对应的三维资产缺失");
  }
  if (
    new Set(spatial.frames.map(f => f.sceneIndex)).size !==
    spatial.frames.length
  )
    throw Error("同一镜头只能采用一份三维参考帧");
}
export async function importCodeMotionSpatialFrame(
  userId: string,
  project: CodeMotionProject,
  input: {
    gcsUri: string;
    bytes: number;
    frame: Omit<
      CodeMotionSpatial["frames"][number],
      "id" | "image" | "sceneDigest"
    >;
  }
) {
  const scene = project.plan?.scenes[input.frame.sceneIndex];
  const spatial = project.plan?.spatial;
  if (!scene || !spatial) throw Error("请先保存本镜和三维素材");
  await assertCodeMotionSpatial(userId, project.id, { ...spatial, frames: [] });
  if (
    !spatial.assets.some(
      a => a.id === input.frame.worldId && a.kind === "spz"
    ) ||
    input.frame.actors.some(
      a => !spatial.assets.some(s => s.id === a.assetId && s.kind === "glb")
    )
  )
    throw Error("参考帧的三维源文件未归档");
  if (
    input.frame.referenceImageIds?.some(
      id => !project.brief.images.some(image => image.id === id)
    )
  )
    throw Error("三维身份参考图不在当前作品内，请先采用原图");
  const imported = await importCodeMotionFile(userId, {
    gcsUri: input.gcsUri,
    name: "三维参考.png",
    bytes: input.bytes,
  });
  if (imported.kind !== "image") throw Error("参考帧不是图片");
  const frame = codeMotionSpatialFrameSchema.parse({
    ...input.frame,
    id: randomUUID(),
    image: imported.image,
    sceneDigest: spatialSceneDigest(scene),
  });
  await writeSpatialRecord(
    codeMotionStorage,
    `${spatialPrefix(userId, project.id)}frames/${frame.id}.json`,
    frame
  );
  return frame;
}
