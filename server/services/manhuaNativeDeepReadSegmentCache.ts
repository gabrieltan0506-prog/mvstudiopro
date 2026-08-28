/**
 * 原生精读段级产物缓存。
 *
 * 一段通过当前门禁后必须先可靠写入这里，后续段才允许继续付费；整集入库后，
 * execution 在仍持有该集 claim 时清理缓存。缓存不是审批真源，但它是已付费段的
 * 恢复凭证，所以读取故障不能静默当 miss、写入故障也不能只告警后继续烧下一段。
 *
 * 本模块只负责对象身份、版本化读写和清理，不 import runner，避免循环依赖。
 */
import { createHash } from "node:crypto";
import {
  deleteGcsObject,
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import { nativeDeepReadProposalId } from "./manhuaNativeDeepReadIngest.js";

export const NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX =
  "manhua-template-learn/segment-cache/";
/**
 * 已付费分片的不可变原始证据。与 recovery cache 分开：cache 可在整集入库后清理，
 * evidence 绝不被清理、绝不覆盖，供后续复核门禁、重做聚合与事故追账。
 */
export const NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX =
  "manhua-template-learn/segment-evidence/";
/**
 * 上游模型完整 HTTP 响应的不可变取证区。它必须先于 JSON.parse、密度门禁和任何
 * 下游转换写入；即使响应最终被拒收，已经付费得到的原始证据也不能消失。
 */
export const NATIVE_DEEP_READ_RAW_ATTEMPT_EVIDENCE_PREFIX =
  "manhua-template-learn/segment-evidence-raw/";
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
  /** 生成本段卡的那次上游完整响应；与解析后段卡分对象保存。 */
  rawAttemptEvidenceObjectName?: string;
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

export type NativeDeepReadRawAttemptEvidenceInput = {
  seriesKey: string;
  episodeIndex: number;
  segmentIndex: number;
  segmentCount: number;
  sourceDigest: string;
  requestFingerprint: string;
  batchRequestId: string;
  callId: string;
  attemptNumber: number;
  temperature: number;
  visualRoute: NativeDeepReadSegmentCacheVisualRoute;
  httpStatus: number;
  providerRequestId?: string;
  responseText: string;
};

export type NativeDeepReadSegmentCacheRead = {
  entry: NativeDeepReadSegmentCacheEntry;
  generation: string;
};

export type NativeDeepReadSegmentCacheLocatedRead = NativeDeepReadSegmentCacheRead & {
  objectName: string;
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

/**
 * 付费响应本体的内容指纹。同一请求契约（fingerprint/sourceDigest）下，模型每次
 * 真实响应的 raw/paidUsage 都可能不同；证据对象名必须把响应身份编进去，与
 * segment-evidence-raw 层 attemptN-callId 的做法同理，否则同契约重跑必然撞上
 * 不可变对象内容冲突并永久卡死该段。
 */
export function nativeDeepReadSegmentEvidenceResponseFingerprint(
  entry: NativeDeepReadSegmentCacheEntry,
): string {
  return createHash("sha256")
    .update(cacheBuffer(entry))
    .digest("hex");
}

export function nativeDeepReadSegmentEvidenceObjectName(
  entry: NativeDeepReadSegmentCacheEntry,
): string {
  if (!/^[0-9a-f]{64}$/.test(entry.sourceDigest)) {
    throw new Error("段证据 sourceDigest 非法");
  }
  if (!/^[0-9a-f]{64}$/.test(entry.fingerprint)) {
    throw new Error("段证据 fingerprint 非法");
  }
  if (!Number.isInteger(entry.segmentIndex) || entry.segmentIndex < 0 || entry.segmentIndex > 31) {
    throw new Error(`段证据 segmentIndex 非法：${entry.segmentIndex}`);
  }
  return `${NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX}${nativeDeepReadProposalId(
    entry.seriesKey,
    entry.episodeIndex,
  )}/${entry.sourceDigest}/seg${entry.segmentIndex}-${entry.fingerprint}-${
    nativeDeepReadSegmentEvidenceResponseFingerprint(entry)
  }.json`;
}

export function nativeDeepReadRawAttemptEvidenceObjectName(
  input: Pick<
    NativeDeepReadRawAttemptEvidenceInput,
    "seriesKey" | "episodeIndex" | "segmentIndex" | "sourceDigest" | "attemptNumber" | "callId"
  >,
): string {
  if (!/^[0-9a-f]{64}$/.test(input.sourceDigest)) {
    throw new Error("原始段证据 sourceDigest 非法");
  }
  if (!Number.isInteger(input.segmentIndex) || input.segmentIndex < 0 || input.segmentIndex > 31) {
    throw new Error(`原始段证据 segmentIndex 非法：${input.segmentIndex}`);
  }
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1 || input.attemptNumber > 9) {
    throw new Error(`原始段证据 attemptNumber 非法：${input.attemptNumber}`);
  }
  const callId = String(input.callId || "").trim().toLowerCase();
  if (!/^[0-9a-f-]{16,64}$/.test(callId)) throw new Error("原始段证据 callId 非法");
  return `${NATIVE_DEEP_READ_RAW_ATTEMPT_EVIDENCE_PREFIX}${nativeDeepReadProposalId(
    input.seriesKey,
    input.episodeIndex,
  )}/${input.sourceDigest}/seg${input.segmentIndex}/attempt${input.attemptNumber}-${callId}.json`;
}

/**
 * 在解析/门禁之前保存上游完整响应。写不进去必须关闭式失败，且调用方不得自动
 * 重打同一付费请求；否则会出现“证据没存住，反而又烧一枪”的事故。
 */
export async function writeNativeDeepReadRawAttemptEvidence(
  input: NativeDeepReadRawAttemptEvidenceInput,
): Promise<{ objectName: string; bytes: number; sha256: string }> {
  if (!/^[0-9a-f]{64}$/.test(input.requestFingerprint)) {
    throw new Error("原始段证据 requestFingerprint 非法");
  }
  if (!Number.isInteger(input.segmentCount) || input.segmentCount < 1 || input.segmentCount > 32) {
    throw new Error("原始段证据 segmentCount 非法");
  }
  if (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599) {
    throw new Error("原始段证据 httpStatus 非法");
  }
  const responseBuffer = Buffer.from(String(input.responseText ?? ""), "utf8");
  const responseSha256 = createHash("sha256").update(responseBuffer).digest("hex");
  const objectName = nativeDeepReadRawAttemptEvidenceObjectName(input);
  const payload = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    sourceDigest: input.sourceDigest,
    requestFingerprint: input.requestFingerprint,
    seriesKey: input.seriesKey,
    episodeIndex: input.episodeIndex,
    segmentIndex: input.segmentIndex,
    segmentCount: input.segmentCount,
    batchRequestId: input.batchRequestId,
    callId: input.callId,
    attemptNumber: input.attemptNumber,
    temperature: input.temperature,
    visualRoute: input.visualRoute,
    httpStatus: input.httpStatus,
    providerRequestId: input.providerRequestId,
    responseBytes: responseBuffer.byteLength,
    responseSha256,
    responseText: input.responseText,
  }, null, 2)}\n`, "utf8");
  const created = await uploadBufferToGcsIfAbsent({
    bucket: getGcsBucketName(),
    objectName,
    contentType: "application/json",
    buffer: payload,
  });
  if (!created.created) {
    const existing = await downloadGcsObjectVersioned({
      gcsUri: `gs://${getGcsBucketName()}/${objectName}`,
    });
    if (!existing.buffer.equals(payload)) {
      throw new Error("原始段证据对象已存在但内容不同，已停止");
    }
  }
  return { objectName, bytes: responseBuffer.byteLength, sha256: responseSha256 };
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
    || (entry.rawAttemptEvidenceObjectName != null
      && !String(entry.rawAttemptEvidenceObjectName).startsWith(
        NATIVE_DEEP_READ_RAW_ATTEMPT_EVIDENCE_PREFIX,
      ))
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

