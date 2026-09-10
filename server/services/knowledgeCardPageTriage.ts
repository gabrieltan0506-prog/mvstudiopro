/**
 * 挑参考页（目录页缩略图 → JSON 页码表）的模型链（用户 0910 拍板）：
 * 读图 + 出 JSON 的活，主力 DeepSeek V4 Flash Vision（EvoLink api 优先、OpenRouter 兜底），
 * 兜底新加坡 Qwen3.8-Max（能读图）；不再用 GPT-5.6 Sol（太贵）。
 * 每次网关尝试前 touch 活动心跳；输出不是合法 JSON 视为坏输出换下一家。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { touchKnowledgeCardDistillActivity } from "./knowledgeCardDistillActivity.js";

export const PAGE_TRIAGE_MODEL_EVOLINK = String(process.env.KNOWLEDGE_CARD_TRIAGE_MODEL_EVOLINK || "deepseek-v4-flash-vision-exp").trim();
export const PAGE_TRIAGE_MODEL_OPENROUTER = String(process.env.KNOWLEDGE_CARD_TRIAGE_MODEL_OPENROUTER || "deepseek/deepseek-v4-flash-vision-exp").trim();
// 带图的请求走 api.evolink.ai（direct 只给纯文本，仓库既有约定见 knowledgeCardDistill.ts）
const EVOLINK_VISION_CHAT_URL = String(process.env.EVOLINK_CHAT_URL || "https://api.evolink.ai/v1/chat/completions").trim();
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const TRIAGE_TIMEOUT_MS = Math.max(60_000, Number(process.env.KNOWLEDGE_CARD_TRIAGE_TIMEOUT_MS) || 180_000);

type TriageGateway = { name: "evolink" | "openrouter"; url: string; key: string; model: string };
function visionGateways(): TriageGateway[] {
  const out: TriageGateway[] = [];
  const evo = String(process.env.EVOLINK_API_KEY || "").trim();
  if (evo) out.push({ name: "evolink", url: EVOLINK_VISION_CHAT_URL, key: evo, model: PAGE_TRIAGE_MODEL_EVOLINK });
  const or = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (or) out.push({ name: "openrouter", url: OPENROUTER_CHAT_URL, key: or, model: PAGE_TRIAGE_MODEL_OPENROUTER });
  return out;
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
      max_tokens: 4096,
      response_format: { type: "json_object" },
      ...(gw.name === "evolink" ? { thinking: { type: "disabled" } } : {}),
    }),
    signal: params.abortSignal ?? AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`triage_upstream_failed:${gw.name}:${res.status}:${text.slice(0, 200)}`);
  let json: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`triage_bad_json:${gw.name}:${text.slice(0, 120)}`);
  }
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
  const gateways = visionGateways();
  let lastError: Error | null = null;
  for (let i = 0; i < gateways.length; i++) {
    const gw = gateways[i]!;
    touchKnowledgeCardDistillActivity();
    try {
      return await chat(gw, params);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[knowledgeCardPageTriage] ${gw.name}/${gw.model} 失败 → ${i < gateways.length - 1 ? `改走 ${gateways[i + 1]!.name}` : "改走 Qwen3.8-Max 兜底"}：${lastError.message.slice(0, 160)}`);
    }
  }
  if (params.fallback) {
    touchKnowledgeCardDistillActivity();
    const out = await params.fallback();
    if (!looksLikeTriageJson(out)) throw new Error(`triage_bad_output:qwen:${out.slice(0, 80)}`);
    return out;
  }
  throw lastError || new Error("挑参考页：没有可用的视觉模型网关");
}
