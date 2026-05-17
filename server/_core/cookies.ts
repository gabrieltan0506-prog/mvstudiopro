import type { CookieOptions, Request } from "express";

/**
 * Session Cookie：
 * - **預設**（無 `SESSION_COOKIE_DOMAIN`）：主機級 + `SameSite=Lax`，適合同源 `/api` 經 Vercel rewrite 至 Fly。
 * - **長任務直連 api 子域**（如 `VITE_FLY_API_ORIGIN=https://api.mvstudiopro.com`）：請設 `SESSION_COOKIE_DOMAIN=.mvstudiopro.com`，
 *   使 `www` 與 `api` 共享 JWT；仍可用 `Lax`（同 registrable domain 子請求會帶 Cookie）。
 * - **`SESSION_COOKIE_SAMESITE_NONE=1`**：`SameSite=None; Secure`（僅當你真的需要跨**不同站点**送 Cookie，例如極少數與 fly.dev 同憑證樹／除錯場景；一般應優先 api 子域 + Domain）。
 */
export function getSessionCookieOptions(
  _req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const production = process.env.NODE_ENV === "production";
  const domainRaw = String(process.env.SESSION_COOKIE_DOMAIN || "").trim();
  const domain = domainRaw.length > 0 ? domainRaw : undefined;

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
