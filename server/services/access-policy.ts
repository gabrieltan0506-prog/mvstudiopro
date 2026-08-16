import { timingSafeEqual } from "node:crypto";

const SUPERVISOR_EMAILS = new Set([
  "gabrieltan0506@gmail.com",
  "benjamintan0506@163.com",
]);

/** 与 env `SUPERVISOR_SECRET` 做恒定时间比较；仅供登录后换取绑定账号的监管会话。 */
export function isValidSupervisorSecret(token: string | null | undefined): boolean {
  const expected = Buffer.from(String(process.env.SUPERVISOR_SECRET || ""), "utf8");
  const supplied = Buffer.from(String(token || ""), "utf8");
  return expected.length > 0
    && supplied.length === expected.length
    && timingSafeEqual(supplied, expected);
}

/**
 * 平台选题封面等高阶管线开关：DB 角色为 admin/supervisor，或当前账号持有已验签监管会话。
 * 積分／免扣費仍應僅依角色等既有邏輯，不得以 token 繞過。
 */
export function resolvePlatformSupervisorOpsAllowed(
  user: { id?: number | null; role?: string | null },
  supervisorSession?: { userId: number; expiresAt: number } | null,
): boolean {
  if (user.role === "admin" || user.role === "supervisor") return true;
  return Boolean(
    user.id
      && supervisorSession
      && supervisorSession.userId === user.id
      && supervisorSession.expiresAt > Date.now(),
  );
}

/**
 * 站点拥有者专属操作。角色与监管会话都不能绕过；OWNER_OPEN_ID 缺失时 fail closed。
 * 用于保护爆款蒸馏模板的全文查看、模型优化与修订替换。
 */
export function resolveSiteOwnerOnlyAllowed(
  user: { openId?: string | null },
  configuredOwnerOpenId: string | null | undefined = process.env.OWNER_OPEN_ID,
): boolean {
  const expected = String(configuredOwnerOpenId || "").trim();
  const actual = String(user.openId || "").trim();
  return Boolean(expected && actual && actual === expected);
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
