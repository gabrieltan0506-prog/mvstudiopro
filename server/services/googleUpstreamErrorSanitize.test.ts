import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * /api/google?op=geminiScript：须登录、用量闸门、模型只由服务端决定；失败响应不带上游原文与请求地址。
 * 离线替身：Vertex 令牌、登录与 fetch 全替身，不发真实请求。
 */
const h = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("../_core/sdk.js", () => ({ sdk: { authenticateRequest: h.auth } }));
vi.mock("../utils/vertex", () => ({ getVertexAccessToken: async () => "test-token" }));
import handler from "../../api/google";
import { resetUsageLimitsForTest, USAGE_LIMITS } from "../_core/usageLimits";

const UPSTREAM = { error: { message: "models/gemini-3.1-pro-preview is not found for project p-secret in Vertex AI" } };
const fetchMock = vi.fn();

async function call(op: string, body: Record<string, unknown>, ip = "9.9.9.9") {
  let status = 0, result: any;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { result = value; return this; }, setHeader() { return this; } };
  await handler({ method: "POST", headers: {}, ip, query: { op }, body } as never, response as never);
  return { status, body: result };
}
const okBody = { candidates: [{ content: { parts: [{ text: "好" }] } }] };

beforeEach(() => {
  resetUsageLimitsForTest();
  h.auth.mockReset().mockResolvedValue({ id: 7, role: "user" });
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify(UPSTREAM), { status: 400, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERTEX_PROJECT_ID", "p-secret");
  vi.stubEnv("GEMINI_SCRIPT_MODEL", "gemini-3.8-flash");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const LEAK = /gemini|vertex|google|p-secret|aiplatform|https?:|projects\//i;

it("未登录 401：不取令牌、不发任何上游请求", async () => {
  h.auth.mockResolvedValue(null);
  const result = await call("geminiScript", { prompt: "测试" });
  expect(result.status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("登录用户：模型只用服务端配置，调用方传的 Pro 模型被忽略", async () => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(okBody), { status: 200, headers: { "content-type": "application/json" } }));
  const result = await call("geminiScript", { prompt: "测试", model: "gemini-9-ultra-pro" });
  expect(result.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url = String(fetchMock.mock.calls[0]?.[0]);
  expect(url).toContain("/models/gemini-3.8-flash:generateContent");
  expect(url).not.toContain("ultra");
});

it("提示词超长 413，不调上游", async () => {
  const result = await call("geminiScript", { prompt: "字".repeat(120_001) });
  expect(result.status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("超过每分钟上限 429，被拒请求不调上游", async () => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(okBody), { status: 200, headers: { "content-type": "application/json" } }));
  for (let i = 0; i < USAGE_LIMITS.geminiScript.perMinute; i++) expect((await call("geminiScript", { prompt: "测试" })).status).toBe(200);
  const calls = fetchMock.mock.calls.length;
  const limited = await call("geminiScript", { prompt: "测试" });
  expect(limited.status).toBe(429);
  expect(limited.body).toMatchObject({ ok: false, error: "rate_limited" });
  expect(fetchMock.mock.calls.length).toBe(calls);
});

it("geminiScript 失败：只回业务友好句，不回 url / raw", async () => {
  const result = await call("geminiScript", { prompt: "测试" });
  expect(result.status).toBe(502);
  expect(result.body).toEqual({ ok: false, status: 400, error: "算力紧张，请稍后重试" });
  expect(JSON.stringify(result.body)).not.toMatch(LEAK);
  expect(fetchMock).toHaveBeenCalled();
});

it("缺 VERTEX_PROJECT_ID：不回环境变量名", async () => {
  vi.stubEnv("VERTEX_PROJECT_ID", "");
  const result = await call("geminiScript", { prompt: "测试" });
  expect(result.status).toBe(500);
  expect(JSON.stringify(result.body)).not.toMatch(/VERTEX/);
  expect(fetchMock).not.toHaveBeenCalled();
});
