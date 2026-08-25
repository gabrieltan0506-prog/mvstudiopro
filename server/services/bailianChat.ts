/**
 * GLM-5.3 主力 + Qwen3.8-Max 兜底的三档聊天通道(2026-08-25 用户拍板改线)。
 * 顺序:OpenRouter GLM-5.3 → 百炼 Qwen3.8-Max 兜底 → EvoLink Qwen3.8-Max 兜底。
 *
 * 🔴 GLM-5.3 不再走百炼(北京/新加坡两档已删,2026-08-25 用户明确拍板):
 *    百炼那两跳按量计费且 0824 曾因模型名不符静默失败回落,用户指定 GLM 一律走 OpenRouter。
 * ⚠️ EvoLink 的 GLM-5.3 尚未上线——0825 Fly 内实测 /v1/models 只有 glm-5.2,
 *    请求 glm-5.3 返回 404 model_not_found("This error is permanent")。
 *    EvoLink 上线 5.3 后在 OpenRouter 之后加档即可,勿用 glm-5.2 冒充。
 *
 * OpenRouter 实测(0825 Fly 内): z-ai/glm-5.3 HTTP 200,provider=Z.AI;
 * 注意它是 reasoning 模型,过小的 max_tokens 会被思考 token 吃光导致空 content——
 * 本链已有 empty_content 判定兜底,调用方仍应给足 max_tokens。
 *
 * 兜底两档(0825 二次拍板):新加坡 Token Plan Qwen3.8-Max(套餐额度,已付费不用即归零,
 * 先耗套餐) → EvoLink Qwen3.8-Max(保交付不保同型)。
 * ⚠️ SG 套餐端点必须用 token-plan.ap-southeast-1 专用地址配 DASHSCOPE_SG_PLAN_KEY;
 *    不能用 DASHSCOPE_SG_BASE(业务空间地址配套餐钥匙会 401,#1307 工作树实录)。
 * 至此整条链不再有任何百炼按量档。
 */
export type GlmGatewayName =
  /** @deprecated 0825 起 GLM 不再走百炼;成员仅保留给历史账本/轨迹反序列化,链上不再出现 */
  | "bailian"
  /** @deprecated 同上 */
  | "bailian_sg"
  | "openrouter"
  /** @deprecated 0825 二次拍板:Qwen 兜底改走新加坡 Token Plan,百炼按量档退役;成员留给历史轨迹 */
  | "bailian_qwen"
  | "plan_sg_qwen"
  | "evolink_qwen";

/** @deprecated 0825 起 GLM 不走百炼;常量仅保留给历史账本比对,链上不再使用 */
export const BAILIAN_GLM_MODEL = "ZHIPU/GLM-5.3";
/** OpenRouter 档（与百炼不同名，不能由 BAILIAN_GLM_MODEL 拼接得到） */
export const OPENROUTER_GLM_MODEL = "z-ai/glm-5.3";
/** 末档兜底:GLM 全线不可用时换 Qwen3.8-Max(Wan official 百炼直连 → EvoLink,与扩写链同 id) */
export const GLM_CHAIN_FALLBACK_MODEL = "qwen3.8-max";

function bailianBase(): string {
  const dedicated = String(process.env.BAILIAN_COMPAT_BASE_URL || "").trim().replace(/\/$/, "");
  if (dedicated) return dedicated;
  return String(process.env.WAN_OFFICIAL_BASE || "").trim().replace(/\/$/, "");
}

export function isBailianChatConfigured(): boolean {
  return Boolean(bailianBase() && String(process.env.WAN_OFFICIAL_API_KEY || "").trim());
}

export type BailianChatResponse = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  model?: string;
  /** 上游实际供应商，例如 OpenRouter 返回的 Z.AI。 */
  provider?: string;
};

export type GlmGatewayUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

export type GlmGatewayTraceEntry = {
  gateway: GlmGatewayName;
  model: string;
  outcome: "ok" | "http_error" | "invalid_json" | "truncated" | "incomplete" | "empty_content" | "content_invalid" | "network_error" | "skipped_not_configured";
  detail?: string;
};

export type GlmChatSuccess = BailianChatResponse & {
  /** 实际交卷网关 */
  gateway: GlmGatewayName;
  /** 本次调用的全部真实外呼轨迹(含之前失败的网关) */
  gatewayTrace: GlmGatewayTraceEntry[];
};

/** 三网关全灭:携带完整外呼轨迹供遥测记真账 */
export class GlmGatewayError extends Error {
  readonly code = "glm_gateway_all_failed";
  constructor(
    message: string,
    readonly gatewayTrace: GlmGatewayTraceEntry[],
    /** 已发生的全部上游用量；业务 JSON 不合格或 finish_reason 异常也不能归零。 */
    readonly usage: GlmGatewayUsage = emptyGlmGatewayUsage(),
  ) {
    super(message);
    this.name = "GlmGatewayError";
  }
}

