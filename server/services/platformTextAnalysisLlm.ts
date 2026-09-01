/**
 * /platform 分析文统一模型路由：北京 Qwen 3.8 → 新加坡 Qwen 3.8 → GLM-5.3。
 *
 * 两个 Qwen 档使用各自 Token Plan 密钥与固定地域端点；GLM 只在最后兜底，
 * 且显式锁为 glm_only，避免共享链再次绕回 Qwen 或切到其他模型。
 */
import {
  invokeGlmJsonChatWithGatewayFallback,
  type BailianChatResponse,
  type GlmGatewayTraceEntry,
} from "./bailianChat.js";

export const PLATFORM_TEXT_QWEN_MODEL = "qwen3.8-max";
export const PLATFORM_TEXT_GLM_MODEL = "glm-5.3";
export const PLATFORM_TEXT_QWEN_BEIJING_URL =
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
export const PLATFORM_TEXT_QWEN_SINGAPORE_URL =
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions";

export type PlatformTextAnalysisEngine =
  | "qwen_3_8_beijing"
  | "qwen_3_8_singapore"
  | "glm_5_3";

export type PlatformTextAnalysisResponse = BailianChatResponse & {
  gateway?: string;
  gatewayTrace?: Array<{ gateway: string; model: string; outcome: string; detail?: string }>;
};

export type PlatformTextAnalysisAttemptTrace = {
  attempt: number;
  engine: PlatformTextAnalysisEngine;
  modelName: string;
  gatewayTrace?: Array<{ gateway: string; model: string; outcome: string; detail?: string }>;
};

export type PlatformTextAnalysisResult = {
  response: PlatformTextAnalysisResponse;
  engine: PlatformTextAnalysisEngine;
  modelName: string;
  attempt: number;
  attempts: PlatformTextAnalysisAttemptTrace[];
};

export class PlatformTextAnalysisAttemptsError extends Error {
  readonly code = "platform_text_analysis_attempts_failed";
  constructor(
    message: string,
    readonly attempts: PlatformTextAnalysisAttemptTrace[],
    readonly aborted: boolean,
  ) {
    super(message);
    this.name = "PlatformTextAnalysisAttemptsError";
  }
}

export type PlatformTextAnalysisInvokeDeps = {
  qwenBeijing?: (args: PlatformTextAnalysisRunParams) => Promise<PlatformTextAnalysisResponse>;
  qwenSingapore?: (args: PlatformTextAnalysisRunParams) => Promise<PlatformTextAnalysisResponse>;
  glm?: (args: PlatformTextAnalysisRunParams) => Promise<PlatformTextAnalysisResponse>;
  sleepMs?: (ms: number) => Promise<void>;
};

export type PlatformTextAnalysisRunParams = {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  validateContent?: (content: string) => void;
};

export function buildPlatformQwen38RequestBody(params: PlatformTextAnalysisRunParams): Record<string, unknown> {
  const maxCompletionTokens = Math.max(8_192, Math.min(65_536, Math.floor(Number(params.maxTokens) || 65_536)));
  return {
    model: PLATFORM_TEXT_QWEN_MODEL,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    enable_thinking: true,
    // 用户固定为 high；Qwen 3.8 官方会将 high 映射到其最高 xhigh 档。
    reasoning_effort: "high",
    max_completion_tokens: maxCompletionTokens,
    response_format: { type: "json_object" },
    stream: true,
    stream_options: { include_usage: true },
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
  };
}

function qwenSecret(region: "beijing" | "singapore"): string {
  return String(
    region === "beijing"
      ? process.env.WAN_PLAN_API_KEY || ""
      : process.env.DASHSCOPE_SG_PLAN_KEY || "",
  ).trim();
}

function qwenEndpoint(region: "beijing" | "singapore"): string {
  return region === "beijing" ? PLATFORM_TEXT_QWEN_BEIJING_URL : PLATFORM_TEXT_QWEN_SINGAPORE_URL;
}

function qwenGateway(region: "beijing" | "singapore"): PlatformTextAnalysisEngine {
  return region === "beijing" ? "qwen_3_8_beijing" : "qwen_3_8_singapore";
}

function combineAbortSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(240_000);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function parseQwenSse(raw: string): PlatformTextAnalysisResponse {
  let content = "";
  let finishReason: string | null = null;
  let usage: BailianChatResponse["usage"];
  let model = PLATFORM_TEXT_QWEN_MODEL;
  let provider = "";
  let parsedFrames = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let frame: {
      choices?: Array<{
        delta?: { content?: unknown };
        message?: { content?: unknown };
        finish_reason?: string | null;
      }>;
      usage?: BailianChatResponse["usage"];
      model?: string;
      provider?: string;
    };
    try {
      frame = JSON.parse(payload) as typeof frame;
    } catch {
      continue;
    }
    parsedFrames += 1;
    const choice = frame.choices?.[0];
    const piece = choice?.delta?.content ?? choice?.message?.content;
    if (typeof piece === "string") content += piece;
    if (choice?.finish_reason != null) finishReason = choice.finish_reason;
    if (frame.usage) usage = frame.usage;
    if (frame.model) model = frame.model;
    if (frame.provider) provider = frame.provider;
  }
  if (parsedFrames === 0) throw new Error("Qwen 3.8 流式响应无法解析");
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage,
    model,
    provider: provider || undefined,
  };
}

function parseQwenResponse(raw: string, contentType: string): PlatformTextAnalysisResponse {
  if (/text\/event-stream/i.test(contentType) || /^\s*data:/m.test(raw)) return parseQwenSse(raw);
  try {
    return JSON.parse(raw) as PlatformTextAnalysisResponse;
  } catch {
    throw new Error(`Qwen 3.8 返回非 JSON：${raw.slice(0, 120)}`);
  }
}

