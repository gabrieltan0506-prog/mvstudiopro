import { constants } from "node:fs";
import { mkdir, open, lstat, rename, statfs } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  MANHUA_LOCAL_VIDEO_CHUNK_BYTES,
  MANHUA_LOCAL_VIDEO_MAX_BYTES,
  MANHUA_LOCAL_VIDEO_UPLOAD_ID,
  buildManhuaLocalVideoSourceRef,
} from "../../shared/manhuaLocalVideoUpload";

const exec = promisify(execFile);
const ROOT = "/data/manhua-local-video-uploads";
const RESERVE = 128 * 1024 * 1024;
const manifestSchema = z
  .object({
    version: z.literal(1),
    uploadId: z.string().regex(MANHUA_LOCAL_VIDEO_UPLOAD_ID),
    userId: z.string().regex(/^[1-9][0-9]*$/),
    fileName: z.string().min(1).max(255),
    bytes: z.number().int().positive().max(MANHUA_LOCAL_VIDEO_MAX_BYTES),
    offset: z.number().int().nonnegative().max(MANHUA_LOCAL_VIDEO_MAX_BYTES),
    status: z.enum(["uploading", "completed"]),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    durationSec: z.number().finite().positive().optional(),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
export class LocalVideoUploadError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}
function fail(status: number, code: string, message: string): never {
  throw new LocalVideoUploadError(status, code, message);
}
const locks = new Map<string, Promise<unknown>>();
async function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(run);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}
async function safeDirectory(dir: string) {
  // 每一级都拒绝符号链接，不能只验证最终文件。
  const absolute = path.resolve(dir);
  let at = path.parse(absolute).root;
  for (const part of absolute
    .slice(at.length)
    .split(path.sep)
    .filter(Boolean)) {
    at = path.join(at, part);
    await mkdir(at, { mode: 0o700 }).catch(e => {
      if (e.code !== "EEXIST") throw e;
    });
    const info = await lstat(at);
    if (!info.isDirectory() || info.isSymbolicLink())
      fail(409, "UNSAFE_STORAGE", "视频存储目录不安全");
  }
}
async function readManifest(dir: string) {
  const handle = await open(
    path.join(dir, "manifest.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096)
      fail(409, "INVALID_MANIFEST", "上传记录无效");
    return manifestSchema.parse(JSON.parse(await handle.readFile("utf8")));
  } finally {
    await handle.close();
  }
}
async function saveManifest(dir: string, manifest: Manifest) {
  const temporary = path.join(dir, `manifest-${randomUUID()}.pending`);
  const handle = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(JSON.stringify(manifest));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path.join(dir, "manifest.json"));
  const directory = await open(dir, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function shaFile(file: string, expected: number) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== expected)
      fail(409, "SOURCE_CHANGED", "原视频大小或文件身份已改变");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      hash.update(chunk);
    const after = await handle.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      fail(409, "SOURCE_CHANGED", "原视频在校验期间发生变化");
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
async function probeVideo(file: string): Promise<number> {
  try {
    const { stdout } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,avi,ogg,mpegts,mpeg",
        "-enable_drefs",
        "0",
        "-use_absolute_path",
        "0",
        "-show_entries",
        "format=duration,format_name:stream=codec_type,width,height",
        "-of",
        "json",
        file,
      ],
      { timeout: 30_000, maxBuffer: 128 * 1024 }
    );
    const data = JSON.parse(stdout);
    const duration = Number(data.format?.duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !data.streams?.some(
        (s: { codec_type?: string; width?: number; height?: number }) =>
          s.codec_type === "video" &&
          Number(s.width) > 0 &&
          Number(s.height) > 0
      )
    )
      throw new Error("invalid");
    return duration;
  } catch {
    return fail(422, "INVALID_VIDEO", "文件不是可读取的有效视频");
  }
}
export function createManhuaLocalVideoUploadService(
  options: {
    root?: string;
    probe?: (file: string) => Promise<number>;
    freeBytes?: (dir: string) => Promise<number>;
  } = {}
) {
  const root = path.resolve(options.root ?? ROOT);
  async function space(required: number) {
    const available = options.freeBytes
      ? await options.freeBytes(root)
      : await statfs(root).then(s => s.bavail * s.bsize);
    if (available < required + RESERVE)
      fail(507, "DISK_FULL", "视频存储空间不足，请稍后再试");
  }
  function identity(userId: string | number, uploadId?: string) {
    const user = String(userId);
    if (
      !/^[1-9][0-9]*$/.test(user) ||
      (uploadId !== undefined && !MANHUA_LOCAL_VIDEO_UPLOAD_ID.test(uploadId))
    )
      fail(400, "INVALID_ID", "上传编号无效");
    return { user, dir: path.join(root, `u${user}`, uploadId ?? "") };
  }
  async function load(userId: string | number, uploadId: string) {
    const { user, dir } = identity(userId, uploadId);
    // 读取不创建缺失目录，跨用户猜编号不会产生空资产。
    try {
      let at = path.parse(dir).root;
      for (const part of dir.slice(at.length).split(path.sep).filter(Boolean)) {
        at = path.join(at, part);
        const info = await lstat(at);
        if (!info.isDirectory() || info.isSymbolicLink())
          fail(409, "UNSAFE_STORAGE", "视频存储目录不安全");
      }
      const manifest = await readManifest(dir);
      if (
        manifest.userId !== user ||
        manifest.uploadId !== uploadId ||
        manifest.offset > manifest.bytes
      )
        fail(409, "INVALID_MANIFEST", "上传记录无效");
      const file = path.join(dir, "source.video");
      const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.size < manifest.offset ||
          (manifest.status === "completed" && info.size !== manifest.bytes)
        )
          fail(409, "SOURCE_CHANGED", "原视频大小或文件身份已改变");
        // 崩溃可能留下未提交尾块；只保留 manifest 已确认的偏移。
        if (manifest.status === "uploading" && info.size > manifest.offset) {
          await handle.truncate(manifest.offset);
          await handle.sync();
        }
      } finally {
        await handle.close();
      }
      return { manifest, file, dir };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        fail(404, "NOT_FOUND", "找不到本账号的上传记录");
      throw e;
    }
  }
  function publicStatus(m: Manifest) {
    return {
      uploadId: m.uploadId,
      status: m.status,
      offset: m.offset,
      bytes: m.bytes,
      fileName: m.fileName,
      ...(m.status === "completed"
        ? {
            sha256: m.sha256,
            durationSec: m.durationSec,
            sourceRef: buildManhuaLocalVideoSourceRef({
              userId: m.userId,
              uploadId: m.uploadId,
              sha256: m.sha256!,
            }),
          }
        : {}),
    };
  }
  async function verified(userId: string | number, uploadId: string) {
    const { manifest: m, file } = await load(userId, uploadId);
    if (
      m.status !== "completed" ||
      m.offset !== m.bytes ||
      !m.sha256 ||
      !m.durationSec
    )
      fail(409, "NOT_COMPLETED", "视频尚未上传完成");
    if ((await shaFile(file, m.bytes)) !== m.sha256)
      fail(409, "SOURCE_CHANGED", "原视频校验失败，请重新上传");
    return {
      uploadId: m.uploadId,
      userId: m.userId,
      fileName: m.fileName,
      bytes: m.bytes,
      sha256: m.sha256,
      durationSec: m.durationSec,
      localPath: file,
      sourceRef: buildManhuaLocalVideoSourceRef({
        userId: m.userId,
        uploadId: m.uploadId,
        sha256: m.sha256,
      }),
    };
  }
  return {
    async create(input: {
      userId: string | number;
      fileName: string;
      bytes: number;
    }) {
      const { user, dir: userDir } = identity(input.userId);
      if (
        typeof input.fileName !== "string" ||
        !input.fileName.trim() ||
        input.fileName.length > 255 ||
        /[\x00-\x1f\x7f/\\]/.test(input.fileName) ||
        !Number.isSafeInteger(input.bytes) ||
        input.bytes <= 0 ||
        input.bytes > MANHUA_LOCAL_VIDEO_MAX_BYTES
      )
        fail(400, "INVALID_INPUT", "视频文件名或大小无效，最大支持 800 MiB");
      await safeDirectory(userDir);
      await space(input.bytes);
      const uploadId = randomUUID();
      const dir = path.join(userDir, uploadId);
      await mkdir(dir, { mode: 0o700 });
      const file = await open(
        path.join(dir, "source.video"),
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600
      );
      await file.close();
      const m: Manifest = {
        version: 1,
        uploadId,
        userId: user,
        fileName: input.fileName.trim(),
        bytes: input.bytes,
        offset: 0,
        status: "uploading",
      };
      await saveManifest(dir, m);
      return publicStatus(m);
    },
    async status(input: { userId: string | number; uploadId: string }) {
      return locked(identity(input.userId, input.uploadId).dir, async () => {
        const { manifest } = await load(input.userId, input.uploadId);
        if (manifest.status === "completed")
          await verified(input.userId, input.uploadId);
        return publicStatus(manifest);
      });
    },
    async append(input: {
      userId: string | number;
      uploadId: string;
      offset: number;
      chunk: Buffer;
    }) {
      return locked(identity(input.userId, input.uploadId).dir, async () => {
        const {
          manifest: m,
          file,
          dir,
        } = await load(input.userId, input.uploadId);
        if (m.status !== "uploading")
          fail(409, "ALREADY_COMPLETED", "视频已经完成上传");
        if (!Number.isSafeInteger(input.offset) || input.offset !== m.offset)
          fail(409, "OFFSET_MISMATCH", "上传进度已改变，请重新读取进度后续传");
        if (
          !Buffer.isBuffer(input.chunk) ||
          input.chunk.length === 0 ||
          input.chunk.length > MANHUA_LOCAL_VIDEO_CHUNK_BYTES ||
          m.offset + input.chunk.length > m.bytes
        )
          fail(413, "INVALID_CHUNK", "上传分块大小无效");
        await space(input.chunk.length);
        const handle = await open(
          file,
          constants.O_RDWR | constants.O_NOFOLLOW
        );
        let committed = false;
        try {
          let written = 0;
          while (written < input.chunk.length) {
            const part = await handle.write(
              input.chunk,
              written,
              input.chunk.length - written,
              m.offset + written
            );
            if (!part.bytesWritten) throw new Error("write failed");
            written += part.bytesWritten;
          }
          await handle.sync();
          await saveManifest(dir, { ...m, offset: m.offset + written });
          committed = true;
          return publicStatus({ ...m, offset: m.offset + written });
        } finally {
          // manifest rename 可能已成功但后续 sync 失败，先读回再决定截断，不能毁掉已确认块。
          try {
            if (!committed) {
              const current = await readManifest(dir);
              await handle.truncate(current.offset);
              await handle.sync();
            }
          } finally {
            await handle.close();
          }
        }
      });
    },
    async complete(input: { userId: string | number; uploadId: string }) {
      return locked(identity(input.userId, input.uploadId).dir, async () => {
        const {
          manifest: m,
          file,
          dir,
        } = await load(input.userId, input.uploadId);
        if (m.status === "completed") {
          await verified(input.userId, input.uploadId);
          return publicStatus(m);
        }
        if (m.offset !== m.bytes)
          fail(409, "NOT_COMPLETED", "视频尚未上传完成");
        const sha256 = await shaFile(file, m.bytes);
        const durationSec = await (options.probe ?? probeVideo)(file);
        if (!Number.isFinite(durationSec) || durationSec <= 0)
          fail(422, "INVALID_VIDEO", "视频时长无效");
        const finished: Manifest = {
          ...m,
          status: "completed",
          sha256,
          durationSec,
        };
        await saveManifest(dir, finished);
        return publicStatus(finished);
      });
    },
    resolveOwned(input: { userId: string | number; uploadId: string }) {
      return locked(identity(input.userId, input.uploadId).dir, () =>
        verified(input.userId, input.uploadId)
      );
    },
  };
}
export const manhuaLocalVideoUploadService =
  createManhuaLocalVideoUploadService();
export async function resolveOwnedManhuaLocalVideoUpload(input: {
  userId: string | number;
  uploadId: string;
}) {
  try {
    return await manhuaLocalVideoUploadService.resolveOwned(input);
  } catch (error) {
    if (error instanceof LocalVideoUploadError) throw error;
    // worker 会把异常写入任务回执，磁盘与解析错误不得携带本地路径进入回执。
    throw new LocalVideoUploadError(
      503,
      "SOURCE_UNAVAILABLE",
      "原视频暂不可读取，请稍后重试"
    );
  }
}
