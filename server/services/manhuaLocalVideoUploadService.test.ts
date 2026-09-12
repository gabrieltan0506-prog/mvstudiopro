import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  mkdtemp,
  realpath,
  readFile,
  appendFile,
  writeFile,
  stat,
  symlink,
  mkdir,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  createManhuaLocalVideoUploadService,
  manhuaLocalVideoUploadService,
  resolveOwnedManhuaLocalVideoUpload,
  LocalVideoUploadError,
} from "./manhuaLocalVideoUploadService";
import {
  MANHUA_LOCAL_VIDEO_MAX_BYTES,
  MANHUA_LOCAL_VIDEO_CHUNK_BYTES,
} from "../../shared/manhuaLocalVideoUpload";
const exec = promisify(execFile);
let root: string;
let video: Buffer;
beforeAll(async () => {
  root = await realpath(
    await mkdtemp("/private/tmp/manhua-local-upload-test-")
  );
  await exec("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=96x64:r=12",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(root, "fixture.mp4"),
  ]);
  video = await readFile(path.join(root, "fixture.mp4"));
  console.log("LOCAL_VIDEO_UPLOAD_EVIDENCE", root);
});
const setup = (suffix: string, freeBytes?: (dir: string) => Promise<number>) =>
  createManhuaLocalVideoUploadService({
    root: path.join(root, suffix),
    freeBytes,
  });
