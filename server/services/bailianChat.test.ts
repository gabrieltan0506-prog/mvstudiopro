/**
 * GLM-5.3 链回归(0825 改线后):成功短路/HTTP 失败降级/业务验真失败降级/
 * abort 停链/全灭带完整轨迹/参数透传/🔴 百炼上绝不出现 GLM 模型名。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlmGatewayError, invokeGlmJsonChatWithGatewayFallback } from "./bailianChat";

const GOOD = JSON.stringify({ reportTitle: "报表", insightSummary: [{ role: "判断", title: "t", description: "d" }], trackGrowth: [{ name: "n", growth: "+1%" }] });
const okBody = (content: string, model = "glm-5.3") =>
  JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 }, model });
const meteredBody = (options: {
  content?: string;
  finishReason?: string;
  omitFinishReason?: boolean;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
} = {}) => JSON.stringify({
  choices: [{
    message: { content: options.content ?? GOOD },
    ...(options.omitFinishReason ? {} : { finish_reason: options.finishReason ?? "stop" }),
  }],
  usage: {
    prompt_tokens: options.inputTokens ?? 101,
    completion_tokens: options.outputTokens ?? 202,
    completion_tokens_details: { reasoning_tokens: options.reasoningTokens ?? 33 },
    cost: options.costUsd ?? 0.0123,
  },
  model: "z-ai/glm-5.3",
  provider: options.provider ?? "Z.AI",
});

function stubFetchSeq(handlers: Array<(url: string, init: any) => { ok: boolean; status: number; body: string }>) {
  let i = 0;
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      const h = handlers[Math.min(i, handlers.length - 1)];
      i += 1;
      const r = h(String(url), init);
      return { ok: r.ok, status: r.status, text: async () => r.body };
    }),
  );
  return calls;
}

describe("invokeGlmJsonChatWithGatewayFallback(GLM-5.3 链 · 0825 去百炼后)", () => {
  beforeEach(() => {
    vi.stubEnv("WAN_OFFICIAL_BASE", "https://ws.example.cn");
    vi.stubEnv("WAN_OFFICIAL_API_KEY", "bl-key");
    vi.stubEnv("DASHSCOPE_SG_BASE", "https://sg.example.com");
    vi.stubEnv("DASHSCOPE_SG_API_KEY", "sg-key");
    vi.stubEnv("DASHSCOPE_SG_PLAN_KEY", "sg-plan-key");
    vi.stubEnv("EVOLINK_API_KEY", "evo-key");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("🔀0829改线：EvoLink GLM 是主档，成功即短路,只发一次外呼", async () => {
    const calls = stubFetchSeq([() => ({ ok: true, status: 200, body: okBody(GOOD) })]);
    const r = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("api.evolink.ai");
    expect(r.gateway).toBe("evolink_glm");
    expect(r.model).toBe("glm-5.3");
    expect(r.gatewayTrace).toEqual([{ gateway: "evolink_glm", model: "glm-5.3", outcome: "ok" }]);
    // 链级默认温度必须显式发出（不发＝落到供应商默认 1.0）
    expect(JSON.parse(String(calls[0].init.body)).temperature).toBe(0.8);
  });

  it("glm_only 失败时关闭式停止：EvoLink→OpenRouter 两档都试，绝不回退 Qwen", async () => {
    const calls = stubFetchSeq([() => ({ ok: false, status: 503, body: "openrouter down" })]);
    const err = await invokeGlmJsonChatWithGatewayFallback({
      system: "s",
      user: "u",
      // 旧名 openrouter_only 必须仍然被当作 glm_only（存量调用方兼容）
      gatewayPolicy: "openrouter_only",
    }).catch((error) => error);

    expect(err).toBeInstanceOf(GlmGatewayError);
    expect(err.message).toContain("GLM-5.3 两档(EvoLink→OpenRouter)全部失败");
    expect(err.gatewayTrace).toEqual([
      expect.objectContaining({
        gateway: "evolink_glm",
        model: "glm-5.3",
        outcome: "http_error",
        providerError: expect.objectContaining({ httpStatus: 503 }),
      }),
      expect.objectContaining({
        gateway: "openrouter",
        model: "z-ai/glm-5.3",
        outcome: "http_error",
        providerError: expect.objectContaining({ httpStatus: 503 }),
      }),
    ]);
    expect(calls[0].url).toContain("api.evolink.ai");
    expect(calls[1].url).toContain("openrouter.ai");
    expect(calls).toHaveLength(2);
    // 关键回归：两档都是 GLM-5.3，一次都不许滑到 Qwen 兜底
    expect(calls.some((call) => /token-plan/.test(call.url))).toBe(false);
    for (const call of calls) {
      expect(JSON.parse(String(call.init.body)).model).not.toBe("qwen3.8-max");
    }
  });

  it("EvoLink GLM 请求体：顶层 reasoning_effort、无 provider 键、12 分钟墙钟", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const calls = stubFetchSeq([() => ({ ok: true, status: 200, body: meteredBody() })]);

    await invokeGlmJsonChatWithGatewayFallback({
      system: "s",
      user: "u",
      gatewayPolicy: "glm_only",
      reasoningEffort: "max",
      requireParameters: true,
      timeoutMs: 12 * 60_000,
    });

    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(720_000);
    expect(calls[0].init.signal).toBe(timeoutSignal);
    const evoBody = JSON.parse(String(calls[0].init.body));
    // EvoLink 用**顶层字符串** reasoning_effort，不是 OpenRouter 的嵌套 reasoning:{effort}
    expect(evoBody).toMatchObject({ model: "glm-5.3", reasoning_effort: "max" });
    expect(evoBody.reasoning).toBeUndefined();
    expect(evoBody.provider).toBeUndefined();   // provider 是 OpenRouter 专属键
  });

  it("🔒OpenRouter 兜底档必须钉死原生 z-ai/fp8 且禁回落（0829 账单实证：抽到中转商=烧四倍思考）", async () => {
    const calls = stubFetchSeq([
      () => ({ ok: false, status: 500, body: "evolink down" }),
      () => ({ ok: true, status: 200, body: meteredBody() }),
    ]);
    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s", user: "u", gatewayPolicy: "glm_only", requireParameters: true,
    });
    expect(r.gateway).toBe("openrouter");
    const orBody = JSON.parse(String(calls[1].init.body));
    expect(orBody).toMatchObject({
      model: "z-ai/glm-5.3",
      reasoning: { effort: "high" },
      provider: { order: ["z-ai/fp8"], allow_fallbacks: false, require_parameters: true },
    });
    expect(orBody.reasoning_effort).toBeUndefined();  // 别把 EvoLink 的键抄过来
  });

  it("成功保留上游 provider、cost 与 reasoning token，内部通道只写 gateway", async () => {
    stubFetchSeq([() => ({
      ok: true,
      status: 200,
      body: meteredBody({
        provider: "Z.AI",
        inputTokens: 105,
        outputTokens: 218,
        reasoningTokens: 203,
        costUsd: 0.0011062,
      }),
    })]);

    const result = await invokeGlmJsonChatWithGatewayFallback({
      system: "s",
      user: "u",
      gatewayPolicy: "glm_only",
      requireFinishReasonStop: true,
    });

    expect(result.provider).toBe("Z.AI");
    expect(result.gateway).toBe("evolink_glm");
    expect(result.usage).toEqual({
      prompt_tokens: 105,
      completion_tokens: 218,
      completion_tokens_details: { reasoning_tokens: 203 },
      cost: 0.0011062,
    });
  });

  it("默认策略不回归：GLM 两档全 500 后才降级新加坡 Token Plan Qwen", async () => {
    const calls = stubFetchSeq([
      () => ({ ok: false, status: 500, body: "boom" }),
      () => ({ ok: false, status: 500, body: "boom" }),
      () => ({ ok: true, status: 200, body: okBody(GOOD, "qwen3.8-max") }),
    ]);
    const r = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u" });
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toContain("token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode");
    expect(r.gateway).toBe("plan_sg_qwen");
    // 七审第4条回归:SG 套餐档必须继承 DashScope Qwen 的 enable_thinking(换档时分支键漏改过)
    const sgBody = JSON.parse(String(calls[2].init?.body));
    expect(sgBody.enable_thinking).toBe(true);
    expect(sgBody.model).toBe("qwen3.8-max");
    expect(r.gatewayTrace.map((t: any) => t.gateway)).toEqual(["evolink_glm", "openrouter", "plan_sg_qwen"]);
  });

  it("HTTP 200 但业务验真失败时继续降级(复审 P1-1 核心)", async () => {
    const calls = stubFetchSeq([
      () => ({ ok: true, status: 200, body: okBody("抱歉这不是报表 JSON") }),
      () => ({ ok: true, status: 200, body: okBody("抱歉这不是报表 JSON") }),
      () => ({ ok: true, status: 200, body: okBody(GOOD, "qwen3.8-max") }),
    ]);
    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s",
      user: "u",
      validateContent: (text) => {
        if (!text.startsWith("{")) throw new Error("业务 JSON 非法");
      },
    });
    expect(calls).toHaveLength(3);
    expect(r.gateway).toBe("plan_sg_qwen");
    expect(r.gatewayTrace[0]).toMatchObject({ gateway: "evolink_glm", outcome: "content_invalid" });
    expect(r.gatewayTrace[1]).toMatchObject({ gateway: "openrouter", outcome: "content_invalid" });
  });

  it("glm_only 的业务 JSON 验真失败仍在 GlmGatewayError 保留真实 usage", async () => {
    stubFetchSeq([
      () => ({
        ok: true,
        status: 200,
        body: meteredBody({ inputTokens: 410, outputTokens: 72, reasoningTokens: 61, costUsd: 0.08 }),
      }),
      () => ({ ok: false, status: 500, body: "openrouter down" }),
    ]);

    const err = await invokeGlmJsonChatWithGatewayFallback({
      system: "s",
      user: "u",
      gatewayPolicy: "glm_only",
      validateContent: () => {
        throw new Error("业务 JSON 非法");
      },
    }).catch((error) => error);

    expect(err).toBeInstanceOf(GlmGatewayError);
    expect(err.gatewayTrace).toEqual([
      expect.objectContaining({ gateway: "evolink_glm", outcome: "content_invalid", detail: "业务 JSON 非法" }),
      expect.objectContaining({ gateway: "openrouter", outcome: "http_error" }),
    ]);
    expect(err.usage).toEqual({
      inputTokens: 410,
      outputTokens: 72,
      reasoningTokens: 61,
      costUsd: 0.08,
    });
  });

  it.each([
    ["非 stop", meteredBody({ finishReason: "content_filter", inputTokens: 510, outputTokens: 82, reasoningTokens: 71, costUsd: 0.09 })],
    ["缺失 finish_reason", meteredBody({ omitFinishReason: true, inputTokens: 610, outputTokens: 92, reasoningTokens: 81, costUsd: 0.1 })],
  ])("strict 只接受 stop：%s 被拒且 GlmGatewayError 保留 usage", async (_label, body) => {
    stubFetchSeq([() => ({ ok: true, status: 200, body })]);

    const err = await invokeGlmJsonChatWithGatewayFallback({
      system: "s",
      user: "u",
      gatewayPolicy: "glm_only",
      requireFinishReasonStop: true,
    }).catch((error) => error);

    const envelope = JSON.parse(body);
    expect(err).toBeInstanceOf(GlmGatewayError);
    // 两档 GLM 都会被试到，两档都因非 stop 被拒；用量按两次累计。
    expect(err.gatewayTrace).toEqual([
      expect.objectContaining({ gateway: "evolink_glm", outcome: "incomplete" }),
      expect.objectContaining({ gateway: "openrouter", outcome: "incomplete" }),
    ]);
    expect(err.usage).toEqual({
      inputTokens: envelope.usage.prompt_tokens * 2,
      outputTokens: envelope.usage.completion_tokens * 2,
      reasoningTokens: envelope.usage.completion_tokens_details.reasoning_tokens * 2,
      costUsd: envelope.usage.cost * 2,
    });
  });

  it("空 content 视为失败继续降级,不得当成功（GLM-5.3 reasoning 吃光 max_tokens 的实测形态）", async () => {
    const calls = stubFetchSeq([
      () => ({ ok: true, status: 200, body: okBody("") }),
      () => ({ ok: true, status: 200, body: okBody("") }),
      () => ({ ok: true, status: 200, body: okBody(GOOD, "qwen3.8-max") }),
    ]);
    const r = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u" });
    expect(calls).toHaveLength(3);
    expect(r.gatewayTrace[0]).toMatchObject({ gateway: "evolink_glm", outcome: "empty_content" });
  });

  it("🔒 deadlineAtMs 逐档真扣减：第二档拿到的墙钟必须小于第一档（0830 空改事故回归）", async () => {
    // 这条测试就是为了拦住「空改」：上一版在调用方算一次差值（恒为 0），
    // 网关层每档重读同一个 params，两档各拿满上限。那种实现下本测试必红。
    const timeouts: number[] = [];
    const realNow = Date.now();
    let clock = realNow;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    }) as typeof AbortSignal.timeout);

    stubFetchSeq([
      () => { clock += 300_000; return { ok: false, status: 500, body: "evolink slow" }; },
      () => ({ ok: true, status: 200, body: meteredBody() }),
    ]);

    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s", user: "u", gatewayPolicy: "glm_only",
      timeoutMs: 600_000,
      deadlineAtMs: realNow + 600_000,
    });

    expect(r.gateway).toBe("openrouter");
    expect(timeouts).toHaveLength(2);
    expect(timeouts[0]).toBe(600_000);
    // 第一档吃掉 300 秒，第二档只应拿到剩下的 300 秒
    expect(timeouts[1]).toBe(300_000);
    expect(timeouts[1]!).toBeLessThan(timeouts[0]!);
  });

  it("🔒 预算耗尽时跳过该档，不发一个注定超时的调用", async () => {
    const realNow = Date.now();
    let clock = realNow;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const calls = stubFetchSeq([
      () => { clock += 590_000; return { ok: false, status: 500, body: "evolink ate the budget" }; },
      () => ({ ok: true, status: 200, body: meteredBody() }),
    ]);

    const err = await invokeGlmJsonChatWithGatewayFallback({
      system: "s", user: "u", gatewayPolicy: "glm_only",
      timeoutMs: 600_000,
      deadlineAtMs: realNow + 600_000,
    }).catch((error) => error);

    // 只发出第一档；第二档剩余 10 秒 < 60 秒阈值，直接跳过而不是强发
    expect(calls).toHaveLength(1);
    expect(err).toBeInstanceOf(GlmGatewayError);
    expect(err.gatewayTrace.map((t: any) => t.outcome))
      .toEqual(["http_error", "skipped_budget_exhausted"]);
  });

  it("🔒 SSE 流式：分帧正文拼接、usage 与 finish_reason 从末帧取（0830 EvoLink 524 / undici 300s 修复）", async () => {
    const sse = [
      'data: {"model":"glm-5.3","choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
      'data: {"choices":[{"delta":{"content":"true}"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":22,"completion_tokens_details":{"reasoning_tokens":3},"cost":0.5}}',
      "data: [DONE]",
      "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, {
      status: 200, headers: { "content-type": "text/event-stream" },
    })));

    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s", user: "u", gatewayPolicy: "glm_only", requireFinishReasonStop: true,
    });
    expect(r.choices?.[0]?.message?.content).toBe('{"ok":true}');
    expect(r.choices?.[0]?.finish_reason).toBe("stop");
    expect(r.usage?.completion_tokens).toBe(22);
    expect(r.usage?.cost).toBe(0.5);
  });

  it("🔒 上游忽略 stream:true 回普通 JSON 时不许静默交白卷", async () => {
    // 用 SSE 读取器去读普通 JSON 会读出空正文——静默拿不到结果是最危险的失败形态。
    vi.stubGlobal("fetch", vi.fn(async () => new Response(meteredBody(), {
      status: 200, headers: { "content-type": "application/json" },
    })));
    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s", user: "u", gatewayPolicy: "glm_only",
    });
    expect(r.choices?.[0]?.message?.content).toBe(GOOD);
  });

  it("🔒 末帧不带换行也必须收到 finish_reason / usage / provider（审查 P1 三缺口）", async () => {
    const sse = 'data: {"provider":"Z.AI","choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n'
      + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":18,"cost":0.25}}';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, {
      status: 200, headers: { "content-type": "text/event-stream" },
    })));
    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s", user: "u", gatewayPolicy: "glm_only", requireFinishReasonStop: true,
    });
    expect(r.choices?.[0]?.message?.content).toBe('{"ok":true}');
    expect(r.choices?.[0]?.finish_reason).toBe("stop");   // 旧实现：null → 成功产出被判死
    expect(r.usage?.cost).toBe(0.25);                      // 旧实现：undefined → 账本归零
    expect(r.provider).toBe("Z.AI");                       // 旧实现：整个丢失
  });

  it("🔒 上限按还原正文算，不按原始 SSE 字节（275 倍放大会把自己掐死）", async () => {
    // 每 token 一帧、每帧一个完整信封：原始字节远大于正文。
    const frames = Array.from({ length: 400 }, () =>
      'data: {"choices":[{"delta":{"content":"甲"}}],"id":"chatcmpl-xxxxxxxxxxxxxxxxxxxx","object":"chat.completion.chunk","provider":"Z.AI","usage":null}');
    frames.push('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', "data: [DONE]", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(frames.join("\n"), {
      status: 200, headers: { "content-type": "text/event-stream" },
    })));
    // 正文仅 400 字（约 1.2KB），原始 SSE 约 60KB。上限设 8KB：
    // 按正文算 → 过；按原始字节算 → 被自己掐死。
    const r = await invokeGlmJsonChatWithGatewayFallback({
      system: "s", user: "u", gatewayPolicy: "glm_only", maxResponseBytes: 8 * 1024,
    });
    expect(r.choices?.[0]?.message?.content).toHaveLength(400);
  });

  it("首网关失败后若已 abort,不再调用下一网关", async () => {
    const ac = new AbortController();
    stubFetchSeq([
      () => {
        ac.abort();
        return { ok: false, status: 500, body: "boom" };
      },
    ]);
    const err = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u", abortSignal: ac.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(GlmGatewayError);
    expect(err.message).toContain("硬截止");
    expect(vi.mocked(fetch as any).mock.calls).toHaveLength(1);
  });

  it("全链失败:轨迹=[evolink_glm,openrouter,plan_sg_qwen,evolink_qwen];🔴 整条链零百炼按量调用", async () => {
    const calls = stubFetchSeq([() => ({ ok: false, status: 502, body: "bad" })]);
    const err = await invokeGlmJsonChatWithGatewayFallback({ system: "s", user: "u", maxTokens: 12_345 }).catch((e) => e);
    expect(err).toBeInstanceOf(GlmGatewayError);
    expect(err.gatewayTrace.map((t: any) => t.gateway)).toEqual([
      "evolink_glm",
      "openrouter",
      "plan_sg_qwen",
      "evolink_qwen",
    ]);
    expect(err.gatewayTrace.every((t: any) => t.outcome === "http_error")).toBe(true);
    const body0 = JSON.parse(String(calls[0].init?.body));
    expect(body0.max_tokens).toBe(12_345);
    expect(body0.model).toBe("glm-5.3");
    // 0825 二次拍板:百炼按量域名(WAN_OFFICIAL_BASE)一次都不许被打到
    for (const c of calls) {
      expect(c.url).not.toContain("ws.example.cn");
      const model = JSON.parse(String(c.init?.body || "{}")).model;
      // Qwen 兜底两档才是 qwen 模型；EvoLink GLM 主档同样在 evolink 域上，但跑的是 glm-5.3
      if (/token-plan/.test(c.url)) expect(model).toBe("qwen3.8-max");
      if (/api\.evolink\.ai/.test(c.url)) expect(["glm-5.3", "qwen3.8-max"]).toContain(model);
    }
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });
});
