import { createHash } from "node:crypto";
import { uploadBufferToGcs } from "./gcs";
import { backupArtMotionEvidence } from "./artMotionEvidence";
export type ArtMotionEvidenceReceipt = {
  storage: "gcs" | "website_data";
  objectName: string;
  gcsUri?: string;
  bytes: number;
  sha256: string;
};
/** 正常只写 GCS；只有存储失败才等待网站 /data 的持久化及摘要回执。 */
export async function persistArtMotionEvidence(
  userId: string,
  requestId: string,
  objectName: string,
  bytes: Buffer,
  deps = { upload: uploadBufferToGcs, fallback: backupArtMotionEvidence }
): Promise<ArtMotionEvidenceReceipt> {
  const receipt = {
    objectName,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    const saved = await deps.upload({
      objectName,
      buffer: bytes,
      contentType: "application/json",
      signal: AbortSignal.timeout(120_000),
    });
    return { ...receipt, storage: "gcs", gcsUri: saved.gcsUri };
  } catch {
    await deps.fallback(userId, requestId, objectName, bytes);
    return { ...receipt, storage: "website_data" };
  }
}