export async function invokeRegionalQwen38JsonChat(
  region: "beijing" | "singapore",
  params: PlatformTextAnalysisRunParams,
): Promise<PlatformTextAnalysisResponse> {
  const gateway = qwenGateway(region);
  const key = qwenSecret(region);
  if (!key) {
    const err = new Error(`${gateway} 未配置`) as Error & { gatewayTrace?: PlatformTextAnalysisAttemptTrace["gatewayTrace"] };
    err.gatewayTrace = [{ gateway, model: PLATFORM_TEXT_QWEN_MODEL, outcome: "skipped_not_configured" }];
    throw err;
  }
  const response = await fetch(qwenEndpoint(region), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildPlatformQwen38RequestBody(params)),
    signal: combineAbortSignal(params.abortSignal),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${gateway} HTTP ${response.status}：${raw.slice(0, 160)}`);
  }
  const parsed = parseQwenResponse(raw, String(response.headers.get("content-type") || ""));
  const choice = parsed.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error(`${gateway} 输出被截断`);
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error(`${gateway} 返回空内容`);
  params.validateContent?.(content);
  return {
    ...parsed,
    model: String(parsed.model || PLATFORM_TEXT_QWEN_MODEL),
    gateway,
    gatewayTrace: [{ gateway, model: String(parsed.model || PLATFORM_TEXT_QWEN_MODEL), outcome: "ok" }],
  };
}

async function invokeGlmLast(params: PlatformTextAnalysisRunParams): Promise<PlatformTextAnalysisResponse> {
  const response = await invokeGlmJsonChatWithGatewayFallback({
    system: params.systemPrompt,
    user: params.userPrompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    abortSignal: params.abortSignal,
    gatewayPolicy: "glm_only",
    validateContent: params.validateContent,
  });
  return response;
}

function fallbackTrace(
  engine: PlatformTextAnalysisEngine,
  error: unknown,
): PlatformTextAnalysisAttemptTrace["gatewayTrace"] {
  const fromError = (error as { gatewayTrace?: PlatformTextAnalysisAttemptTrace["gatewayTrace"] })?.gatewayTrace;
  if (Array.isArray(fromError) && fromError.length > 0) return fromError;
  const message = error instanceof Error ? error.message : String(error);
  return [{
    gateway: engine,
    model: engine === "glm_5_3" ? PLATFORM_TEXT_GLM_MODEL : PLATFORM_TEXT_QWEN_MODEL,
    outcome: "error",
    detail: message.slice(0, 200),
  }];
}

export async function runPlatformTextAnalysisAttempts(
  params: PlatformTextAnalysisRunParams,
  deps: PlatformTextAnalysisInvokeDeps = {},
): Promise<PlatformTextAnalysisResult> {
  const sleep = deps.sleepMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const routes: Array<{
    engine: PlatformTextAnalysisEngine;
    modelName: string;
    invoke: (args: PlatformTextAnalysisRunParams) => Promise<PlatformTextAnalysisResponse>;
  }> = [
    {
      engine: "qwen_3_8_beijing",
      modelName: PLATFORM_TEXT_QWEN_MODEL,
      invoke: deps.qwenBeijing ?? ((args) => invokeRegionalQwen38JsonChat("beijing", args)),
    },
    {
      engine: "qwen_3_8_singapore",
      modelName: PLATFORM_TEXT_QWEN_MODEL,
      invoke: deps.qwenSingapore ?? ((args) => invokeRegionalQwen38JsonChat("singapore", args)),
    },
    {
      engine: "glm_5_3",
      modelName: PLATFORM_TEXT_GLM_MODEL,
      invoke: deps.glm ?? invokeGlmLast,
    },
  ];
  const attempts: PlatformTextAnalysisAttemptTrace[] = [];
  let lastError = "";
  const failed = (aborted: boolean) => new PlatformTextAnalysisAttemptsError(
    aborted
      ? `平台分析任务已截止（实际执行 ${attempts.length}/${routes.length} 档）${lastError ? `：${lastError}` : ""}`
      : `平台分析模型全线失败（实际执行 ${attempts.length}/${routes.length} 档）${lastError ? `：${lastError}` : ""}`,
    attempts,
    aborted,
  );
  for (let index = 0; index < routes.length; index += 1) {
    if (params.abortSignal?.aborted) throw failed(true);
    const route = routes[index];
    const trace: PlatformTextAnalysisAttemptTrace = {
      attempt: index + 1,
      engine: route.engine,
      modelName: route.modelName,
    };
    attempts.push(trace);
    try {
      const response = await route.invoke(params);
      const content = response.choices?.[0]?.message?.content;
      if (response.choices?.[0]?.finish_reason === "length") throw new Error(`${route.engine} 输出被截断`);
      if (typeof content !== "string" || !content.trim()) throw new Error(`${route.engine} 返回空内容`);
      params.validateContent?.(content);
      trace.gatewayTrace = response.gatewayTrace ?? [{
        gateway: response.gateway || route.engine,
        model: String(response.model || route.modelName),
        outcome: "ok",
      }];
      return { response, engine: route.engine, modelName: route.modelName, attempt: index + 1, attempts };
    } catch (error) {
      lastError = (error instanceof Error ? error.message : String(error)).slice(0, 240);
      trace.gatewayTrace = fallbackTrace(route.engine, error);
      if (params.abortSignal?.aborted) throw failed(true);
      if (index < routes.length - 1) await sleep(400 * (index + 1));
    }
  }
  throw failed(false);
}

export function countPlatformTextGatewayCalls(attempts: PlatformTextAnalysisAttemptTrace[]): number {
  return attempts.reduce(
    (sum, attempt) => sum + (attempt.gatewayTrace ?? []).filter((item) =>
      item.outcome !== "skipped_not_configured" && item.outcome !== "skipped_budget_exhausted"
    ).length,
    0,
  );
}

export function summarizePlatformTextGatewayTrace(attempts: PlatformTextAnalysisAttemptTrace[]): string {
  return attempts
    .flatMap((attempt) => (attempt.gatewayTrace ?? []).map((item) =>
      `${attempt.attempt}:${item.gateway}=${item.outcome}`
    ))
    .join("|");
}

export function asGlmTrace(
  trace: GlmGatewayTraceEntry[],
): PlatformTextAnalysisAttemptTrace["gatewayTrace"] {
  return trace.map(({ gateway, model, outcome, detail }) => ({ gateway, model, outcome, detail }));
}
