/**
 * GLM-5.2 三网关聊天通道(2026-08-18 用户拍板:百炼→EvoLink→OpenRouter;K3 出局)。
 * 三通道均 2026-08-18 实测 200。复审三轮 P1-1/P1-3:
 * - 每个网关的响应必须过 validateContent 业务验真才算成功,否则继续降级;
 * - 全程记录 gatewayTrace(真实 HTTP 外呼),失败以 GlmGatewayError 携带轨迹上抛。
 * 配置:聊天端点优先 BAILIAN_COMPAT_BASE_URL,兼容回退 WAN_OFFICIAL_BASE(与 Wan 视频同 key)。
 */

export const BAILIAN_GLM_MODEL = "glm-5.2";

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
  gateway: "bailian" | "evolink" | "openrouter";
  model: string;
  outcome: "ok" | "http_error" | "invalid_json" | "truncated" | "empty_content" | "content_invalid" | "network_error" | "skipped_not_configured";
  detail?: string;
};

export type GlmChatSuccess = BailianChatResponse & {
  /** 实际交卷网关 */
  gateway: "bailian" | "evolink" | "openrouter";
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
    name: "bailian" | "evolink" | "openrouter";
    model: string;
    ready: boolean;
    url: string;
    key: string;
  }> = [
    {
      name: "bailian",
      model: BAILIAN_GLM_MODEL,
      ready: isBailianChatConfigured(),
      url: `${bailianBase()}/compatible-mode/v1/chat/completions`,
      key: String(process.env.WAN_OFFICIAL_API_KEY || "").trim(),
    },
    {
      name: "evolink",
      model: "glm-5.2",
      ready: Boolean(String(process.env.EVOLINK_API_KEY || "").trim()),
      url: "https://api.evolink.ai/v1/chat/completions",
      key: String(process.env.EVOLINK_API_KEY || "").trim(),
    },
    {
      name: "openrouter",
      model: "z-ai/glm-5.2",
      ready: Boolean(String(process.env.OPENROUTER_API_KEY || "").trim()),
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: String(process.env.OPENROUTER_API_KEY || "").trim(),
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
      const res = await invokeOneGlmGateway(params, g.url, g.key, g.model);
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
    `GLM 兜底三网关全灭：${trace.map((t) => `${t.gateway}=${t.outcome}`).join(",") || "无可用网关"}`,
    trace,
  );
}

async function invokeOneGlmGateway(
  params: { system: string; user: string; maxTokens?: number; abortSignal?: AbortSignal },
  url: string,
  key: string,
  model: string,
): Promise<BailianChatResponse> {
  const timeoutSignal = AbortSignal.timeout(240_000);
  const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, timeoutSignal]) : timeoutSignal;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      max_tokens: Math.max(8_192, Math.min(131_072, Math.floor(Number(params.maxTokens) || 65_536))),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`GLM HTTP ${res.status}: ${raw.slice(0, 160)}`);
  let json: BailianChatResponse;
  try {
    json = JSON.parse(raw) as BailianChatResponse;
  } catch {
    throw new Error(`GLM 非 JSON 响应：${raw.slice(0, 120)}`);
  }
  if (String(json.choices?.[0]?.finish_reason || "") === "length") throw new Error("GLM 输出被截断（预算耗尽）");
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
