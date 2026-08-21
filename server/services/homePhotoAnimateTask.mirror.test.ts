/**
 * 首帧镜像回归(2026-08-21 排障):百炼(阿里云北京)拉不动 GCS 签名 URL,
 * 提交前必须镜像到自有域;自有域/已镜像的不重复下载;下载失败抛错(调用方回落网关)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeFlyPlatformImageBuffer = vi.fn(async (..._a: unknown[]) => ({ relPath: "home-photo-animate-src/x.png" }));
const buildFlyPlatformImagePublicUrl = vi.fn(
  (rel: string) => `https://mvstudiopro.com/api/jobs?op=flyVolumeMedia&relPath=${encodeURIComponent(rel)}`,
);
vi.mock("./flyVolumeGeneratedImages.js", () => ({
  writeFlyPlatformImageBuffer: (...a: unknown[]) => writeFlyPlatformImageBuffer(...a),
  buildFlyPlatformImagePublicUrl: (rel: string) => buildFlyPlatformImagePublicUrl(rel),
}));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const fetchMock = vi.fn();

function baseTask(imageUrl: string, over: Record<string, unknown> = {}) {
  return {
    taskId: "hpa_test_1",
    userId: 7,
    status: "queued",
    creditsCharged: 0,
    imageUrl,
    prompt: "动起来",
    duration: 5,
    resolution: "720p",
    aspectRatio: "3:4",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  } as never;
}

describe("ensureBailianReachableImageUrl", () => {
  let tmp = "";
  const OLD_DIR = process.env.HOME_PHOTO_ANIMATE_TASK_DIR;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    writeFlyPlatformImageBuffer.mockClear();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hpa-mirror-"));
    process.env.HOME_PHOTO_ANIMATE_TASK_DIR = tmp;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (OLD_DIR) process.env.HOME_PHOTO_ANIMATE_TASK_DIR = OLD_DIR;
    else delete process.env.HOME_PHOTO_ANIMATE_TASK_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function mod() {
    return import("./homePhotoAnimateTask");
  }

  it("GCS 签名 URL:下载→写 Fly 卷→返回自有域 URL,并落盘 bailianImageUrl", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => PNG.buffer.slice(0, PNG.length) });
    const { ensureBailianReachableImageUrl } = await mod();
    const task = baseTask("https://storage.googleapis.com/bkt/generated/x.png?X-Goog-Signature=abc");
    const url = await ensureBailianReachableImageUrl(task);
    expect(url).toContain("mvstudiopro.com");
    expect(url).toContain("op=flyVolumeMedia");
    expect(writeFlyPlatformImageBuffer).toHaveBeenCalledTimes(1);
    expect((task as { bailianImageUrl?: string }).bailianImageUrl).toBe(url);
  });

  it("已是自有域 URL:原样返回,零下载零镜像", async () => {
    const { ensureBailianReachableImageUrl } = await mod();
    const own = "https://mvstudiopro.com/api/jobs?op=flyVolumeMedia&relPath=a.png";
    const url = await ensureBailianReachableImageUrl(baseTask(own));
    expect(url).toBe(own);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeFlyPlatformImageBuffer).not.toHaveBeenCalled();
  });

  it("重试幂等:bailianImageUrl 已存在直接复用,不重复下载", async () => {
    const { ensureBailianReachableImageUrl } = await mod();
    const cached = "https://mvstudiopro.com/api/jobs?op=flyVolumeMedia&relPath=cached.png";
    const url = await ensureBailianReachableImageUrl(
      baseTask("https://storage.googleapis.com/bkt/x.png", { bailianImageUrl: cached }),
    );
    expect(url).toBe(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("下载失败抛错(调用方按未触达百炼回落网关)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const { ensureBailianReachableImageUrl } = await mod();
    await expect(
      ensureBailianReachableImageUrl(baseTask("https://storage.googleapis.com/bkt/x.png")),
    ).rejects.toThrow(/镜像首帧图下载失败/);
    expect(writeFlyPlatformImageBuffer).not.toHaveBeenCalled();
  });
});
