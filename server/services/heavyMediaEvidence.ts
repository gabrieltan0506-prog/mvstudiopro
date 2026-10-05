import { createHash } from "node:crypto";
import {
  uploadBufferToGcsIfAbsent,
  downloadGcsObject,
  getGcsBucketName,
} from "./gcs";

const objectName = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw new Error("Invalid media receipt identity");
  return `heavy-media-evidence/${id}/result.json`;
};
/** Permanent, immutable result receipt. Never included in temporary-media cleanup. */
export async function saveHeavyMediaResult(
  id: string,
  userId: string,
  result: unknown
) {
  const content = JSON.stringify(result);
  const receipt = {
    version: 1,
    id,
    userId,
    bytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
    result,
  };
  const stored = await uploadBufferToGcsIfAbsent({
    objectName: objectName(id),
    buffer: Buffer.from(JSON.stringify(receipt)),
    contentType: "application/json",
  });
  if (!stored.created) {
    const existing = await readHeavyMediaResult(id, userId);
    if (JSON.stringify(existing) !== content)
      throw new Error("Existing media result differs; original retained");
  }
  return {
    objectName: objectName(id),
    bytes: receipt.bytes,
    sha256: receipt.sha256,
  };
}
export async function readHeavyMediaResult(
  id: string,
  userId: string
): Promise<unknown | null> {
  let buffer: Buffer;
  try {
    ({ buffer } = await downloadGcsObject({
      gcsUri: `gs://${getGcsBucketName()}/${objectName(id)}`,
    }));
  } catch (error) {
    if (/gcs_download_failed:404/.test(String(error))) return null;
    throw error;
  }
  const receipt = JSON.parse(buffer.toString("utf8"));
  const content = JSON.stringify(receipt.result);
  if (
    receipt.version !== 1 ||
    receipt.id !== id ||
    receipt.userId !== userId ||
    receipt.bytes !== Buffer.byteLength(content) ||
    receipt.sha256 !== createHash("sha256").update(content).digest("hex")
  ) {
    throw new Error("Invalid media result receipt; refusing recovery");
  }
  return receipt.result;
}
