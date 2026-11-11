import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * 前台零技术泄漏：/api/google 失败响应不带上游原文、请求地址（含项目与模型名）。
 * 离线替身：Vertex 令牌与 fetch 全替身，上游一律回 400（不重试），不发真实请求。
 */
vi.mock("../utils/vertex", () => ({ getVertexAccessToken: async () => "test-token" }));
import handler from "../../api/google";

const UPSTREAM = { error: { message: "models/gemini-3.1-pro-preview is not found for project p-secret in Vertex AI" } };
const fetchMock = vi.fn();

async function call(op: string, body: Record<string, unknown>) {
  let status = 0, result: any;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { result = value; return this; }, setHeader() { return this; } };
  await handler({ method: "POST", headers: {}, query: { op }, body } as never, response as never);
  return { status, body: result };
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url: string) => new Response(JSON.stringify(UPSTREAM), { status: 400, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERTEX_PROJECT_ID", "p-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const LEAK = /gemini|vertex|google|p-secret|aiplatform|https?:|projects\//i;

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
