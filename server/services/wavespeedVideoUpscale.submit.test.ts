import { beforeEach, afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { submitWavespeedVideoUpscale } from "./wavespeedVideoUpscale";
let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "upscale-evidence-")); vi.stubEnv("PHOTO_UPSCALE_EVIDENCE_DIR", dir); vi.stubEnv("WAVESPEED_API_KEY", "test-key"); });
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await fs.rm(dir, { recursive: true, force: true }); });
it.each([400, 413, 422])("上游HTTP%s非JSON明确拒绝仍可同源退款", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("rejected", { status })));
  await expect(submitWavespeedVideoUpscale({ taskId: "test", videoUrl: "https://example.com/a.mp4", target: "2k" })).rejects.toMatchObject({ kind: "rejected" });
});
it("响应丢失明确为unknown，禁止重投", async () => {
  const fetch = vi.fn(async () => { throw new Error("offline"); }); vi.stubGlobal("fetch", fetch);
  await expect(submitWavespeedVideoUpscale({ taskId: "test", videoUrl: "https://example.com/a.mp4", target: "2k" })).rejects.toMatchObject({ kind: "unknown" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("提交前证据不可写不发送付费请求", async () => {
  vi.stubEnv("PHOTO_UPSCALE_EVIDENCE_DIR", "/dev/null"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(submitWavespeedVideoUpscale({ taskId: "test", videoUrl: "https://example.com/a.mp4", target: "2k" })).rejects.toMatchObject({ kind: "rejected" });
  expect(fetch).not.toHaveBeenCalled();
});
