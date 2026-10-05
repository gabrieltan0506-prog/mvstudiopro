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

it("1080p参考视频规范化提交保留实际档位与证据", async () => {
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ data: { id: "reference-1080p" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await expect(submitWavespeedVideoUpscale({ taskId: "reference-1080p", videoUrl: "https://example.com/reference.mp4", target: "1080p" })).resolves.toEqual({ predictionId: "reference-1080p" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ video: "https://example.com/reference.mp4", target_resolution: "1080p" });
  const [evidenceDir] = await fs.readdir(dir);
  const files = await fs.readdir(path.join(dir, evidenceDir));
  const request = files.find(name => name.startsWith("request-") && name.endsWith("-raw.json"));
  expect(request).toBeTruthy();
  expect(JSON.parse(await fs.readFile(path.join(dir, evidenceDir, request!), "utf8"))).toMatchObject({ target_resolution: "1080p" });
});