export type GlmParams = {
  system: string;
  user: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  /** 默认保留三档交付链；模型锁定业务必须显式只走 OpenRouter。 */
  gatewayPolicy?: "fallback" | "openrouter_only";
  /** 调用方墙钟；默认 240 秒，长结构任务可显式放宽。 */
  timeoutMs?: number;
  /** OpenRouter reasoning 参数；仅在 OpenRouter 档发送。 */
  reasoningEffort?: "low" | "medium" | "high" | "max";
  /** 要求 OpenRouter 只路由给完整支持所传参数的供应商。 */
  requireParameters?: boolean;
  /** 为 true 时只接受 finish_reason=stop，缺失或其他值一律拒绝。 */
  requireFinishReasonStop?: boolean;
  /** 防止异常响应整体进入内存；省略时使用 4 MiB。 */
  maxResponseBytes?: number;
  /** 业务验真钩子:抛错=该网关响应不可用,继续降级(复审 P1-1) */
  validateContent?: (content: string) => void;
};

function emptyGlmGatewayUsage(): GlmGatewayUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
}

function responseGlmGatewayUsage(response: BailianChatResponse): GlmGatewayUsage {
  return {
    inputTokens: Math.max(0, Number(response.usage?.prompt_tokens) || 0),
    outputTokens: Math.max(0, Number(response.usage?.completion_tokens) || 0),
    reasoningTokens: Math.max(
      0,
      Number(response.usage?.completion_tokens_details?.reasoning_tokens) || 0,
    ),
    costUsd: Math.max(0, Number(response.usage?.cost) || 0),
  };
}

function addGlmGatewayUsage(
  left: GlmGatewayUsage,
  right: GlmGatewayUsage,
): GlmGatewayUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

type GlmGatewayAttemptError = Error & { glmGatewayUsage?: GlmGatewayUsage };

export async function invokeGlmJsonChatWithGatewayFallback(params: GlmParams): Promise<GlmChatSuccess> {
  const trace: GlmGatewayTraceEntry[] = [];
  let accumulatedUsage = emptyGlmGatewayUsage();
  const configuredGateways: Array<{
    name: GlmGatewayName;
    model: string;
    ready: boolean;
    url: string;
    key: string;
  }> = [
    {
      // 主档:GLM-5.3 唯一在用通道(0825 拍板;EvoLink 5.3 上线前不加第二档 GLM)
      name: "openrouter",
      model: OPENROUTER_GLM_MODEL,
      ready: Boolean(String(process.env.OPENROUTER_API_KEY || "").trim()),
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: String(process.env.OPENROUTER_API_KEY || "").trim(),
    },
    {
      // 兜底一:GLM 不可用才换模型;新加坡 Token Plan 套餐额度(已付费,不用即归零)
      // 端点写死 token-plan 专用域——配 DASHSCOPE_SG_BASE 会 401,不给配错的机会
      name: "plan_sg_qwen",
      model: GLM_CHAIN_FALLBACK_MODEL,
      ready: Boolean(String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim()),
      url: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
      key: String(process.env.DASHSCOPE_SG_PLAN_KEY || "").trim(),
    },
    {
      // 兜底二:SG 套餐也不通才走 EvoLink,保交付不保同型
      name: "evolink_qwen",
      model: GLM_CHAIN_FALLBACK_MODEL,
      ready: Boolean(String(process.env.EVOLINK_API_KEY || "").trim()),
      url: "https://api.evolink.ai/v1/chat/completions",
      key: String(process.env.EVOLINK_API_KEY || "").trim(),
    },
  ];
  const gateways = params.gatewayPolicy === "openrouter_only"
    ? configuredGateways.slice(0, 1)
    : configuredGateways;
  for (const g of gateways) {
    if (!g.ready) {
      trace.push({ gateway: g.name, model: g.model, outcome: "skipped_not_configured" });
      continue;
    }
    if (params.abortSignal?.aborted) {
      throw new GlmGatewayError("GLM 调用已被硬截止取消", trace, accumulatedUsage);
    }
    try {
      const res = await invokeOneGlmGateway(params, g.url, g.key, g.model, g.name);
      accumulatedUsage = addGlmGatewayUsage(accumulatedUsage, responseGlmGatewayUsage(res));
      const content = res.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content.trim() : "";
      if (!text) {
        trace.push({ gateway: g.name, model: g.model, outcome: "empty_content" });
        continue;
      }
      if (params.validateContent) {
        try {
          params.validateContent(text);
        } catch (ve) {
          trace.push({
            gateway: g.name,
            model: g.model,
            outcome: "content_invalid",
            detail: (ve instanceof Error ? ve.message : String(ve)).slice(0, 120),
          });
          continue;
        }
      }
      trace.push({ gateway: g.name, model: g.model, outcome: "ok" });
      // provider 保留上游真实值（例如 Z.AI）；内部通道身份单独放 gateway。
      return { ...res, gateway: g.name, gatewayTrace: trace };
    } catch (e) {
      const attemptUsage = (e as GlmGatewayAttemptError).glmGatewayUsage;
      if (attemptUsage) {
        accumulatedUsage = addGlmGatewayUsage(accumulatedUsage, attemptUsage);
      }
      const msg = e instanceof Error ? e.message : String(e);
      const outcome: GlmGatewayTraceEntry["outcome"] = /HTTP \d+/.test(msg)
        ? "http_error"
        : /截断/.test(msg)
          ? "truncated"
          : /未正常结束/.test(msg)
            ? "incomplete"
          : /非 JSON/.test(msg)
            ? "invalid_json"
            : "network_error";
      trace.push({ gateway: g.name, model: g.model, outcome, detail: msg.slice(0, 120) });
      console.warn(`[glmGatewayFallback] ${g.name}: ${msg.slice(0, 200)}`);
    }
  }
  throw new GlmGatewayError(
    params.gatewayPolicy === "openrouter_only"
      ? `OpenRouter GLM-5.3 调用失败：${trace.map((t) => `${t.gateway}=${t.outcome}`).join(",") || "通道未配置"}`
      : `GLM 兜底全链失败(含 Qwen 末档)：${trace.map((t) => `${t.gateway}=${t.outcome}`).join(",") || "无可用网关"}`,
    trace,
    accumulatedUsage,
  );
}

