/**
 * 管理者专用 Pro Agent 多轮对话：Responses API · reasoning.mode=pro。
 * 不计用户免费额度、不扣积分。
 */
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches.js";
import { invokeGpt56ResponsesText } from "./gpt56ResponsesClient.js";

export type ProAgentMessage = { role: "user" | "assistant"; content: string };

const PRO_AGENT_INSTRUCTIONS = `你是 mvstudiopro 内部产品参谋（管理者专用 Pro Agent）。
用简洁中文回答；可讨论平台选题、Skill 池、趋势库用法、信息架构与运维口径。
禁止编造未给出的成交额/精确搜索量；不确定就标明假设。
不要输出代码围栏包裹的整站重构；给可执行建议即可。`;

export async function chatPlatformProAgent(params: {
  messages: ProAgentMessage[];
  abortSignal?: AbortSignal;
}): Promise<{ reply: string; via: string }> {
  const trimmed = (params.messages || [])
    .map((m) => ({
      role: m.role,
      content: String(m.content || "").trim().slice(0, 6000),
    }))
    .filter((m) => m.content.length > 0)
    .slice(-16);
  if (!trimmed.length) throw new Error("请先输入消息");

  const transcript = trimmed
    .map((m) => `${m.role === "user" ? "管理者" : "Pro"}：${m.content}`)
    .join("\n\n");

  const text = await invokeGpt56ResponsesText({
    instructions: PRO_AGENT_INSTRUCTIONS,
    input: `以下为多轮对话（由旧到新）。请只回复下一轮助手回答，不要复述整段历史。\n\n${transcript}`,
    modelName: getPlatformStage2OpenAiModel(),
    reasoningMode: "pro",
    reasoningEffort: "medium",
    store: false,
    abortSignal: params.abortSignal,
    timeoutMs: 180_000,
  });
  const reply = String(text || "").trim();
  if (!reply) throw new Error("Pro Agent 返回空内容");
  return { reply: reply.slice(0, 12000), via: "responses_pro" };
}
