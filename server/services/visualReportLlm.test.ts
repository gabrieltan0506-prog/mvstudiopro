/**
 * 趋势报表三攻路由回归（0821 改口径:前两攻 GLM-5.3 链、末攻兜底 DeepSeek）：
 * 首攻命中即停/两败后只走 DeepSeek 兜底/状态不串台/硬截止立断/遥测记真实路由/全灭抛错保退款语义。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildVisualReportFailureTelemetry,
  countGatewayCalls,
  parseVisualReportJson,
  runVisualReportLlmAttempts,
  VisualReportAttemptsError,
} from "./visualReportLlm";
import { DEEPSEEK_ECONOMY_MODEL } from "./platformTopicShortlist";

const GOOD = JSON.stringify({ reportTitle: "周报", insightSummary: [{ role: "判断", title: "t", description: "d" }], trackGrowth: [{ name: "赛道", growth: "+10%" }] });
const asResp = (content: string, extra: Record<string, unknown> = {}) => ({
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
  ...extra,
});
const noSleep = async () => {};

describe("runVisualReportLlmAttempts（三攻路由）", () => {
  it("首攻 GLM-5.3 成功即停:不打第二攻、不碰 DeepSeek 兜底,遥测记录真实路由", async () => {
    const glm = vi.fn(async () => asResp(GOOD, { model: "glm-5.3", provider: "bailian", gateway: "bailian" }));
    const ds = vi.fn();
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, primaryModelName: "glm-5.3",
      deepSeekInvoke: ds as any, primaryInvoke: glm as any, sleepMs: noSleep,
    });
    expect(glm).toHaveBeenCalledTimes(1);
    expect(ds).not.toHaveBeenCalled();
    expect(r.engine).toBe("glm_5_3");
    expect(r.attempt).toBe(1);
    expect(r.modelName).toBe("glm-5.3");
    expect(r.upstreamProvider).toBe("bailian");
    expect(r.parsed.reportTitle).toBe("周报");
  });

  it("maxTokens 与 abortSignal 确实传入 DeepSeek 兜底通道（P1-1/P1-2）", async () => {
    const seen: any[] = [];
    const ds = vi.fn(async (args: any) => { seen.push(args); return asResp(GOOD); });
    const glm = vi.fn(async () => { throw new Error("GLM 链失败"); });
    const ac = new AbortController();
    await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 12_345, primaryModelName: "glm-5.3",
      abortSignal: ac.signal, deepSeekInvoke: ds, primaryInvoke: glm as any, sleepMs: noSleep,
    });
    expect(seen[0].maxTokens).toBe(12_345);
    expect(seen[0].abortSignal).toBe(ac.signal);
  });

  it("前两攻 GLM 链失败后,第三攻只调 DeepSeek 兜底且成功交卷,attempt=3", async () => {
    const glm = vi.fn(async () => { throw new Error("GLM 链挂了"); });
    const ds = vi.fn(async () => asResp(GOOD, { model: "deepseek/deepseek-v4-pro-0813" }));
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, primaryModelName: "glm-5.3",
      deepSeekInvoke: ds, primaryInvoke: glm as any, sleepMs: noSleep,
    });
    expect(glm).toHaveBeenCalledTimes(2);
    expect(glm).toHaveBeenCalledWith("glm-5.3");
    expect(ds).toHaveBeenCalledTimes(1);
    expect(r.engine).toBe("openrouter_deepseek");
    expect(r.modelName).toBe(DEEPSEEK_ECONOMY_MODEL);
    expect(r.attempt).toBe(3);
  });

  it("首攻内容解析失败后,次攻不读旧状态、以新响应交卷", async () => {
    let call = 0;
    const glm = vi.fn(async () => (call++ === 0 ? asResp("前言而已,不是 JSON") : asResp(GOOD)));
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, primaryModelName: "glm-5.3",
      deepSeekInvoke: vi.fn() as any, primaryInvoke: glm as any, sleepMs: noSleep,
    });
    expect(r.attempt).toBe(2);
    expect(r.engine).toBe("glm_5_3");
    expect(r.parsed.reportTitle).toBe("周报");
  });

  it("硬截止已触发时立即放弃,不再烧后续尝试(P1-1)", async () => {
    const ac = new AbortController();
    const glm = vi.fn(async () => { ac.abort(); throw new Error("aborted"); });
    const ds = vi.fn();
    const err = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, primaryModelName: "glm-5.3",
      abortSignal: ac.signal, deepSeekInvoke: ds as any, primaryInvoke: glm as any, sleepMs: noSleep,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(VisualReportAttemptsError);
    expect(err.message).toContain("实际执行 1/3");
    expect(err.aborted).toBe(true);
    expect(err.attempts).toHaveLength(1);
    expect(glm).toHaveBeenCalledTimes(1);
    expect(ds).not.toHaveBeenCalled();
  });

  it("三攻全灭抛错(退款语义由上层 catch 承接),错误含最后一次失败原因", async () => {
    const glm = vi.fn(async () => { throw new Error("GLM炸"); });
    const ds = vi.fn(async () => { throw new Error("DS也炸"); });
    const err = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, primaryModelName: "glm-5.3",
      deepSeekInvoke: ds, primaryInvoke: glm as any, sleepMs: noSleep,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(VisualReportAttemptsError);
    expect(err.message).toMatch(/趋势报表生成失败（实际执行 3\/3 次）：DS也炸/);
    expect(err.attempts.map((x: any) => x.engine)).toEqual([
      "glm_5_3", "glm_5_3", "openrouter_deepseek",
    ]);
  });
});

describe("parseVisualReportJson(两路共用同一把尺)", () => {
  it("围栏 JSON 与「前言+JSON」都能解析", () => {
    expect(parseVisualReportJson("```json\n" + GOOD + "\n```").parsed.reportTitle).toBe("周报");
    expect(parseVisualReportJson("以下是报表:" + GOOD).parsed.reportTitle).toBe("周报");
  });
  it("空壳(缺三主键)必拒", () => {
    expect(() => parseVisualReportJson(JSON.stringify({ hello: 1 }))).toThrow("reportTitle");
  });
  it("只有标题的空壳必拒(复审五轮 P1-2)", () => {
    expect(() => parseVisualReportJson(JSON.stringify({ reportTitle: "周报" }))).toThrow("insightSummary");
  });
  it("洞察与赛道为空数组的空壳必拒(复审五轮 P1-2)", () => {
    expect(() => parseVisualReportJson(JSON.stringify({ reportTitle: "周报", insightSummary: [], trackGrowth: [] }))).toThrow("为空");
  });
  it("HTML/错误页必拒", () => {
    expect(() => parseVisualReportJson("<html>bad gateway</html>")).toThrow("非 JSON");
  });
});

describe("兜底引擎标签与失败遥测(复审 P1-1/P1-4)", () => {
  it("默认兜底标签为 DeepSeek 经济档(openrouter_deepseek)", async () => {
    const glm = vi.fn(async () => { throw new Error("GLM炸"); });
    const ds = vi.fn(async () => asResp(GOOD, { model: "deepseek/deepseek-v4-pro-0813" }));
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, primaryModelName: "glm-5.3",
      deepSeekInvoke: ds, primaryInvoke: glm as any, sleepMs: noSleep,
    });
    expect(r.engine).toBe("openrouter_deepseek");
    expect(r.modelName).toBe(DEEPSEEK_ECONOMY_MODEL);
  });

  it("首攻截止:attemptsPerformed=1,provider 不含兜底引擎", () => {
    const err = new VisualReportAttemptsError("msg", [
      { attempt: 1, engine: "glm_5_3", modelName: "glm-5.3" },
    ], true);
    const t = buildVisualReportFailureTelemetry({ error: err, llmResult: null, stage: "llm" });
    expect(t.attemptsPerformed).toBe(1);
    expect(t.aborted).toBe(true);
    expect(t.provider).not.toContain("deepseek");
    expect(t.engineEnv).toBe("glm_5_3");
  });

  it("三攻全灭:轨迹含三个真实模型", () => {
    const err = new VisualReportAttemptsError("msg", [
      { attempt: 1, engine: "glm_5_3", modelName: "glm-5.3" },
      { attempt: 2, engine: "glm_5_3", modelName: "glm-5.3" },
      { attempt: 3, engine: "openrouter_deepseek", modelName: "deepseek/deepseek-v4-pro-0813" },
    ], false);
    const t = buildVisualReportFailureTelemetry({ error: err, llmResult: null, stage: "llm" });
    expect(t.attemptsPerformed).toBe(3);
    expect(t.provider).toContain("1:glm_5_3:glm-5.3");
    expect(t.provider).toContain("3:openrouter_deepseek");
    expect(t.engineEnv).toBe("glm_5_3+glm_5_3+openrouter_deepseek");
  });

  it("LLM 成功但后处理失败:记 postprocess_failed,不得写 attempts_failed", () => {
    const t = buildVisualReportFailureTelemetry({
      error: new Error("转换崩了"),
      llmResult: {
        parsed: {}, rawBody: "", engine: "openrouter_deepseek",
        modelName: "deepseek/deepseek-v4-pro-0813", attempt: 1,
        finishReason: "stop", promptTokens: 1, completionTokens: 2,
        upstreamModel: null, upstreamProvider: null,
        gateway: "openrouter", gatewayAttemptsPerformed: 4,
        gatewayTraceSummary: "3:bailian=http_error|3:evolink=ok",
      },
      stage: "post_llm",
    });
    expect(t.provider).toContain("visual_report_postprocess_failed:openrouter_deepseek");
    expect(t.provider).not.toContain("attempts_failed");
    // 复审四轮 P1-3:后处理失败沿用真实外呼数与轨迹,不拿逻辑 attempt 充数
    expect(t.gatewayAttemptsPerformed).toBe(4);
    expect(t.gatewayTrace).toBe("3:bailian=http_error|3:evolink=ok");
  });

  it("LLM 前置准备失败:记 before_llm/not_started", () => {
    const t = buildVisualReportFailureTelemetry({ error: new Error("扣费炸了"), llmResult: null, stage: "before_llm" });
    expect(t.engineEnv).toBe("not_started");
    expect(t.provider).toBe("visual_report_before_llm_failed");
    expect(t.attemptsPerformed).toBe(0);
  });
});

describe("countGatewayCalls(真实外呼计数,复审四轮 P1-1)", () => {
  it("skipped_not_configured 不计入;DeepSeek 每攻计 1", () => {
    const n = countGatewayCalls([
      { attempt: 1, engine: "openrouter_deepseek", modelName: "ds" },
      { attempt: 2, engine: "openrouter_deepseek", modelName: "ds" },
      {
        attempt: 3, engine: "glm_5_3", modelName: "glm-5.3",
        gatewayTrace: [
          { gateway: "bailian", model: "glm-5.3", outcome: "skipped_not_configured" },
          { gateway: "evolink", model: "glm-5.3", outcome: "ok" },
        ],
      },
    ]);
    expect(n).toBe(3);
  });

  it("GLM 攻多网关降级全部计入", () => {
    const n = countGatewayCalls([
      {
        attempt: 3, engine: "glm_5_3", modelName: "glm-5.3",
        gatewayTrace: [
          { gateway: "bailian", model: "glm-5.3", outcome: "http_error" },
          { gateway: "evolink", model: "glm-5.3", outcome: "content_invalid" },
          { gateway: "openrouter", model: "z-ai/glm-5.3", outcome: "ok" },
        ],
      },
    ]);
    expect(n).toBe(3);
  });

  it("三攻全灭的失败遥测带真实外呼数与轨迹", () => {
    const err = new VisualReportAttemptsError("msg", [
      { attempt: 1, engine: "openrouter_deepseek", modelName: "ds" },
      { attempt: 2, engine: "openrouter_deepseek", modelName: "ds" },
      {
        attempt: 3, engine: "glm_5_3", modelName: "glm-5.3",
        gatewayTrace: [
          { gateway: "bailian", model: "glm-5.3", outcome: "skipped_not_configured" },
          { gateway: "evolink", model: "glm-5.3", outcome: "http_error" },
          { gateway: "openrouter", model: "z-ai/glm-5.3", outcome: "http_error" },
        ],
      },
    ], false);
    const t = buildVisualReportFailureTelemetry({ error: err, llmResult: null, stage: "llm" });
    expect(t.gatewayAttemptsPerformed).toBe(4);
    expect(t.gatewayTrace).toBe("3:bailian=skipped_not_configured|3:evolink=http_error|3:openrouter=http_error");
  });
});

describe("DeepSeek 未配置零外呼(复审五轮 P1-1)", () => {
  it("两攻 DeepSeek 均 skipped + GLM 首网关成功 → gatewayAttemptsPerformed=1", async () => {
    const ds = vi.fn(async () => {
      const err = new Error("经济档通道未配置") as Error & { gatewayTrace?: unknown };
      err.gatewayTrace = [{ gateway: "openrouter", model: "deepseek/deepseek-v4-pro-0813", outcome: "skipped_not_configured" }];
      throw err;
    });
    const glm = vi.fn(async () => ({
      choices: [{ message: { content: GOOD }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
      model: "glm-5.3",
      gateway: "bailian",
      gatewayTrace: [{ gateway: "bailian", model: "glm-5.3", outcome: "ok" }],
    }));
    const r = await runVisualReportLlmAttempts({
      systemPrompt: "s", userPrompt: "u", maxTokens: 40_000, primaryModelName: "glm-5.3",
      deepSeekInvoke: ds as any, primaryInvoke: glm as any, sleepMs: async () => {},
    });
    expect(r.gatewayAttemptsPerformed).toBe(1);
    expect(r.gateway).toBe("bailian");
  });
});
