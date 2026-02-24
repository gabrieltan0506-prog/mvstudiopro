import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SignJWT, jwtVerify } from "jose";

export type SessionPayload = {
  email: string;
  googleId: string;
};

export type ApiContext = {
  req: VercelRequest;
  res: VercelResponse;
  user: SessionPayload | null;
};

const textEncoder = new TextEncoder();

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const jwtSecret = getRequiredEnv("JWT_SECRET");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(textEncoder.encode(jwtSecret));
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const jwtSecret = getRequiredEnv("JWT_SECRET");
    const { payload } = await jwtVerify(token, textEncoder.encode(jwtSecret));

    if (typeof payload.email !== "string" || typeof payload.googleId !== "string") {
      return null;
    }

    return {
      email: payload.email,
      googleId: payload.googleId,
    };
  } catch {
    return null;
  }
}

export async function createContext(
  req: VercelRequest,
  res: VercelResponse
): Promise<ApiContext> {
  const token = req.cookies?.mvsp_session;
  const user = typeof token === "string" && token ? await verifySession(token) : null;

  return {
    req,
    res,
    user,
  };
}
