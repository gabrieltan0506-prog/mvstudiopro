/** 只在当前页面内存中保留失败摘要；不记录请求参数、Cookie、认证头或完整响应。 */
export type ApiDebugError = {
  id: number;
  time: string;
  stage: string;
  endpoint: string;
  message: string;
  status?: number;
  contentType?: string;
};
let sequence = 0;
let entries: ApiDebugError[] = [];
const listeners = new Set<() => void>();
export const getApiDebugErrors = () => entries;
export const subscribeApiDebugErrors = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const clearApiDebugErrors = () => {
  entries = [];
  listeners.forEach(listener => listener());
};

export function redactApiDebugText(value: unknown): string {
  return String(value ?? "")
    .replace(/\b(?:https?:\/\/|gs:\/\/|s3:\/\/)[^\s<>"'`]+/gi, "[链接已脱敏]")
    .replace(/(["']?(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\n,}]+)/gi, "$1[已脱敏]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已脱敏]")
    .replace(/\b(?:sk|AIza)[-_A-Za-z0-9]{12,}/g, "[密钥已脱敏]")
    .slice(0, 1500);
}

function endpointOnly(value: unknown): string {
  // 只保留接口名，查询字符串里可能包含完整输入或签名。
  const raw = String(value ?? "未知接口");
  try {
    const url = new URL(raw, "https://local.invalid");
    const path = url.pathname.match(/\/api\/trpc\/([a-zA-Z0-9_.,-]+)$/)?.[1];
    return path || (/^[a-zA-Z0-9_.,-]+$/.test(raw) ? raw : "非tRPC接口");
  } catch { return "未知接口"; }
}

export function recordApiDebugError(input: Omit<ApiDebugError, "id" | "time">) {
  const row: ApiDebugError = {
    id: ++sequence, time: new Date().toISOString(),
    stage: redactApiDebugText(input.stage), endpoint: endpointOnly(input.endpoint),
    message: redactApiDebugText(input.message), status: input.status,
    contentType: input.contentType ? redactApiDebugText(input.contentType) : undefined,
  };
  entries = [row, ...entries].slice(0, 30);
  listeners.forEach(listener => listener());
}

export function recordTrpcDebugError(error: unknown, key: unknown, stage: string) {
  const e = error as { message?: string; data?: { httpStatus?: number }; meta?: { response?: Response } };
  const parts = Array.isArray(key) ? key[0] : undefined;
  const endpoint = Array.isArray(parts) ? parts.filter(p => typeof p === "string").join(".") : "未知接口";
  recordApiDebugError({ stage, endpoint, message: e?.message || String(error),
    status: e?.data?.httpStatus ?? e?.meta?.response?.status,
    contentType: e?.meta?.response?.headers?.get("content-type") || undefined });
}

async function responseSummary(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "响应正文为空";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < 8192) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true }).slice(0, 8192 - text.length);
    }
  } finally { void reader.cancel().catch(() => {}); }
  if (!text.trim()) return "响应正文为空";
  if (/^\s*</.test(text)) {
    // 不保存HTML正文、脚本或隐藏字段，仅提取错误页标题及已知网关代码。
    const title = text.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1];
    const code = text.match(/\b(?:FUNCTION_INVOCATION_TIMEOUT|FUNCTION_INVOCATION_FAILED|DEPLOYMENT_NOT_FOUND|Vercel Security Checkpoint|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i)?.[0];
    return `接口返回HTML，不能作为JSON解析${title ? `；页面标题：${title}` : ""}${code ? `；错误标识：${code}` : ""}`;
  }
  try {
    const body = JSON.parse(text);
    const list = Array.isArray(body) ? body : [body];
    return list.map(item => item?.error?.json?.message || item?.error?.message || item?.message)
      .filter(v => typeof v === "string").join("；") || "接口返回错误状态，正文没有可公开的错误消息";
  } catch { return "接口返回非JSON正文，未保存原始页面内容"; }
}

/** 包裹现有传输，保留响应原对象及失败语义，不额外重试或提交。 */
export async function withApiDebugFetch(input: RequestInfo | URL, send: () => Promise<Response>): Promise<Response> {
  const endpoint = input instanceof Request ? input.url : String(input);
  try {
    const response = await send();
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/\bjson\b/i.test(contentType)) {
      recordApiDebugError({ stage: "HTTP响应", endpoint, status: response.status, contentType,
        message: /html/i.test(contentType) ? "接口返回HTML，前端需要JSON；具体来源尚待后台日志确认" : `HTTP ${response.status}；响应类型：${contentType || "未提供"}` });
      void responseSummary(response.clone()).then(message => recordApiDebugError({
        stage: "响应错误摘要", endpoint, status: response.status, contentType, message,
      })).catch(() => {});
    }
    return response;
  } catch (error) {
    recordApiDebugError({ stage: "网络连接", endpoint, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
