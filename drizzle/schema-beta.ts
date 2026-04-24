import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

/**
 * Beta testing quota & invitation system
 * - Admin grants beta quota (20/40 uses) to specific users
 * - Beta users get a unique invite code to share
 * - Each successful referral grants +10 uses to both inviter and invitee
 */

// Beta user quotas - managed by admin
export const betaQuotas = mysqlTable("beta_quotas", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // Foreign key to users.id
  totalQuota: int("totalQuota").default(0).notNull(), // Total granted quota (e.g., 20 or 40)
  usedCount: int("usedCount").default(0).notNull(), // How many times used across all features
  bonusQuota: int("bonusQuota").default(0).notNull(), // Extra quota from referrals
  inviteCode: varchar("inviteCode", { length: 16 }).notNull().unique(), // Unique invite code
  isActive: boolean("isActive").default(true).notNull(),
  grantedBy: int("grantedBy").notNull(), // Admin user ID who granted
  note: text("note"), // Admin note (e.g., "VIP tester", "KOL partner")
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BetaQuota = typeof betaQuotas.$inferSelect;
export type InsertBetaQuota = typeof betaQuotas.$inferInsert;

// Referral records - tracks who invited whom
export const betaReferrals = mysqlTable("beta_referrals", {
  id: int("id").autoincrement().primaryKey(),
  inviterUserId: int("inviterUserId").notNull(), // The user who shared the invite code
  inviteeUserId: int("inviteeUserId").notNull(), // The user who used the invite code
  inviteCode: varchar("inviteCode", { length: 16 }).notNull(),
  bonusGranted: int("bonusGranted").default(10).notNull(), // Bonus given to each party
  status: mysqlEnum("status", ["pending", "completed", "revoked"]).default("completed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BetaReferral = typeof betaReferrals.$inferSelect;
export type InsertBetaReferral = typeof betaReferrals.$inferInsert;

// ─── Beta invite codes (supervisor → user, redeemable for credits) ────────
export const betaInviteCodes = mysqlTable("beta_invite_codes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  credits: int("credits").default(200).notNull(),
  maxUses: int("max_uses").default(1).notNull(),        // -1 = unlimited
  usedCount: int("used_count").default(0).notNull(),
  createdBy: int("created_by").notNull(),               // supervisor userId
  note: varchar("note", { length: 120 }),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const betaCodeUsages = mysqlTable("beta_code_usages", {
  id: int("id").autoincrement().primaryKey(),
  codeId: int("code_id").notNull(),
  userId: int("user_id").notNull(),
  creditsAwarded: int("credits_awarded").notNull(),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
});

export type BetaInviteCode = typeof betaInviteCodes.$inferSelect;
export type InsertBetaInviteCode = typeof betaInviteCodes.$inferInsert;
export type BetaCodeUsage = typeof betaCodeUsages.$inferSelect;
