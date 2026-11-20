import crypto from "node:crypto";
import fs from "node:fs";

function readGoogleServiceAccount() {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return JSON.parse(
        raw.replace(
          /"private_key"\s*:\s*"([\s\S]*?)"/m,
          (_match, privateKey) => `"private_key": ${JSON.stringify(String(privateKey || ""))}`,
        ),
      );
    }
  }

  const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credentialsPath) {
    return JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  }

  throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS");
}

/**
 * 令牌缓存（1120）：原来每次存取都现签 JWT 再换令牌，读一个对象要 4 次往返，
 * 换令牌接口一抖就让整单失败。令牌有效期一小时，进程内缓存、提前 5 分钟刷新即可。
 * - 并发调用共用同一次刷新（single-flight），50 个并发存取只换一次令牌；
 * - 刷新失败不缓存失败：下次调用重新换；若旧令牌尚未真正过期，先继续用旧令牌；
 * - 换令牌的网络错误与 408/429/5xx 属临时故障，短退避重试 3 次，仍失败抛
 *   `vertex_token_failed:<状态|network>:…`，上层据此归为可重试的瞬态错误。
 * 凭证仍只从原有服务端环境变量读取；令牌与断言都不进日志、不进错误信息。
 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

type CachedToken = { token: string; expiresAt: number; identity: string };
let cachedToken: CachedToken | null = null;
let refreshing: { identity: string; promise: Promise<CachedToken> } | null = null;

/** 仅测试用：清空进程内令牌缓存。 */
export function resetVertexAccessTokenCacheForTest() {
  cachedToken = null;
  refreshing = null;
}

/** 凭证身份只用于区分缓存（换服务账号即失效），不外泄任何凭证内容。 */
function credentialIdentity(sa: { client_email?: string; private_key?: string }) {
  return crypto.createHash("sha256").update(`${sa.client_email || ""}\n${sa.private_key || ""}`).digest("hex");
}

function transientTokenStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function requestVertexAccessToken(sa: { client_email: string; private_key: string }, identity: string): Promise<CachedToken> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= TOKEN_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, TOKEN_RETRY_DELAYS_MS[attempt - 1]));
    // 每次重试重新签断言：iat/exp 跟随实际发送时刻。
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })).toString("base64url");
    const unsignedToken = `${header}.${payload}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsignedToken);
    signer.end();
    const signature = signer.sign(sa.private_key).toString("base64url");
    const assertion = `${unsignedToken}.${signature}`;

    const requestedAt = Date.now();
    let tokenRes: Response;
    let json: any;
    try {
      tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion
        }).toString(),
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
      json = await tokenRes.json().catch(() => ({}));
    } catch (error) {
      // 网络层失败（含超时、读响应中断）：只记错误类别，不带请求体。
      const detail = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      lastError = new Error(`vertex_token_failed:network:${detail.slice(0, 200)}`);
      continue;
    }
    if (tokenRes.ok && json?.access_token) {
      const expiresInSec = Number(json.expires_in);
      const lifetimeMs = Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec * 1000 : 3600_000;
      return { token: String(json.access_token), expiresAt: requestedAt + lifetimeMs, identity };
    }
    // 失败报文只留错误码与说明（令牌接口失败时不含令牌）。
    const detail = JSON.stringify({ error: json?.error, error_description: json?.error_description }).slice(0, 300);
    lastError = new Error(`vertex_token_failed:${tokenRes.status}:${detail}`);
    if (!transientTokenStatus(tokenRes.status)) throw lastError;
  }
  throw lastError ?? new Error("vertex_token_failed:network:unknown");
}

/**
 * 取得 Vertex AI OAuth2 Access Token（使用 GOOGLE_APPLICATION_CREDENTIALS_JSON 或 GOOGLE_APPLICATION_CREDENTIALS）
 */
export async function getVertexAccessToken(): Promise<string> {
  const sa = readGoogleServiceAccount();
  const identity = credentialIdentity(sa);
  const now = Date.now();
  const cached = cachedToken && cachedToken.identity === identity ? cachedToken : null;
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) return cached.token;

  let entry = refreshing && refreshing.identity === identity ? refreshing : null;
  if (!entry) {
    const promise = requestVertexAccessToken(sa, identity);
    const created = { identity, promise };
    entry = created;
    refreshing = created;
    promise.then(
      fresh => { if (refreshing === created) { cachedToken = fresh; refreshing = null; } },
      () => { if (refreshing === created) refreshing = null; },
    );
  }
  try {
    const fresh = await entry.promise;
    // 进入缓存的那一步在 then 回调里；此处直接回放本次刷新结果，避免竞态读到旧值。
    return fresh.token;
  } catch (error) {
    // 临期刷新失败但旧令牌仍未过期：先继续用旧令牌，下次调用再刷新。
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    throw error;
  }
}
