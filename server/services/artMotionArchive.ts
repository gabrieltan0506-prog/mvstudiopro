import { readFile, mkdir, open, link, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  getGcsBucketName,
  inspectGcsObjectBounded,
  uploadBufferToGcsIfAbsent,
} from "./gcs";

export class ArtMotionArchiveUnavailable extends Error {
  constructor() {
    super("GCS 动画归档读写失败");
  }
}

export const artMotionSha = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
/** 小型证据有界读取；凭证和内容始终留在服务端。 */
export async function readArtMotionArchive(
  objectName: string,
  maxBytes = 2 * 1024 * 1024
) {
  const chunks: Buffer[] = [];
  try {
    await inspectGcsObjectBounded({
      gcsUri: `gs://${getGcsBucketName()}/${objectName}`,
      maxBytes,
      timeoutMs: 30_000,
      onChunk: chunk => chunks.push(Buffer.from(chunk)),
    });
  } catch {
    throw new ArtMotionArchiveUnavailable();
  }
  return Buffer.concat(chunks);
}
/** 原子创建且永不覆盖；已存在时必须逐字节相同，才算幂等成功。 */
export async function writeArtMotionArchive(objectName: string, bytes: Buffer) {
  let saved;
  try {
    saved = await uploadBufferToGcsIfAbsent({
      objectName,
      buffer: bytes,
      contentType: "application/json",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ArtMotionArchiveUnavailable();
  }
  if (!saved.created) {
    const prior = await readArtMotionArchive(objectName, bytes.length).catch(
      () => {
        throw new Error("已存在的场景快照无法核对，未创建回退版本");
      }
    );
    if (!prior.equals(bytes))
      throw new Error("动画永久归档内容冲突，未覆盖原版本");
  }
}

const FALLBACK_ROOT = "/data/growth/art-motion-inputs";
async function websiteArchivePath(objectName: string) {
  if (
    process.env.FLY_MACHINE_ID &&
    process.env.FLY_MACHINE_ID === process.env.MANHUA_HEAVY_MACHINE_ID
  )
    throw new Error("工作机禁止使用 /data 场景回退");
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  if (!mounts.split("\n").some(row => row.split(" ")[4] === "/data"))
    throw new Error("网站持久卷不可用");
  return path.join(
    FALLBACK_ROOT,
    `${artMotionSha(Buffer.from(objectName))}.json`
  );
}
export async function writeWebsiteArtMotionArchive(
  objectName: string,
  bytes: Buffer
) {
  const target = await websiteArchivePath(objectName);
  await mkdir(FALLBACK_ROOT, { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await readFile(target)).equals(bytes))
        throw new Error("场景回退快照内容冲突，未覆盖原版本");
    }
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
  const dir = await open(FALLBACK_ROOT, "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
export async function readWebsiteArtMotionArchive(objectName: string) {
  return readFile(await websiteArchivePath(objectName));
}
