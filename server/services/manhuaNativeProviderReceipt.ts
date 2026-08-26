import type { ManhuaNativeProviderErrorReceipt } from "../../shared/manhuaNativeModelReceipt.js";

const SENSITIVE_KEY = /^(?:authorization|proxy-authorization|api[_-]?key|apikey|cookie|set-cookie|secret|client[_-]?secret|credential|password|passwd|(?:access|refresh|id|auth)[_-]?token|token|key|signature|x-goog-signature|x-amz-signature|signed[_-]?url)$/i;
const PROVIDER_BODY_MAX_CHARS = 4_000;
const PROVIDER_TEXT_SCAN_MAX_CHARS = 64_000;
const REDACTED_CREDENTIAL = "[已移除凭证]";

const SENSITIVE_ASSIGNMENT_KEY = [
  "authorization",
  "proxy[-_]?authorization",
  "api[-_]?key",
  "apikey",
  "client[-_]?secret",
  "secret",
  "credential",
  "password",
  "passwd",
  "(?:access|refresh|id|auth)[-_]?token",
  "token",
  "key",
  "signature",
  "x-goog-signature",
  "x-amz-signature",
].join("|");
const SENSITIVE_ASSIGNMENT = new RegExp(
  `((?:^|[\\s,;{(?&#])(?:["']?)(?:${SENSITIVE_ASSIGNMENT_KEY})(?:["']?)\\s*[:=]\\s*)`
    + `(?!\\[已移除(?:凭证|访问参数)\\])(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;}&\\]\\)]+)`,
  "gi",
);

const SENSITIVE_URL_PARAM = /^(?:x-(?:goog|amz)-.+|awsaccesskeyid|signature|sig|api[_-]?key|apikey|key|(?:access|refresh|id|auth)[_-]?token|token|secret|credential)$/i;

function sanitizeProviderUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const sanitizeParams = (raw: string, prefix: "?" | "#"): string => {
      if (!raw) return "";
      const value = raw.slice(1).split("&").map((part) => {
        const separator = part.indexOf("=");
        const rawName = separator >= 0 ? part.slice(0, separator) : part;
        let name = rawName;
        try {
          name = decodeURIComponent(rawName.replace(/\+/g, " "));
        } catch {
          // 非法编码按原名继续判断；后续不会把值解码进日志。
        }
        return SENSITIVE_URL_PARAM.test(name)
          ? `${rawName}=[已移除访问参数]`
          : part;
      }).join("&");
      return value ? `${prefix}${value}` : "";
    };
    return `${parsed.origin}${parsed.pathname}`
      + sanitizeParams(parsed.search, "?")
      + sanitizeParams(parsed.hash, "#");
  } catch {
    return "[已移除外部地址]";
  }
}

function sanitizeProviderText(value: string): string {
  const truncated = value.length > PROVIDER_TEXT_SCAN_MAX_CHARS;
  let text = value.slice(0, PROVIDER_TEXT_SCAN_MAX_CHARS);
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, sanitizeProviderUrl);
  // Authorization 的值可能是 Bearer/Basic，也可能直接是一段 token；只替换值本身。
  text = text.replace(
    /(\b(?:proxy[-_])?authorization\b\s*[:=]\s*)(?:(?:bearer|basic)\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
    `$1${REDACTED_CREDENTIAL}`,
  );
  text = text.replace(
    /\bbearer\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[A-Za-z0-9._~+/=-]+)/gi,
    `Bearer ${REDACTED_CREDENTIAL}`,
  );
  // Cookie 名称可变，因此只在明确的 Cookie/Set-Cookie 片段内逐个遮盖 name=value。
  text = text.replace(
    /(\b(?:set-)?cookie\b\s*[:=]\s*)([^\r\n]*)/gi,
    (_whole, prefix: string, cookieText: string) => `${prefix}${cookieText.replace(
      /(^|;\s*)([A-Za-z0-9_.-]+)\s*=\s*(?:"[^"\r\n;]*"|'[^'\r\n;]*'|[^\s,;}]+)/g,
      (_pair, separator: string, name: string) => `${separator}${name}=${REDACTED_CREDENTIAL}`,
    )}`,
  );
  text = text.replace(
    SENSITIVE_ASSIGNMENT,
    (_whole, prefix: string) => `${prefix}${REDACTED_CREDENTIAL}`,
  );
  return `${text}${truncated ? "[内容已截断]" : ""}`;
}

export type ErrorWithNativeProviderReceipt = Error & {
  nativeProviderError?: ManhuaNativeProviderErrorReceipt;
};

function sanitizeProviderValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 12) return "[层级过深]";
  if (SENSITIVE_KEY.test(key)) return REDACTED_CREDENTIAL;
  if (typeof value === "string") {
    return sanitizeProviderText(value);
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
  const row = error as (ErrorWithNativeProviderReceipt & {
    code?: unknown;
    cause?: unknown;
  }) | null;
  if (row?.nativeProviderError) return row.nativeProviderError;

  // Node fetch/Undici 把真正网络原因放在 `error.cause`；只记顶层 message 会把
  // UND_ERR_HEADERS_TIMEOUT、ECONNRESET 等全部压成一句无用的 `fetch failed`。
  // 这里只摘取可操作的分类字段，并继续经过统一脱敏，不保存请求 URL 或请求体。
  const cause = row?.cause && typeof row.cause === "object"
    ? row.cause as { name?: unknown; code?: unknown; message?: unknown }
    : undefined;
  if (!cause && !row?.code) return undefined;
  const code = firstText(256, cause?.code, row?.code);
  const message = firstText(2_000, cause?.message, row?.message);
  const type = firstText(256, cause?.name, row?.name);
  if (!code && !message && !type) return undefined;
  return { code, message, type };
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
