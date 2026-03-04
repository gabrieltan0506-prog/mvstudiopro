import crypto from "crypto";

type Payload = {
  sub: string;           // user id
  day: string;           // YYYYMMDD
  reason: "kling_queue";
};

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function todayYYYYMMDD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function signUpgradeToken(payload: Payload, secret: string) {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyUpgradeToken(token: string, secret: string): Payload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (sig !== expect) return null;

  try {
    const payload = JSON.parse(unb64url(body).toString("utf-8"));
    if (!payload?.sub || !payload?.day || payload?.reason !== "kling_queue") return null;
    return payload as Payload;
  } catch {
    return null;
  }
}
