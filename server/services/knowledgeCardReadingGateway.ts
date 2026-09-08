import { getEvolinkApiKey, resolveGpt56OfficialFallbackTarget, type Gpt56CopywritingTarget } from "./gpt56CopywritingGateway.js";
import { extractFirstChoicePlainText, isRetryableOpenAiGatewayError } from "../_core/llm.js";
import { KNOWLEDGE_CARD_DISTILL_MODEL_QWEN, KNOWLEDGE_CARD_DISTILL_MODEL_SOL, type ActiveKnowledgeCardDistillModelId } from "../../shared/knowledgeCardDistillModels.js";
import { claimKnowledgeReadingCall, readKnowledgeReadingJson, saveKnowledgeReadingObject } from "./knowledgeCardReadingStore.js";

type ReadingReply = { status: number; body: string; receivedAt: string };
type ReadingTransportReceipt = { retryable: boolean; receivedAt: string; outcome: "unknown" | "avoided" };
export type KnowledgeReadingCall = {
  objectPrefix: string;
  model: ActiveKnowledgeCardDistillModelId;
  system: string;
  text: string;
  images?: Array<{ pageId: string; url: string }>;
  signal?: AbortSignal;
  /** 同一阅读任务的通道避让范围（如分析前缀）；不传则每次独立判定。 */
  channelScope?: string;
};

const EVOLINK_AVOID_MS = 10 * 60_000;
const evolinkAvoidUntil = new Map<string, number>();
function markEvolinkUnavailable(scope?: string) { if (scope) evolinkAvoidUntil.set(scope, Date.now() + EVOLINK_AVOID_MS); }
function evolinkAvoided(scope?: string): boolean {
  if (!scope) return false;
  const until = evolinkAvoidUntil.get(scope);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  evolinkAvoidUntil.delete(scope);
  return false;
}
/** 仅测试用：清空同进程内的通道避让记忆。 */
export function resetKnowledgeReadingChannelMemory() { evolinkAvoidUntil.clear(); }

/** 官方回执可能带快照日期；只放行「所选模型-YYYY-MM-DD」这一种形状，其他一律不接受。 */
export function knowledgeReadingModelMatches(reported: unknown, model: ActiveKnowledgeCardDistillModelId): boolean {
  if (typeof reported !== "string") return false;
  if (reported === model) return true;
  return reported.startsWith(`${model}-`) && /^\d{4}-\d{2}-\d{2}$/.test(reported.slice(model.length + 1));
}

class ReadingChannelAvoidedError extends Error {
  constructor() { super("主通道近期超时，本批直接使用官方备用通道"); }
}

class ReadingTransportError extends Error {
  constructor(readonly retryable: boolean) {
    super("阅读通道未返回完整响应，原请求结果待对账，未重复提交同一通道");
  }
}

/** 每条通道独立占用、保留原始回执；缓存及未知结果均不再次调用该通道。 */
async function requestReadingChannelOnce(input: KnowledgeReadingCall, prefix: string, body: Record<string, unknown>, resolveTarget: () => Gpt56CopywritingTarget, avoid = false): Promise<ReadingReply> {
  input.signal?.throwIfAborted();
  const cached = await readKnowledgeReadingJson<ReadingReply>(`${prefix}/raw.json`);
  if (cached) return cached;
  const transport = await readKnowledgeReadingJson<ReadingTransportReceipt>(`${prefix}/transport-error.json`);
  if (transport) throw new ReadingTransportError((transport.outcome === "unknown" && transport.retryable === true) || transport.outcome === "avoided");
  // 已有回执优先复用；只有真要发新请求时才因避让改走备用通道。仍尊重本通道占用：
  // 另一进程已在途时不越过它去买备用通道。「已避让」记号由调用方在备用通道成功后再落。
  if (avoid) {
    if (await readKnowledgeReadingJson<unknown>(`${prefix}/claim.json`)) throw new Error("已有阅读请求正在处理或等待对账，未重复提交；请保留任务记录");
    throw new ReadingChannelAvoidedError();
  }
  const target = resolveTarget();
  if (target.modelName !== input.model) throw new Error("备用通道模型与所选档位不一致，未提交请求");
  input.signal?.throwIfAborted();
  if (!(await claimKnowledgeReadingCall(`${prefix}/claim.json`)))
    throw new Error("已有阅读请求正在处理或等待对账，未重复提交；请保留任务记录");
  let reply: ReadingReply;
  try {
    const response = await fetch(target.apiUrl, {
      method: "POST", headers: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, model: target.modelName }),
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(240_000)]) : AbortSignal.timeout(240_000),
    });
    reply = { status: response.status, body: await response.text(), receivedAt: new Date().toISOString() };
  } catch (error) {
    // 中止属于我们这边切断传输，结果同样未知：本通道已占用不重发，但允许改走备用通道，
    // 否则恢复同任务时该批永久卡在待对账。这是传输结果未知的本地回执，不伪造供应商 raw；不保存可能含凭证的异常详情。
    const retryable = input.signal?.aborted ? true : isRetryableOpenAiGatewayError(error);
    await saveKnowledgeReadingObject(`${prefix}/transport-error.json`, Buffer.from(JSON.stringify({ outcome: "unknown", retryable, receivedAt: new Date().toISOString() })));
    if (input.signal?.aborted) throw error;
    throw new ReadingTransportError(retryable);
  }
  // 存储失败不能触发另一次购买；必须先保留原始响应，随后才解析或决定回退。
  await saveKnowledgeReadingObject(`${prefix}/raw.json`, Buffer.from(JSON.stringify(reply)));
  return reply;
}

