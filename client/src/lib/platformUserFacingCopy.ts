/** 面向用户文案：过滤模型名、API、fallback 等内部实现细节 */

const INTERNAL_ENGINE_PATTERN =
  /EVOLINK|OPENAI|VERTEX|GPT|Gemini|gemini|gpt-|Nano Banana|GPT-IMAGE|GPT54|主模型|备用模型|备用路径|主路径|fallback|analyzeGrowthCamp|growth_analyze|Vertex|Evolink|OhMyGPT|套话快照|成长营套话|trendStore|trendstore|爬虫|爬蟲|crawler|GCS|gs:\/\/|growth-camp|Job not found|pollCount|platformAssetLite|deployment to match the model|request id:/i;

export function sanitizePlatformUserMessage(raw: string, fallback = "操作暂时不可用，请稍后重试"): string {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  if (/\(401\)|Unauthorized|登录状态已失效|未登录|session.*失效/i.test(text)) {
    return "登录状态已失效，请刷新页面重新登录后再试（分析任务可能仍在后台运行）";
  }
  // EvoLink 积分不足（402）——保留可读提示，便于用户充值
  if (/积分不足|insufficient.?quota|dashboard\/billing/i.test(text)) {
    return "上游模型账户积分不足，请充值后再试（https://evolink.ai/dashboard/billing）";
  }
  // 模型 deployment / 上游 404 —— 明确告知非积分问题；全案文案主路径为 OpenAI 官方 gpt-5.6-sol，失败改走 Evolink
  if (/模型暂不可用|非积分问题|Could not find an existing deployment|Specified model not found/i.test(text)) {
    return "文案模型暂不可用（非积分问题）；系统将尝试备用网关，请稍后重试";
  }
  // 网关 HTML / 非 JSON 被当成 JSON 解析（常见：Unexpected token 'A', "An error o"...）
  if (
    /Unexpected token|is not valid JSON|An error o|SyntaxError.*JSON|Failed to execute 'json'|Unexpected end of JSON/i.test(
      text,
    )
  ) {
    return "算力紧张或请求超时，请稍后重试";
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
