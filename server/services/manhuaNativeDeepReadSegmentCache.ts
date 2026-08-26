/**
 * 原生精读段级产物缓存。
 *
 * 一段通过当前门禁后必须先可靠写入这里，后续段才允许继续付费；整集入库后，
 * execution 在仍持有该集 claim 时清理缓存。缓存不是审批真源，但它是已付费段的
 * 恢复凭证，所以读取故障不能静默当 miss、写入故障也不能只告警后继续烧下一段。
 *
 * 本模块只负责对象身份、版本化读写和清理，不 import runner，避免循环依赖。
 */
import {
  deleteGcsObject,
  downloadGcsObjectVersioned,
  getGcsBucketName,
  uploadBufferToGcs,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import { nativeDeepReadProposalId } from "./manhuaNativeDeepReadIngest.js";

export const NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX =
  "manhua-template-learn/segment-cache/";
export const NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION = 1 as const;

export type NativeDeepReadSegmentCacheVisualRoute =
  | "vertex_gcs_video"
  | "evolink_gemini_video";

export type NativeDeepReadSegmentCacheEntry = {
  schemaVersion: typeof NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION;
  /** 当前模型、generationConfig、真实段提示词、fps 与来源摘要的契约指纹。 */
  fingerprint: string;
  /** 稳定来源标识的 sha256；不落签名 URL 或 CDN 临时参数。 */
  sourceDigest: string;
  seriesKey: string;
  episodeIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio: boolean;
  requestedFps: number;
  visualRoute: NativeDeepReadSegmentCacheVisualRoute;
  degraded: boolean;
  /** 已通过段门禁的段卡原文。 */
  raw: Record<string, unknown>;
  /** 首次产出该段实际发生的用量，仅作溯源；缓存命中不得并入本次 usage。 */
  paidUsage: {
    inputTokens: number;
    outputTokens: number;
    audioInputTokens: number;
    reasoningTokens: number;
    costCny: number;
  };
  savedAtIso: string;
};

export type NativeDeepReadSegmentCacheRead = {
  entry: NativeDeepReadSegmentCacheEntry;
  generation: string;
};

export function nativeDeepReadSegmentCacheObjectName(
  seriesKey: string,
  episodeIndex: number,
  segmentIndex: number,
): string {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex > 31) {
    throw new Error(`段缓存 segmentIndex 非法：${segmentIndex}`);
  }
  return `${NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX}${nativeDeepReadProposalId(
    seriesKey,
    episodeIndex,
  )}_seg${segmentIndex}.json`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes("gcs_stat_failed:404");
}

function isGenerationConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("gcs_upload_failed:412");
}

function parseCacheEntry(
  value: unknown,
  expected: { seriesKey: string; episodeIndex: number; segmentIndex: number },
): NativeDeepReadSegmentCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("段缓存内容不是 JSON 对象");
  }
  const entry = value as NativeDeepReadSegmentCacheEntry;
  const numbers = [
    entry.startSec,
    entry.endSec,
    entry.requestedFps,
    entry.paidUsage?.inputTokens,
    entry.paidUsage?.outputTokens,
    entry.paidUsage?.audioInputTokens,
    entry.paidUsage?.reasoningTokens,
    entry.paidUsage?.costCny,
  ];
  if (
    entry.schemaVersion !== NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION
    || entry.seriesKey !== expected.seriesKey
    || entry.episodeIndex !== expected.episodeIndex
    || entry.segmentIndex !== expected.segmentIndex
    || !/^[0-9a-f]{64}$/.test(String(entry.fingerprint || ""))
    || !/^[0-9a-f]{64}$/.test(String(entry.sourceDigest || ""))
    || typeof entry.hasAudio !== "boolean"
    || (entry.visualRoute !== "vertex_gcs_video" && entry.visualRoute !== "evolink_gemini_video")
    || typeof entry.degraded !== "boolean"
    || !entry.raw
    || typeof entry.raw !== "object"
    || Array.isArray(entry.raw)
    || !numbers.every((number) => Number.isFinite(number) && Number(number) >= 0)
    || (entry.hasAudio && Number(entry.paidUsage?.audioInputTokens) <= 0)
    || !(entry.endSec > entry.startSec)
    || Number.isNaN(Date.parse(String(entry.savedAtIso || "")))
  ) {
    throw new Error("段缓存字段或对象身份不完整");
  }
  return entry;
}

