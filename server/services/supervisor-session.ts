import { createHmac, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { CookieOptions, Request } from "express";
import { getSessionCookieOptions } from "../_core/cookies";

export const SUPERVISOR_SESSION_COOKIE_NAME = "mvs_supervisor_session";
export const SUPERVISOR_SESSION_TTL_MS = 4 * 60 * 60 * 1_000;

export type SupervisorSession = {
  userId: number;
  expiresAt: number;
};

type SupervisorSessionPayload = {
  v: 1;
  userId: number;
  expiresAt: number;
};

function supervisorSecret() {
  return String(process.env.SUPERVISOR_SECRET || "");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createSupervisorSessionToken(
  userId: number,
  nowMs: number = Date.now(),
): { token: string; session: SupervisorSession } {
  const secret = supervisorSecret();
  if (!secret) throw new Error("supervisor_secret_missing");
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("supervisor_session_user_invalid");
  const payload: SupervisorSessionPayload = {
    v: 1,
    userId,
    expiresAt: nowMs + SUPERVISOR_SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${encoded}.${signature(encoded, secret)}`,
    session: { userId: payload.userId, expiresAt: payload.expiresAt },
  };
}

export function readSupervisorSession(params: {
  cookieHeader?: string;
  expectedUserId?: number;
  nowMs?: number;
}): SupervisorSession | undefined {
  const secret = supervisorSecret();
  if (!secret || !params.cookieHeader) return undefined;
  let token = "";
  try {
    token = parseCookieHeader(params.cookieHeader)[SUPERVISOR_SESSION_COOKIE_NAME] || "";
  } catch {
    return undefined;
  }
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra !== undefined) return undefined;
  const expectedSignature = signature(encoded, secret);
  if (!signaturesEqual(suppliedSignature, expectedSignature)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SupervisorSessionPayload>;
    const nowMs = params.nowMs ?? Date.now();
    if (payload.v !== 1 || !Number.isInteger(payload.userId) || Number(payload.userId) <= 0) return undefined;
    if (!Number.isFinite(payload.expiresAt) || Number(payload.expiresAt) <= nowMs) return undefined;
    if (params.expectedUserId !== undefined && Number(payload.userId) !== params.expectedUserId) return undefined;
    return { userId: Number(payload.userId), expiresAt: Number(payload.expiresAt) };
  } catch {
    return undefined;
  }
}

export function getSupervisorSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  return {
    ...getSessionCookieOptions(req),
    httpOnly: true,
    sameSite: "strict",
    secure: true,
  };
}
