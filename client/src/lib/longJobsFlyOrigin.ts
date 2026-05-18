/** 正式站預設 API 主機（須 `SESSION_COOKIE_DOMAIN=.mvstudiopro.com`）。 */
const DEFAULT_CANONICAL_API_ORIGIN = "https://api.mvstudiopro.com";
/** Preview 兜底。 */
const DEFAULT_FLY_DEV_ORIGIN = "https://mvstudiopro.fly.dev";

/**
 * 長請求須直連 API 主機，避免 `www`→Vercel→Fly 反代逾時。
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
 * 長耗時 tRPC（2×4 / 封面等）專用：`ROUTER_EXTERNAL_TARGET_*` 來自 Vercel→Fly 反代腰斬，須直連 Fly（或同 apex 的 api 子域）繞過 Vercel。
 *
 * **Cookie**：`www.mvstudiopro.com` 上設的主機級 Session **不會**隨請求發到 `*.fly.dev`（不同站點）。
 * 生產建議：`api.mvstudiopro.com` CNAME 到 Fly，設 `VITE_FLY_API_ORIGIN=https://api.mvstudiopro.com` 與服端 `SESSION_COOKIE_DOMAIN=mvstudiopro.com`（勿加引號／尾隨空格）
 *（SameSite=Lax 即可覆蓋子域請求）。若暫只有 fly.dev，須自行承擔登入態或改用與登入同站的 API 主機名。
 */
export function longJobsTrpcHttpUrl(): string {
  const fly = longJobsFlyOrigin();
  const base = fly ? fly.replace(/\/+$/, "") : typeof window !== "undefined" ? window.location.origin : "";
  return base ? `${base}/api/trpc` : "/api/trpc";
}

/** {@link withFlyHealthGate} / `/api/health` 探針使用的 origin。 */
export function longJobsTrpcHealthOrigin(): string {
  const fly = longJobsFlyOrigin();
  if (fly) return fly.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
