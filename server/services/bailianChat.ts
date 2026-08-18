/**
 * 阿里百炼(北京)OpenAI 兼容聊天通道(2026-08-18 实测贯通)。
 * 首个用户:趋势报表兜底 GLM-5.2(用户拍板:「不行的话换 GLM-5.2,弄到 K3 干嘛」——
 * ¥8/¥28 每百万 tokens,输出价为 K3 的 28%)。密钥与 Wan 官方视频同一把。
 */

export const BAILIAN_GLM_MODEL = "glm-5.2";

function bailianBase(): string {
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

/** GLM-5.2 三网关链（2026-08-18 用户拍板:百炼→EvoLink→OpenRouter,全通道 2026-08-18 实测 200）。 */
export async function invokeGlmJsonChatWithGatewayFallback(params: {
  system: string;
  user: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<BailianChatResponse> {
  const gateways: Array<{ name: string; ready: boolean; run: () => Promise<BailianChatResponse> }> = [
    { name: "bailian", ready: isBailianChatConfigured(), run: () => invokeBailianGlmJsonChat(params) },
    {
      name: "evolink",
      ready: Boolean(String(process.env.EVOLINK_API_KEY || "").trim()),
      run: () =>
        invokeOpenAiCompatGlm(params, "https://api.evolink.ai/v1/chat/completions", String(process.env.EVOLINK_API_KEY || "").trim(), "glm-5.2"),
    },
    {
      name: "openrouter",
      ready: Boolean(String(process.env.OPENROUTER_API_KEY || "").trim()),
      run: () =>
        invokeOpenAiCompatGlm(params, "https://openrouter.ai/api/v1/chat/completions", String(process.env.OPENROUTER_API_KEY || "").trim(), "z-ai/glm-5.2"),
    },
  ];
  let lastErr = "GLM 三网关均未配置";
  for (const g of gateways) {
    if (!g.ready) continue;
    if (params.abortSignal?.aborted) throw new Error("GLM 兜底已被硬截止取消");
    try {
      const res = await g.run();
      res.provider = g.name;
      return res;
    } catch (e) {
      lastErr = `${g.name}: ${e instanceof Error ? e.message : String(e)}`;
      console.warn(`[glmGatewayFallback] ${lastErr.slice(0, 200)}`);
    }
  }
  throw new Error(`GLM 兜底三网关全灭：${lastErr.slice(0, 200)}`);
}

async function invokeOpenAiCompatGlm(
  params: { system: string; user: string; maxTokens?: number; abortSignal?: AbortSignal },
  url: string,
  key: string,
  model: string,
): Promise<BailianChatResponse> {
  if (!key) throw new Error("通道未配置");
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

export async function invokeBailianGlmJsonChat(params: {
  system: string;
  user: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<BailianChatResponse> {
  const base = bailianBase();
  const key = String(process.env.WAN_OFFICIAL_API_KEY || "").trim();
  if (!base || !key) throw new Error("百炼通道未配置");
  const timeoutSignal = AbortSignal.timeout(240_000);
  const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, timeoutSignal]) : timeoutSignal;
  const res = await fetch(`${base}/compatible-mode/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: BAILIAN_GLM_MODEL,
      max_tokens: Math.max(8_192, Math.min(131_072, Math.floor(Number(params.maxTokens) || 65_536))),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`百炼 GLM HTTP ${res.status}: ${raw.slice(0, 160)}`);
  let json: BailianChatResponse;
  try {
    json = JSON.parse(raw) as BailianChatResponse;
  } catch {
    throw new Error(`百炼 GLM 非 JSON 响应：${raw.slice(0, 120)}`);
  }
  if (String(json.choices?.[0]?.finish_reason || "") === "length") {
    throw new Error("百炼 GLM 输出被截断（预算耗尽）");
  }
  json.provider = json.provider || "bailian";
  return json;
}
