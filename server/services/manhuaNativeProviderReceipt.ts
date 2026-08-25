import type { ManhuaNativeProviderErrorReceipt } from "../../shared/manhuaNativeModelReceipt.js";

const SENSITIVE_KEY = /(?:authorization|api[_-]?key|cookie|secret|credential|access[_-]?token|signed[_-]?url)/i;
const PROVIDER_BODY_MAX_CHARS = 4_000;

export type ErrorWithNativeProviderReceipt = Error & {
  nativeProviderError?: ManhuaNativeProviderErrorReceipt;
};

function sanitizeProviderValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 12) return "[层级过深]";
  if (SENSITIVE_KEY.test(key)) return "[已移除凭证]";
  if (typeof value === "string") {
    return value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}${parsed.search ? "?[已移除访问参数]" : ""}`;
      } catch {
        return "[已移除外部地址]";
      }
    });
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeProviderValue(item, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, sanitizeProviderValue(child, childKey, depth + 1)]));
  }
  return value;
}

function firstText(maxChars: number, ...values: unknown[]): string | undefined {
  for (const value of values) {
    const sanitized = sanitizeProviderValue(value);
    const text = typeof sanitized === "string" || typeof sanitized === "number"
      ? String(sanitized).trim()
      : "";
    if (text) return text.slice(0, maxChars);
  }
  return undefined;
}

export function parseNativeProviderErrorReceipt(input: {
  httpStatus?: number;
  responseText?: string;
  requestId?: string;
}): ManhuaNativeProviderErrorReceipt {
  const text = String(input.responseText || "").trim();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text ? { message: text } : undefined;
  }
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const error = root.error && typeof root.error === "object" && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : root;
  const sanitized = parsed === undefined ? undefined : sanitizeProviderValue(parsed);
  const responseBody = sanitized === undefined
    ? undefined
    : JSON.stringify(sanitized).slice(0, PROVIDER_BODY_MAX_CHARS);
  return {
    httpStatus: Number.isFinite(Number(input.httpStatus)) ? Number(input.httpStatus) : undefined,
    code: firstText(256, error.code, root.code, error.status, root.status),
    message: firstText(2_000, error.message, root.message, error.detail, root.detail),
    requestId: firstText(
      256,
      input.requestId,
      error.request_id,
      error.requestId,
      root.request_id,
      root.requestId,
      root.id,
    ),
    param: firstText(512, error.param, error.parameter, root.param, root.parameter),
    type: firstText(256, error.type, root.type),
    responseBody,
  };
}

export function errorWithNativeProviderReceipt(
  message: string,
  receipt: ManhuaNativeProviderErrorReceipt,
): ErrorWithNativeProviderReceipt {
  return Object.assign(new Error(message), { nativeProviderError: receipt });
}

export function nativeProviderReceiptFromError(
  error: unknown,
): ManhuaNativeProviderErrorReceipt | undefined {
  const row = error as ErrorWithNativeProviderReceipt | null;
  return row?.nativeProviderError;
}

export function formatNativeProviderErrorZh(
  serviceZh: string,
  receipt: ManhuaNativeProviderErrorReceipt,
): string {
  return [
    `${serviceZh}${receipt.httpStatus ? ` HTTP ${receipt.httpStatus}` : ""}`,
    receipt.code ? `code=${receipt.code}` : "",
    receipt.message || "",
    receipt.requestId ? `request_id=${receipt.requestId}` : "",
    receipt.param ? `param=${receipt.param}` : "",
  ].filter(Boolean).join(" · ");
}
