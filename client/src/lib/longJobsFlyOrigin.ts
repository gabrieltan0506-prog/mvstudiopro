const DEFAULT_FLY_ORIGIN = "https://mvstudiopro.fly.dev";

/**
 * 正式域名走 Vercel 托管、由 vercel.json 将 `/api/*` rewrite 到 Fly 时，
 * 边缘对外部源有超时上限；Seedance 等单连接长耗时 fal.subscribe 易触发 502（如 ROUTER_EXTERNAL_TARGET_*）。
 * Fly 已对 mvstudiopro.com / www 放行 CORS，正式站可直连 Fly 绕开该层超时。
 */
export function longJobsFlyOrigin(): string | null {
  const fromEnv = String(import.meta.env.VITE_FLY_API_ORIGIN || "")
    .trim()
    .replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  if (typeof window === "undefined") return null;

  const h = window.location.hostname.toLowerCase();
  if (h === "mvstudiopro.com" || h === "www.mvstudiopro.com") {
    return DEFAULT_FLY_ORIGIN;
  }
  if (h.endsWith(".vercel.app")) {
    return DEFAULT_FLY_ORIGIN;
  }
  return null;
}

/** `/api/...` → 必要时带 Fly origin 的绝对 URL；本地与其它宿主保持相对路径。 */
export function withLongJobsFlyDirect(pathnameAndQuery: string): string {
  const path = pathnameAndQuery.startsWith("/")
    ? pathnameAndQuery
    : `/${pathnameAndQuery}`;
  const fly = longJobsFlyOrigin();
  if (!fly) return path;
  return `${fly}${path}`;
}

/** 与 `withFlyHealthGate` 配合：探针应打到实际请求的根 origin。 */
export function flyHealthProbeOriginForUrl(url: string): string {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    return new URL(url).origin;
  }
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