async function invokeOneGlmGateway(
  params: GlmParams,
  url: string,
  key: string,
  model: string,
  gateway: GlmGatewayTraceEntry["gateway"] = "bailian",
): Promise<BailianChatResponse> {
  const timeoutMs = Math.max(
    1_000,
    Math.min(15 * 60_000, Math.floor(Number(params.timeoutMs) || 240_000)),
  );
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, timeoutSignal]) : timeoutSignal;
  const budget = Math.max(8_192, Math.min(131_072, Math.floor(Number(params.maxTokens) || 65_536)));
  const body: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  };
  if (gateway === "evolink_qwen") {
    // EvoLink Qwen 档位 low|medium|xhigh(无 max);与扩写链同口径开顶档,
    // 且用 max_completion_tokens(传 max_tokens 会被静默忽略)
    body.enable_thinking = true;
    body.reasoning_effort = "xhigh";
    body.max_completion_tokens = budget;
  } else if (gateway === "bailian_qwen" || gateway === "plan_sg_qwen") {
    // DashScope compatible-mode Qwen(含新加坡 Token Plan):只认 enable_thinking
    // (不认 reasoning_effort),预算走 max_tokens——七审第4条:换档时这条分支键漏改过
    body.enable_thinking = true;
    body.max_tokens = budget;
  } else {
    body.max_tokens = budget;
    if (params.reasoningEffort) {
      body.reasoning = { effort: params.reasoningEffort };
    }
    if (params.requireParameters) {
      body.provider = { require_parameters: true };
    }
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const maxResponseBytes = Math.max(
    1_024,
    Math.min(16 * 1024 * 1024, Math.floor(Number(params.maxResponseBytes) || 4 * 1024 * 1024)),
  );
  if (Buffer.byteLength(raw) > maxResponseBytes) {
    throw new Error("GLM 链响应超过处理上限");
  }
  if (!res.ok) throw new Error(`GLM 链 HTTP ${res.status}: ${raw.slice(0, 160)}`);
  let json: BailianChatResponse;
  try {
    json = JSON.parse(raw) as BailianChatResponse;
  } catch {
    throw new Error(`GLM 链非 JSON 响应：${raw.slice(0, 120)}`);
  }
  const finishReason = String(json.choices?.[0]?.finish_reason || "");
  const usage = responseGlmGatewayUsage(json);
  const failWithUsage = (message: string): never => {
    throw Object.assign(new Error(message), { glmGatewayUsage: usage }) as GlmGatewayAttemptError;
  };
  if (finishReason === "length") failWithUsage("GLM 链输出被截断（预算耗尽）");
  if (params.requireFinishReasonStop && finishReason !== "stop") {
    failWithUsage(`GLM 链未正常结束（${finishReason || "missing"}）`);
  }
  return json;
}

/** 兼容保留:单打百炼(供探针/其他调用方直连百炼时使用) */
export async function invokeBailianGlmJsonChat(params: {
  system: string;
  user: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<BailianChatResponse> {
  if (!isBailianChatConfigured()) throw new Error("百炼通道未配置");
  return invokeOneGlmGateway(
    params,
    `${bailianBase()}/compatible-mode/v1/chat/completions`,
    String(process.env.WAN_OFFICIAL_API_KEY || "").trim(),
    BAILIAN_GLM_MODEL,
  );
}
