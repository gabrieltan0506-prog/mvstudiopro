import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeDeepReadKeyMoment } from "../../shared/manhuaNativeDeepRead.js";
import type { ManhuaViralTemplateEvidenceFrame } from "../../shared/manhuaViralTemplateBank.js";
import { getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs.js";

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
  runFfmpeg: (args: string[], abortSignal?: AbortSignal) => Promise<void>;
  makeTempDir: () => Promise<string>;
  readFrame: (path: string) => Promise<Buffer>;
  removePath: (path: string, recursive?: boolean) => Promise<void>;
  uploadFrame: UploadFrame;
  bucket: () => string;
};

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
      (error) => error
        ? reject(new Error(abortSignal?.aborted ? "用户已停止关键时刻抽帧" : "关键时刻抽帧未完成"))
        : resolve(),
    );
  });
}

const defaultDeps: NativeKeyMomentFrameDeps = {
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
}): string[] {
  const seekArgs = ["-ss", String(input.atSec)];
  const sourceArgs = [...mediaInputArgs(input.node), "-i", input.node.url];
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
 * 正式卡关键时刻抽帧。任一帧双策略失败或上传失败都只省略该行，不阻断卡片入库。
 */
export async function extractNativeKeyMomentEvidenceFrames(input: {
  seriesKey: string;
  episodeIndex: number;
  sourceDigest?: string;
  mediaNodes: readonly NativeKeyMomentFrameMediaNode[];
  keyMoments?: readonly NativeDeepReadKeyMoment[];
  abortSignal?: AbortSignal;
}, deps: NativeKeyMomentFrameDeps = defaultDeps): Promise<ManhuaViralTemplateEvidenceFrame[]> {
  const moments = mergeNativeKeyMomentsBySecond(input.keyMoments || []);
  const node = input.mediaNodes.find((candidate) => /^https?:\/\//i.test(String(candidate?.url || "")));
  if (!moments.length || !node) return [];

  let tempDir: string;
  try {
    tempDir = await deps.makeTempDir();
  } catch {
    return [];
  }

  try {
    const rows = await mapConcurrent(moments, KEY_MOMENT_FRAME_MAX_CONCURRENCY, async (moment, index) => {
      const outputPath = join(tempDir, `km-${String(index).padStart(4, "0")}.jpg`);
      let buffer: Buffer | undefined;
      for (const seek of ["fast", "accurate"] as const) {
        if (input.abortSignal?.aborted) break;
        await deps.removePath(outputPath).catch(() => undefined);
        try {
          await deps.runFfmpeg(buildNativeKeyMomentFrameArgs({
            node,
            atSec: moment.atSec,
            outputPath,
            seek,
          }), input.abortSignal);
          const candidate = await deps.readFrame(outputPath);
          assertJpeg(candidate);
          buffer = candidate;
          break;
        } catch {
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
      } catch {
        return undefined;
      }
      return {
        ...moment,
        objectName,
        mimeType: "image/jpeg" as const,
        bytes: buffer.byteLength,
        sha256,
      };
    });
    return rows.filter((row): row is ManhuaViralTemplateEvidenceFrame => Boolean(row));
  } finally {
    await deps.removePath(tempDir, true).catch(() => undefined);
  }
}
