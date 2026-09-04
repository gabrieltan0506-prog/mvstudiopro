import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isFlashReadViaGeminiApiEnabled,
  uploadSegmentToGeminiFiles,
} from "./manhuaNativeDeepReadRunner.js";

const zeroSleep = async () => undefined;

describe("flash 走 Gemini API key 开关（0904 已停用）", () => {
  const saved = { flag: process.env.MANHUA_FLASH_READ_VIA_GEMINI_API, key: process.env.GEMINI_API_KEY };
  afterEach(() => {
    process.env.MANHUA_FLASH_READ_VIA_GEMINI_API = saved.flag ?? "";
    process.env.GEMINI_API_KEY = saved.key ?? "";
  });
  it("开关与钥匙都在也恒为 false——读片一律走 Vertex", () => {
    process.env.MANHUA_FLASH_READ_VIA_GEMINI_API = "1";
    process.env.GEMINI_API_KEY = "k";
    expect(isFlashReadViaGeminiApiEnabled()).toBe(false);
  });
  it("开关缺失同样为 false", () => {
    process.env.MANHUA_FLASH_READ_VIA_GEMINI_API = "";
    process.env.GEMINI_API_KEY = "k";
    expect(isFlashReadViaGeminiApiEnabled()).toBe(false);
    process.env.MANHUA_FLASH_READ_VIA_GEMINI_API = "1";
    process.env.GEMINI_API_KEY = "";
    expect(isFlashReadViaGeminiApiEnabled()).toBe(false);
  });
});

describe("uploadSegmentToGeminiFiles", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("start→upload→轮询 ACTIVE 后返回 files URI", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/upload/v1beta/files") && init?.method === "POST" && !u.includes("upload-session")) {
        return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload-session/1" } });
      }
      if (u.includes("upload-session")) {
        return Response.json({ file: { name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", state: "PROCESSING" } });
      }
      return Response.json({ state: "ACTIVE", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc" });
    }) as never;
    const out = await uploadSegmentToGeminiFiles({ buffer: Buffer.from("x"), sleepMs: zeroSleep });
    expect(out.fileUri).toBe("https://generativelanguage.googleapis.com/v1beta/files/abc");
    expect(calls.some((u) => u.endsWith("/v1beta/files/abc"))).toBe(true);
  });

  it("缺上传地址关闭式失败", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
    await expect(uploadSegmentToGeminiFiles({ buffer: Buffer.from("x"), sleepMs: zeroSleep }))
      .rejects.toThrow("上传地址");
  });

  it("终态非 ACTIVE（FAILED）关闭式失败，不返回可读 URI", async () => {
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith("/upload/v1beta/files") && init?.method === "POST") {
        return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://g/upload-session/1" } });
      }
      if (u.includes("upload-session")) {
        return Response.json({ file: { name: "files/abc", uri: "https://g/v1beta/files/abc", state: "FAILED" } });
      }
      return Response.json({ state: "FAILED" });
    }) as never;
    await expect(uploadSegmentToGeminiFiles({ buffer: Buffer.from("x"), sleepMs: zeroSleep }))
      .rejects.toThrow("FAILED");
  });

  it("瞬时 5xx 重试一次后成功", async () => {
    let startCalls = 0;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith("/upload/v1beta/files") && init?.method === "POST") {
        startCalls += 1;
        if (startCalls === 1) return new Response("boom", { status: 503 });
        return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://g/upload-session/1" } });
      }
      if (u.includes("upload-session")) {
        return Response.json({ file: { name: "files/r1", uri: "https://g/v1beta/files/r1", state: "ACTIVE" } });
      }
      return Response.json({ state: "ACTIVE", uri: "https://g/v1beta/files/r1" });
    }) as never;
    const out = await uploadSegmentToGeminiFiles({ buffer: Buffer.from("x"), sleepMs: zeroSleep });
    expect(out.fileUri).toBe("https://g/v1beta/files/r1");
    expect(startCalls).toBe(2);
  });

  it("GEMINI_API_KEY 缺失直接拒绝，不发网络请求", async () => {
    process.env.GEMINI_API_KEY = "";
    const spy = vi.fn();
    globalThis.fetch = spy as never;
    await expect(uploadSegmentToGeminiFiles({ buffer: Buffer.from("x"), sleepMs: zeroSleep }))
      .rejects.toThrow("GEMINI_API_KEY");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("stripVertexOnlyGenerationConfigFields", () => {
  it("剥掉 audioTimestamp，其余字段与嵌套结构原样保留", async () => {
    const { stripVertexOnlyGenerationConfigFields, buildGeminiNativeDeepReadSegmentRequest } =
      await import("./manhuaNativeDeepReadRunner.js");
    const body = buildGeminiNativeDeepReadSegmentRequest({
      fileUri: "https://g/v1beta/files/x",
      fps: 12,
      prompt: "p",
      segmentContext: { startSec: 0, endSec: 300, segmentIndex: 0, hasAudio: true },
    }) as { generationConfig: Record<string, unknown> };
    expect(body.generationConfig.audioTimestamp).toBe(true);
    const wire = stripVertexOnlyGenerationConfigFields(body) as { generationConfig: Record<string, unknown> };
    expect("audioTimestamp" in wire.generationConfig).toBe(false);
    expect(wire.generationConfig.temperature).toBe(body.generationConfig.temperature);
    expect(wire.generationConfig.responseSchema).toBe(body.generationConfig.responseSchema);
    expect(wire.generationConfig.thinkingConfig).toBe(body.generationConfig.thinkingConfig);
    // 冻结契约不被改写：原 body 的 audioTimestamp 仍在
    expect(body.generationConfig.audioTimestamp).toBe(true);
  });
  it("非对象与缺 generationConfig 的 body 原样返回", async () => {
    const { stripVertexOnlyGenerationConfigFields } = await import("./manhuaNativeDeepReadRunner.js");
    expect(stripVertexOnlyGenerationConfigFields(null)).toBe(null);
    const noConfig = { contents: [] };
    expect(stripVertexOnlyGenerationConfigFields(noConfig)).toBe(noConfig);
  });
});
