import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Persistent sessions table.
 * 
 * Stores session tokens in the database so that users remain logged in
 * even after a Sandbox restart (which changes the domain and invalidates
 * in-memory state / cookies).
 * 
 * The `token` column holds the JWT session token. On every authenticated
 * request the server checks that the token exists in this table AND that
 * it has not expired. On logout the row is deleted.
 */
export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  /** The user's numeric ID (FK to users.id) */
  userId: int("userId").notNull(),
  /** The user's openId for quick look-up without joining users */
  openId: varchar("openId", { length: 64 }).notNull(),
  /** The full JWT session token string */
  token: text("token").notNull(),
  /** Human-readable login method that created this session */
  loginMethod: varchar("loginMethod", { length: 64 }),
  /** User-Agent or device info (optional, for future "manage sessions" UI) */
  userAgent: varchar("userAgent", { length: 512 }),
  /** When the session expires (server enforced) */
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** Updated on every successful token verification (last active) */
  lastActiveAt: timestamp("lastActiveAt").defaultNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;
