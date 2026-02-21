import { int, mysqlTable, text, timestamp, varchar, mysqlEnum } from "drizzle-orm/mysql-core";

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
export const teams = mysqlTable("teams", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  ownerId: int("ownerId").notNull(), // FK → users.id（企業版訂閱者）
  maxMembers: int("maxMembers").default(10).notNull(),
  /** 團隊總 Credits 池（從企業版訂閱帳號分配過來的） */
  creditPool: int("creditPool").default(0).notNull(),
  /** 已分配給成員的 Credits 總量 */
  creditAllocated: int("creditAllocated").default(0).notNull(),
  /** 6 位邀請碼 */
  inviteCode: varchar("inviteCode", { length: 20 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

// ═══════════════════════════════════════════
// 團隊成員
// ═══════════════════════════════════════════
export const teamMembers = mysqlTable("team_members", {
  id: int("id").autoincrement().primaryKey(),
  teamId: int("teamId").notNull(), // FK → teams.id
  userId: int("userId").notNull(), // FK → users.id
  role: mysqlEnum("teamRole", ["owner", "admin", "member"]).default("member").notNull(),
  /** 該成員被分配的 Credits 額度 */
  allocatedCredits: int("allocatedCredits").default(0).notNull(),
  /** 該成員已使用的 Credits */
  usedCredits: int("usedCredits").default(0).notNull(),
  status: mysqlEnum("memberStatus", ["active", "invited", "suspended", "removed"]).default("invited").notNull(),
  invitedAt: timestamp("invitedAt").defaultNow().notNull(),
  joinedAt: timestamp("joinedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = typeof teamMembers.$inferInsert;

// ═══════════════════════════════════════════
// Credits 分配歷史
// ═══════════════════════════════════════════
export const teamCreditAllocations = mysqlTable("team_credit_allocations", {
  id: int("id").autoincrement().primaryKey(),
  teamId: int("teamId").notNull(), // FK → teams.id
  memberId: int("memberId").notNull(), // FK → team_members.id
  /** 操作者 userId */
  allocatedBy: int("allocatedBy").notNull(), // FK → users.id
  /** 正數=分配, 負數=回收 */
  amount: int("amount").notNull(),
  /** 分配後該成員的額度 */
  balanceAfter: int("balanceAfter").notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TeamCreditAllocation = typeof teamCreditAllocations.$inferSelect;
export type InsertTeamCreditAllocation = typeof teamCreditAllocations.$inferInsert;

// ═══════════════════════════════════════════
// 團隊活動日誌
// ═══════════════════════════════════════════
export const teamActivityLogs = mysqlTable("team_activity_logs", {
  id: int("id").autoincrement().primaryKey(),
  teamId: int("teamId").notNull(), // FK → teams.id
  userId: int("userId").notNull(), // FK → users.id（執行者）
  action: varchar("action", { length: 50 }).notNull(),
  // action 類型：team_created | member_invited | member_joined | member_removed |
  //             member_suspended | credits_allocated | credits_reclaimed | credits_used |
  //             team_updated | role_changed
  targetUserId: int("targetUserId"), // 被操作的用戶
  description: text("description"),
  metadata: text("metadata"), // JSON string
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TeamActivityLog = typeof teamActivityLogs.$inferSelect;
export type InsertTeamActivityLog = typeof teamActivityLogs.$inferInsert;
