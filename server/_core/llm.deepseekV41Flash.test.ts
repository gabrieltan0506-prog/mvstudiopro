import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeLLM } from "./llm";
import { OPENROUTER_DEEPSEEK_V41_FLASH_MODEL as modelName } from "../services/openrouterDeepSeekV41Flash";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("漫剧顾问 DeepSeek V4.1 Flash 通道", () => {
  it("请求准确模型和 JSON，保留推理与 token 预算，不走 GPT 参数", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test-only-not-real");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "test-completion", model: modelName,
      choices: [{ index: 0, message: { role: "assistant", content: '{"answer":"先压近，再反打"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.00009 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeLLM({ provider: "openai", modelName,
      reasoningEffort: "high", max_tokens: 16_384, temperature: 1, topP: 0.9,
      response_format: { type: "json_object" }, openRouterProviderPreferences: { require_parameters: true },
      messages: [{ role: "user", content: "test" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({ model: modelName, reasoning: { effort: "high" }, max_tokens: 16_384,
      response_format: { type: "json_object" }, provider: { require_parameters: true, order: ["DeepSeek"], allow_fallbacks: false } });
    for (const field of ["reasoning_effort", "max_completion_tokens", "temperature", "top_p"]) expect(body[field]).toBeUndefined();
    expect(result.model).toBe(modelName);
    expect(result.usage?.cost).toBe(0.00009);
  });

  it("失败不静默切回 Kimi 或其他高价模型", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test-only-not-real");
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"unavailable"}}', { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(invokeLLM({ provider: "openai", modelName, messages: [{ role: "user", content: "test" }] })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).model).toBe(modelName);
  });
});

it("DeepSeek SSE 逐字透传正文，忽略推理/心跳，保留末尾用量", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-only-not-real");
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  const chunks: string[] = [];
  let finished = false;
  const promise = invokeLLM({ provider: "openai", modelName, messages: [{ role: "user", content: "test" }], onContentDelta: d => chunks.push(d) }).then(r => { finished = true; return r; });
  const send = (value: unknown) => ctrl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
  ctrl.enqueue(new TextEncoder().encode(': OPENROUTER PROCESSING\n\n'));
  send({ model: modelName, choices: [{ delta: { reasoning_content: "不展示内部推理" } }] });
  send({ choices: [{ delta: { content: '{"answer":"推近' } }] });
  await vi.waitFor(() => expect(chunks).toEqual(['{"answer":"推近']));
  expect(finished).toBe(false);
  send({ choices: [{ delta: { content: '，然后切镜"}' }, finish_reason: "stop" }] });
  send({ choices: [], usage: { prompt_tokens: 123, completion_tokens: 456, cost: 0.001 } });
  ctrl.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); ctrl.close();
  const result = await promise;
  expect(result.choices[0].message.content).toBe('{"answer":"推近，然后切镜"}');
  expect(result.usage?.cost).toBe(0.001);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
});

it.each([null, "length", "error"])("DeepSeek 未正常结束 %s 不返回半成品", async finish_reason => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-only-not-real");
  const frame = { choices: [{ delta: { content: '{"answer":"半截"}' }, finish_reason }] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })));
  await expect(invokeLLM({ provider: "openai", modelName, messages: [{ role: "user", content: "test" }] })).rejects.toThrow();
});

it.each(["deepseek-v4.1-flash", "glm-5.3-flash", "glm-5.3-flashx"])("EvoLink %s 使用原生字段与固定文本入口", async modelName => {
  vi.stubEnv("EVOLINK_API_KEY", "test-evolink-not-real");
  const frame = { model: modelName, choices: [{ delta: { content: '{"answer":"测试"}' }, finish_reason: "stop" }] };
  const fetchMock = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  await invokeLLM({ provider: "openai", modelName, openAiGateway: "evolink_flash_only", response_format: { type: "json_object" }, max_tokens: 16_384, reasoningEffort: "high", messages: [{ role: "user", content: "test" }] });
  expect(fetchMock.mock.calls[0][0]).toBe("https://direct.evolink.ai/v1/chat/completions");
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toMatchObject({ model: modelName, response_format: { type: "json_object" }, stream: true, max_tokens: 16_384, reasoning_effort: "high" });
  expect(body.provider).toBeUndefined(); expect(body.reasoning).toBeUndefined(); expect(body.max_completion_tokens).toBeUndefined();
  if (modelName.startsWith("deepseek")) expect(body.thinking).toEqual({ type: "enabled" });
});
it.each(["z-ai/glm-5.3-flash", "z-ai/glm-5.3-flashx"])("GLM %s 保持流式 JSON 且不能解除 Z.AI 锁", async modelName => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-only-not-real");
  const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  await invokeLLM({ provider: "openai", modelName, openRouterProviderPreferences: { allow_fallbacks: true }, response_format: { type: "json_object" }, max_tokens: 16_384, messages: [{ role: "user", content: "test" }] });
  expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: modelName, stream: true, response_format: { type: "json_object" }, provider: { order: ["Z.AI"], allow_fallbacks: false, require_parameters: true } });
});

// 真实探针曾耗尽推理预算却无正文，必须检查实际请求体而非只 mock 顾问结果。
it.each([
  [modelName, "auto", { reasoning: { enabled: false } }],
  ["deepseek-v4.1-flash", "evolink_flash_only", { thinking: { type: "disabled" } }],
] as const)("顾问 %s 显式关闭推理且保留流式 JSON", async (modelName, openAiGateway, expected) => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-only-not-real"); vi.stubEnv("EVOLINK_API_KEY", "test-key");
  const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  await invokeLLM({ provider: "openai", modelName, openAiGateway, reasoningEffort: "none", response_format: { type: "json_object" }, messages: [{ role: "user", content: "test" }] });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toMatchObject({ ...expected, stream: true, response_format: { type: "json_object" } });
  expect(body.reasoning_effort).toBeUndefined();
  expect(body.reasoning?.effort).toBeUndefined();
});
