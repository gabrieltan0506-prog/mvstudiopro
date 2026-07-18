/**
 * 动效 PPT 页面清单：GPT-5.6 Sol 生成文案与图表数据（方案 A）。
 */
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm";
import {
  getPlatformStage2OpenAiModel,
  resolvePlatformStage2OpenAiReasoningEffort,
} from "../config/platformSwitches";
import { resolveGemini35FlashCopywritingMaxOutputTokens } from "./gemini35FlashRuntime";
import {
  HTML_PPT_OUTLINE_CAPACITY_MESSAGE,
  buildHtmlPptOutlineSystemPrompt,
  buildHtmlPptOutlineUserPrompt,
  parseHtmlPptOutlineJson,
  type HtmlPptOutlineLlmInput,
  type HtmlPptOutlineLlmResult,
} from "../../shared/htmlPptOutlinePrompt.js";
import type { HtmlPptStyleId } from "../../shared/htmlPptMaker.js";

export { HTML_PPT_OUTLINE_CAPACITY_MESSAGE };

async function invokeOutlineViaGpt56(
  userBlock: string,
  reasoningEffort: "low" | "minimal",
): Promise<string> {
  const hasKey = Boolean(
    String(process.env.OPENAI_API_KEY || "").trim() || String(process.env.EVOLINK_API_KEY || "").trim(),
  );
  if (!hasKey) {
    throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
  }
  const response = await invokeLLM({
    provider: "openai",
    modelName: getPlatformStage2OpenAiModel(),
    reasoningEffort,
    max_tokens: resolveGemini35FlashCopywritingMaxOutputTokens(),
    temperature: 0.75,
    messages: [
      { role: "system", content: buildHtmlPptOutlineSystemPrompt() },
      { role: "user", content: userBlock },
    ],
    response_format: { type: "json_object" },
  });
  return extractFirstChoicePlainText(response).trim();
}

export async function generateHtmlPptOutline(
  input: HtmlPptOutlineLlmInput,
): Promise<HtmlPptOutlineLlmResult & { model: string }> {
  const title = String(input.title || "").trim();
  if (title.length < 2) throw new Error("请填写主题");
  const pageCount = Math.max(3, Math.min(16, Math.floor(input.pageCount || 8)));
  const styleId = (input.styleId || "dark_research") as HtmlPptStyleId;
  const userBlock = buildHtmlPptOutlineUserPrompt({
    title,
    purposeZh: input.purposeZh,
    pageCount,
    styleId,
    briefZh: input.briefZh,
  });

  const primaryReasoning =
    resolvePlatformStage2OpenAiReasoningEffort() === "high" ||
    resolvePlatformStage2OpenAiReasoningEffort() === "xhigh"
      ? "low"
      : (resolvePlatformStage2OpenAiReasoningEffort() as "low" | "minimal");

  let lastError: unknown;
  for (const reasoningEffort of [primaryReasoning, "minimal"] as const) {
    try {
      const raw = await invokeOutlineViaGpt56(userBlock, reasoningEffort);
      const parsed = parseHtmlPptOutlineJson(raw, { pageCount });
      return { ...parsed, model: getPlatformStage2OpenAiModel() };
    } catch (err) {
      lastError = err;
      console.warn(
        `[generateHtmlPptOutline] GPT-5.6 失败 (reasoning=${reasoningEffort}):`,
        err instanceof Error ? err.message.slice(0, 240) : err,
      );
    }
  }

  console.warn(
    "[generateHtmlPptOutline] 全部失败:",
    lastError instanceof Error ? lastError.message.slice(0, 240) : lastError,
  );
  throw new Error(HTML_PPT_OUTLINE_CAPACITY_MESSAGE);
}
