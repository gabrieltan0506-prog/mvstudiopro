/**
 * **Gemini API** `generateContent`（`GEMINI_API_KEY`），默认 **gemini-3.5-flash**。
 * 历史文件名保留；不再走 Vertex IAM REST。
 */
import {
  callGemini35FlashCopywriting,
  resolveGemini35FlashCopywritingMaxOutputTokens,
  resolveGemini35FlashModelName,
} from "./gemini35FlashRuntime.js";

export async function vertexGemini3FlashGenerateContent(
  prompt: string,
  cfg?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): Promise<string> {
  void cfg?.signal;
  const model = resolveGemini35FlashModelName();
  return callGemini35FlashCopywriting({
    taskSystemInstruction:
      "你是专业助手。根据用户提示给出准确、完整的回答；使用简体中文，除非用户要求其他语言。",
    userText: prompt,
    responseMimeType: "text/plain",
    maxOutputTokens: resolveGemini35FlashCopywritingMaxOutputTokens(cfg?.maxOutputTokens),
    temperature: cfg?.temperature ?? 0.8,
    modelName: model,
  });
}
