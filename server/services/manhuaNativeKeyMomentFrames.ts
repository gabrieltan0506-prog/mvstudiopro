import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeDeepReadKeyMoment } from "../../shared/manhuaNativeDeepRead.js";
import type { ManhuaViralTemplateEvidenceFrame } from "../../shared/manhuaViralTemplateBank.js";
import { buildManhuaLocalVideoSourceRef, parseManhuaLocalVideoSourceRef } from "../../shared/manhuaLocalVideoUpload.js";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./gcs.js";

const KEY_MOMENT_FRAME_MAX_CONCURRENCY = 4;
const KEY_MOMENT_FRAME_TIMEOUT_MS = 60_000;
const KEY_MOMENT_FRAME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

export type NativeKeyMomentFrameMediaNode = {
  url: string;
  referer?: string;
};

type UploadFrame = (params: {
  bucket: string;
  objectName: string;
  buffer: Buffer;
  contentType: "image/jpeg";
  metadata: Record<string, string>;
}) => Promise<{ created: boolean; generation?: string }>;

export type NativeKeyMomentFrameDeps = {
  signPreparedVideo?: (gsUri: string) => string;
  resolveLocalUpload?: (input: { userId: string; uploadId: string }) => Promise<{
    localPath: string; sourceRef: string; sha256: string;
  }>;
  runFfmpeg: (args: string[], abortSignal?: AbortSignal) => Promise<void>;
  makeTempDir: () => Promise<string>;
  readFrame: (path: string) => Promise<Buffer>;
  removePath: (path: string, recursive?: boolean) => Promise<void>;
  uploadFrame: UploadFrame;
  bucket: () => string;
};

/** 只记录分类，不回传含签名URL的命令行或stderr。 */
export function describeNativeFrameFailure(error: unknown): string {
  const row = error as { code?: unknown; killed?: boolean; message?: unknown; stderr?: unknown } | null;
  const text = `${String(row?.message || "")} ${String(row?.stderr || "")}`;
  if (row?.killed || /timed? ?out|timeout/i.test(text)) return "timeout";
  if (/ENOTFOUND|EAI_AGAIN|Name or service not known|resolve.*host|DNS/i.test(text)) return "dns";
  if (/403|Forbidden/i.test(text)) return "http_403";
  if (/404|Not Found/i.test(text)) return "http_404";
  if (/401|Unauthorized/i.test(text)) return "http_401";
  if (/Connection reset|ECONNRESET/i.test(text)) return "connection_reset";
  if (/Invalid data|moov atom|decode|JPEG/i.test(text)) return "invalid_media";
  if (/ENOSPC|No space left/i.test(text)) return "disk_full";
  if (row?.code === "ENOENT") return "file_or_executable_missing";
  if (/http_40[134]|connection_reset|invalid_media|disk_full|file_or_executable_missing/.test(text)) return text.match(/http_40[134]|connection_reset|invalid_media|disk_full|file_or_executable_missing/)![0];
  return "unknown";
}

// 多片并发返回时仍共享四个 ffmpeg 名额，不能把逐片上限相乘。
let activeFrameProcesses = 0;
const frameProcessWaiters: Array<() => void> = [];
async function withFrameProcessSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeFrameProcesses >= KEY_MOMENT_FRAME_MAX_CONCURRENCY) {
    await new Promise<void>(resolve => frameProcessWaiters.push(resolve));
  } else activeFrameProcesses += 1;
  try { return await work(); }
  finally {
    const next = frameProcessWaiters.shift();
    if (next) next();
    else activeFrameProcesses -= 1;
  }
}

function runFfmpeg(args: string[], abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      args,
      {
        maxBuffer: 8 * 1024 * 1024,
        timeout: KEY_MOMENT_FRAME_TIMEOUT_MS,
        signal: abortSignal,
      },
      (error, _stdout, stderr) => error
        ? reject(new Error(abortSignal?.aborted ? "用户已停止关键时刻抽帧" : `关键时刻抽帧未完成：${describeNativeFrameFailure({ ...error, stderr })}`))
        : resolve(),
    );
  });
}

const defaultDeps: NativeKeyMomentFrameDeps = {
  signPreparedVideo: signGsUriV4ReadUrl,
  resolveLocalUpload: async (input) => {
    const { resolveOwnedManhuaLocalVideoUpload } = await import("./manhuaLocalVideoUploadService.js");
    return resolveOwnedManhuaLocalVideoUpload(input);
  },
  runFfmpeg,
  makeTempDir: () => mkdtemp(join(tmpdir(), "native-key-moments-")),
  readFrame: readFile,
  removePath: async (path, recursive = false) => {
    await rm(path, { force: true, recursive });
  },
  uploadFrame: uploadBufferToGcsIfAbsent,
  bucket: getGcsBucketName,
};