function parseReadingReply(reply: ReadingReply, model: ActiveKnowledgeCardDistillModelId): unknown {
  if (reply.status < 200 || reply.status >= 300) throw new Error("文档阅读未成功，原始回执已保留，未自动重复购买同一通道");
  const envelope = JSON.parse(reply.body);
  if (!knowledgeReadingModelMatches(envelope.model, model)) throw new Error("阅读回执与所选档位不一致，已保留原始响应，未接受结果");
  if (envelope.choices?.[0]?.finish_reason !== "stop") throw new Error("阅读结果未完整返回，已保留原始结果，不能作为完整方案使用");
  const plain = extractFirstChoicePlainText(envelope).trim();
  if (!plain) throw new Error("阅读结果为空，未进入方案或生图");
  return JSON.parse(plain);
}

/** 图文契约不降级；EvoLink 超时后仅同一所选 Sol 模型走现有官方备用通道。 */
export async function invokeKnowledgeReadingJson(input: KnowledgeReadingCall): Promise<unknown> {
  input.signal?.throwIfAborted();
  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.text }];
  for (const image of input.images || []) {
    content.push({ type: "text", text: `下一张原页的唯一身份：${image.pageId}` });
    content.push({ type: "image_url", image_url: { url: image.url, detail: "high" } });
  }
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [{ role: "system", content: input.system }, { role: "user", content }],
    response_format: { type: "json_object" }, reasoning_effort: "xhigh", max_tokens: 32768,
  };
  if (input.model === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) {
    body.enable_thinking = true;
    body.max_completion_tokens = 32768;
    delete body.max_tokens;
  }
  const officialFallback = async () => {
    input.signal?.throwIfAborted();
    // 复用现有官方映射和服务端凭证解析；官方 GPT 使用 max_completion_tokens。
    const officialBody = { ...body, max_completion_tokens: 32768 };
    delete (officialBody as Record<string, unknown>).max_tokens;
    const reply = await requestReadingChannelOnce(input, `${input.objectPrefix}/official-fallback`, officialBody, () => {
      const target = resolveGpt56OfficialFallbackTarget(input.model);
      if (target.gateway !== "openai_official") throw new Error("官方备用通道配置不一致，未提交请求");
      return target;
    });
    return parseReadingReply(reply, input.model);
  };
  const canFallback = input.model === KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  // 官方通道已有成功回执（避让后记号未落盘、进程重启等）时直接复用，主通道不再下单；
  // 官方失败回执不短路，主通道恢复健康后仍可用。
  if (canFallback) {
    const official = await readKnowledgeReadingJson<ReadingReply>(`${input.objectPrefix}/official-fallback/raw.json`);
    // 只有能解析的官方回执才短路；截断/空内容/HTML 等不可用回执不锁死主通道。
    if (official && official.status >= 200 && official.status < 300) {
      try { return parseReadingReply(official, input.model); } catch { /* 官方回执不可用，继续走主通道 */ }
    }
  }
  let reply: ReadingReply;
  try {
    reply = await requestReadingChannelOnce(input, input.objectPrefix, body, () => {
      const apiKey = getEvolinkApiKey();
      if (!apiKey) throw new Error("文档阅读暂不可用，请稍后重试");
      const apiUrl = input.images?.length
        ? String(process.env.EVOLINK_CHAT_COMPLETIONS_URL || "https://api.evolink.ai/v1/chat/completions")
        : String(process.env.EVOLINK_DIRECT_CHAT_COMPLETIONS_URL || "https://direct.evolink.ai/v1/chat/completions");
      return { gateway: "evolink", apiUrl, apiKey, modelName: input.model };
    }, canFallback && evolinkAvoided(input.channelScope));
  } catch (error) {
    if (canFallback && error instanceof ReadingChannelAvoidedError) {
      markEvolinkUnavailable(input.channelScope);
      const result = await officialFallback();
      // 备用通道确认成功后才把主通道记为「已避让」：进程重启恢复同任务仍复用官方结果，不回头购买主通道；
      // 备用通道失败则不留记号。记号写失败不能吞掉已付费结果：官方 raw 已落盘，下次入口会先复用它。
      try {
        await saveKnowledgeReadingObject(`${input.objectPrefix}/transport-error.json`, Buffer.from(JSON.stringify({ outcome: "avoided", retryable: true, receivedAt: new Date().toISOString() })));
      } catch (markError) {
        console.warn("[knowledgeCardReading] 已避让记号写入失败，官方结果已保留：", markError instanceof Error ? markError.message : markError);
      }
      return result;
    }
    if (canFallback && error instanceof ReadingTransportError && error.retryable && !input.signal?.aborted) {
      markEvolinkUnavailable(input.channelScope);
      return officialFallback();
    }
    throw error;
  }
  const timeoutHtml = reply.status >= 200 && reply.status < 300 && /^\s*(?:<!doctype\s+html|<html)/i.test(reply.body) && /524|time[ -]?out|cloudflare/i.test(reply.body);
  if (canFallback && (isRetryableOpenAiGatewayError({ status: reply.status }) || timeoutHtml)) {
    markEvolinkUnavailable(input.channelScope);
    return officialFallback();
  }
  try {
    return parseReadingReply(reply, input.model);
  } catch (error) {
    // 主通道 2xx 但截断/空内容/档位不符：坏回执已永久保留，不再打同一通道；Sol 改走官方同模型一次，
    // 否则该批在确定性前缀下永远读不完。这不是通道故障，不进入避让。
    if (canFallback && reply.status >= 200 && reply.status < 300) return officialFallback();
    throw error;
  }
}
