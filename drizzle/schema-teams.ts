import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * 企業版團隊管理 Schema
 *
 * 包含：
 * - teams: 團隊基本信息
 * - team_members: 團隊成員（含角色和分配額度）
 * - team_credit_allocations: Credits 分配歷史記錄
 * - team_activity_logs: 團隊活動日誌（邀請、分配、使用等）
 */

// ═══════════════════════════════════════════
// 團隊
// ═══════════════════════════════════════════
export const teams = pgTable("teams", {
  id: serial().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  ownerId: integer("ownerId").notNull(), // FK → users.id（企業版訂閱者）
  maxMembers: integer("maxMembers").default(10).notNull(),
  /** 團隊總 Credits 池（從企業版訂閱帳號分配過來的） */
  creditPool: integer("creditPool").default(0).notNull(),
  /** 已分配給成員的 Credits 總量 */
  creditAllocated: integer("creditAllocated").default(0).notNull(),
  /** 6 位邀請碼 */
  inviteCode: varchar("inviteCode", { length: 20 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

// ═══════════════════════════════════════════
// 團隊成員
// ═══════════════════════════════════════════
export const teamMembers = pgTable("team_members", {
  id: serial().primaryKey(),
  teamId: integer("teamId").notNull(), // FK → teams.id
  userId: integer("userId").notNull(), // FK → users.id
  role: text("teamRole").default("member").notNull(),
  /** 該成員被分配的 Credits 額度 */
  allocatedCredits: integer("allocatedCredits").default(0).notNull(),
  /** 該成員已使用的 Credits */
  usedCredits: integer("usedCredits").default(0).notNull(),
  status: text("memberStatus").default("invited").notNull(),
  invitedAt: timestamp("invitedAt").defaultNow().notNull(),
  joinedAt: timestamp("joinedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;

// ═══════════════════════════════════════════
// Credits 分配歷史
// ═══════════════════════════════════════════
export const teamCreditAllocations = pgTable("team_credit_allocations", {
  id: serial().primaryKey(),
  teamId: integer("teamId").notNull(), // FK → teams.id
  memberId: integer("memberId").notNull(), // FK → team_members.id
  /** 操作者 userId */
  allocatedBy: integer("allocatedBy").notNull(), // FK → users.id
  /** 正數=分配, 負數=回收 */
  amount: integer("amount").notNull(),
  /** 分配後該成員的額度 */
  balanceAfter: integer("balanceAfter").notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TeamCreditAllocation = typeof teamCreditAllocations.$inferSelect;
export type InsertTeamCreditAllocation = typeof teamCreditAllocations.$inferInsert;

// ═══════════════════════════════════════════
// 團隊活動日誌
// ═══════════════════════════════════════════
export const teamActivityLogs = pgTable("team_activity_logs", {
  id: serial().primaryKey(),
  teamId: integer("teamId").notNull(), // FK → teams.id
  userId: integer("userId").notNull(), // FK → users.id（執行者）
  action: varchar("action", { length: 50 }).notNull(),
  // action 類型：team_created | member_invited | member_joined | member_removed |
  //             member_suspended | credits_allocated | credits_reclaimed | credits_used |
  //             team_updated | role_changed
  targetUserId: integer("targetUserId"), // 被操作的用戶
  description: text("description"),
  metadata: text("metadata"), // JSON string
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TeamActivityLog = typeof teamActivityLogs.$inferSelect;
export type InsertTeamActivityLog = typeof teamActivityLogs.$inferInsert;
