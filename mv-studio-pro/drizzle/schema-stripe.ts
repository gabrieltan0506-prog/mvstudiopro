import { int, mysqlTable, text, timestamp, varchar, decimal } from "drizzle-orm/mysql-core";

/**
 * Stripe + Credits 付費系統 Schema
 * 
 * 包含：
 * - stripe_customers: Stripe 客戶映射
 * - subscriptions: 訂閱記錄
 * - credit_balances: Credits 餘額
 * - credit_transactions: Credits 交易記錄（充值/扣費）
 * - stripe_usage_logs: 功能使用日誌（每次扣費記錄）
 * - coupons: 優惠碼
 */

// ═══════════════════════════════════════════
// Stripe 客戶映射
// ═══════════════════════════════════════════
export const stripeCustomers = mysqlTable("stripe_customers", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // FK → users.id
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }).notNull().unique(),
  plan: varchar("plan", { length: 20 }).default("free").notNull(), // free | pro | enterprise
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  trialEndsAt: timestamp("trialEndsAt"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  cancelAtPeriodEnd: int("cancelAtPeriodEnd").default(0).notNull(), // 0 = false, 1 = true
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type InsertStripeCustomer = typeof stripeCustomers.$inferInsert;

// ═══════════════════════════════════════════
// Credits 餘額
// ═══════════════════════════════════════════
export const creditBalances = mysqlTable("credit_balances", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // FK → users.id
  balance: int("balance").default(0).notNull(),
  lifetimeEarned: int("lifetimeEarned").default(0).notNull(), // 累計獲得
  lifetimeSpent: int("lifetimeSpent").default(0).notNull(), // 累計消耗
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CreditBalance = typeof creditBalances.$inferSelect;
export type InsertCreditBalance = typeof creditBalances.$inferInsert;

// ═══════════════════════════════════════════
// Credits 交易記錄
// ═══════════════════════════════════════════
export const creditTransactions = mysqlTable("credit_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  amount: int("amount").notNull(), // 正數=充值, 負數=扣費
  type: varchar("type", { length: 20 }).notNull(), // credit | debit
  source: varchar("source", { length: 50 }).notNull(), // subscription | purchase | bonus | beta | referral | usage
  action: varchar("action", { length: 50 }), // mvAnalysis | idolGeneration | storyboard | videoGeneration
  description: text("description"),
  balanceAfter: int("balanceAfter").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactions.$inferInsert;

// ═══════════════════════════════════════════
// 功能使用日誌
// ═══════════════════════════════════════════
export const stripeUsageLogs = mysqlTable("stripe_usage_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // FK → users.id
  action: varchar("action", { length: 50 }).notNull(), // mvAnalysis | idolGeneration | storyboard | videoGeneration
  creditsCost: int("creditsCost").default(0).notNull(),
  isFreeQuota: int("isFreeQuota").default(0).notNull(), // 0 = paid, 1 = free quota
  description: text("description"),
  balanceAfter: int("balanceAfter"),
  metadata: text("metadata"), // JSON string
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StripeUsageLog = typeof stripeUsageLogs.$inferSelect;
export type InsertStripeUsageLog = typeof stripeUsageLogs.$inferInsert;

// ═══════════════════════════════════════════
// 優惠碼
// ═══════════════════════════════════════════
export const coupons = mysqlTable("coupons", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  discountPercent: int("discountPercent").default(0).notNull(), // 百分比折扣 (10 = 10% off)
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }), // 固定金額折扣
  maxUses: int("maxUses").default(100).notNull(),
  usedCount: int("usedCount").default(0).notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Coupon = typeof coupons.$inferSelect;
export type InsertCoupon = typeof coupons.$inferInsert;
