/**
 * 趋势报表三攻路由（2026-08-18 审查返工后抽出为独立可测模块）：
 * attempt 1-2 走 DeepSeek 经济档,attempt 3 兜底百炼 GLM-5.2(用户拍板:K3 出局,不回落 Evolink/OpenRouter 贵档)。
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
};

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
}): { engineEnv: string; provider: string; attemptsPerformed: number; aborted: boolean } {
  const attemptsError = params.error instanceof VisualReportAttemptsError ? params.error : null;
  if (attemptsError) {
    return {
      engineEnv: attemptsError.attempts.map((x) => x.engine).join("+") || "not_started",
      provider: `visual_report_attempts_failed:${attemptsError.attempts
        .map((x) => `${x.attempt}:${x.engine}:${x.modelName}`)
        .join("|")}`,
      attemptsPerformed: attemptsError.attempts.length,
      aborted: attemptsError.aborted,
    };
  }
  if (params.llmResult) {
    return {
      engineEnv: params.llmResult.engine,
      provider: `visual_report_postprocess_failed:${params.llmResult.engine}:${params.llmResult.modelName}`,
      attemptsPerformed: params.llmResult.attempt,
      aborted: false,
    };
  }
  return {
    engineEnv: "not_started",
    provider: `visual_report_${params.stage}_failed`,
    attemptsPerformed: 0,
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
};

type FallbackResponse = {
  choices?: Array<{ message?: { content?: unknown; [k: string]: unknown }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  provider?: string;
};

/** 报表 JSON 解析与空壳校验（DeepSeek/K3 两路共用同一把尺） */
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
  if (!obj.reportTitle && !Array.isArray(obj.insightSummary) && !Array.isArray(obj.trackGrowth)) {
    throw new Error("JSON 缺少 reportTitle/insightSummary/trackGrowth");
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
  const sleep = params.sleepMs ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
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
      };
    } catch (attemptErr) {
      lastErr = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
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
