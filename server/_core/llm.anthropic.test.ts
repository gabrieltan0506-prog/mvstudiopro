import { describe, expect, it, vi } from "vitest";

// llm.ts 顶层 import 重模块，全量并发下 transform 成本计入 5s 默认预算（负载抽签）
vi.setConfig({ testTimeout: 60_000 });

import { buildAnthropicRequestBody } from "./llm";

describe("buildAnthropicRequestBody", () => {
  it("system 提到顶层字段，正文进 messages，带 fallbacks 缺省", () => {
    const body = buildAnthropicRequestBody(
      {
        messages: [
          { role: "system", content: "系统规则" },
          { role: "user", content: "你好" },
        ],
      },
      "claude-opus-5",
    );
    expect(body.model).toBe("claude-opus-5");
    expect(body.system).toBe("系统规则");
    expect(body.fallbacks).toBe("default");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "你好" }] },
    ]);
  });

  it("图片：https 走 url source，data URL 转 base64 source，其它形态报错", () => {
    const body = buildAnthropicRequestBody(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "看图" },
              { type: "image_url", image_url: { url: "https://example.com/a.jpg" } },
              { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
            ],
          },
        ],
      },
      "claude-opus-5",
    );
    const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]!.content;
    expect(content[1]).toEqual({ type: "image", source: { type: "url", url: "https://example.com/a.jpg" } });
    expect(content[2]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "QUJD" },
    });
    expect(() =>
      buildAnthropicRequestBody(
        {
          messages: [
            { role: "user", content: [{ type: "image_url", image_url: { url: "gs://b/x.jpg" } }] },
          ],
        },
        "claude-opus-5",
      ),
    ).toThrow(/https 或 data URL/);
  });

  it("max_tokens 宁大勿掐：低于下限抬到 16000，超帽压回 64000", () => {
    const low = buildAnthropicRequestBody(
      { messages: [{ role: "user", content: "x" }], max_tokens: 4096 },
      "claude-opus-5",
    );
    expect(low.max_tokens).toBe(16_000);
    const high = buildAnthropicRequestBody(
      { messages: [{ role: "user", content: "x" }], maxTokens: 200_000 },
      "claude-opus-5",
    );
    expect(high.max_tokens).toBe(64_000);
  });

  it("effort 档位映射：minimal→low，high 原样，无档不带 output_config", () => {
    const a = buildAnthropicRequestBody(
      { messages: [{ role: "user", content: "x" }], reasoningEffort: "minimal" },
      "claude-opus-5",
    );
    expect(a.output_config).toEqual({ effort: "low" });
    const b = buildAnthropicRequestBody(
      { messages: [{ role: "user", content: "x" }], reasoningEffort: "high" },
      "claude-opus-5",
    );
    expect(b.output_config).toEqual({ effort: "high" });
    const c = buildAnthropicRequestBody({ messages: [{ role: "user", content: "x" }] }, "claude-opus-5");
    expect(c.output_config).toBeUndefined();
  });

  it("claude-opus-5 不带采样控件；首条非 system 必须是 user", () => {
    const body = buildAnthropicRequestBody(
      { messages: [{ role: "user", content: "x" }] },
      "claude-opus-5",
    );
    expect("temperature" in body).toBe(false);
    expect("top_p" in body).toBe(false);
    expect(() =>
      buildAnthropicRequestBody(
        { messages: [{ role: "assistant", content: "我先说" }] },
        "claude-opus-5",
      ),
    ).toThrow(/首条/);
  });
});
