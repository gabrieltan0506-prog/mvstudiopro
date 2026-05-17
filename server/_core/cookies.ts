import type { CookieOptions, Request } from "express";

const MVSTUDIO_APEX = "mvstudiopro.com";

/** 與 `cookie@1.x` serialize 使用的 domain-value 檢查一致；不匹配則勿傳給 res.cookie，否則抛 `option domain is invalid` */
const COOKIE_DOMAIN_VALUE_RE =
  /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Fly `secrets set` 若誤帶引號、尾端空白、BOM，`cookie` 套件會直接拋錯導致登入失敗。
 */
function sanitizeSessionCookieDomainFromEnv(value: string): string {
  let s = String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s+/g, "");
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim().replace(/\s+/g, "");
  }
  // 前導點可省略；統一成無點形式，避免複製貼上混入不可見字元時與檢查不一致
  if (s.toLowerCase() === `.${MVSTUDIO_APEX}`) {
    s = MVSTUDIO_APEX;
  }
  return s;
}

function assertSerializableCookieDomain(domain: string): string | undefined {
  if (!domain || !COOKIE_DOMAIN_VALUE_RE.test(domain)) {
    if (domain) {
      console.error(
        `[cookies] SESSION_COOKIE_DOMAIN 无效（含非法字符或空格），已忽略: ${JSON.stringify(domain)}`,
      );
    }
    return undefined;
  }
  return domain;
}

/** Vercel→Fly 等反代後，req.hostname 可能是 fly.dev；優先讀取 X-Forwarded-Host */
function clientFacingHost(req: Request): string {
  const raw = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const candidate = raw || String(req.hostname || "").trim().toLowerCase();
  if (!candidate) return "";
  try {
    const hasScheme = candidate.startsWith("http://") || candidate.startsWith("https://");
    const u = new URL(hasScheme ? candidate : `http://${candidate}`);
    return (u.hostname || "").toLowerCase();
  } catch {
    return candidate.replace(/:\d+$/, "");
  }
}

function resolveSessionCookieDomain(req: Request): string | undefined {
  let raw = sanitizeSessionCookieDomainFromEnv(process.env.SESSION_COOKIE_DOMAIN || "");
  const lower = raw.toLowerCase();
  // 誤設成主機級 www 時，api 子域請求永遠不帶 Cookie → 401
  if (lower === `www.${MVSTUDIO_APEX}`) {
    raw = MVSTUDIO_APEX;
  }
  const fromEnv = raw.length > 0 ? assertSerializableCookieDomain(raw) : undefined;
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV !== "production") return undefined;

  const host = clientFacingHost(req) || String(req.hostname || "").toLowerCase();
  if (host === MVSTUDIO_APEX || host.endsWith(`.${MVSTUDIO_APEX}`)) {
    return MVSTUDIO_APEX;
  }
  return undefined;
}

/**
 * Session Cookie：
 * - **預設**（無 `SESSION_COOKIE_DOMAIN`）：主機級 + `SameSite=Lax`，適合同源 `/api` 經 Vercel rewrite 至 Fly。
 * - **長任務直連 api 子域**（如 `VITE_FLY_API_ORIGIN=https://api.mvstudiopro.com`）：請設 `SESSION_COOKIE_DOMAIN=mvstudiopro.com`（**不要**加引號或尾隨空格），
 *   使 `www` 與 `api` 共享 JWT；仍可用 `Lax`（同 registrable domain 子請求會帶 Cookie）。
 * - 生產環境若請求 Host 為 `www` / `api` / apex 的 `mvstudiopro.com` 且未設 env 時，會自動使用 `mvstudiopro.com`（與正確的 `SESSION_COOKIE_DOMAIN` 等效）。
 * - **`SESSION_COOKIE_SAMESITE_NONE=1`**：`SameSite=None; Secure`（僅當你真的需要跨**不同站点**送 Cookie，例如極少數與 fly.dev 同憑證樹／除錯場景；一般應優先 api 子域 + Domain）。
 */
export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const production = process.env.NODE_ENV === "production";
  const domain = resolveSessionCookieDomain(req);

  const noneFlag = String(process.env.SESSION_COOKIE_SAMESITE_NONE || "")
    .trim()
    .toLowerCase();
  const useSameSiteNone =
    noneFlag === "1" || noneFlag === "true" || noneFlag === "yes" || noneFlag === "on";

  return {
    httpOnly: true,
    path: "/",
    ...(domain ? { domain } : {}),
    sameSite: production && useSameSiteNone ? "none" : "lax",
    secure: production,
  };
}
