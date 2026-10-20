import { extractFirstChoicePlainText, extractJsonString, invokeLLM } from "../_core/llm.js";
import {
  MARKETING_PLAN_MODELS, MARKETING_PLAN_STEPS, buildMarketingPlanPrompt,
  buildMarketingIntegrationPrompt, formatMarketingIntegration, marketingIntegrationSchema,
  type MarketingPlanResult, type MarketingPlanStep, type MarketingStepResult,
} from "../../shared/marketingPlan.js";

export const MARKETING_PLAN_MAX_TOKENS = 24000;
export const MARKETING_PLAN_CALL_TIMEOUT_MS = 6 * 60_000;

export type MarketingCompletion = {
  text: string; finishReason: string; receipt: NonNullable<MarketingStepResult["receipt"]>;
};

/** 调用不自动换模型、不自动重发，推理和供应商锁沿共用服务端传输层。 */
export async function callMarketingPlanModel(input: {
  step: MarketingPlanStep; context: string; originals?: { deepseek: string; glm: string }; requestId: string;
}): Promise<MarketingCompletion> {
  const started = Date.now();
  const integrated = input.step === "integrated";
  const response = await invokeLLM({
    provider: "openai", modelName: MARKETING_PLAN_MODELS[input.step], openAiGateway: "auto",
    reasoningEffort: "high", max_tokens: MARKETING_PLAN_MAX_TOKENS,
    abortSignal: AbortSignal.timeout(MARKETING_PLAN_CALL_TIMEOUT_MS), requestId: input.requestId,
    ...(integrated ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: integrated ? buildMarketingIntegrationPrompt() : buildMarketingPlanPrompt(input.context) },
      { role: "user", content: integrated
        ? JSON.stringify({ originalRequirement: input.context, drafts: input.originals }) : input.context },
    ],
  });
  const usage = response.usage as (typeof response.usage & {
    cost?: number; completion_tokens_details?: { reasoning_tokens?: number };
  });
  return {
    text: extractFirstChoicePlainText(response), finishReason: response.choices?.[0]?.finish_reason || "",
    receipt: { id: response.id, model: response.model || MARKETING_PLAN_MODELS[input.step], provider: response.provider, elapsedMs: Date.now() - started,
      promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens, costUsd: usage?.cost },
  };
}

export type MarketingPlanDependencies = {
  call: typeof callMarketingPlanModel;
  save: (result: MarketingPlanResult) => Promise<void>;
  settle: () => Promise<number>;
};

/**
 * 可恢复的三步链。每次发送前写入running；崩溃恢复不重发未知请求。
 * 失败只保留状态，定向重试必须由用户操作把对应步骤重新置pending。
 */
export async function runMarketingPlan(
  jobId: string, saved: MarketingPlanResult, deps: MarketingPlanDependencies,
): Promise<MarketingPlanResult> {
  const result = structuredClone(saved);
  for (const step of MARKETING_PLAN_STEPS) {
    if (result.steps[step].status === "running") {
      result.steps[step] = { ...result.steps[step], status: "unknown", error: "上次请求结果尚未确认，未自动重新调用。请核对后选择仅重试此步骤。" };
      await deps.save(result);
    }
    if (result.steps[step].status !== "pending") continue;
    if (step === "integrated" && (result.steps.deepseek.status !== "succeeded" || result.steps.glm.status !== "succeeded")) continue;
    const prior = result.steps[step];
    result.steps[step] = { status: "running", attempts: (prior.attempts || 0) + 1, history: prior.history };
    await deps.save(result);
    let completion: MarketingCompletion | undefined;
    let next: MarketingStepResult;
    try {
      completion = await deps.call({ step, context: result.context, requestId: `${jobId}/${step}/${result.steps[step].attempts}`,
        ...(step === "integrated" ? { originals: { deepseek: result.steps.deepseek.text!, glm: result.steps.glm.text! } } : {}) });
      if (completion.finishReason !== "stop") throw new Error("结果未正常结束，原始返回已保留。请仅重试此步骤。");
      if (completion.text.trim().length < 80 || completion.text.length > 100000) throw new Error("返回内容为空、过短或超出保存范围，未当作完成。");
      if (step === "integrated") {
        const parsed = marketingIntegrationSchema.parse(JSON.parse(extractJsonString(completion.text)));
        next = { status: "succeeded", text: formatMarketingIntegration(parsed), adoptionBrief: parsed.adoptionBrief, receipt: completion.receipt };
      } else next = { status: "succeeded", text: completion.text, receipt: completion.receipt };
    } catch {
      next = { status: completion ? "failed" : "unknown",
        error: completion ? "返回不完整或格式不符合要求，原稿已保留；只需重试这一步。" : "请求未取得完整回执，未自动重发；其他成功结果已保留。",
        ...(completion ? { text: completion.text, receipt: completion.receipt } : {}) };
    }
    result.steps[step] = { ...next, attempts: result.steps[step].attempts, history: prior.history };
    // 保存失败必须上抛，不能捕获为模型失败后继续下一次付费请求。
    await deps.save(result);
  }
  if (MARKETING_PLAN_STEPS.every(step => result.steps[step].status === "succeeded") && result.billing !== "succeeded") {
    try {
      result.chargedCredits = await deps.settle();
      result.billing = "succeeded";
      delete result.billingError;
    } catch {
      result.billing = "failed";
      result.billingError = "三份内容已保存，结算未完成。可仅重试结算，不重新调用模型。";
    }
    await deps.save(result);
  }
  return result;
}
