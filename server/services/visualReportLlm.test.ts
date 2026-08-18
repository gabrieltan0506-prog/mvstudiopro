/**
 * 趋势报表三攻路由回归（审查 P1-4 清单逐条覆盖）：
 * 首攻命中即停/两败后只走 K3/状态不串台/硬截止立断/遥测记真实路由/全灭抛错保退款语义。
 */
import { describe, expect, it, vi } from "vitest";
import { parseVisualReportJson, runVisualReportLlmAttempts } from "./visualReportLlm";
import { DEEPSEEK_ECONOMY_MODEL } from "./platformTopicShortlist";

const GOOD = JSON.stringify({ reportTitle: "周报", insightSummary: [], trackGrowth: [] });
const asResp = (content: string, extra: Record<string, unknown> = {}) => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
  ...extra,
});
const noSleep = async () => {};

describe("runVisualReportLlmAttempts（三攻路由）", () => {
  it("首攻 DeepSeek 成功即停:不打第二攻、不碰 K3,遥测记录真实路由", async () => {
    const ds = vi.fn(async () => asResp(GOOD, { model: "deepseek/deepseek-v4-pro-0813", provider: "openrouter" }));
    const k3 = vi.fn();
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, fallbackModelName: "moonshotai/kimi-k3",
      deepSeekInvoke: ds, fallbackInvoke: k3 as any, sleepMs: noSleep,
    });
    expect(ds).toHaveBeenCalledTimes(1);
    expect(k3).not.toHaveBeenCalled();
    expect(r.engine).toBe("openrouter_deepseek");
    expect(r.attempt).toBe(1);
    expect(r.modelName).toBe(DEEPSEEK_ECONOMY_MODEL);
    expect(r.upstreamProvider).toBe("openrouter");
    expect(r.parsed.reportTitle).toBe("周报");
  });

  it("maxTokens 与 abortSignal 确实传入 DeepSeek 通道（P1-1/P1-2）", async () => {
    const seen: any[] = [];
    const ds = vi.fn(async (args: any) => { seen.push(args); return asResp(GOOD); });
    const ac = new AbortController();
    await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 12_345, fallbackModelName: "k3",
      abortSignal: ac.signal, deepSeekInvoke: ds, fallbackInvoke: vi.fn() as any, sleepMs: noSleep,
    });
    expect(seen[0].maxTokens).toBe(12_345);
    expect(seen[0].abortSignal).toBe(ac.signal);
  });

  it("前两攻 DeepSeek 失败后,第三攻只调 K3 且成功交卷,attempt=3", async () => {
    const ds = vi.fn(async () => { throw new Error("经济档挂了"); });
    const k3 = vi.fn(async () => asResp(GOOD, { model: "moonshotai/kimi-k3" }));
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, fallbackModelName: "moonshotai/kimi-k3",
      deepSeekInvoke: ds, fallbackInvoke: k3 as any, sleepMs: noSleep,
    });
    expect(ds).toHaveBeenCalledTimes(2);
    expect(k3).toHaveBeenCalledTimes(1);
    expect(k3).toHaveBeenCalledWith("moonshotai/kimi-k3");
    expect(r.engine).toBe("evolink_k3");
    expect(r.attempt).toBe(3);
  });

  it("首攻内容解析失败后,次攻不读旧状态、以新响应交卷", async () => {
    let call = 0;
    const ds = vi.fn(async () => (call++ === 0 ? asResp("前言而已,不是 JSON") : asResp(GOOD)));
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, fallbackModelName: "k3",
      deepSeekInvoke: ds, fallbackInvoke: vi.fn() as any, sleepMs: noSleep,
    });
    expect(r.attempt).toBe(2);
    expect(r.parsed.reportTitle).toBe("周报");
  });

  it("硬截止已触发时立即放弃,不再烧后续尝试(P1-1)", async () => {
    const ac = new AbortController();
    const ds = vi.fn(async () => { ac.abort(); throw new Error("aborted"); });
    const k3 = vi.fn();
    await expect(runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, fallbackModelName: "k3",
      abortSignal: ac.signal, deepSeekInvoke: ds, fallbackInvoke: k3 as any, sleepMs: noSleep,
    })).rejects.toThrow("趋势报表生成失败");
    expect(ds).toHaveBeenCalledTimes(1);
    expect(k3).not.toHaveBeenCalled();
  });

  it("三攻全灭抛错(退款语义由上层 catch 承接),错误含最后一次失败原因", async () => {
    const ds = vi.fn(async () => { throw new Error("DS炸"); });
    const k3 = vi.fn(async () => { throw new Error("K3也炸"); });
    await expect(runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, fallbackModelName: "k3",
      deepSeekInvoke: ds, fallbackInvoke: k3 as any, sleepMs: noSleep,
    })).rejects.toThrow(/趋势报表生成失败（已重试 3 次）：K3也炸/);
  });
});

describe("parseVisualReportJson(两路共用同一把尺)", () => {
  it("围栏 JSON 与「前言+JSON」都能解析", () => {
    expect(parseVisualReportJson("```json\n" + GOOD + "\n```").parsed.reportTitle).toBe("周报");
    expect(parseVisualReportJson("以下是报表:" + GOOD).parsed.reportTitle).toBe("周报");
  });
  it("空壳(缺三主键)必拒", () => {
    expect(() => parseVisualReportJson(JSON.stringify({ hello: 1 }))).toThrow("缺少 reportTitle");
  });
  it("HTML/错误页必拒", () => {
    expect(() => parseVisualReportJson("<html>bad gateway</html>")).toThrow("非 JSON");
  });
});
