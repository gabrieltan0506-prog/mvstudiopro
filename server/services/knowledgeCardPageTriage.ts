/**
 * 挑参考页（目录页缩略图 → JSON 页码表）的模型链（用户 0910 拍板）：
 * 读图 + 出 JSON 的活（0911 用户令：同模型先换供应商，OpenRouter 优先、EvoLink 兜底）：
 * OpenRouter DeepSeek V4.1 Flash → EvoLink 同款 → 降档尾段（GLM 5.3 Flash 两家 → Qwen 两家）。
 * 每次网关尝试前 touch 活动心跳；输出不是合法 JSON 视为坏输出换下一家。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { touchKnowledgeCardDistillActivity } from "./knowledgeCardDistillActivity.js";
import { OPENROUTER_DEEPSEEK_PROVIDER_LOCK } from "./knowledgeCardGatewayOrder.js";
import { assertSseContentSafety, isSseContentSafetyError, isSseResponse, readGlmSseStream } from "./sseChatStream.js";


// 带图：EvoLink 侧只有 vision-exp（钥匙里没有 V4.1，0911 实弹核过）；OpenRouter 侧 V4.1 原生多模态
export const PAGE_TRIAGE_MODEL_EVOLINK = String(process.env.KNOWLEDGE_CARD_TRIAGE_MODEL_EVOLINK || "deepseek-v4-flash-vision-exp").trim();
export const PAGE_TRIAGE_MODEL_OPENROUTER = String(process.env.KNOWLEDGE_CARD_TRIAGE_MODEL_OPENROUTER || "deepseek/deepseek-v4.1-flash").trim();
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
// 带图的请求走 api.evolink.ai（direct 只给纯文本，仓库既有约定见 knowledgeCardDistill.ts）
const EVOLINK_VISION_CHAT_URL = String(process.env.EVOLINK_CHAT_URL || "https://api.evolink.ai/v1/chat/completions").trim();
const TRIAGE_TIMEOUT_MS = Math.max(60_000, Number(process.env.KNOWLEDGE_CARD_TRIAGE_TIMEOUT_MS) || 180_000);

type TriageGateway = { name: "evolink" | "openrouter"; url: string; key: string; model: string };
function evolinkVisionGateway(): TriageGateway | null {
  const evo = String(process.env.EVOLINK_API_KEY || "").trim();
  return evo ? { name: "evolink", url: EVOLINK_VISION_CHAT_URL, key: evo, model: PAGE_TRIAGE_MODEL_EVOLINK } : null;
}
function openRouterVisionGateway(): TriageGateway | null {
  const or = String(process.env.OPENROUTER_API_KEY || "").trim();
  return or ? { name: "openrouter", url: OPENROUTER_CHAT_URL, key: or, model: PAGE_TRIAGE_MODEL_OPENROUTER } : null;
}

export function looksLikeTriageJson(raw: string): boolean {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return false;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { pages?: unknown };
    return Array.isArray(parsed.pages);
  } catch {
    return false;
  }
}

async function visionChatOnce(gw: TriageGateway, params: { system: string; userText: string; imageUrls: string[]; abortSignal?: AbortSignal }): Promise<string> {
  const res = await fetch(gw.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gw.key}`,
      "Content-Type": "application/json",
      ...(gw.name === "openrouter" ? { "HTTP-Referer": "https://mvstudiopro.com", "X-Title": "mvstudiopro knowledge card" } : {}),
    },
    body: JSON.stringify({
      model: gw.model,
      messages: [
        { role: "system", content: params.system },
        {
          role: "user",
          content: [
            { type: "text", text: params.userText },
            ...params.imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 16_384,
      response_format: { type: "json_object" },
      // 0911 用户令：全链流式
      stream: true,
      stream_options: { include_usage: true },
      // 0910 用户令：思考一律打开、不准关闭，档位 high
      ...(gw.name === "evolink"
        ? { thinking: { type: "enabled" }, reasoning_effort: "high" }
        // OpenRouter 的 DeepSeek 视觉跳锁自营，不落到转售方（0911 用户令）
        : { reasoning: { effort: "high" }, provider: OPENROUTER_DEEPSEEK_PROVIDER_LOCK }),
    }),
    signal: params.abortSignal ?? AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
  });
  // 非 200 一律按文本读：错误正文要留给下面的状态码判定，别被 strict 先抛掉（复审 P2）
  const text = res.ok && isSseResponse(res) && res.body
    ? await readGlmSseStream(res.body, undefined, { strictCompletion: true })
    : await res.text();
  if (!res.ok) throw new Error(`triage_upstream_failed:${gw.name}:${res.status}:${text.slice(0, 200)}`);
  let json: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`triage_bad_json:${gw.name}:${text.slice(0, 120)}`);
  }
  assertSseContentSafety(json.choices?.[0]?.finish_reason);
  const content = json.choices?.[0]?.message?.content;
  const out = typeof content === "string" ? content.trim() : "";
  if (!looksLikeTriageJson(out)) throw new Error(`triage_bad_output:${gw.name}:${out.slice(0, 80)}`);
  return out;
}

/** 测试注入：替换真实网关调用 */
export const pageTriageTestHooks = new AsyncLocalStorage<{ chat: typeof visionChatOnce }>();

/**
 * 主力 DeepSeek 视觉档（两家网关）→ 兜底 `fallback`（调用方传入 Qwen3.8-Max 的调用）。
 * 全部失败抛最后一个错误，由挑页循环按「本组不选参考页」处理。
 */
export async function invokePageTriageJson(params: {
  system: string;
  userText: string;
  imageUrls: string[];
  fallback?: () => Promise<string>;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const chat = pageTriageTestHooks.getStore()?.chat || visionChatOnce;
  // 顺序（0911）：EvoLink DeepSeek Vision → OpenRouter DeepSeek Vision → Qwen 兜底（调用方传入，内部再走 Qwen 全链）
  const attempts: Array<{ label: string; run: () => Promise<string> }> = [];
  // 0911 用户令：同模型先走 OpenRouter 路由，失败才落 EvoLink
  const or = openRouterVisionGateway();
  if (or) attempts.push({ label: `${or.name}/${or.model}`, run: () => chat(or, params) });
  const evo = evolinkVisionGateway();
  if (evo) attempts.push({ label: `${evo.name}/${evo.model}`, run: () => chat(evo, params) });
  if (params.fallback) {
    const fallback = params.fallback;
    attempts.push({
      label: "qwen-fallback",
      run: async () => {
        const out = await fallback();
        if (!looksLikeTriageJson(out)) throw new Error(`triage_bad_output:qwen:${out.slice(0, 80)}`);
        return out;
      },
    });
  }
  let lastError: Error | null = null;
  for (let i = 0; i < attempts.length; i++) {
    params.abortSignal?.throwIfAborted();
    const attempt = attempts[i]!;
    touchKnowledgeCardDistillActivity();
    try {
      return await attempt.run();
    } catch (err) {
      if (isSseContentSafetyError(err) || params.abortSignal?.aborted) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      const next = attempts[i + 1];
      console.warn(`[knowledgeCardPageTriage] ${attempt.label} 失败 → ${next ? `改走 ${next.label}` : "无兜底"}：${lastError.message.slice(0, 160)}`);
    }
  }
  throw lastError || new Error("挑参考页：没有可用的视觉模型网关");
}
