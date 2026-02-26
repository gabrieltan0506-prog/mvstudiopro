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

