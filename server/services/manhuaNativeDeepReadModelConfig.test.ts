import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1110 用户令：模板学习（漫剧原生精读）改用 Gemini 3.8 Flash，且模型不写死——env 可换。
 * 离线替身：不发任何真实请求、不读任何真实凭证。
 */
vi.mock("./vertexMedia.js", () => ({
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer vertex-test-token" }),
  getVertexProjectId: () => "test-project",
}));

import {
  NATIVE_DEEP_READ_MODEL_PRICES_PER_M,
  buildGeminiNativeDeepReadSegmentRequest,
  nativeDeepReadModelPrices,
  postEvolinkNativeDeepRead,
  postVertexNativeDeepRead,
} from "./manhuaNativeDeepReadRunner";

function fakeHttp() {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetch = vi.fn(async (url: unknown, init: unknown) => {
    const i = init as { body: string; headers: Record<string, string> };
    calls.push({ url: String(url), body: JSON.parse(i.body), headers: i.headers });
    return new Response("{}", { status: 200 });
  });
  return { calls, deps: { fetch: fetch as never, dispatcher: {} as never } };
}

const segmentRequest = (model: string) => buildGeminiNativeDeepReadSegmentRequest({
  segmentContext: { startSec: 0, endSec: 60, segmentIndex: 0, hasAudio: true },
  model,
  fileUri: "gs://test-bucket/seg-0.mp4",
  fps: 12,
  attemptIndex: 0,
  prompt: "测试提示词",
});

describe("模板学习精读：请求 URL / 请求体用配置模型", () => {
  beforeEach(() => {
    vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
    vi.stubEnv("EVOLINK_DIRECT_BASE_URL", "https://evolink.test");
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
    vi.stubEnv("MANHUA_DEEP_READ_MODEL", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("未传模型时缺省 gemini-3.8-flash（不再缺省 3.1 Pro）", async () => {
    const vertex = fakeHttp();
    await postVertexNativeDeepRead({ contents: [] }, undefined, undefined, undefined, vertex.deps);
    expect(vertex.calls[0]!.url).toBe("https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent");
    const evolink = fakeHttp();
    await postEvolinkNativeDeepRead({ contents: [] }, undefined, undefined, undefined, evolink.deps);
    expect(evolink.calls[0]!.url).toBe("https://evolink.test/v1beta/models/gemini-3.8-flash:generateContent");
  });

  it("设 MANHUA_DEEP_READ_MODEL 后两条通道 URL 都用配置模型；请求体按通用合同（不套 Argon 专用参数）", async () => {
    vi.stubEnv("MANHUA_DEEP_READ_MODEL", "gemini-3.9-flash");
    const body = segmentRequest("gemini-3.9-flash");
    expect(body).toEqual(segmentRequest("gemini-3.8-flash"));
    expect(JSON.stringify(body)).not.toContain("gemini-3.1-pro");
    const vertex = fakeHttp();
    await postVertexNativeDeepRead(body, undefined, undefined, undefined, vertex.deps);
    expect(vertex.calls[0]!.url).toContain("/publishers/google/models/gemini-3.9-flash:generateContent");
    expect(vertex.calls[0]!.body).toEqual(body);
    const evolink = fakeHttp();
    await postEvolinkNativeDeepRead(body, undefined, undefined, undefined, evolink.deps);
    expect(evolink.calls[0]!.url).toBe("https://evolink.test/v1beta/models/gemini-3.9-flash:generateContent");
    expect(evolink.calls[0]!.body).toEqual(body);
  });

  it("GEMINI_DEFAULT_MODEL 全局改、领域空白回落全局", async () => {
    vi.stubEnv("GEMINI_DEFAULT_MODEL", "gemini-4.0-flash");
    vi.stubEnv("MANHUA_DEEP_READ_MODEL", "   ");
    const evolink = fakeHttp();
    await postEvolinkNativeDeepRead({ contents: [] }, undefined, undefined, undefined, evolink.deps);
    expect(evolink.calls[0]!.url).toBe("https://evolink.test/v1beta/models/gemini-4.0-flash:generateContent");
  });
});

describe("精读成本表", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });

  it("含 gemini-3.8-flash 单价（$0.30/$2.50 × 7.2 → ¥2.16/¥18 每百万 token），旧三代单价不变", () => {
    expect(NATIVE_DEEP_READ_MODEL_PRICES_PER_M["gemini-3.8-flash"]).toEqual({ inPerM: 2.16, outPerM: 18.0 });
    expect(nativeDeepReadModelPrices("gemini-3.8-flash")).toEqual({ inPerM: 2.16, outPerM: 18.0, priceKnown: true });
    expect(nativeDeepReadModelPrices("gemini-3.1-pro-preview")).toEqual({ inPerM: 9.0, outPerM: 72.0, priceKnown: true });
    expect(nativeDeepReadModelPrices("gemini-4-argon")).toEqual({ inPerM: 28.8, outPerM: 144, priceKnown: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("表外模型不得按 0 元计：取表内最高单价保守估算并告警", () => {
    const unknown = nativeDeepReadModelPrices("gemini-3.9-flash");
    expect(unknown.priceKnown).toBe(false);
    expect(unknown.inPerM).toBeGreaterThan(0);
    expect(unknown.outPerM).toBeGreaterThan(0);
    expect(unknown).toMatchObject({ inPerM: 28.8, outPerM: 144 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