type MergedKeyMoment = {
  atSec: number;
  kindZh: string;
  noteZh: string;
};

/** 同一 0.1 秒位只有一张物理帧；不同类别和说明合并进同一证据行。 */
export function mergeNativeKeyMomentsBySecond(
  moments: readonly NativeDeepReadKeyMoment[],
): MergedKeyMoment[] {
  const grouped = new Map<number, { kinds: string[]; notes: string[] }>();
  for (const raw of moments) {
    const atSec = Math.round(Number(raw?.atSec) * 10) / 10;
    const kindZh = String(raw?.kindZh || "").trim();
    const noteZh = String(raw?.noteZh || "").trim();
    if (!Number.isFinite(atSec) || atSec < 0 || !kindZh || !noteZh) continue;
    const key = Math.round(atSec * 10);
    const group = grouped.get(key) || { kinds: [], notes: [] };
    if (!group.kinds.includes(kindZh)) group.kinds.push(kindZh);
    if (!group.notes.includes(noteZh)) group.notes.push(noteZh);
    grouped.set(key, group);
  }
  return Array.from(grouped.entries())
    .map(([decisecond, group]) => ({
      atSec: decisecond / 10,
      kindZh: group.kinds.join("／").slice(0, 24),
      noteZh: group.notes.join("；").slice(0, 160),
    }))
    .sort((left, right) => left.atSec - right.atSec);
}

function mediaInputArgs(node: NativeKeyMomentFrameMediaNode): string[] {
  const referer = String(node.referer || "").trim();
  return [
    "-user_agent", KEY_MOMENT_FRAME_USER_AGENT,
    ...(referer ? ["-headers", `Referer: ${referer}\r\n`] : []),
  ];
}

/** 快速 seek 把 -ss 放在 -i 前；准确 seek 失败回退把 -ss 放在 -i 后。 */
export function buildNativeKeyMomentFrameArgs(input: {
  node: NativeKeyMomentFrameMediaNode;
  atSec: number;
  outputPath: string;
  seek: "fast" | "accurate";
  trustedLocalSource?: boolean;
}): string[] {
  const seekArgs = ["-ss", String(input.atSec)];
  const sourceArgs = [
    ...(input.trustedLocalSource ? ["-protocol_whitelist", "file,pipe"] : mediaInputArgs(input.node)),
    "-i", input.node.url,
  ];
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    ...(input.seek === "fast" ? [...seekArgs, ...sourceArgs] : [...sourceArgs, ...seekArgs]),
    "-map", "0:v:0", "-frames:v", "1", "-q:v", "4", input.outputPath,
  ];
}

function assertJpeg(buffer: Buffer): void {
  if (
    buffer.byteLength < 4
    || buffer[0] !== 0xff
    || buffer[1] !== 0xd8
    || buffer[buffer.byteLength - 2] !== 0xff
    || buffer[buffer.byteLength - 1] !== 0xd9
  ) {
    throw new Error("关键时刻抽帧没有生成完整 JPEG");
  }
}

function safeSeriesPath(seriesKey: string): string {
  const normalized = String(seriesKey || "").trim().replace(/[^0-9A-Za-z_-]+/g, "-").slice(0, 80);
  return normalized || createHash("sha256").update(String(seriesKey || "unknown")).digest("hex").slice(0, 24);
}

