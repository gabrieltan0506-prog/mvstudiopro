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
 * 兜底两档保持不变(它们是 Qwen 不是 GLM,不在"GLM 不走百炼"口径内):
 * 百炼 Qwen 用 Wan official 同一把钥匙,EvoLink Qwen 保交付不保同型。
 *
 * 配置:兜底聊天端点优先 BAILIAN_COMPAT_BASE_URL,兼容回退 WAN_OFFICIAL_BASE(与 Wan 视频同 key)。
 */
export type GlmGatewayName =
  /** @deprecated 0825 起 GLM 不再走百炼;成员仅保留给历史账本/轨迹反序列化,链上不再出现 */
  | "bailian"
  /** @deprecated 同上 */
  | "bailian_sg"
  | "openrouter"
  | "bailian_qwen"
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
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  provider?: string;
};

export type GlmGatewayTraceEntry = {
  gateway: GlmGatewayName;
  model: string;
  outcome: "ok" | "http_error" | "invalid_json" | "truncated" | "empty_content" | "content_invalid" | "network_error" | "skipped_not_configured";
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
  constructor(message: string, readonly gatewayTrace: GlmGatewayTraceEntry[]) {
    super(message);
    this.name = "GlmGatewayError";
  }
}

type GlmParams = {
  system: string;
  user: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  /** 业务验真钩子:抛错=该网关响应不可用,继续降级(复审 P1-1) */
  validateContent?: (content: string) => void;
};

export async function invokeGlmJsonChatWithGatewayFallback(params: GlmParams): Promise<GlmChatSuccess> {
  const trace: GlmGatewayTraceEntry[] = [];
  const gateways: Array<{
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
      // 末档一:GLM 三网关全灭才换模型;Wan official 百炼直连(同一把 WAN_OFFICIAL 钥匙)
      name: "bailian_qwen",
      model: GLM_CHAIN_FALLBACK_MODEL,
      ready: isBailianChatConfigured(),
      url: `${bailianBase()}/compatible-mode/v1/chat/completions`,
      key: String(process.env.WAN_OFFICIAL_API_KEY || "").trim(),
    },
    {
      // 末档二:百炼 Qwen 也不通才走 EvoLink,保交付不保同型
      name: "evolink_qwen",
      model: GLM_CHAIN_FALLBACK_MODEL,
      ready: Boolean(String(process.env.EVOLINK_API_KEY || "").trim()),
      url: "https://api.evolink.ai/v1/chat/completions",
      key: String(process.env.EVOLINK_API_KEY || "").trim(),
    },
  ];
  for (const g of gateways) {
    if (!g.ready) {
      trace.push({ gateway: g.name, model: g.model, outcome: "skipped_not_configured" });
      continue;
    }
    if (params.abortSignal?.aborted) {
      throw new GlmGatewayError("GLM 兜底已被硬截止取消", trace);
    }
    try {
      const res = await invokeOneGlmGateway(params, g.url, g.key, g.model, g.name);
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
      return { ...res, provider: g.name, gateway: g.name, gatewayTrace: trace };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const outcome: GlmGatewayTraceEntry["outcome"] = /HTTP \d+/.test(msg)
        ? "http_error"
        : /截断/.test(msg)
          ? "truncated"
          : /非 JSON/.test(msg)
            ? "invalid_json"
            : "network_error";
      trace.push({ gateway: g.name, model: g.model, outcome, detail: msg.slice(0, 120) });
      console.warn(`[glmGatewayFallback] ${g.name}: ${msg.slice(0, 200)}`);
    }
  }
  throw new GlmGatewayError(
    `GLM 兜底全链失败(含 Qwen 末档)：${trace.map((t) => `${t.gateway}=${t.outcome}`).join(",") || "无可用网关"}`,
    trace,
  );
}

async function invokeOneGlmGateway(
  params: { system: string; user: string; maxTokens?: number; abortSignal?: AbortSignal },
  url: string,
  key: string,
  model: string,
  gateway: GlmGatewayTraceEntry["gateway"] = "bailian",
): Promise<BailianChatResponse> {
  const timeoutSignal = AbortSignal.timeout(240_000);
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
  } else if (gateway === "bailian_qwen") {
    // 百炼兼容模式 Qwen:只认 enable_thinking(不认 reasoning_effort),预算走 max_tokens
    body.enable_thinking = true;
    body.max_tokens = budget;
  } else {
    body.max_tokens = budget;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`GLM 链 HTTP ${res.status}: ${raw.slice(0, 160)}`);
  let json: BailianChatResponse;
  try {
    json = JSON.parse(raw) as BailianChatResponse;
  } catch {
    throw new Error(`GLM 链非 JSON 响应：${raw.slice(0, 120)}`);
  }
  if (String(json.choices?.[0]?.finish_reason || "") === "length") throw new Error("GLM 链输出被截断（预算耗尽）");
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
