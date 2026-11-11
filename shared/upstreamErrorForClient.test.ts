import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UPSTREAM_ERROR_CLIENT_MAX_CHARS,
  logAndSanitizeUpstreamError,
  sanitizeUpstreamErrorForClient,
} from "./upstreamErrorForClient";

const LEAK = /gemini|gpt|openai|sunburst|flare|deepseek|glm|qwen|kimi|evolink|openrouter|wavespeed|byteplus|minimax|hailuo|happy ?horse|wan-?3|vertex|google|vercel|kling|可灵|即梦|suno|udio|nano banana|omnihuman|百炼|https?:|gs:\/\/|projects\/|Bearer|key=|sk-|AIza/i;

afterEach(() => vi.restoreAllMocks());

describe("sanitizeUpstreamErrorForClient", () => {
  it.each([
    "Gemini 3.8 Flash via Vertex AI 返回 429：https://us-central1-aiplatform.googleapis.com/v1/projects/p-123/locations/us/publishers/google/models/gemini-3.8-flash:generateContent",
    "EvoLink 通道失败（超时）：GLM 5.3 FlashX · OpenRouter 429 rate limited",
    "gs://mvsp-bucket/uploads/u7/a.mp4 not found; signed https://storage.googleapis.com/b/o?X-Goog-Signature=deadbeef&key=abc",
    "WaveSpeed AI wan-3.0 reference-to-video failed; MiniMax hailuo-3 / Happy Horse 1.1 fallback",
    "Authorization: Bearer ya29.a0AfH6SMB token sk-proj-ABCDEFGH12345 AIzaSyA1234567890abcdefghij",
    "Image 2.5 Sunburst 与 Flare 均失败；Suno V5 / Udio；可灵、即梦、OmniHuman 2、百炼、Nano Banana Pro、Kling 3.0",
  ])("去地址 / 凭证 / 模型与供应商名：%s", raw => {
    const out = sanitizeUpstreamErrorForClient(raw);
    expect(out).not.toMatch(LEAK);
    expect(out.length).toBeGreaterThan(0);
  });

  it("保留业务信息与 Seedance 引擎名", () => {
    expect(sanitizeUpstreamErrorForClient("Seedance 2.0 内容审核未通过：含敏感人物")).toBe("Seedance 2.0 内容审核未通过：含敏感人物");
    expect(sanitizeUpstreamErrorForClient("EvoLink HTTP 500：积分不足")).toBe("生成服务 HTTP 500：积分不足");
  });

  it("截断与兜底", () => {
    const out = sanitizeUpstreamErrorForClient("错".repeat(500));
    expect(Array.from(out)).toHaveLength(UPSTREAM_ERROR_CLIENT_MAX_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(sanitizeUpstreamErrorForClient("", { fallback: "稍后重试" })).toBe("稍后重试");
    expect(sanitizeUpstreamErrorForClient(null)).toBe("服务暂时不可用，请稍后重试");
    expect(sanitizeUpstreamErrorForClient(new Error("OpenRouter"), { maxChars: 4 })).toBe("生成服务");
  });

  it("非字符串入参：Error / 对象都能处理且不抛错", () => {
    expect(sanitizeUpstreamErrorForClient(new Error("Vertex 503"))).toBe("生成服务 503");
    expect(sanitizeUpstreamErrorForClient({ status: 500, url: "https://api.openai.com/v1" })).not.toMatch(LEAK);
  });
});

describe("logAndSanitizeUpstreamError", () => {
  it("原文进服务端日志，返回脱敏版", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = logAndSanitizeUpstreamError("t", new Error("Gemini via https://x.googleapis.com failed"));
    expect(out).not.toMatch(LEAK);
    expect(String(spy.mock.calls[0]?.[1])).toContain("https://x.googleapis.com");
  });
});
