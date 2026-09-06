import { createHash } from "node:crypto";
import { NATIVE_STRUCTURED_CARD_PREFIX } from "../../shared/manhuaNativeStructuredCard.js";
import {
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
  downloadGcsObjectVersioned,
} from "./gcs.js";

export type NativeStructuredCard = {
  schemaVersion: 1;
  sourceDigest: string;
  seriesKey: string;
  episodeIndex: number;
  segmentEvidenceObjectNames: string[];
  raw: Record<string, unknown>;
};
/** 零模型调用保存实际消费的整形结果，避免多批整形导出又退回失败原稿。 */
export async function writeNativeStructuredCard(
  input: NativeStructuredCard,
  deps = {
    upload: uploadBufferToGcsIfAbsent,
    download: downloadGcsObjectVersioned,
    getBucket: getGcsBucketName,
  }
): Promise<string> {
  if (
    !/^[a-f0-9]{64}$/.test(input.sourceDigest) ||
    !input.segmentEvidenceObjectNames.length ||
    !Array.isArray(input.raw.shots) ||
    !input.raw.shots.length
  )
    throw new Error("整形消费证据为空或来源身份缺失");
  const buffer = Buffer.from(JSON.stringify(input));
  const objectName = `${NATIVE_STRUCTURED_CARD_PREFIX}${createHash("sha256").update(buffer).digest("hex")}.json`;
  const bucket = deps.getBucket();
  await deps.upload({
    bucket,
    objectName,
    buffer,
    contentType: "application/json",
  });
  const saved = await deps.download({ gcsUri: `gs://${bucket}/${objectName}` });
  if (!saved.buffer.equals(buffer))
    throw new Error("整形消费证据持久化对账不符");
  console.info(
    `[nativeDeepRead] 最终消费证据已保存：${objectName} · ${buffer.length} bytes · SHA-256=${objectName.slice(NATIVE_STRUCTURED_CARD_PREFIX.length, -5)}`
  );
  return objectName;
}