/** 只有 404 是缓存未命中；网络、权限、解析错误关闭式停止，避免把已付费段重买。 */
export async function readNativeDeepReadSegmentCacheEntry(input: {
  seriesKey: string;
  episodeIndex: number;
  segmentIndex: number;
}): Promise<NativeDeepReadSegmentCacheRead | null> {
  const objectName = nativeDeepReadSegmentCacheObjectName(
    input.seriesKey,
    input.episodeIndex,
    input.segmentIndex,
  );
  let versioned: Awaited<ReturnType<typeof downloadGcsObjectVersioned>>;
  try {
    versioned = await downloadGcsObjectVersioned({
      gcsUri: `gs://${getGcsBucketName()}/${objectName}`,
    });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new Error(
      `第${input.episodeIndex}集第${input.segmentIndex + 1}段缓存读取失败，已停止以避免重复付费`,
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(versioned.buffer.toString("utf8"));
  } catch (error) {
    throw new Error(
      `第${input.episodeIndex}集第${input.segmentIndex + 1}段缓存 JSON 损坏，已停止以避免重复付费`,
      { cause: error },
    );
  }
  return {
    entry: parseCacheEntry(parsed, input),
    generation: versioned.generation,
  };
}

function cacheBuffer(entry: NativeDeepReadSegmentCacheEntry): Buffer {
  return Buffer.from(`${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

/**
 * 条件写入：不存在时 ifGenerationMatch=0；存在旧契约时按 generation 覆写。
 * 竞争失败后复读一次；若对方已经写入同一契约即视为成功，否则明确失败。
 */
export async function writeNativeDeepReadSegmentCacheEntry(
  entry: NativeDeepReadSegmentCacheEntry,
): Promise<void> {
  // 写前也走同一把身份/证据尺；有声段 AUDIO token=0 不能冒充“模型真听过”。
  parseCacheEntry(entry, entry);
  const objectName = nativeDeepReadSegmentCacheObjectName(
    entry.seriesKey,
    entry.episodeIndex,
    entry.segmentIndex,
  );
  const bucket = getGcsBucketName();
  const payload = cacheBuffer(entry);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let versioned: Awaited<ReturnType<typeof downloadGcsObjectVersioned>> | null = null;
    try {
      versioned = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (!versioned) {
      const created = await uploadBufferToGcsIfAbsent({
        bucket,
        objectName,
        contentType: "application/json",
        buffer: payload,
      });
      if (created.created) return;
      continue;
    }
    try {
      const existing = parseCacheEntry(
        JSON.parse(versioned.buffer.toString("utf8")),
        entry,
      );
      if (
        existing.fingerprint === entry.fingerprint
        && existing.sourceDigest === entry.sourceDigest
      ) return;
    } catch {
      // 旧版、损坏或不同契约：只允许按刚读到的 generation 条件替换。
    }
    try {
      await uploadBufferToGcs({
        bucket,
        objectName,
        contentType: "application/json",
        ifGenerationMatch: versioned.generation,
        buffer: payload,
      });
      return;
    } catch (error) {
      if (isGenerationConflict(error)) continue;
      throw error;
    }
  }
  throw new Error(
    `第${entry.episodeIndex}集第${entry.segmentIndex + 1}段缓存并发写入未确认，已停止`,
  );
}

/** execution 必须在仍持有该集 claim 时调用；任一删除失败都向上抛，由上层告警。 */
export async function clearNativeDeepReadSegmentCacheForEpisode(input: {
  seriesKey: string;
  episodeIndex: number;
  segmentCount: number;
}): Promise<void> {
  const bucket = getGcsBucketName();
  const results = await Promise.allSettled(
    Array.from({ length: input.segmentCount }, (_, segmentIndex) =>
      deleteGcsObject({
        bucket,
        objectName: nativeDeepReadSegmentCacheObjectName(
          input.seriesKey,
          input.episodeIndex,
          segmentIndex,
        ),
      })),
  );
  if (results.some((result) => result.status === "rejected")) {
    throw new Error(`第${input.episodeIndex}集段缓存未全部清理`);
  }
}
