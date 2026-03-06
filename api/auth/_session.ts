import crypto from "node:crypto";

export const SESSION_COOKIE = "mvsp_session";

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function signSession(payload: Record<string, any>, secret: string) {
  const body = Buffer.from(JSON.stringify(payload), "utf-8");
  const sig = crypto.createHmac("sha256", secret).update(body).digest();
  return `${b64url(body)}.${b64url(sig)}`;
}

export function verifySession(token: string, secret: string): null | Record<string, any> {
  try {
    const [bodyB64, sigB64] = String(token || "").split(".");
    if (!bodyB64 || !sigB64) return null;
    const body = Buffer.from(bodyB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const expected = crypto.createHmac("sha256", secret).update(body).digest();
    const given = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (expected.length !== given.length) return null;
    if (!crypto.timingSafeEqual(expected, given)) return null;
    const json = JSON.parse(body.toString("utf-8"));
    if (!json?.email) return null;
    if (json?.exp && Date.now() > Number(json.exp)) return null;
    return json;
  } catch {
    return null;
  }
}

export function parseCookie(cookieHeader: string | undefined, name: string) {
  const raw = String(cookieHeader || "");
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx);
    const v = p.slice(idx + 1);
    if (k === name) return v;
  }
  return "";
}

export function buildSessionCookie(token: string, maxAgeSec = 60 * 60 * 24 * 7) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${maxAgeSec}`
  ].join("; ");
}

export function buildLogoutCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=0"
  ].join("; ");
}
