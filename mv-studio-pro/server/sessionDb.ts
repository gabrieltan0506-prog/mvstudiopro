import { eq, and, gt, lt, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { sessions, InsertSession } from "../drizzle/schema";

/**
 * Session persistence layer.
 *
 * Every login path (OAuth, Email OTP, Email password) calls `createSession`
 * to store the JWT in the database. `authenticateRequest` in sdk.ts first
 * verifies the JWT signature, then calls `getSessionByToken` to confirm
 * the token still exists (i.e. has not been logged-out or expired).
 */

// ── Create ──────────────────────────────────────────────────────────────

export async function createSession(data: {
  userId: number;
  openId: string;
  token: string;
  loginMethod?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[SessionDB] Cannot create session: database not available");
    return;
  }

  try {
    await db.insert(sessions).values({
      userId: data.userId,
      openId: data.openId,
      token: data.token,
      loginMethod: data.loginMethod ?? null,
      userAgent: data.userAgent ?? null,
      expiresAt: data.expiresAt,
    });
    console.log(`[SessionDB] Session created for user ${data.userId} (${data.openId})`);
  } catch (error) {
    console.error("[SessionDB] Failed to create session:", error);
    // Non-fatal: the user can still use the JWT directly
  }
}

// ── Read ────────────────────────────────────────────────────────────────

/**
 * Look up a session row by its full JWT token string.
 * Returns the session if it exists AND has not expired, otherwise null.
 */
export async function getSessionByToken(token: string) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, sql`NOW()`)))
      .limit(1);

    if (result.length === 0) return null;

    // Touch lastActiveAt (fire-and-forget)
    db.update(sessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(sessions.id, result[0].id))
      .catch(() => {});

    return result[0];
  } catch (error) {
    console.error("[SessionDB] Failed to get session by token:", error);
    return null;
  }
}

/**
 * Look up a session by openId. Returns the most recent active session.
 */
export async function getSessionByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.openId, openId), gt(sessions.expiresAt, sql`NOW()`)))
      .orderBy(desc(sessions.lastActiveAt))
      .limit(1);

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[SessionDB] Failed to get session by openId:", error);
    return null;
  }
}

/**
 * Get all active sessions for a user (for "manage sessions" UI).
 */
export async function getUserSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];

  try {
    return db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, sql`NOW()`)))
      .orderBy(desc(sessions.lastActiveAt));
  } catch (error) {
    console.error("[SessionDB] Failed to get user sessions:", error);
    return [];
  }
}

// ── Delete ──────────────────────────────────────────────────────────────

/**
 * Delete a specific session (logout).
 */
export async function deleteSessionByToken(token: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.delete(sessions).where(eq(sessions.token, token));
    console.log("[SessionDB] Session deleted");
  } catch (error) {
    console.error("[SessionDB] Failed to delete session:", error);
  }
}

/**
 * Delete all sessions for a user (force logout everywhere).
 */
export async function deleteAllUserSessions(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.delete(sessions).where(eq(sessions.userId, userId));
    console.log(`[SessionDB] All sessions deleted for user ${userId}`);
  } catch (error) {
    console.error("[SessionDB] Failed to delete user sessions:", error);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────

/**
 * Remove expired sessions. Call periodically (e.g. every hour).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const result = await db.delete(sessions).where(lt(sessions.expiresAt, sql`NOW()`));
    const deleted = (result as any)?.[0]?.affectedRows ?? 0;
    if (deleted > 0) {
      console.log(`[SessionDB] Cleaned up ${deleted} expired sessions`);
    }
    return deleted;
  } catch (error) {
    console.error("[SessionDB] Failed to cleanup expired sessions:", error);
    return 0;
  }
}
