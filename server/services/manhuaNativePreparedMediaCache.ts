/** 已验收的切片独立于模型结果保存；模型失败不使视频分片失去恢复身份。 */
import { createHash } from "node:crypto";
import { downloadGcsObjectVersioned, getGcsBucketName, statGcsObjectVersion, uploadBufferToGcs } from "./gcs.js";

export type PreparedMediaVideo = {
  gsUri: string;
  startSec: number;
  endSec: number;
  temporaryGcs: { bucket: string; objectName: string };
  bytes: number;
  hasAudio: boolean;
  /** 已有持久化恢复索引，普通任务结束不删除其媒体对象。 */
  reusable?: boolean;
};
export type PreparedMediaIdentity = {
  seriesKey: string; sourceDigest: string; episodeIndex: number;
  sourceDurationSec: number; startSec: number; endSec: number;
  /** 仅服务端按原始段号计算的旧截图来源索引，可核验后迁移。 */
  legacyFrameSourceName?: string;
};
export type PreparedMediaCacheDeps = {
  download: typeof downloadGcsObjectVersioned;
  stat: typeof statGcsObjectVersion;
  upload: typeof uploadBufferToGcs;
  bucket: () => string;
};
export const defaultPreparedMediaCacheDeps: PreparedMediaCacheDeps = {
  download: downloadGcsObjectVersioned, stat: statGcsObjectVersion, upload: uploadBufferToGcs, bucket: getGcsBucketName,
};
function identity(input: PreparedMediaIdentity) {
  if (!/^[\w-]{1,80}$/.test(input.seriesKey) || !/^[a-f0-9]{64}$/.test(input.sourceDigest)
    || !Number.isInteger(input.episodeIndex) || input.episodeIndex < 1
    || !Number.isFinite(input.sourceDurationSec) || !Number.isFinite(input.startSec) || !Number.isFinite(input.endSec)
    || input.startSec < 0 || input.endSec <= input.startSec || input.endSec > input.sourceDurationSec + 0.01) {
    throw new Error("视频分片恢复身份无效");
  }
  // 编码/截取合同改变时升级版本；温度、模型和提示词不改变同一视频分片的身份。
  return { version: 1, seriesKey: input.seriesKey, sourceDigest: input.sourceDigest, episodeIndex: input.episodeIndex,
    sourceDurationSec: input.sourceDurationSec, startSec: input.startSec, endSec: input.endSec };
}
export function preparedMediaIndexName(input: PreparedMediaIdentity): string {
  const key = identity(input);
  return `manhua-template-learn/prepared-media/v1/${input.seriesKey}/${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`;
}
const missing = (error: unknown) => error instanceof Error && /^gcs_(?:stat|download)_failed:404(?:\b|:)/.test(error.message);
function assertVideo(video: PreparedMediaVideo, key: PreparedMediaIdentity, bucket: string) {
  if (!video || !video.temporaryGcs || video.temporaryGcs.bucket !== bucket
    || !/^manhua-template-learn\/tmp\/native-deep-read\/[\w-]+\.mp4$/.test(video.temporaryGcs.objectName)
    || video.gsUri !== `gs://${bucket}/${video.temporaryGcs.objectName}`
    || video.startSec !== key.startSec || video.endSec !== key.endSec
    || !Number.isSafeInteger(video.bytes) || video.bytes <= 0 || typeof video.hasAudio !== "boolean") {
    throw new Error("视频分片恢复索引内容或来源范围不一致");
  }
}
export async function readPreparedMedia(input: PreparedMediaIdentity, deps = defaultPreparedMediaCacheDeps, signal?: AbortSignal): Promise<PreparedMediaVideo | null> {
  signal?.throwIfAborted();
  let saved: { identity: ReturnType<typeof identity>; video: PreparedMediaVideo; generation: string };
  try {
    const result = await deps.download({ gcsUri: `gs://${deps.bucket()}/${preparedMediaIndexName(input)}`, signal });
    saved = JSON.parse(result.buffer.toString("utf8"));
  } catch (error) {
    if (!missing(error)) throw error;
    if (!input.legacyFrameSourceName) return null;
    if (!/^manhua-template-learn\/native-frame-sources\/[a-f0-9]{64}\.json$/.test(input.legacyFrameSourceName)) throw new Error("旧视频分片来源索引无效");
    let candidates: unknown;
    try {
      const legacy = await deps.download({ gcsUri: `gs://${deps.bucket()}/${input.legacyFrameSourceName}`, signal });
      candidates = JSON.parse(legacy.buffer.toString("utf8"));
    } catch (legacyError) {
      if (missing(legacyError)) return null;
      throw legacyError;
    }
    if (!Array.isArray(candidates)) throw new Error("旧视频分片来源索引损坏");
    for (const candidate of candidates) {
      assertVideo(candidate, input, deps.bucket());
      try { return await writePreparedMedia(input, candidate, deps, signal); }
      catch (legacyError) { if (!missing(legacyError)) throw legacyError; }
    }
    return null;
  }
  if (JSON.stringify(saved?.identity) !== JSON.stringify(identity(input)) || !/^\d+$/.test(saved?.generation)) {
    throw new Error("视频分片恢复索引身份或版本损坏，未重新切片");
  }
  assertVideo(saved.video, input, deps.bucket());
  try {
    const actual = await deps.stat({ gcsUri: saved.video.gsUri, signal });
    if (actual.generation !== saved.generation || actual.byteLength !== saved.video.bytes) return null;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  return { ...saved.video, reusable: true };
}
export async function writePreparedMedia(input: PreparedMediaIdentity, video: PreparedMediaVideo, deps = defaultPreparedMediaCacheDeps, signal?: AbortSignal): Promise<PreparedMediaVideo> {
  const key = identity(input);
  assertVideo(video, input, deps.bucket());
  const actual = await deps.stat({ gcsUri: video.gsUri, signal });
  if (actual.byteLength !== video.bytes || !/^\d+$/.test(actual.generation)) throw new Error("视频分片上传对象校验失败，未保存恢复索引");
  await deps.upload({ objectName: preparedMediaIndexName(input), bucket: deps.bucket(), contentType: "application/json",
    buffer: Buffer.from(JSON.stringify({ identity: key, video, generation: actual.generation })), signal });
  return { ...video, reusable: true };
}
