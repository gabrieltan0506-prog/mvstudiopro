import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "free", "beta", "paid", "supervisor"]).default("free").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Visitor guestbook / contact inquiry messages
export const guestbookMessages = mysqlTable("guestbook_messages", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 30 }),
  company: varchar("company", { length: 200 }),
  subject: varchar("subject", { length: 255 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GuestbookMessage = typeof guestbookMessages.$inferSelect;
export type InsertGuestbookMessage = typeof guestbookMessages.$inferInsert;

// Video comments and ratings
export const mvReviews = mysqlTable("mv_reviews", {
  id: int("id").autoincrement().primaryKey(),
  mvId: varchar("mvId", { length: 64 }).notNull(),
  nickname: varchar("nickname", { length: 100 }).notNull(),
  rating: int("rating").notNull(), // 1-5 stars
  comment: text("comment").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MvReview = typeof mvReviews.$inferSelect;
export type InsertMvReview = typeof mvReviews.$inferInsert;

// Re-export extended schema
export * from "./schema-extended";
export * from "./schema-email-auth";
export * from "./schema-storyboards";
export * from "./schema-payments";
export * from "./schema-creations";
export * from "./schema-beta";
export * from "./schema-stripe";
export * from "./schema-teams";
export * from "./schema-audit";
export * from "./schema-video-submissions";
export * from "./schema-showcase";
export * from "./schema-sessions";
export * from "./schema-video-signatures";
export * from "./schema-jobs";
export * from "./schema-workflow";
