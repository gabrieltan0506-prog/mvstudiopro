/**
 * 與 AdminPanel「維運 token」共用 sessionStorage 鍵；值須與服端 env `SUPERVISOR_SECRET` 一致。
 */
export const SUPERVISOR_TRPC_TOKEN_SESSION_KEY = "mvs-supervisor-reap-token";

export function getSupervisorTrpcToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = sessionStorage.getItem(SUPERVISOR_TRPC_TOKEN_SESSION_KEY)?.trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}

/**
 * URL 帶 `supervisor=1` 且 `supervisorToken` 時寫入 sessionStorage，並從地址欄移除 token，避免分享連結洩漏。
 */
export function captureSupervisorTokenFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("supervisor") !== "1") return;
    const t = params.get("supervisorToken")?.trim();
    if (!t) return;
    sessionStorage.setItem(SUPERVISOR_TRPC_TOKEN_SESSION_KEY, t);
    params.delete("supervisorToken");
    const nextSearch = params.toString();
    const next = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", next);
  } catch {
    /* session / history 可能不可用 */
  }
}
