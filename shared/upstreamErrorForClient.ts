/**
 * 上游报错回给前台前的统一脱敏（product-guardrails 一「前台零技术泄漏」）。
 *
 * - 去地址：http(s) / gs:// / s3:// 链接、Vertex `projects/<id>/locations/...` 资源路径
 * - 去凭证痕迹：Bearer 令牌、key= / token= / signature= 查询参数、sk- 开头的密钥样式串
 * - 去模型 / 通道 / 供应商 / 云厂商名：统一换成「生成服务」（Seedance 例外，站长 1110 允许界面保留）
 * - 截断：默认 200 字
 *
 * 原文只写服务端日志（见 logAndSanitizeUpstreamError），不进响应体。
 * 与前端 client/src/lib/maskMediaUrls.ts 的 maskMediaProviderDetails 同一思路，这里是服务端出口版。
 */

const URL_PATTERN = /(?:https?:\/\/|gs:\/\/|s3:\/\/|www\.)[^\s<>"'`，。；！？）】\]]+/gi;
const RESOURCE_PATH_PATTERN = /\bprojects\/[^\s/"']+(?:\/[^\s"']*)?/gi;
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|key|token|access[_-]?token|signature|x-goog-signature|sig)=[^\s&"']+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
];
/** 模型 / 通道 / 供应商 / 云厂商名（大小写不敏感）；Seedance 不在表内。 */
const VENDOR_PATTERN = new RegExp(
  [
    "gemini(?:[-\\s]*\\d+(?:\\.\\d+)*)?(?:[-\\s]*(?:flash|pro|lite|preview|image))*",
    "gpt[-\\s]*(?:image[-\\s]*)?\\d*(?:\\.\\d+)*(?:[-\\s]*(?:sol|terra|mini|pro))?",
    "openai",
    "sunburst",
    "flare",
    "deepseek(?:[-\\s]*v?\\d+(?:\\.\\d+)*)?(?:[-\\s]*flash)?",
    "glm(?:[-\\s]*\\d+(?:\\.\\d+)*)?(?:[-\\s]*flashx?)?",
    "qwen\\w*",
    "kimi",
    "evolink",
    "openrouter",
    "wavespeed(?:\\s*ai)?",
    "byteplus",
    "volcengine",
    "minimax",
    "hailuo(?:[-\\s]*\\d+)?",
    "happy\\s*horse(?:[-\\s]*\\d+(?:\\.\\d+)*)?",
    "happyhorse(?:[-\\s]*\\d+(?:\\.\\d+)*)?",
    "\\bwan[-\\s]*\\d+(?:\\.\\d+)*",
    "vertex(?:\\s*ai)?",
    "google(?:\\s*cloud)?",
    "anthropic",
    "claude",
    "kling",
    "可灵",
    "jimeng",
    "即梦",
    "suno(?:[-\\s]*v?\\d+(?:\\.\\d+)*)?",
    "udio",
    "nano\\s*banana(?:\\s*(?:pro|2))?",
    "\\bveo\\b",
    "omnihuman(?:[-\\s]*\\d+)?",
    "tripo",
    "replicate",
    "fal\\.ai",
    "vercel",
    "cloud\\s*run",
    "\\bfly(?:\\.io)?\\b",
    "百炼",
    "阿里云",
    "\\bh3\\b",
  ].join("|"),
  "gi",
);

export const UPSTREAM_ERROR_CLIENT_MAX_CHARS = 200;

export type SanitizeUpstreamErrorOptions = {
  /** 脱敏后为空时给的业务友好句。 */
  fallback?: string;
  maxChars?: number;
};

function rawText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Error) return value.message || "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** 把上游原文脱敏成可回给前台的短句；不会抛错。 */
export function sanitizeUpstreamErrorForClient(value: unknown, options: SanitizeUpstreamErrorOptions = {}): string {
  const fallback = options.fallback ?? "服务暂时不可用，请稍后重试";
  const maxChars = Math.max(1, options.maxChars ?? UPSTREAM_ERROR_CLIENT_MAX_CHARS);
  let text = rawText(value);
  for (const pattern of CREDENTIAL_PATTERNS) text = text.replace(pattern, "[已隐藏]");
  text = text
    .replace(URL_PATTERN, "[链接已隐藏]")
    .replace(RESOURCE_PATH_PATTERN, "[资源已隐藏]")
    .replace(VENDOR_PATTERN, "生成服务")
    // 连续替换后的「生成服务 生成服务」「生成服务/生成服务」合并成一个
    .replace(/生成服务(?:[\s/·:：,，_-]*生成服务)+/g, "生成服务")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  const chars = Array.from(text);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : text;
}

/** 原文进服务端日志（截 2000 字），返回脱敏后的前台文案。 */
export function logAndSanitizeUpstreamError(
  tag: string,
  value: unknown,
  options: SanitizeUpstreamErrorOptions = {},
): string {
  const raw = rawText(value);
  if (raw) console.error(`[${tag}] upstream error (raw, server log only):`, raw.slice(0, 2000));
  return sanitizeUpstreamErrorForClient(raw, options);
}