/**
 * 找同一系列、同一媒体来源下被旧计划写错集号的已付费段。
 *
 * 这不是普通缓存命中路径，只供失败占位接管时做一次身份纠偏。对象名只负责提供
 * 旧 episode/segment 身份，真正是否可迁移还要由 execution 用当前计划重算旧、
 * 新两份 fingerprint 并复跑段门禁。这里遇到列举截断或任一对象损坏都关闭式停止，
 * 因为把“没看全”当成“没有旧段”会直接导致重复付费。
 */
export async function listNativeDeepReadSegmentCacheEntriesBySourceDigest(input: {
  seriesKey: string;
  sourceDigest: string;
  excludeEpisodeIndex?: number;
}): Promise<NativeDeepReadSegmentCacheLocatedRead[]> {
  if (!/^[0-9a-f]{64}$/.test(String(input.sourceDigest || ""))) {
    throw new Error("段缓存迁移缺少稳定来源摘要");
  }
  const idPrefix = nativeDeepReadProposalId(input.seriesKey, 1).replace(/\d{3}$/, "");
  const prefix = `${NATIVE_DEEP_READ_SEGMENT_CACHE_PREFIX}${idPrefix}`;
  let names: string[];
  try {
    names = await listGcsObjectNamesByPrefix({
      prefix,
      literalPrefix: true,
      maxResults: 1000,
    });
  } catch (error) {
    throw new Error("无法核对同源已付费分段，已停止以避免重复付费", { cause: error });
  }
  if (names.length >= 1000) {
    throw new Error("同系列段缓存达到列举上限，无法确认是否存在同源已付费段");
  }
  const bucket = getGcsBucketName();
  const rows: NativeDeepReadSegmentCacheLocatedRead[] = [];
  for (const objectName of names) {
    const suffix = objectName.slice(prefix.length);
    const match = /^([0-9]{3})_seg([0-9]{1,2})\.json$/.exec(suffix);
    if (!match) continue;
    const episodeIndex = Number(match[1]);
    const segmentIndex = Number(match[2]);
    if (episodeIndex === input.excludeEpisodeIndex) continue;
    let versioned: Awaited<ReturnType<typeof downloadGcsObjectVersioned>>;
    try {
      versioned = await downloadGcsObjectVersioned({
        gcsUri: `gs://${bucket}/${objectName}`,
      });
      const entry = parseCacheEntry(
        JSON.parse(versioned.buffer.toString("utf8")),
        { seriesKey: input.seriesKey, episodeIndex, segmentIndex },
      );
      if (entry.sourceDigest === input.sourceDigest) {
        rows.push({ entry, generation: versioned.generation, objectName });
      }
    } catch (error) {
      throw new Error("同系列段缓存无法完整核对，已停止以避免重复付费", { cause: error });
    }
  }
  return rows;
}