describe("私有原片分块与验真", () => {
  it("worker读取器隐藏底层磁盘路径并保留业务错误", async () => {
    const spy = vi.spyOn(manhuaLocalVideoUploadService, "resolveOwned");
    const input = {
      userId: 7,
      uploadId: "11111111-1111-4111-8111-111111111111",
    };
    try {
      spy.mockRejectedValueOnce(new Error("EACCES /data/private/source.video"));
      await expect(
        resolveOwnedManhuaLocalVideoUpload(input)
      ).rejects.toMatchObject({
        status: 503,
        code: "SOURCE_UNAVAILABLE",
        message: "原视频暂不可读取，请稍后重试",
      });
      const error = new LocalVideoUploadError(
        409,
        "SOURCE_CHANGED",
        "原视频校验失败，请重新上传"
      );
      spy.mockRejectedValueOnce(error);
      await expect(resolveOwnedManhuaLocalVideoUpload(input)).rejects.toBe(
        error
      );
    } finally {
      spy.mockRestore();
    }
  });
  it("真实视频分块、重启续传、完成与来源SHA复核", async () => {
    const service = setup("real");
    const m = await service.create({
      userId: 7,
      fileName: "测试视频.mp4",
      bytes: video.length,
    });
    await service.append({
      userId: 7,
      uploadId: m.uploadId,
      offset: 0,
      chunk: video.subarray(0, 100),
    });
    const restarted = setup("real");
    expect(
      (await restarted.status({ userId: 7, uploadId: m.uploadId })).offset
    ).toBe(100);
    await restarted.append({
      userId: 7,
      uploadId: m.uploadId,
      offset: 100,
      chunk: video.subarray(100),
    });
    const result = await restarted.complete({
      userId: 7,
      uploadId: m.uploadId,
    });
    expect(result).toMatchObject({
      status: "completed",
      offset: video.length,
      durationSec: 1,
      sha256: createHash("sha256").update(video).digest("hex"),
    });
    expect(result).not.toHaveProperty("localPath");
    const owned = await restarted.resolveOwned({
      userId: 7,
      uploadId: m.uploadId,
    });
    expect(await readFile(owned.localPath)).toEqual(video);
    expect((await stat(owned.localPath)).mode & 0o777).toBe(0o600);
    expect(
      await restarted.complete({ userId: 7, uploadId: m.uploadId })
    ).toEqual(result);
    await expect(
      restarted.resolveOwned({ userId: 8, uploadId: m.uploadId })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      restarted.append({
        userId: 7,
        uploadId: m.uploadId,
        offset: video.length,
        chunk: Buffer.from("x"),
      })
    ).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
    await writeFile(owned.localPath, Buffer.alloc(video.length));
    await expect(
      restarted.resolveOwned({ userId: 7, uploadId: m.uploadId })
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    await expect(
      restarted.status({ userId: 7, uploadId: m.uploadId })
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });
  it("并发相同偏移仅一块被确认，崩溃尾块恢复到已确认偏移", async () => {
    const service = setup("concurrent");
    const m = await service.create({ userId: 7, fileName: "x.mp4", bytes: 20 });
    const input = {
      userId: 7,
      uploadId: m.uploadId,
      offset: 0,
      chunk: Buffer.from("1234"),
    };
    const results = await Promise.allSettled([
      service.append(input),
      service.append(input),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const file = path.join(
      root,
      "concurrent",
      "u7",
      m.uploadId,
      "source.video"
    );
    await appendFile(file, "uncommitted");
    expect((await setup("concurrent").status(input)).offset).toBe(4);
    expect(await readFile(file, "utf8")).toBe("1234");
    await expect(service.complete(input)).rejects.toMatchObject({
      code: "NOT_COMPLETED",
    });
  });
  it("拒绝超限、错误偏移、空块和磁盘不足", async () => {
    const service = setup("limits");
    await expect(
      service.create({ userId: 7, fileName: "../x", bytes: 1 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      service.create({
        userId: 7,
        fileName: "x",
        bytes: MANHUA_LOCAL_VIDEO_MAX_BYTES + 1,
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      setup("disk", async () => 0).create({
        userId: 7,
        fileName: "x",
        bytes: 1,
      })
    ).rejects.toMatchObject({ status: 507 });
    const m = await service.create({
      userId: 7,
      fileName: "x",
      bytes: MANHUA_LOCAL_VIDEO_CHUNK_BYTES + 2,
    });
    await expect(
      service.append({
        userId: 7,
        uploadId: m.uploadId,
        offset: 1,
        chunk: Buffer.from("1"),
      })
    ).rejects.toMatchObject({ code: "OFFSET_MISMATCH" });
    await expect(
      service.append({
        userId: 7,
        uploadId: m.uploadId,
        offset: 0,
        chunk: Buffer.alloc(0),
      })
    ).rejects.toMatchObject({ code: "INVALID_CHUNK" });
    await expect(
      service.append({
        userId: 7,
        uploadId: m.uploadId,
        offset: 0,
        chunk: Buffer.alloc(MANHUA_LOCAL_VIDEO_CHUNK_BYTES + 1),
      })
    ).rejects.toMatchObject({ code: "INVALID_CHUNK" });
    expect(
      (await service.status({ userId: 7, uploadId: m.uploadId })).offset
    ).toBe(0);
  });
  it.each([
    "ffconcat version 1.0\nfile '/etc/passwd'\n",
    "#EXTM3U\nhttps://example.invalid/video.ts\n",
    "not a video",
  ])("伪装视频或播放列表不完成且保留证据", async value => {
    const service = setup("invalid");
    const bytes = Buffer.from(value);
    const m = await service.create({
      userId: 7,
      fileName: "movie.mp4",
      bytes: bytes.length,
    });
    await service.append({
      userId: 7,
      uploadId: m.uploadId,
      offset: 0,
      chunk: bytes,
    });
    await expect(
      service.complete({ userId: 7, uploadId: m.uploadId })
    ).rejects.toMatchObject({ code: "INVALID_VIDEO" });
    expect(
      (await service.status({ userId: 7, uploadId: m.uploadId })).status
    ).toBe("uploading");
    expect(
      await readFile(
        path.join(root, "invalid", "u7", m.uploadId, "source.video")
      )
    ).toEqual(bytes);
  });
  it("拒绝原片、上传目录和根目录符号链接", async () => {
    const service = setup("links");
    const m = await service.create({ userId: 7, fileName: "x", bytes: 1 });
    const dir = path.join(root, "links", "u7", m.uploadId);
    const file = path.join(dir, "source.video");
    await rename(file, path.join(dir, "retained.video"));
    await symlink(path.join(root, "fixture.mp4"), file);
    await expect(
      service.status({ userId: 7, uploadId: m.uploadId })
    ).rejects.toThrow();
    await rename(dir, `${dir}-retained`);
    await symlink(`${dir}-retained`, dir);
    await expect(
      service.status({ userId: 7, uploadId: m.uploadId })
    ).rejects.toMatchObject({ code: "UNSAFE_STORAGE" });
    await mkdir(path.join(root, "real-root"));
    await symlink(path.join(root, "real-root"), path.join(root, "root-link"));
    await expect(
      setup("root-link").create({ userId: 7, fileName: "x", bytes: 1 })
    ).rejects.toMatchObject({ code: "UNSAFE_STORAGE" });
  });
});
