import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeParams, InvokeResult } from "../../_core/llm";
import {
  STOCK_KEYWORDS_CACHE_TTL_MS,
  STOCK_KEYWORDS_FALLBACK_TTL_MS,
  STOCK_KEYWORDS_LLM_HOPS,
  STOCK_KEYWORDS_RATE_LIMIT,
  clearStockKeywordCache,
  parseStockKeywordLlmText,
  stockKeywordCacheKey,
  suggestStockKeywords,
  takeStockKeywordQuota,
} from "./keywords";

const reply = (content: string, finish_reason = "stop"): InvokeResult => ({
  id: "x",
  created: 0,
  model: "test",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }],
});
const okJson = JSON.stringify({ query: "woman drinking coffee cafe", queryZh: "女人 咖啡店" });
const input = { text: "女孩在咖啡店里喝咖啡，窗外下着雨", purpose: "mv" as const };

beforeEach(() => {
  clearStockKeywordCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("suggestStockKeywords", () => {
  it("LLM 成功：返回校验后的英文词与中文展示，source=llm；请求为短输出、关闭思考、带超时信号", async () => {
    const invoke = vi.fn(async (_p: InvokeParams) => reply(okJson));
    const r = await suggestStockKeywords(input, { invoke });
    expect(r).toEqual({ query: "woman drinking coffee cafe", queryZh: "女人 咖啡店", source: "llm" });
    expect(invoke).toHaveBeenCalledTimes(1);
    const p = invoke.mock.calls[0][0];
    expect(p.modelName).toBe(STOCK_KEYWORDS_LLM_HOPS[0].modelName);
    expect(p.reasoningEffort).toBe("none");
    expect(p.max_tokens).toBeLessThanOrEqual(200);
    expect(p.response_format).toEqual({ type: "json_object" });
    expect(p.abortSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(p.messages)).toContain(input.text);
  });

  it("第一跳报错 → 第二跳同款备用通道成功", async () => {
    const invoke = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce(reply(okJson));
    const r = await suggestStockKeywords(input, { invoke });
    expect(r.source).toBe("llm");
    expect(invoke.mock.calls.map(c => c[0].modelName)).toEqual(STOCK_KEYWORDS_LLM_HOPS.map(h => h.modelName));
  });

  it("超时（反向）：8 秒内无回复 → 取消上游并退回规则版", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const invoke = vi.fn((p: InvokeParams) => {
        signal = p.abortSignal;
        return new Promise<InvokeResult>(() => {});
      });
      const pending = suggestStockKeywords(input, { invoke });
      await vi.advanceTimersByTimeAsync(8_000);
      const r = await pending;
      expect(r.source).toBe("rules");
      expect(r.query.split(" ")).toEqual(expect.arrayContaining(["girl", "coffee", "rain"]));
      expect(signal?.aborted).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["乱码", "@@##不是JSON"],
    ["中文词", JSON.stringify({ query: "城市 夜景", queryZh: "城市夜景" })],
    ["词数超限", JSON.stringify({ query: "one two three four five six seven", queryZh: "太长" })],
    ["只有一个词", JSON.stringify({ query: "rain", queryZh: "雨" })],
    ["带解释", "Here you go: city night"],
  ])("格式不合格（反向：%s）→ 两跳都不合格后退回规则版", async (_name, content) => {
    const invoke = vi.fn(async () => reply(content));
    const r = await suggestStockKeywords(input, { invoke });
    expect(r.source).toBe("rules");
    expect(invoke).toHaveBeenCalledTimes(STOCK_KEYWORDS_LLM_HOPS.length);
  });

  it("输出被截断（finish_reason=length）不采用", async () => {
    const invoke = vi.fn(async () => reply(okJson, "length"));
    expect((await suggestStockKeywords(input, { invoke })).source).toBe("rules");
  });

  it("未配置：通道抛「未配置」→ 规则版，不抛给用户", async () => {
    const invoke = vi.fn(async () => { throw new Error("模型通道未配置"); });
    const r = await suggestStockKeywords({ text: "城市夜景", purpose: "marketing" }, { invoke });
    expect(r).toEqual({ query: "city night", queryZh: "城市夜景", source: "rules" });
  });

  it("queryZh 不合格时用规则版中文展示兜底，query 仍用 LLM", async () => {
    const invoke = vi.fn(async () => reply(JSON.stringify({ query: "City Night", queryZh: "City" })));
    const r = await suggestStockKeywords({ text: "城市夜景", purpose: "mv" }, { invoke });
    expect(r).toEqual({ query: "city night", queryZh: "城市夜景", source: "llm" });
  });

  it("缓存命中：同 text+purpose 30 分钟内不再调上游；换用途或过期后重新请求", async () => {
    let t = 1_000_000;
    const invoke = vi.fn(async () => reply(okJson));
    const deps = { invoke, now: () => t };
    await suggestStockKeywords(input, deps);
    await suggestStockKeywords({ ...input, text: `  ${input.text} `, orientation: "portrait" }, deps);
    expect(invoke).toHaveBeenCalledTimes(1);
    await suggestStockKeywords({ ...input, purpose: "marketing" }, deps);
    expect(invoke).toHaveBeenCalledTimes(2);
    t += STOCK_KEYWORDS_CACHE_TTL_MS;
    await suggestStockKeywords(input, deps);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("规则兜底结果只短缓存，过后重试 LLM", async () => {
    let t = 0;
    const invoke = vi.fn().mockRejectedValueOnce(new Error("x")).mockRejectedValueOnce(new Error("x")).mockResolvedValue(reply(okJson));
    const deps = { invoke, now: () => t };
    expect((await suggestStockKeywords(input, deps)).source).toBe("rules");
    expect((await suggestStockKeywords(input, deps)).source).toBe("rules");
    expect(invoke).toHaveBeenCalledTimes(2);
    t += STOCK_KEYWORDS_FALLBACK_TTL_MS;
    expect((await suggestStockKeywords(input, deps)).source).toBe("llm");
  });

  it("同 key 并发合并为一次上游请求", async () => {
    const invoke = vi.fn(async () => reply(okJson));
    const [a, b] = await Promise.all([suggestStockKeywords(input, { invoke }), suggestStockKeywords(input, { invoke })]);
    expect(a).toEqual(b);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("空白文本（反向）直接拒绝", async () => {
    await expect(suggestStockKeywords({ text: "   ", purpose: "mv" }, { invoke: vi.fn() })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("缓存键 = sha256(text+purpose)，与画幅无关", () => {
    expect(stockKeywordCacheKey("海边", "mv")).toMatch(/^[0-9a-f]{64}$/);
    expect(stockKeywordCacheKey(" 海边 ", "mv")).toBe(stockKeywordCacheKey("海边", "mv"));
    expect(stockKeywordCacheKey("海边", "mv")).not.toBe(stockKeywordCacheKey("海边", "manhua"));
  });
});

describe("parseStockKeywordLlmText", () => {
  it("接受代码围栏与 keywords 数组写法", () => {
    expect(parseStockKeywordLlmText("```json\n{\"keywords\":[\"rain\",\"street\"],\"queryZh\":\"雨 街道\"}\n```", "兜底")).toEqual({ query: "rain street", queryZh: "雨 街道" });
  });
  it("数组/空对象/非 JSON 返回 null", () => {
    expect(parseStockKeywordLlmText("[]", "x")).toBeNull();
    expect(parseStockKeywordLlmText("{}", "x")).toBeNull();
    expect(parseStockKeywordLlmText("", "x")).toBeNull();
  });
});

describe("takeStockKeywordQuota", () => {
  it("每用户每分钟 30 次，第 31 次拒绝；窗口滑过后恢复；用户互不影响", () => {
    const t = 5_000_000;
    for (let i = 0; i < STOCK_KEYWORDS_RATE_LIMIT.max; i++) expect(takeStockKeywordQuota(1, t + i)).toBe(true);
    expect(takeStockKeywordQuota(1, t + 100)).toBe(false);
    expect(takeStockKeywordQuota(2, t + 100)).toBe(true);
    expect(takeStockKeywordQuota(1, t + STOCK_KEYWORDS_RATE_LIMIT.windowMs)).toBe(true);
  });
});
