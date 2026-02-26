const SUPERVISOR_EMAILS = new Set([
  "gabrieltan0506@gmail.com",
  "benjamintan0506@163.com",
]);

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
