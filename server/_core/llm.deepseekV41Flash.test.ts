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
