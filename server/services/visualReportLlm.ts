/**
 * 趋势报表三攻路由（2026-08-18 审查返工后抽出为独立可测模块）：
 * attempt 1-2 走 DeepSeek 经济档,attempt 3 兜底 GLM-5.2(三网关链:百炼→EvoLink→OpenRouter)。遥测同时记录逻辑尝试(llm)与真实外呼(gateway)两层次数。
 * 遥测以本模块返回的真实路由为准（审查 P1-3：禁止把 OpenRouter 记成 Evolink）。
 */
import {
  DEEPSEEK_ECONOMY_MODEL,
  invokeDeepSeekJsonChatRaw,
  type DeepSeekJsonChatResponse,
} from "./platformTopicShortlist";

export type VisualReportEngine = "openrouter_deepseek" | "glm_5_2";

/** 单次尝试的真实路由痕迹（复审 P1-1：失败遥测必须记真账） */
export type VisualReportAttemptTrace = {
  attempt: number;
  engine: VisualReportEngine;
  modelName: string;
  /** GLM 兜底攻的真实网关外呼轨迹(复审三轮 P1-3) */
  gatewayTrace?: Array<{ gateway: string; model: string; outcome: string; detail?: string }>;
};

/** 真实 HTTP 外呼数:DeepSeek 攻=1;GLM 攻=网关轨迹中真实外呼条数(skipped_not_configured 不计;无轨迹按 1 计) */
export function countGatewayCalls(trace: VisualReportAttemptTrace[]): number {
  return trace.reduce((sum, t) => {
    // 复审五轮 P1-1:有轨迹以轨迹为准(skipped=零外呼);无轨迹的攻按 1 次真实 fetch 计
    if (t.gatewayTrace) return sum + t.gatewayTrace.filter((g) => g.outcome !== "skipped_not_configured").length;
    return sum + 1;
  }, 0);
}

/** 全轨迹压成可入指标的字符串(attempt:gateway=outcome|…) */
export function summarizeGatewayTrace(trace: VisualReportAttemptTrace[]): string {
  return trace
    .flatMap((t) => (t.gatewayTrace ?? []).map((g) => `${t.attempt}:${g.gateway}=${g.outcome}`))
    .join("|");
}

/** 三攻失败结构化错误：携带真实尝试轨迹与是否硬截止,供上层遥测/退款文案如实记录 */
export class VisualReportAttemptsError extends Error {
  readonly code = "visual_report_attempts_failed";
  constructor(
    message: string,
    readonly attempts: VisualReportAttemptTrace[],
    readonly aborted: boolean,
  ) {
    super(message);
    this.name = "VisualReportAttemptsError";
  }
}

/** 失败遥测统一口径（routers catch 复用;抽成纯函数以便直接测试——复审 P1-4） */
export function buildVisualReportFailureTelemetry(params: {
  error: unknown;
  llmResult: VisualReportLlmResult | null;
  stage: "before_llm" | "llm" | "post_llm";
}): {
  engineEnv: string;
  provider: string;
  attemptsPerformed: number;
  gatewayAttemptsPerformed: number;
  gatewayTrace: string;
  aborted: boolean;
} {
  const attemptsError = params.error instanceof VisualReportAttemptsError ? params.error : null;
  if (attemptsError) {
    return {
      engineEnv: attemptsError.attempts.map((x) => x.engine).join("+") || "not_started",
      provider: `visual_report_attempts_failed:${attemptsError.attempts
        .map((x) => `${x.attempt}:${x.engine}:${x.modelName}`)
        .join("|")}`,
      attemptsPerformed: attemptsError.attempts.length,
      gatewayAttemptsPerformed: countGatewayCalls(attemptsError.attempts),
      gatewayTrace: summarizeGatewayTrace(attemptsError.attempts),
      aborted: attemptsError.aborted,
    };
  }
  if (params.llmResult) {
    return {
      engineEnv: params.llmResult.engine,
      provider: `visual_report_postprocess_failed:${params.llmResult.engine}:${params.llmResult.modelName}`,
      attemptsPerformed: params.llmResult.attempt,
      // 复审四轮 P1-3:后处理失败也要记真实外呼数与轨迹,不拿逻辑 attempt 充数
      gatewayAttemptsPerformed: params.llmResult.gatewayAttemptsPerformed,
      gatewayTrace: params.llmResult.gatewayTraceSummary,
      aborted: false,
    };
  }
  return {
    engineEnv: "not_started",
    provider: `visual_report_${params.stage}_failed`,
    attemptsPerformed: 0,
    gatewayAttemptsPerformed: 0,
    gatewayTrace: "",
    aborted: false,
  };
}

export type VisualReportLlmResult = {
  parsed: Record<string, unknown>;
  rawBody: string;
  engine: VisualReportEngine;
  modelName: string;
  attempt: number;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  upstreamModel: string | null;
  upstreamProvider: string | null;
  /** GLM 兜底成功时的实际交卷网关(bailian/evolink/openrouter);DeepSeek 攻为 "openrouter" */
  gateway: string | null;
  /** 全程真实 HTTP 外呼数(含失败攻;不计未配置跳过) */
  gatewayAttemptsPerformed: number;
  /** 全程网关轨迹摘要(attempt:gateway=outcome|…) */
  gatewayTraceSummary: string;
};

