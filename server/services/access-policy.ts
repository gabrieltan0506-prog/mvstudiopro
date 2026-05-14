const SUPERVISOR_SECRET = process.env.SUPERVISOR_SECRET ?? "";

const SUPERVISOR_EMAILS = new Set([
  "gabrieltan0506@gmail.com",
  "benjamintan0506@163.com",
]);

/** 與 env `SUPERVISOR_SECRET` 比對；用於免登入的高權限維運操作（如 betaCode.generate、reapStaleNeonJobs）。 */
export function isValidSupervisorSecret(token: string | null | undefined): boolean {
  return !!SUPERVISOR_SECRET && !!token && token === SUPERVISOR_SECRET;
}

/**
 * 平台選題封面等高階管線開關：DB 角色為 admin/supervisor，或請求攜帶與 env `SUPERVISOR_SECRET` 一致的 token。
 * 積分／免扣費仍應僅依角色等既有邏輯，不得以 token 繞過。
 */
export function resolvePlatformSupervisorOpsAllowed(
  user: { role?: string | null },
  supervisorToken: string | null | undefined,
): boolean {
  if (user.role === "admin" || user.role === "supervisor") return true;
  const t = typeof supervisorToken === "string" ? supervisorToken.trim() : "";
  return isValidSupervisorSecret(t || null);
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function isSupervisorEmail(email: string | null | undefined): boolean {
  return SUPERVISOR_EMAILS.has(normalizeEmail(email));
}

export function isSupervisorAccount(user: {
  role?: string | null;
  email?: string | null;
}): boolean {
  return user.role === "supervisor" || isSupervisorEmail(user.email);
}

export function hasUnlimitedAccess(user: {
  role?: string | null;
  email?: string | null;
}): boolean {
  return user.role === "admin" || isSupervisorAccount(user);
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "***";
  if (local.length <= 2) return `${local[0] ?? "*"}*@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function getSupervisorAllowlist(mask: boolean = true): string[] {
  const emails = Array.from(SUPERVISOR_EMAILS.values());
  return mask ? emails.map(maskEmail) : emails;
}
