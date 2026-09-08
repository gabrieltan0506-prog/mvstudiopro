import { getEvolinkApiKey, resolveGpt56OfficialFallbackTarget, type Gpt56CopywritingTarget } from "./gpt56CopywritingGateway.js";
import { extractFirstChoicePlainText, isRetryableOpenAiGatewayError } from "../_core/llm.js";
import { KNOWLEDGE_CARD_DISTILL_MODEL_QWEN, KNOWLEDGE_CARD_DISTILL_MODEL_SOL, type ActiveKnowledgeCardDistillModelId } from "../../shared/knowledgeCardDistillModels.js";
import { claimKnowledgeReadingCall, readKnowledgeReadingJson, saveKnowledgeReadingObject } from "./knowledgeCardReadingStore.js";

type ReadingReply = { status: number; body: string; receivedAt: string };
type ReadingTransportReceipt = { retryable: boolean; receivedAt: string; outcome: "unknown" };
export type KnowledgeReadingCall = {
  objectPrefix: string;
  model: ActiveKnowledgeCardDistillModelId;
  system: string;
  text: string;
  images?: Array<{ pageId: string; url: string }>;
  signal?: AbortSignal;
};

class ReadingTransportError extends Error {
  constructor(readonly retryable: boolean) {
    super("阅读通道未返回完整响应，原请求结果待对账，未重复提交同一通道");
  }
}

/** 每条通道独立占用、保留原始回执；缓存及未知结果均不再次调用该通道。 */
async function requestReadingChannelOnce(input: KnowledgeReadingCall, prefix: string, body: Record<string, unknown>, resolveTarget: () => Gpt56CopywritingTarget): Promise<ReadingReply> {
  input.signal?.throwIfAborted();
  const cached = await readKnowledgeReadingJson<ReadingReply>(`${prefix}/raw.json`);
  if (cached) return cached;
  const transport = await readKnowledgeReadingJson<ReadingTransportReceipt>(`${prefix}/transport-error.json`);
  if (transport) throw new ReadingTransportError(transport.outcome === "unknown" && transport.retryable === true);
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
    const retryable = !input.signal?.aborted && isRetryableOpenAiGatewayError(error);
    // 这是传输结果未知的本地回执，不伪造供应商 raw；不保存可能含凭证的异常详情。
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
  if (envelope.model !== model) throw new Error("阅读回执与所选档位不一致，已保留原始响应，未接受结果");
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
  let reply: ReadingReply;
  try {
    reply = await requestReadingChannelOnce(input, input.objectPrefix, body, () => {
      const apiKey = getEvolinkApiKey();
      if (!apiKey) throw new Error("文档阅读暂不可用，请稍后重试");
      const apiUrl = input.images?.length
        ? String(process.env.EVOLINK_CHAT_COMPLETIONS_URL || "https://api.evolink.ai/v1/chat/completions")
        : String(process.env.EVOLINK_DIRECT_CHAT_COMPLETIONS_URL || "https://direct.evolink.ai/v1/chat/completions");
      return { gateway: "evolink", apiUrl, apiKey, modelName: input.model };
    });
  } catch (error) {
    if (input.model === KNOWLEDGE_CARD_DISTILL_MODEL_SOL && error instanceof ReadingTransportError && error.retryable && !input.signal?.aborted)
      return officialFallback();
    throw error;
  }
  const timeoutHtml = reply.status >= 200 && reply.status < 300 && /^\s*(?:<!doctype\s+html|<html)/i.test(reply.body) && /524|time[ -]?out|cloudflare/i.test(reply.body);
  if (input.model === KNOWLEDGE_CARD_DISTILL_MODEL_SOL && (isRetryableOpenAiGatewayError({ status: reply.status }) || timeoutHtml))
    return officialFallback();
  return parseReadingReply(reply, input.model);
}
