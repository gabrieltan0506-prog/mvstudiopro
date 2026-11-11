/** 两跳函数的限流规则（用户 2026-11-11 定）：429 先同通道退避重试 3 次，仍限流才切下一跳；其他失败不占这三次。 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geminiAudioJsonWithFallback, GEMINI_TWO_HOP_RATE_LIMIT_BACKOFF_MS } from "../gemini-audio";

vi.mock("../services/vertexMedia.js", () => ({
  getVertexAuthHeaders: async () => ({ Authorization: "Bearer test" }),
  getVertexProjectId: () => "test-project",
  baseUrlForVertex: () => "https://aiplatform.googleapis.com",
}));

const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"a\":1}" }] } }] }), { status: 200 });
const limited = () => new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 });
const isVertex = (url: unknown) => String(url).includes("aiplatform.googleapis.com");
function run(extra: { rateLimitBackoffMs?: number[] } = {}) {
  const saved = new Map<string, unknown>(), waits: number[] = [];
  const promise = geminiAudioJsonWithFallback({
    media: { vertexFileUri: "gs://test-bucket/a.mp4", evolinkFileUri: () => "https://signed.example/a.mp4?sig=t" },
    mimeType: "video/mp4", model: "gemini-3.8-flash", prompt: "p", schemaName: "t",
    validate: v => v as { a: number }, save: async (name, value) => { saved.set(name, value); },
    sleep: async ms => { waits.push(ms); }, ...extra,
  });
  return { promise, saved, waits };
}
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"test\":true}");
  vi.stubEnv("VERTEX_PROJECT_ID", "test-project");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
});
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("两跳限流：同通道退避重试 3 次再切跳", () => {
  it("Vertex 限流两次后成功：留在 Vertex，按 2s、5s 退避", async () => {
    let n = 0;
    fetchMock.mockImplementation(async (url: unknown) => (isVertex(url) && n++ < 2 ? limited() : ok()));
    const { promise, saved, waits } = run();
    const out = await promise;
    expect(out.channel).toBe("Vertex");
    expect(waits).toEqual([2000, 5000]);
    expect(saved.has("hop-1-vertex-rate-limited-1")).toBe(true);
    expect(saved.has("hop-1-vertex-rate-limited-2")).toBe(true);
    expect(fetchMock.mock.calls.filter(c => !isVertex(c[0]))).toHaveLength(0);
  });
  it("Vertex 一直限流：首发 + 3 次重试后切 EvoLink", async () => {
    fetchMock.mockImplementation(async (url: unknown) => (isVertex(url) ? limited() : ok()));
    const { promise, waits } = run();
    const out = await promise;
    expect(out.channel).toBe("EvoLink");
    expect(waits).toEqual([...GEMINI_TWO_HOP_RATE_LIMIT_BACKOFF_MS]);
    expect(fetchMock.mock.calls.filter(c => isVertex(c[0]))).toHaveLength(4);
    expect(out.failuresZh[0]).toContain("已退避重试 3 次");
  });
  it("非限流的 HTTP 错误不重试，直接切下一跳", async () => {
    fetchMock.mockImplementation(async (url: unknown) => (isVertex(url) ? new Response("{}", { status: 500 }) : ok()));
    const { promise, waits } = run();
    const out = await promise;
    expect(out.channel).toBe("EvoLink");
    expect(waits).toEqual([]);
    expect(fetchMock.mock.calls.filter(c => isVertex(c[0]))).toHaveLength(1);
  });
  it("传空数组即关闭重试", async () => {
    fetchMock.mockImplementation(async (url: unknown) => (isVertex(url) ? limited() : ok()));
    const { promise, waits } = run({ rateLimitBackoffMs: [] });
    expect((await promise).channel).toBe("EvoLink");
    expect(waits).toEqual([]);
  });
});
