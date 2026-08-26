/**
 * 段级产物缓存（0826 用户拍板并入）：段跑成功即存，重跑先查——
 * 「四段成两段败」的失败集重跑只买败的段，成功段的钱永不白烧。
 *
 * 本模块只做**哑存储**（对象名/读/写/清），不 import runner：
 * 指纹计算与门禁复验都在 runner 侧完成，避免循环依赖。
 * 缓存不是真源：入库成功后由 execution 清掉本集缓存；读不动/对不上一律当 miss。
 */
import {
  deleteGcsObject,
  downloadGcsObjectVersioned,
  getGcsBucketName,
  uploadBufferToGcs,
} from "./gcs.js";
import { nativeDeepReadProposalId } from "./manhuaNativeDeepReadIngest.js";

export const NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX =
  "manhua-template-learn/segment-cache/";

/** 与占位/卡片同一个 id 生成器：非法 seriesKey/集号在这里就抛，不走网络。 */
export function nativeDeepReadSegmentCacheObjectName(
  seriesKey: string,
  episodeIndex: number,
  segmentIndex: number,
): string {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex > 31) {
    throw new Error(`段缓存 segmentIndex 非法：${segmentIndex}`);
  }
  return `${NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX}${nativeDeepReadProposalId(seriesKey, episodeIndex)}_seg${segmentIndex}.json`;
}

export type NativeDeepReadSegmentCacheEntry = {
  /** runner 侧的参数指纹（PLAN_VERSION+generationConfig+提示词模板）；对不上=作废 */
  fingerprint: string;
  seriesKey: string;
  episodeIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio: boolean;
  /** 已通过段门禁的段卡原文 */
  raw: Record<string, unknown>;
  /** 原始付费调用的用量快照（溯源用；缓存命中时不再计费） */
  paidUsage: {
    inputTokens: number;
    outputTokens: number;
    audioInputTokens: number;
    reasoningTokens: number;
    costCny: number;
  };
  savedAtIso: string;
};

/** 读一条缓存条目；任何读取/解析问题一律返回 null（缓存永远只能省钱，不能拦路）。 */
export async function readNativeDeepReadSegmentCacheEntry(input: {
  seriesKey: string;
  episodeIndex: number;
  segmentIndex: number;
}): Promise<NativeDeepReadSegmentCacheEntry | null> {
  const objectName = nativeDeepReadSegmentCacheObjectName(
    input.seriesKey,
    input.episodeIndex,
    input.segmentIndex,
  );
  try {
    const versioned = await downloadGcsObjectVersioned({
      gcsUri: `gs://${getGcsBucketName()}/${objectName}`,
    });
    const parsed = JSON.parse(versioned.buffer.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entry = parsed as NativeDeepReadSegmentCacheEntry;
    if (
      typeof entry.fingerprint !== "string"
      || !entry.raw
      || typeof entry.raw !== "object"
      || typeof entry.hasAudio !== "boolean"
    ) return null;
    return entry;
  } catch {
    return null;
  }
}

/** 写一条缓存条目（幂等覆盖）。写失败只影响下次省钱，由调用方决定是否 warn。 */
export async function writeNativeDeepReadSegmentCacheEntry(
  entry: NativeDeepReadSegmentCacheEntry,
): Promise<void> {
  const objectName = nativeDeepReadSegmentCacheObjectName(
    entry.seriesKey,
    entry.episodeIndex,
    entry.segmentIndex,
  );
  await uploadBufferToGcs({
    objectName,
    contentType: "application/json",
    buffer: Buffer.from(`${JSON.stringify(entry, null, 2)}\n`, "utf8"),
  });
}

/** 入库成功后清掉本集全部段缓存（集卡已是真源，缓存留着只会过期误导）。 */
export async function clearNativeDeepReadSegmentCacheForEpisode(input: {
  seriesKey: string;
  episodeIndex: number;
  segmentCount: number;
}): Promise<void> {
  const bucket = getGcsBucketName();
  const jobs: Array<Promise<unknown>> = [];
  for (let segmentIndex = 0; segmentIndex < input.segmentCount; segmentIndex += 1) {
    const objectName = nativeDeepReadSegmentCacheObjectName(
      input.seriesKey,
      input.episodeIndex,
      segmentIndex,
    );
    jobs.push(deleteGcsObject({ bucket, objectName }).catch(() => undefined));
  }
  await Promise.allSettled(jobs);
}
