/** OpenRouter 通用认证；只在服务端读取密钥，禁止进入日志或错误消息。 */
export function getOpenRouterApiKey(): string {
  const raw = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!raw || !/^sk-[A-Za-z0-9]/.test(raw)) return "";
  return raw;
}

export function buildOpenRouterAuthHeaders(apiKey: string): Record<string, string> {
  const referer = String(
    process.env.OPENROUTER_HTTP_REFERER
      || process.env.APP_URL
      || "https://www.mvstudiopro.com",
  )
    .trim()
    .replace(/\/+$/, "");
  const title = String(process.env.OPENROUTER_APP_TITLE || "MV Studio Pro").trim()
    || "MV Studio Pro";
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": referer || "https://www.mvstudiopro.com",
    "X-Title": title,
    "X-OpenRouter-Title": title,
  };
}
