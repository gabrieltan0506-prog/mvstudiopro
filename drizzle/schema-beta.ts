import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Beta testing quota & invitation system
 * - Admin grants beta quota (20/40 uses) to specific users
 * - Beta users get a unique invite code to share
 * - Each successful referral grants +10 uses to both inviter and invitee
 */

// Beta user quotas - managed by admin
export const betaQuotas = pgTable("beta_quotas", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull().unique(), // Foreign key to users.id
  totalQuota: integer("totalQuota").default(0).notNull(), // Total granted quota (e.g., 20 or 40)
  usedCount: integer("usedCount").default(0).notNull(), // How many times used across all features
  bonusQuota: integer("bonusQuota").default(0).notNull(), // Extra quota from referrals
  inviteCode: varchar("inviteCode", { length: 16 }).notNull().unique(), // Unique invite code
  isActive: boolean("isActive").default(true).notNull(),
  grantedBy: integer("grantedBy").notNull(), // Admin user ID who granted
  note: text("note"), // Admin note (e.g., "VIP tester", "KOL partner")
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type BetaQuota = typeof betaQuotas.$inferSelect;
export type InsertBetaQuota = typeof betaQuotas.$inferInsert;

// Referral records - tracks who invited whom
export const betaReferrals = pgTable("beta_referrals", {
  id: serial().primaryKey(),
  inviterUserId: integer("inviterUserId").notNull(), // The user who shared the invite code
  inviteeUserId: integer("inviteeUserId").notNull(), // The user who used the invite code
  inviteCode: varchar("inviteCode", { length: 16 }).notNull(),
  bonusGranted: integer("bonusGranted").default(10).notNull(), // Bonus given to each party
  status: text("status").default("completed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BetaReferral = typeof betaReferrals.$inferSelect;
export type InsertBetaReferral = typeof betaReferrals.$inferInsert;

// ─── Beta invite codes (supervisor → user, redeemable for credits) ────────
export const betaInviteCodes = pgTable("beta_invite_codes", {
  id: serial().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  credits: integer("credits").default(200).notNull(),
  maxUses: integer("max_uses").default(1).notNull(),        // -1 = unlimited
  usedCount: integer("used_count").default(0).notNull(),
  createdBy: integer("created_by").notNull(),               // supervisor userId
  note: varchar("note", { length: 120 }),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const betaCodeUsages = pgTable("beta_code_usages", {
  id: serial().primaryKey(),
  codeId: integer("code_id").notNull(),
  userId: integer("user_id").notNull(),
  creditsAwarded: integer("credits_awarded").notNull(),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
});

export type BetaInviteCode = typeof betaInviteCodes.$inferSelect;
export type InsertBetaInviteCode = typeof betaInviteCodes.$inferInsert;
export type BetaCodeUsage = typeof betaCodeUsages.$inferSelect;
