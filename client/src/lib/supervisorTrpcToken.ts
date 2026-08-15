let exchangeInFlight: Promise<boolean> | null = null;
const SUPERVISOR_SESSION_HINT_KEY = "mvs-supervisor-session-ready";
export const SUPERVISOR_SESSION_CHANGED_EVENT = "mvs:supervisor-session-changed";

function notifySupervisorSessionChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SUPERVISOR_SESSION_CHANGED_EVENT));
  }
}

export function hasSupervisorSessionHint(): boolean {
  if (typeof window === "undefined") return false;
  const expiresAt = Number(sessionStorage.getItem(SUPERVISOR_SESSION_HINT_KEY));
  if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return true;
  sessionStorage.removeItem(SUPERVISOR_SESSION_HINT_KEY);
  return false;
}

export async function exchangeSupervisorSecret(secret: string): Promise<boolean> {
  const normalized = secret.trim();
  if (!normalized) return false;
  if (exchangeInFlight) return exchangeInFlight;
  exchangeInFlight = fetch("/api/supervisor-session", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: normalized }),
  }).then(async (response) => {
    if (!response.ok) throw new Error("监管会话建立失败");
    const body = await response.json() as { expiresAt?: number };
    const expiresAt = Number(body.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error("监管会话有效期异常");
    }
    sessionStorage.setItem(SUPERVISOR_SESSION_HINT_KEY, String(expiresAt));
    notifySupervisorSessionChanged();
    return true;
  }).finally(() => {
    exchangeInFlight = null;
  });
  return exchangeInFlight;
}

export async function clearSupervisorSession(): Promise<void> {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SUPERVISOR_SESSION_HINT_KEY);
    localStorage.removeItem("mvs-supervisor-access");
    notifySupervisorSessionChanged();
  }
  await fetch("/api/supervisor-session", {
    method: "DELETE",
    credentials: "include",
  }).catch(() => undefined);
}

/**
 * 兼容旧监管链接：先同步从地址栏移除密钥，再以 POST 换取绑定当前账号的 HttpOnly 会话。
 * 密钥不再写入 sessionStorage，也不再进入任何 tRPC input/header。
 */
export async function captureSupervisorTokenFromUrl(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") !== "1") return false;
  const secret = params.get("supervisorToken")?.trim() || "";
  if (!secret) return false;
  params.delete("supervisorToken");
  const nextSearch = params.toString();
  const next = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
  return exchangeSupervisorSecret(secret);
}
