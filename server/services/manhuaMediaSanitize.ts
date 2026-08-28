/**
 * 漫剧管线统一脱敏（PR1325 第一节）：任何要进日志/错误链/摘要 JSON 的文本
 * 必须先过 sanitizeSensitiveText。遮蔽范围：
 *   - Cookie / Set-Cookie 头与值；
 *   - Authorization 头（含 Bearer/Basic token）；
 *   - DOUYIN_COOKIE 环境变量的字面值与赋值串；
 *   - GCS V4 签名查询参数（X-Goog-Signature 等）；
 *   - 带查询串的 https 媒体签名 URL（砍到主机，查询串绝不外泄）；
 *   - 换行/制表符压平，总长限 300。
 * describeErrorChain 沿 cause 链逐层输出 name/code/message，全部经脱敏。
 */

const REDACTED = "<REDACTED>";
const MAX_LENGTH = 300;

const GOOG_SIGNED_PARAM = /([?&]?)(x-goog-(?:signature|credential|date|expires|signedheaders|algorithm))=[^&\s"'）)】\]，,；;]*/gi;

export function sanitizeSensitiveText(value: unknown): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (value instanceof Error) {
    text = value.message;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else if (value === null || value === undefined) {
    text = "";
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }

  // 1. DOUYIN_COOKIE 环境值按字面整体替换（最优先，防止被别的规则截断后残留）。
  const envCookie = String(process.env.DOUYIN_COOKIE || "").trim();
  if (envCookie.length >= 4) {
    text = text.split(envCookie).join(REDACTED);
  }

  // 2. 带查询串的 https 媒体/签名 URL：砍到主机，查询串与路径一并丢弃。
  text = text.replace(
    /https?:\/\/([^\s/?"'<>]+)[^\s"'<>]*\?[^\s"'<>]*/gi,
    (_match, host: string) => `https://${host}${REDACTED}`,
  );

  // 3. GCS V4 签名参数（可能出现在 URL 之外的报文片段里）。
  text = text.replace(GOOG_SIGNED_PARAM, (_match, prefix: string, key: string) => `${prefix}${key}=${REDACTED}`);

  // 4. Cookie / Set-Cookie 头：值可含分号与空格，整段砍到行尾。
  text = text.replace(/\b(set-cookie|cookie)\s*[:=][^\r\n]*/gi, (_match, key: string) => `${key}:${REDACTED}`);

  // 5. Authorization 头与裸 Bearer/Basic token。
  text = text.replace(/\bauthorization\s*[:=]\s*[^\r\n]*/gi, `Authorization:${REDACTED}`);
  text = text.replace(/\b(bearer|basic)\s+[a-z0-9._~+/=-]{4,}/gi, (_match, scheme: string) => `${scheme} ${REDACTED}`);

  // 6. DOUYIN_COOKIE 赋值串（值与 env 不同时也不放行）。
  text = text.replace(/\bDOUYIN_COOKIE\s*[:=]\s*[^\s"']*/g, `DOUYIN_COOKIE=${REDACTED}`);

  // 7. 禁换行、压平空白，限长。
  text = text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return text.slice(0, MAX_LENGTH);
}

/** 失败必带根因：沿 cause 链逐层保留 name/code/message，逐字段经 sanitizeSensitiveText。 */
export function describeErrorChain(error: unknown): Array<Record<string, string>> {
  const chain: Array<Record<string, string>> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== "object" && typeof current !== "string") break;
    const row: Record<string, string> = {};
    const source = typeof current === "string" ? { message: current } : current as {
      name?: unknown; code?: unknown; message?: unknown; cause?: unknown;
    };
    for (const key of ["name", "code", "message"] as const) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = sanitizeSensitiveText(String(value)).slice(0, 200);
      if (text) row[key] = text;
    }
    if (Object.keys(row).length > 0) chain.push(row);
    current = (source as { cause?: unknown }).cause;
  }
  return chain;
}
