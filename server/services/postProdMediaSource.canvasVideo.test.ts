import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({ outputs: [] as Array<{ output: unknown }> }));
vi.mock("../db", () => ({ getDb: async () => ({
  select: () => ({ from: () => ({ where: async () => state.outputs }) }),
}) }));
vi.mock("./gcs.js", async original => ({
  ...await original<typeof import("./gcs.js")>(), getGcsBucketName: () => "test-bucket",
}));
vi.mock("./canvasMediaOwnership.js", async original => ({
  ...await original<typeof import("./canvasMediaOwnership.js")>(), verifyCanvasMediaOwnership: async () => false,
}));

let dir = "";
const priorDir = process.env.CANVAS_VIDEO_TASK_DIR;
beforeEach(async () => {
  vi.resetModules();
  state.outputs = [];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "postprod-video-owner-"));
  process.env.CANVAS_VIDEO_TASK_DIR = dir;
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("测试禁止联网"); }));
  for (const [id, userId, status, field] of [
    ["own", 7, "succeeded", "videoUrl"], ["other", 8, "succeeded", "videoUrl"],
    ["running", 7, "running", "videoUrl"], ["failed", 7, "failed", "videoUrl"],
    ["text", 7, "succeeded", "prompt"],
  ] as const) {
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ taskId: id, userId, status,
      [field]: `https://storage.googleapis.com/test-bucket/growth-camp/videos/${id}.mp4?signature=test`,
    }));
  }
});
afterEach(async () => {
  if (priorDir === undefined) delete process.env.CANVAS_VIDEO_TASK_DIR;
  else process.env.CANVAS_VIDEO_TASK_DIR = priorDir;
  vi.unstubAllGlobals();
  await fs.rm(dir, { recursive: true, force: true });
});

it("后期真实解析接通本人成功画布视频与已采用音轨，旧jobs产物仍可用", async () => {
  const { resolvePostProdInputSources, resolveRegisteredPostProdMediaSource } = await import("./postProdMediaSource");
  const result = await resolvePostProdInputSources({ userId: "7", input: { action: "bgm_mount", params: {
    videoUri: "https://storage.googleapis.com/test-bucket/growth-camp/videos/own.mp4?signature=test",
    bgmUri: "gs://test-bucket/post-prod/7/music.wav",
  } } });
  expect(result.params).toMatchObject({ videoUri: "gs://test-bucket/growth-camp/videos/own.mp4", bgmUri: "gs://test-bucket/post-prod/7/music.wav" });
  state.outputs = [{ output: { videoUrl: "gs://test-bucket/legacy.mp4" } }];
  await expect(resolveRegisteredPostProdMediaSource({ userId: "7", source: "gs://test-bucket/legacy.mp4" })).resolves.toBe("gs://test-bucket/legacy.mp4");
});

it("他人、未成功、文本中的地址和近似对象名均不作为本人产物", async () => {
  const { resolveRegisteredPostProdMediaSource } = await import("./postProdMediaSource");
  for (const name of ["other", "running", "failed", "text", "own.mp4.backup"]) {
    const object = name.includes(".") ? name : `${name}.mp4`;
    await expect(resolveRegisteredPostProdMediaSource({ userId: "7", source: `gs://test-bucket/growth-camp/videos/${object}` })).rejects.toThrow("素材尚未登记");
  }
});