async function mapConcurrent<T, R>(
  rows: readonly T[],
  concurrency: number,
  work: (row: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(rows.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), rows.length) },
    async () => {
      while (cursor < rows.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await work(rows[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * 正式关键时刻抽帧；返回实际成功帧，协调器负责缺图重试和整形前强门禁。
 */
export async function extractNativeKeyMomentEvidenceFrames(input: {
  seriesKey: string;
  episodeIndex: number;
  sourceDigest?: string;
  mediaNodes: readonly NativeKeyMomentFrameMediaNode[];
  preparedSegments?: readonly { gsUri: string; startSec: number; endSec: number }[];
  localVideoUpload?: NonNullable<ReturnType<typeof parseManhuaLocalVideoSourceRef>>;
  keyMoments?: readonly NativeDeepReadKeyMoment[];
  onFrameUploaded?: (frame: ManhuaViralTemplateEvidenceFrame) => void | Promise<void>;
  onFrameFailure?: (failure: { stage: string; reason: string; atSec?: number }) => void;
  abortSignal?: AbortSignal;
}, deps: NativeKeyMomentFrameDeps = defaultDeps): Promise<ManhuaViralTemplateEvidenceFrame[]> {
  const warn = (stage: string, error?: unknown, atSec?: number) => {
    const reason = describeNativeFrameFailure(error);
    console.warn(`[nativeKeyMomentFrames] ep=${input.episodeIndex} stage=${stage}${atSec == null ? "" : ` atSec=${atSec}`} reason=${reason}`);
    try { input.onFrameFailure?.({ stage, reason, atSec }); } catch { /* 进度异常不丢失截图 */ }
  };
  const moments = mergeNativeKeyMomentsBySecond(input.keyMoments || []);
  if (!moments.length) return [];
  let node = input.mediaNodes.find((candidate) => /^https?:\/\//i.test(String(candidate?.url || "")));
  let localSourceReady = false;
  const needsOriginal = moments.some((moment) => !input.preparedSegments?.some(
    (row) => moment.atSec >= row.startSec && moment.atSec < row.endSec,
  ));
  if (input.localVideoUpload && needsOriginal) {
    // 已缓存的分片可能无本轮媒体；原片不可读时仍保住本轮可用分片的截图。
    try {
      if (!deps.resolveLocalUpload) throw new Error("本地视频抽帧读取器缺失");
      const source = await deps.resolveLocalUpload(input.localVideoUpload);
      if (source.sourceRef !== buildManhuaLocalVideoSourceRef(input.localVideoUpload)
        || source.sha256 !== input.localVideoUpload.sha256) throw new Error("本地视频抽帧来源已改变");
      node = { url: source.localPath };
      localSourceReady = true;
    } catch (error) {
      if (!input.preparedSegments?.length) throw error;
    }
  }
  if (!node && !input.preparedSegments?.length) { warn("source_missing"); return []; }

  let tempDir: string;
  try {
    tempDir = await deps.makeTempDir();
  } catch (error) {
    warn("temporary_directory", error);
    return [];
  }

  try {
    const rows = await mapConcurrent(moments, KEY_MOMENT_FRAME_MAX_CONCURRENCY, async (moment, index) => {
      const outputPath = join(tempDir, `km-${String(index).padStart(4, "0")}.jpg`);
      const segment = input.preparedSegments?.find((row) => moment.atSec >= row.startSec && moment.atSec < row.endSec);
      // 签名只在服务端内存中使用，不进卡片、日志或前端；落盘秒位保持整片绝对时间。
      let frameNode = node;
      if (segment) {
        try {
          if (!deps.signPreparedVideo) throw new Error("分片签名器缺失");
          frameNode = { url: deps.signPreparedVideo(segment.gsUri) };
        } catch (error) { warn("segment_sign", error, moment.atSec); return undefined; }
      }
      if (!frameNode) { warn("source_missing", undefined, moment.atSec); return undefined; }
      let buffer: Buffer | undefined;
      for (const seek of ["fast", "accurate"] as const) {
        if (input.abortSignal?.aborted) break;
        await deps.removePath(outputPath).catch(() => undefined);
        try {
          await withFrameProcessSlot(async () => {
            input.abortSignal?.throwIfAborted();
            await deps.runFfmpeg(buildNativeKeyMomentFrameArgs({
              node: frameNode!,
              atSec: segment ? Math.round((moment.atSec - segment.startSec) * 10) / 10 : moment.atSec,
              outputPath,
              seek,
              trustedLocalSource: localSourceReady && !segment,
            }), input.abortSignal);
          });
          const candidate = await deps.readFrame(outputPath);
          assertJpeg(candidate);
          buffer = candidate;
          break;
        } catch (error) {
          if (seek === "accurate") warn("extract_or_decode", error, moment.atSec);
          // 单帧仅允许快速/准确两种策略；第二次仍失败便省略，不制造失败行。
        }
      }
      await deps.removePath(outputPath).catch(() => undefined);
      if (!buffer) return undefined;

      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const objectName = `manhua-template-learn/native-frames/${safeSeriesPath(input.seriesKey)}`
        + `/ep${String(input.episodeIndex).padStart(3, "0")}`
        + `/${Math.round(moment.atSec * 10)}ds-${sha256.slice(0, 24)}.jpg`;
      try {
        await deps.uploadFrame({
          bucket: deps.bucket(),
          objectName,
          buffer,
          contentType: "image/jpeg",
          metadata: {
            producer: "native-deep-read-key-moments",
            seriesKey: String(input.seriesKey),
            episodeIndex: String(input.episodeIndex),
            atSec: String(moment.atSec),
            kindZh: moment.kindZh,
            sha256,
            ...(input.sourceDigest ? { sourceDigest: String(input.sourceDigest) } : {}),
          },
        });
      } catch (error) {
        warn("upload", error, moment.atSec);
        return undefined;
      }
      const frame = {
        ...moment,
        objectName,
        mimeType: "image/jpeg" as const,
        bytes: buffer.byteLength,
        sha256,
      };
      try { await input.onFrameUploaded?.(frame); }
      catch (error) { warn("progress", error, moment.atSec); }
      return frame;
    });
    return rows.filter((row): row is ManhuaViralTemplateEvidenceFrame => Boolean(row));
  } finally {
    await deps.removePath(tempDir, true).catch(() => undefined);
  }
}
