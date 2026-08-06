/**
 * /canvas 编剧室连载扩写：三档模型调用（优秀=qwen3.8-max、卓越=kimi-k3、顶级=gpt-5.6-sol）。
 * 通道与推理档写法对齐 `platformPersonaPolish.ts` 的双通道润色器，只是这里输出是长篇 Markdown 正文，
 * 不走 JSON response_format，且输出上限按集数放大。
 */
import { extractFirstChoicePlainText, type InvokeResult } from "../_core/llm.js";
import {
  getEvolinkApiKey,
  getOpenRouterChatHeaders,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from "./gpt56CopywritingGateway.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import { PLATFORM_ENGINE_TIER_MODELS, platformEngineEffort } from "../../shared/platformEngineTiers.js";
import type { PlatformEngineTierId } from "../../shared/manhuaWriterExpandPricing.js";

export const MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE = "算力紧张，请稍后再试";

const EVOLINK_DIRECT_CHAT_URL = String(
  process.env.EVOLINK_DIRECT_CHAT_COMPLETIONS_URL || "https://direct.evolink.ai/v1/chat/completions",
).trim();

const EXPAND_TIMEOUT_MS = 300_000;
/** 每集约 3000–4000 输出 token（四到八段可拍表 + 对白/表演），留够余量避免中途截断。 */
const EXPAND_TOKENS_PER_EPISODE = 4000;
const EXPAND_TOKENS_FLOOR = 8000;
const EXPAND_TOKENS_CEILING = 40_000;

function expandMaxTokens(episodeCount: number): number {
  const n = Math.max(1, Math.floor(Number(episodeCount) || 1));
  return Math.min(EXPAND_TOKENS_CEILING, Math.max(EXPAND_TOKENS_FLOOR, n * EXPAND_TOKENS_PER_EPISODE));
}

type ExpandTarget = {
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
  /** Qwen 在 Evolink 上要用 max_completion_tokens，且不能与 max_tokens 同传。 */
  useMaxCompletionTokens?: boolean;
};

/**
 * 优秀/顶级档主走 Evolink，卓越档主走 OpenRouter，掉线各换备道（同价）。
 *
 * 顶级档不能走 OpenRouter 优先：我们的 OpenRouter 账号对整个 OpenAI 系是账号级
 * 403 TOS 封禁（2026-08-05 确认，加 `provider` 参数也绕不过），主走会先浪费一次
 * 403 往返才回落 Evolink。与文件头注释「顶级 | EvoLink `gpt-5.6-sol`」保持一致。
 */
function expandTargets(tier: PlatformEngineTierId): ExpandTarget[] {
  const evolinkKey = getEvolinkApiKey();
  const openRouterKey = getOpenRouterApiKey();
  const models = PLATFORM_ENGINE_TIER_MODELS[tier];
  const evolink: ExpandTarget | null = evolinkKey
    ? {
        url: EVOLINK_DIRECT_CHAT_URL,
        key: evolinkKey,
        model: models.evolink,
        useMaxCompletionTokens: tier === "excellent",
      }
    : null;
  const openrouter: ExpandTarget | null = openRouterKey
    ? {
        url: OPENROUTER_CHAT_COMPLETIONS_URL,
        key: openRouterKey,
        model: models.openrouter,
        headers: getOpenRouterChatHeaders(),
      }
    : null;
  const ordered = tier === "superb" ? [openrouter, evolink] : [evolink, openrouter];
  return ordered.filter((t): t is ExpandTarget => Boolean(t));
}

async function callExpandOnce(params: {
  target: ExpandTarget;
  tier: PlatformEngineTierId;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  const effort = platformEngineEffort("expand", params.tier);
  const body: Record<string, unknown> = {
    model: params.target.model,
    messages: [{ role: "user", content: params.prompt }],
    reasoning_effort: effort,
  };
  if (params.target.useMaxCompletionTokens) {
    body.enable_thinking = true;
    body.max_completion_tokens = params.maxTokens;
  } else {
    body.max_tokens = params.maxTokens;
  }

  const res = await fetch(params.target.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.target.key}`,
      "Content-Type": "application/json",
      ...(params.target.headers || {}),
    },
    signal: AbortSignal.timeout(EXPAND_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.warn(`[manhuaWriterExpand] ${params.target.model} HTTP ${res.status}: ${raw.slice(0, 300)}`);
    throw new Error(MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE);
  }
  let json: InvokeResult;
  try {
    json = JSON.parse(raw) as InvokeResult;
  } catch {
    throw new Error(MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE);
  }
  const text = extractFirstChoicePlainText(json).trim();
  if (!text) throw new Error(MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE);
  // finish_reason === "length" 说明撞到 max_tokens 上限、正文被砍断：
  // res.ok 为真、text 非空，但用户会拿到写到一半的剧本——绝不能算成功去扣钱。
  const finishReason = json.choices?.[0]?.finish_reason;
  if (finishReason === "length") {
    console.warn(
      `[manhuaWriterExpand] ${params.target.model} 输出被截断（finish_reason=length, completion_tokens=${
        json.usage?.completion_tokens ?? "?"
      }/${params.maxTokens}）`,
    );
    throw new Error(MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE);
  }
  console.info(
    `[manhuaWriterExpand] ${params.target.model} completion_tokens=${json.usage?.completion_tokens ?? "?"}`,
  );
  return text;
}

/** 跑一次扩写。主通道失败换备道，两条都失败才抛业务话术。 */
export async function runManhuaWriterExpand(params: {
  prompt: string;
  tier: PlatformEngineTierId;
  episodeCount: number;
}): Promise<string> {
  const targets = expandTargets(params.tier);
  if (targets.length === 0) throw new Error(MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE);
  const maxTokens = expandMaxTokens(params.episodeCount);
  let lastErr: unknown = null;
  for (const target of targets) {
    try {
      return await callExpandOnce({ target, tier: params.tier, prompt: params.prompt, maxTokens });
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn(
    `[manhuaWriterExpand] 全部通道失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
  throw new Error(MANHUA_WRITER_EXPAND_CAPACITY_MESSAGE);
}
