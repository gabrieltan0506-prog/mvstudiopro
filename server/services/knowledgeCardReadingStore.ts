import { createHash } from "node:crypto";
import {
  getGcsBucketName, inspectGcsObjectBounded, uploadBufferToGcsIfAbsent,
} from "./gcs.js";

export const knowledgeReadingDigest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function knowledgeReadingPrefix(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("请先登录");
  return `knowledge-card-reading/u${userId}/`;
}

/** 对象名只由服务端构造；读取异常与对象不存在必须区分，避免故障时重新购买。 */
export async function readKnowledgeReadingObject(objectName: string): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  try {
    await inspectGcsObjectBounded({
      gcsUri: `gs://${getGcsBucketName()}/${objectName}`, maxBytes: 64 * 1024 * 1024,
      onChunk: chunk => chunks.push(Buffer.from(chunk)),
    });
    return Buffer.concat(chunks);
  } catch (error) {
    if (/^gcs_download_failed:404$/.test(String((error as Error).message))) return null;
    throw error;
  }
}

/** 永久、不可覆盖；原始响应与结构化证据分别调用此函数。 */
export async function saveKnowledgeReadingObject(objectName: string, buffer: Buffer, contentType = "application/json") {
  const receipt = await uploadBufferToGcsIfAbsent({ objectName, buffer, contentType });
  if (!receipt.created) {
    const previous = await readKnowledgeReadingObject(objectName);
    if (!previous || knowledgeReadingDigest(previous) !== knowledgeReadingDigest(buffer)) {
      throw new Error("阅读证据身份冲突，已保留旧记录，未覆盖");
    }
  }
  return { objectName, bytes: buffer.length, sha256: knowledgeReadingDigest(buffer), gcsUri: `gs://${getGcsBucketName()}/${objectName}` };
}

export async function readKnowledgeReadingJson<T>(objectName: string): Promise<T | null> {
  const buffer = await readKnowledgeReadingObject(objectName);
  return buffer === null ? null : JSON.parse(buffer.toString("utf8")) as T;
}

/** 占用后未见响应时只允许对账，不能在超时/进程重启后重复提交上游。 */
export async function claimKnowledgeReadingCall(objectName: string): Promise<boolean> {
  return (await uploadBufferToGcsIfAbsent({
    objectName, contentType: "application/json",
    buffer: Buffer.from(JSON.stringify({ startedAt: new Date().toISOString() })),
  })).created;
}
