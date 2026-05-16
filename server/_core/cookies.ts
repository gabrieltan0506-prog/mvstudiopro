import type { CookieOptions, Request } from "express";

/**
 * 同源架構（瀏覽器只映 mvstudiopro.com，API 經 Vercel rewrite）：使用 Lax + 生產環境 Secure，
 * 避免跨站 SameSite=None 在 Safari ITP 等環境下被阻擋。
 */
export function getSessionCookieOptions(
  _req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: production,
  };
}
