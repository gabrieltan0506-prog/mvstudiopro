import type { ManhuaViralTemplateEvidenceFrame } from "../../shared/manhuaViralTemplateBank";
import { inspectGcsObjectBounded, getGcsBucketName } from "./gcs";
import { shouldDispatchHeavyMedia, dispatchLearnWork } from "./heavyLearnMedia";

/** 一批回执一次调度，读取对象实字节核对，不把存在性当完整性。 */
export async function verifyNativeEvidenceFrames(frames: ManhuaViralTemplateEvidenceFrame[], signal?: AbortSignal): Promise<boolean[]> {
  if (!frames.length) return [];
  if (shouldDispatchHeavyMedia()) return dispatchLearnWork<boolean[]>({ operation: "verify_frames", frames }, signal);
  return verifyNativeEvidenceFramesLocally(frames, signal);
}
export async function verifyNativeEvidenceFramesLocally(frames: ManhuaViralTemplateEvidenceFrame[], signal?: AbortSignal): Promise<boolean[]> {
  const results: boolean[] = [];
  for (const frame of frames) {
    signal?.throwIfAborted();
    try {
      const actual = await inspectGcsObjectBounded({ gcsUri: `gs://${getGcsBucketName()}/${frame.objectName}`, signal, maxBytes: frame.bytes });
      results.push(actual.byteLength === frame.bytes && actual.sha256 === frame.sha256);
    } catch { signal?.throwIfAborted(); results.push(false); }
  }
  return results;
}
