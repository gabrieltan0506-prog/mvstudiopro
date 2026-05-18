/** 正式站预设 API 主机（须 `SESSION_COOKIE_DOMAIN=.mvstudiopro.com`）。 */
const DEFAULT_CANONICAL_API_ORIGIN = "https://api.mvstudiopro.com";
/** Preview 兜底。 */
const DEFAULT_FLY_DEV_ORIGIN = "https://mvstudiopro.fly.dev";

/**
 * 长请求须直连 API 主机，避免 `www`→Vercel→Fly 反代逾时。
 */
export function longJobsFlyOrigin(): string | null {
  const fromEnv = String(import.meta.env.VITE_FLY_API_ORIGIN || "")
    .trim()
    .replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  if (typeof window === "undefined") return null;

  const h = window.location.hostname.toLowerCase();
  if (h === "mvstudiopro.com" || h === "www.mvstudiopro.com") {
    return DEFAULT_CANONICAL_API_ORIGIN;
  }
  if (h.endsWith(".vercel.app")) {
    return DEFAULT_FLY_DEV_ORIGIN;
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

/**
 * 长耗时 tRPC（2×4 / 封面等）专用：`ROUTER_EXTERNAL_TARGET_*` 来自 Vercel→Fly 反代腰斩，须直连 Fly（或同 apex 的 api 子域）绕过 Vercel。
 *
 * **Cookie**：`www.mvstudiopro.com` 上设的主机级 Session **不会**随请求发到 `*.fly.dev`（不同站点）。
 * 生产建议：`api.mvstudiopro.com` CNAME 到 Fly，设 `VITE_FLY_API_ORIGIN=https://api.mvstudiopro.com` 与服端 `SESSION_COOKIE_DOMAIN=mvstudiopro.com`（勿加引号／尾随空格）
 *（SameSite=Lax 即可覆盖子域请求）。若暂只有 fly.dev，须自行承担登入态或改用与登入同站的 API 主机名。
 */
export function longJobsTrpcHttpUrl(): string {
  const fly = longJobsFlyOrigin();
  const base = fly ? fly.replace(/\/+$/, "") : typeof window !== "undefined" ? window.location.origin : "";
  return base ? `${base}/api/trpc` : "/api/trpc";
}

/** {@link withFlyHealthGate} / `/api/health` 探针使用的 origin。 */
export function longJobsTrpcHealthOrigin(): string {
  const fly = longJobsFlyOrigin();
  if (fly) return fly.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
