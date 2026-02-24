import { COOKIE_NAME } from "../../shared/const.js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { jwtVerify } from "jose";
import { users, type User } from "../../drizzle/schema";

type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

let db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (db) return db;
  if (!process.env.DATABASE_URL) return null;
  db = drizzle(process.env.DATABASE_URL);
  return db;
}

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) return new Map<string, string>();
  return new Map(Object.entries(parseCookieHeader(cookieHeader)));
}

function isValidSessionPayload(payload: Record<string, unknown>): payload is SessionPayload {
  return (
    typeof payload.openId === "string" &&
    payload.openId.length > 0 &&
    typeof payload.appId === "string" &&
    payload.appId.length > 0 &&
    typeof payload.name === "string"
  );
}

async function verifySession(cookieValue: string | undefined | null): Promise<SessionPayload | null> {
  if (!cookieValue || !process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(
      cookieValue,
      new TextEncoder().encode(process.env.JWT_SECRET),
      {
        algorithms: ["HS256"],
      }
    );
    if (!isValidSessionPayload(payload as Record<string, unknown>)) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

class ApiSdk {
  async authenticateRequest(req: Request): Promise<User> {
    const cookies = parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await verifySession(sessionCookie);

    if (!session) {
      throw new Error("Invalid session cookie");
    }

    const database = getDb();
    if (!database) {
      throw new Error("Database not available");
    }

    const rows = await database.select().from(users).where(eq(users.openId, session.openId)).limit(1);
    const user = rows[0];
    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }
}

export const sdk = new ApiSdk();
