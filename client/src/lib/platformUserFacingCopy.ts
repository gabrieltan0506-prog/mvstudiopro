/** 面向用户文案：过滤模型名、API、fallback 等内部实现细节 */

const INTERNAL_ENGINE_PATTERN =
  /EVOLINK|OPENAI|VERTEX|GPT|Gemini|gemini|gpt-|Nano Banana|GPT-IMAGE|GPT54|主模型|备用模型|备用路径|主路径|fallback|analyzeGrowthCamp|growth_analyze|Vertex|Evolink|OhMyGPT|套话快照|成长营套话|trendStore|trendstore|爬虫|爬蟲|crawler|GCS|gs:\/\/|growth-camp|Job not found|pollCount|platformAssetLite/i;

export function sanitizePlatformUserMessage(raw: string, fallback = "操作暂时不可用，请稍后重试"): string {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  if (/\(401\)|Unauthorized|登录状态已失效|未登录|session.*失效/i.test(text)) {
    return "登录状态已失效，请刷新页面重新登录后再试（分析任务可能仍在后台运行）";
  }
  if (INTERNAL_ENGINE_PATTERN.test(text)) return fallback;
  return text;
}

export function sanitizePlatformUserMessageOrNull(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (INTERNAL_ENGINE_PATTERN.test(text)) return null;
  return text;
}