function cacheBuffer(entry: NativeDeepReadSegmentCacheEntry): Buffer {
  return Buffer.from(`${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

/**
 * 原始证据只准创建，不准覆写。并发先写者若已落同一份内容则幂等成功；
 * 同一不可变对象名出现不同内容说明身份算法或存储已损坏，关闭式失败。
 */
async function ensureNativeDeepReadSegmentEvidence(
  entry: NativeDeepReadSegmentCacheEntry,
): Promise<void> {
  const bucket = getGcsBucketName();
  const objectName = nativeDeepReadSegmentEvidenceObjectName(entry);
  const payload = cacheBuffer(entry);
  const created = await uploadBufferToGcsIfAbsent({
    bucket,
    objectName,
    contentType: "application/json",
    buffer: payload,
  });
  if (created.created) return;

  const existing = await downloadGcsObjectVersioned({
    gcsUri: `gs://${bucket}/${objectName}`,
  });
  if (!existing.buffer.equals(payload)) {
    throw new Error(
      `第${entry.episodeIndex}集第${entry.segmentIndex + 1}段不可变证据发生内容冲突，已停止`,
    );
  }
}

/**
 * 身份迁移只准“目标不存在才创建”，绝不能像普通缓存换代那样覆盖目标对象。
 * 并发先写者若已落同一契约则幂等成功；不同来源或不同契约明确冲突。
 */
export async function createNativeDeepReadSegmentCacheEntryIfAbsent(
  entry: NativeDeepReadSegmentCacheEntry,
): Promise<"created" | "reused"> {
  parseCacheEntry(entry, entry);
  // 不允许先发布缓存、再发现证据写失败。
  await ensureNativeDeepReadSegmentEvidence(entry);

  const bucket = getGcsBucketName();
  const objectName = nativeDeepReadSegmentCacheObjectName(
    entry.seriesKey,
    entry.episodeIndex,
    entry.segmentIndex,
  );
  const created = await uploadBufferToGcsIfAbsent({
    bucket,
    objectName,
    contentType: "application/json",
    buffer: cacheBuffer(entry),
  });
  if (created.created) {
    return "created";
  }
  const existing = await readNativeDeepReadSegmentCacheEntry({
    seriesKey: entry.seriesKey,
    episodeIndex: entry.episodeIndex,
    segmentIndex: entry.segmentIndex,
  });
  if (
    existing
    && existing.entry.sourceDigest === entry.sourceDigest
    && existing.entry.fingerprint === entry.fingerprint
  ) {
    // 复用的是目标集已在位的缓存内容，证据也必须落它，而不是迁移来源集的响应。
    await ensureNativeDeepReadSegmentEvidence(existing.entry);
    return "reused";
  }
  throw new Error(
    `第${entry.episodeIndex}集第${entry.segmentIndex + 1}段已有不同缓存，拒绝迁移覆盖`,
  );
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
  // 证据先落盘；后续缓存写失败只会留下安全的孤立证据，
  // 不会留下指向不存在证据的已发布缓存。
  await ensureNativeDeepReadSegmentEvidence(entry);
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
    let existing: NativeDeepReadSegmentCacheEntry | null = null;
    try {
      existing = parseCacheEntry(
        JSON.parse(versioned.buffer.toString("utf8")),
        entry,
      );
    } catch {
      // 只吞旧版、损坏或不同契约的解析形状错误：这类对象允许按刚读到的
      // generation 条件替换。证据写入的失败绝不能在这里被吞掉。
    }
    if (existing && cacheBuffer(existing).equals(payload)) {
      return;
    }

    // 同契约但不同付费响应也必须更新 active cache：
    // 否则 runner 用新 entry 装提案，而恢复缓存仍是旧 entry（缓存 A / 提案 B）。
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
