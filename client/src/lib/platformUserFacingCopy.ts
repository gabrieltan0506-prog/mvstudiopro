/** 面向用户文案：过滤模型名、API、fallback 等内部实现细节 */

const INTERNAL_ENGINE_PATTERN =
  /EVOLINK|OPENAI|VERTEX|GPT|Gemini|gemini|gpt-|Nano Banana|GPT-IMAGE|GPT54|主模型|备用模型|备用路径|主路径|fallback|analyzeGrowthCamp|growth_analyze|Vertex|Evolink|OhMyGPT|套话快照|成长营套话/i;

export function sanitizePlatformUserMessage(raw: string, fallback = "操作暂时不可用，请稍后重试"): string {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  if (INTERNAL_ENGINE_PATTERN.test(text)) return fallback;
  return text;
}

export function sanitizePlatformUserMessageOrNull(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (INTERNAL_ENGINE_PATTERN.test(text)) return null;
  return text;
}
