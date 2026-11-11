import { describe, expect, it, vi } from "vitest";
import { CreativeHopTransportError, creativeHopSlug, invokeCreativeHop, musicMvDeepComposeHops } from "./creativeLlmHops";
import type { GeminiCarbonDeps } from "./geminiCarbonCall";

const env = { GEMINI_CARBON_CHANNEL_ORDER: "evolink,gemini_api,vertex", EVOLINK_API_KEY: "k", GEMINI_API_KEY: "g", GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}", VERTEX_PROJECT_ID: "p" };
const carbonDeps = (reply: { status: number; body: unknown }): GeminiCarbonDeps & { calls: any[] } => {
  const calls: any[] = [];
  return {
    calls,
    fetch: (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(reply.body), { status: reply.status }); }) as any,
    sleep: async () => undefined, env, vertexAuthHeaders: async () => ({}), vertexProjectId: () => "p", signGsUri: (g) => g, now: () => 0,
  };
};

describe("1111 创作顾问 Carbon 跳", () => {
  it("深度编排跳：按共用通道顺序（缺省 Vertex → Gemini API → EvoLink），模型按 musicMvDeepCompose 领域", async () => {
    const hops = await musicMvDeepComposeHops({});
    expect(hops.map((h) => [h.gateway, h.carbonChannel, h.modelName])).toEqual([
      ["gemini_carbon", "vertex", "gemini-4-carbon"], ["gemini_carbon", "gemini_api", "gemini-4-carbon"], ["gemini_carbon", "evolink", "gemini-4-carbon"],
    ]);
    const custom = await musicMvDeepComposeHops({ MV_DEEP_COMPOSE_MODEL: "gemini-4-carbon-x", GEMINI_CARBON_CHANNEL_ORDER: "vertex,evolink" });
    expect(custom.map((h) => `${h.carbonChannel}:${h.modelName}`)).toEqual(["vertex:gemini-4-carbon-x", "evolink:gemini-4-carbon-x"]);
    expect(creativeHopSlug(hops[0]!)).toBe("gemini-4-carbon@vertex");
  });

  it("单通道调用：系统提示 + 完整上下文，JSON 输出，65536 上限；request 与 carbon-raw 落盘", async () => {
    const [hop] = await musicMvDeepComposeHops({ GEMINI_CARBON_CHANNEL_ORDER: "evolink" });
    const deps = carbonDeps({ status: 200, body: { candidates: [{ content: { parts: [{ text: '{"ok":1}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3, thoughtsTokenCount: 7 } } });
    const saved: Record<string, any> = {};
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await invokeCreativeHop(hop!, "系统提示", { a: 1 }, async (n, v) => { saved[n] = v; }, { timeoutMs: 180_000 }, { invoke: vi.fn() as any, carbon: deps });
    expect(result.text).toBe('{"ok":1}');
    expect(deps.calls[0].url).toContain("direct.evolink.ai/v1beta/models/gemini-4-carbon:generateContent");
    expect(deps.calls[0].body.systemInstruction.parts[0].text).toBe("系统提示");
    expect(deps.calls[0].body.generationConfig).toEqual({ maxOutputTokens: 65536, responseMimeType: "application/json" });
    expect(saved.request.timeoutMs).toBe(300_000);
    expect(saved["carbon-raw"].usage.thoughtsTokens).toBe(7);
  });

  it("通道失败（HTTP / MAX_TOKENS 空正文）→ CreativeHopTransportError（不重写、直接切下一跳）", async () => {
    const [hop] = await musicMvDeepComposeHops({});
    for (const reply of [{ status: 500, body: {} }, { status: 200, body: { candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] } }]) {
      const deps = carbonDeps(reply);
      await expect(invokeCreativeHop(hop!, "s", {}, async () => undefined, {}, { invoke: vi.fn() as any, carbon: deps })).rejects.toBeInstanceOf(CreativeHopTransportError);
    }
  });
});
