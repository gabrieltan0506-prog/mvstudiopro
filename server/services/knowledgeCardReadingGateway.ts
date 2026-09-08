import { getEvolinkApiKey } from "./gpt56CopywritingGateway.js";
import { extractFirstChoicePlainText } from "../_core/llm.js";
import { KNOWLEDGE_CARD_DISTILL_MODEL_QWEN, type ActiveKnowledgeCardDistillModelId } from "../../shared/knowledgeCardDistillModels.js";
import { claimKnowledgeReadingCall, readKnowledgeReadingJson, saveKnowledgeReadingObject } from "./knowledgeCardReadingStore.js";

type ReadingReply = { status: number; body: string; receivedAt: string };
export type KnowledgeReadingCall = {
  objectPrefix: string;
  model: ActiveKnowledgeCardDistillModelId;
  system: string;
  text: string;
  images?: Array<{ pageId: string; url: string }>;
  signal?: AbortSignal;
};

/** 已有通道的专用图文调用：不裁图、不复用OCR压缩指令，原始响应先于任何解析永久落盘。 */
export async function invokeKnowledgeReadingJson(input: KnowledgeReadingCall): Promise<unknown> {
  input.signal?.throwIfAborted();
  let reply = await readKnowledgeReadingJson<ReadingReply>(`${input.objectPrefix}/raw.json`);
  if (!reply) {
    const key = getEvolinkApiKey();
    if (!key) throw new Error("文档阅读暂不可用，请稍后重试");
    if (!(await claimKnowledgeReadingCall(`${input.objectPrefix}/claim.json`))) {
      throw new Error("已有阅读请求正在处理或等待对账，未重复提交；请保留任务记录");
    }
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
    const url = input.images?.length
      ? String(process.env.EVOLINK_CHAT_COMPLETIONS_URL || "https://api.evolink.ai/v1/chat/completions")
      : String(process.env.EVOLINK_DIRECT_CHAT_COMPLETIONS_URL || "https://direct.evolink.ai/v1/chat/completions");
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(240_000)]) : AbortSignal.timeout(240_000),
    });
    reply = { status: response.status, body: await response.text(), receivedAt: new Date().toISOString() };
    await saveKnowledgeReadingObject(`${input.objectPrefix}/raw.json`, Buffer.from(JSON.stringify(reply)));
  }
  if (reply.status < 200 || reply.status >= 300) throw new Error("文档阅读未成功，原始回执已保留，未自动重复购买");
  const envelope = JSON.parse(reply.body);
  if (envelope.model !== input.model) throw new Error("阅读回执与所选档位不一致，已保留原始响应，未接受结果");
  if (envelope.choices?.[0]?.finish_reason !== "stop") throw new Error("阅读结果未完整返回，已保留原始结果，不能作为完整方案使用");
  const plain = extractFirstChoicePlainText(envelope).trim();
  if (!plain) throw new Error("阅读结果为空，未进入方案或生图");
  return JSON.parse(plain);
}
