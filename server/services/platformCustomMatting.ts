/**
 * 1113：平台页「自定义抠像」已下线并删除生成链路；本文件只保留中文描述英文化，
 * 供创作顾问问答出图（platformSkillQa）沿用（领域 strategicCoverDirector，经 runGemini31ProPreviewText）。
 */
import { appendImageFlowLog } from "./proxyImageService.js";
import { runGemini31ProPreviewText } from "./geminiPlatformCompositeTranslation.js";

export async function translateMattingUserPromptToEnglish(userPrompt: string, flowLog?: string[]): Promise<string> {
  const raw = String(userPrompt || "").trim();
  if (!raw) return "";
  const hasCjk = /[\u4e00-\u9fff]/.test(raw);
  if (!hasCjk) {
    appendImageFlowLog(flowLog, "[自定义抠像] 用户提示词已为英文，跳过翻译");
    return raw;
  }
  appendImageFlowLog(flowLog, "[自定义抠像] 中文提示词 → Gemini 英文化");
  const task = [
    "Translate the following user description into concise English for an AI image generation prompt.",
    "Preserve subject identity, pose (e.g. sitting, standing), clothing, and props on the subject.",
    "If the user asks for background removal / isolated subject, omit background scenery in translation.",
    "If the user describes a scene (beach, study room), keep that background.",
    "Output English only, no markdown.",
    "",
    raw,
  ].join("\n");
  try {
    const english = String(await runGemini31ProPreviewText(task)).trim();
    if (english.length >= 8) return english;
  } catch (e: unknown) {
    appendImageFlowLog(flowLog, `[自定义抠像] 翻译失败，回退原文：${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  return raw;
}
