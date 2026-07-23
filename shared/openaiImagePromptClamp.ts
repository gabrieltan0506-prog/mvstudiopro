/**
 * OpenAI images/generations + images/edits：prompt 上限 32000 字符。
 * 超长时优先保留尾部（分镜注入 / 画风硬锁 / 禁字尾），再保留头部摘要。
 */

export const OPENAI_IMAGE_PROMPT_MAX_CHARS = 32_000;

const TRUNCATION_MARK = "\n\n【提示过长已截断】\n";

/**
 * 将生图/改图 prompt 压到 OpenAI 上限内。已在上限内则原样返回。
 */
export function clampOpenAiImagePrompt(
  prompt: string,
  maxChars: number = OPENAI_IMAGE_PROMPT_MAX_CHARS,
): string {
  const s = String(prompt || "").trim();
  const limit = Math.max(64, Math.floor(maxChars) || OPENAI_IMAGE_PROMPT_MAX_CHARS);
  if (s.length <= limit) return s;

  const mark = TRUNCATION_MARK;
  const budget = Math.max(16, limit - mark.length);
  // 尾部权重更高：本镜分镜、硬锁、禁字通常在末段
  const tailBudget = Math.max(8, Math.min(budget - 8, Math.floor(budget * 0.72)));
  const headBudget = Math.max(0, budget - tailBudget);
  const head = s.slice(0, headBudget);
  const tail = s.slice(s.length - tailBudget);
  return `${head}${mark}${tail}`;
}
