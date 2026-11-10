import { afterEach, expect, it, vi } from "vitest";
import { getProviderDiagnostics } from "./provider-diagnostics";

/** 1110：诊断里的 Gemini 探活不再用直连密钥打 Google 消费端接口，只核对 Vertex / EvoLink 两跳是否配置。 */
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("Gemini 相关项不发 generativelanguage 请求、不带直连密钥", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GEMINI_API_KEY", "test-direct-gemini-key");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
  vi.stubEnv("VERTEX_PROJECT_ID", "");
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-key");
  await getProviderDiagnostics();
  const sent = JSON.stringify(fetchMock.mock.calls);
  expect(sent).not.toContain("generativelanguage.googleapis.com");
  expect(sent).not.toContain("test-direct-gemini-key");
});
