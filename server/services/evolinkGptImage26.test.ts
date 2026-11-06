import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { postEvolinkGptImage2AndUpload } from "./evolinkGptImage2";
beforeEach(() => { vi.stubEnv("EVOLINK_API_KEY", "test-key"); vi.stubEnv("EVOLINK_GPT_IMAGE2_MODEL", "gpt-image-2"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"] as const)("EvoLink%s请求保留4K/high和参考图", async model => {
  const captureError: { message?: string } = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(new URL(url).pathname).toBe("/v1/images/generations");
    expect(JSON.parse(String(init!.body))).toMatchObject({ model, size: "16:9", quality: "high", resolution: "4K", n: 1, image_urls: ["https://test.invalid/ref.png"] });
    return Response.json({ error: { message: "test拒绝" } }, { status: 400 });
  }));
  expect(await postEvolinkGptImage2AndUpload("手册配图", "test", { model, strictRequest: true, aspectRatio: "16:9", quality: "high", resolution: "4K", imageUrls: ["https://test.invalid/ref.png"], captureError })).toBeNull();
  expect(captureError.message).toBe("test拒绝");
});
it.each(["断线", "缺ID", "500", "轮询失败", "成品下载失败"])("EvoLink2.6%s按未知保留，不二次购买", async mode => {
  let creates = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("images/generations")) {
      creates++;
      if (mode === "断线") throw new Error("test network lost");
      if (mode === "缺ID") return Response.json({});
      if (mode === "500") return Response.json({ error: { message: "test server" } }, { status: 500 });
      return Response.json({ id: "test-task-26" });
    }
    if (url.includes("tasks/")) {
      if (mode === "轮询失败") return Response.json({}, { status: 503 });
      return Response.json({ status: "completed", results: ["https://test.invalid/result.png"] });
    }
    return new Response("test unavailable", { status: 503 });
  }));
  await expect(postEvolinkGptImage2AndUpload("手册配图", "test", { model: "gpt-image-2.6-sunburst", strictRequest: true })).rejects.toMatchObject({ kind: "unknown" });
  expect(creates).toBe(1);
});
it("EvoLink明确失败终态保留原失败处理", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("images/generations") ? { id: "test-task-26" } : { status: "failed", error: { message: "test failure" } })));
  expect(await postEvolinkGptImage2AndUpload("手册配图", "test", { model: "gpt-image-2.6-sunburst", strictRequest: true })).toBeNull();
});
