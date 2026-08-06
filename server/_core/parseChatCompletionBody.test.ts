import { describe, expect, it } from "vitest";
import { isTransientLlmError, parseChatCompletionBody } from "./llm.js";

/**
 * 2026-08-06：OpenRouter 以 200 返回空 body / 心跳残包，旧代码一律抛「non-JSON body」，
 * 把七条扩写整批打挂。这里锁住三种体：正常 JSON、心跳包裹、空体。
 */
describe("parseChatCompletionBody", () => {
  it("解析正常 JSON", () => {
    const body = JSON.stringify({
      id: "x",
      created: 1,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
    });
    const res = parseChatCompletionBody(body, "OpenRouter", 200);
    expect(res.choices[0]?.message.content).toBe("hi");
  });

  it("剥掉心跳注释行后仍能拿到结果", () => {
    const payload = JSON.stringify({
      id: "x",
      created: 1,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    });
    const body = `: OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\n${payload}`;
    expect(parseChatCompletionBody(body, "OpenRouter", 200).choices[0]?.message.content).toBe("ok");
  });

  it("把流式增量拼回非流式形状", () => {
    const body = [
      ": OPENROUTER PROCESSING",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "前" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "后" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n");
    const res = parseChatCompletionBody(body, "OpenRouter", 200);
    expect(res.choices[0]?.message.content).toBe("前后");
    expect(res.choices[0]?.finish_reason).toBe("stop");
  });

  it("空体标成 transient，交给调用方重试", () => {
    let caught: unknown = null;
    try {
      parseChatCompletionBody("   ", "OpenRouter", 200);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isTransientLlmError(caught)).toBe(true);
  });

  it("纯噪声体也算 transient", () => {
    expect(() => parseChatCompletionBody("<<garbage>>", "OpenRouter", 200)).toThrow();
    try {
      parseChatCompletionBody("<<garbage>>", "OpenRouter", 200);
    } catch (e) {
      expect(isTransientLlmError(e)).toBe(true);
    }
  });
});