type FallbackResponse = {
  choices?: Array<{ message?: { content?: unknown; [k: string]: unknown }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  provider?: string;
  gateway?: string;
  gatewayTrace?: Array<{ gateway: string; model: string; outcome: string; detail?: string }>;
};

/** 报表 JSON 解析与空壳校验(DeepSeek 与 GLM 兜底共用同一把尺) */
export function parseVisualReportJson(rawText: string): { parsed: Record<string, unknown>; rawBody: string } {
  const text = String(rawText || "").trim();
  if (!text) throw new Error("上游返回空内容");
  if (/^An error\b/i.test(text) || text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
    throw new Error(`上游网关非 JSON：${text.slice(0, 80)}`);
  }
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  const stripped = fenceMatch
    ? fenceMatch[1].trim()
    : text.replace(/^```(?:json)?[\r\n]*/i, "").replace(/[\r\n]*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // 兼容「前言 + JSON」形态（审查建议4）：截取首个 { 到末个 } 再试一次
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      parsed = JSON.parse(text.slice(first, last + 1));
    } else {
      parsed = JSON.parse(text);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("解析结果不是 JSON 对象");
  }
  const obj = parsed as Record<string, unknown>;
  // 复审五轮 P1-2:三主键必须同时实质非空,只带标题或空数组的空壳一律拒绝并继续降级
  if (typeof obj.reportTitle !== "string" || !obj.reportTitle.trim()) {
    throw new Error("报表空壳:reportTitle 缺失或为空");
  }
  if (!Array.isArray(obj.insightSummary) || obj.insightSummary.length === 0) {
    throw new Error("报表空壳:insightSummary 为空");
  }
  if (!Array.isArray(obj.trackGrowth) || obj.trackGrowth.length === 0) {
    throw new Error("报表空壳:trackGrowth 为空");
  }
  return { parsed: obj, rawBody: text };
}

export async function runVisualReportLlmAttempts(params: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  fallbackModelName: string;
  abortSignal?: AbortSignal;
  maxAttempts?: number;
  /** 注入点（测试用）；生产默认真实通道 */
  deepSeekInvoke?: (args: {
    system: string;
    user: string;
    maxTokens?: number;
    abortSignal?: AbortSignal;
  }) => Promise<DeepSeekJsonChatResponse>;
  fallbackInvoke: (modelName: string) => Promise<FallbackResponse>;
  sleepMs?: (ms: number) => Promise<void>;
}): Promise<VisualReportLlmResult> {
  const maxAttempts = Math.max(2, params.maxAttempts ?? 3);
  const deepSeekInvoke = params.deepSeekInvoke ?? invokeDeepSeekJsonChatRaw;
  const sleep =
    params.sleepMs ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(t);
          resolve();
        };
        const t = setTimeout(() => {
          params.abortSignal?.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        params.abortSignal?.addEventListener("abort", onAbort, { once: true });
      }));
  let lastErr = "";
  const attempts: VisualReportAttemptTrace[] = [];
  const buildErr = (aborted: boolean) =>
    new VisualReportAttemptsError(
      aborted
        ? `趋势报表任务已截止（实际执行 ${attempts.length}/${maxAttempts} 次）${lastErr ? `：${lastErr.slice(0, 200)}` : ""}`
        : `趋势报表生成失败（实际执行 ${attempts.length}/${maxAttempts} 次）${lastErr ? `：${lastErr.slice(0, 200)}` : ""}`,
      attempts,
      aborted,
    );
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // 复审 P1-3：每轮顶部先查硬截止,截止后一个通道都不许再碰
    if (params.abortSignal?.aborted) throw buildErr(true);
    const useFallback = attempt >= maxAttempts;
    const engine: VisualReportEngine = useFallback ? "glm_5_2" : "openrouter_deepseek";
    const modelName = useFallback ? params.fallbackModelName : DEEPSEEK_ECONOMY_MODEL;
    attempts.push({ attempt, engine, modelName });
    try {
      const response: FallbackResponse = useFallback
        ? await params.fallbackInvoke(modelName)
        : await deepSeekInvoke({
            system: params.systemPrompt,
            user: params.userPrompt,
            maxTokens: params.maxTokens,
            abortSignal: params.abortSignal,
          });
      const choice0 = response.choices?.[0];
      const content = choice0?.message?.content;
      const { parsed, rawBody } = parseVisualReportJson(typeof content === "string" ? content : "");
      if (response.gatewayTrace) attempts[attempts.length - 1].gatewayTrace = response.gatewayTrace;
      return {
        parsed,
        rawBody,
        engine,
        modelName,
        attempt,
        finishReason: choice0?.finish_reason ?? null,
        promptTokens: response.usage?.prompt_tokens ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
        upstreamModel: String(response.model ?? "").trim() || null,
        upstreamProvider: String(response.provider ?? "").trim() || null,
        gateway: String(response.gateway ?? response.provider ?? (useFallback ? "" : "openrouter")).trim() || null,
        gatewayAttemptsPerformed: countGatewayCalls(attempts),
        gatewayTraceSummary: summarizeGatewayTrace(attempts),
      };
    } catch (attemptErr) {
      lastErr = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
      const gwTrace = (attemptErr as { gatewayTrace?: VisualReportAttemptTrace["gatewayTrace"] })?.gatewayTrace;
      if (gwTrace) attempts[attempts.length - 1].gatewayTrace = gwTrace;
      console.warn(`[generateVisualReport] LLM 第 ${attempt}/${maxAttempts} 次失败: ${lastErr.slice(0, 240)}`);
      // 硬截止已触发时立即放弃（复审 P1-2/P1-3）：真实次数入错误,退避可被截止打断
      if (params.abortSignal?.aborted) throw buildErr(true);
      if (attempt < maxAttempts) {
        await sleep(400 * attempt);
        if (params.abortSignal?.aborted) throw buildErr(true);
      }
    }
  }
  throw buildErr(false);
}
