import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Stripe 審計日誌 Schema
 * 
 * 記錄所有 Stripe 相關操作，用於合規審計和問題排查。
 * 包括：支付、退款、訂閱變更、Webhook 事件等。
 */

// ═══════════════════════════════════════════
// 審計日誌
// ═══════════════════════════════════════════
export const stripeAuditLogs = mysqlTable("stripe_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"), // 可為 null（系統事件）
  eventType: varchar("eventType", { length: 100 }).notNull(), // checkout.completed, subscription.created, refund, portal.opened 等
  eventId: varchar("eventId", { length: 255 }), // Stripe Event ID（Webhook 事件）
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  action: varchar("action", { length: 100 }).notNull(), // create, update, delete, refund, portal_open 等
  status: varchar("status", { length: 20 }).default("success").notNull(), // success, failed, pending
  amount: int("amount"), // 金額（分為單位），退款為負數
  currency: varchar("currency", { length: 10 }).default("usd"),
  metadata: text("metadata"), // JSON string，附加數據
  errorMessage: text("errorMessage"), // 失敗時的錯誤信息
  ipAddress: varchar("ipAddress", { length: 45 }), // 請求 IP
  userAgent: text("userAgent"), // 請求 User-Agent
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StripeAuditLog = typeof stripeAuditLogs.$inferSelect;
export type InsertStripeAuditLog = typeof stripeAuditLogs.$inferInsert;

// ═══════════════════════════════════════════
// 發票記錄（同步自 Stripe）
// ═══════════════════════════════════════════
export const stripeInvoices = mysqlTable("stripe_invoices", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  stripeInvoiceId: varchar("stripeInvoiceId", { length: 255 }).notNull().unique(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }).notNull(),
  status: varchar("status", { length: 30 }).notNull(), // draft, open, paid, void, uncollectible
  amountDue: int("amountDue").default(0).notNull(), // 分為單位
  amountPaid: int("amountPaid").default(0).notNull(),
  currency: varchar("currency", { length: 10 }).default("usd").notNull(),
  invoiceUrl: text("invoiceUrl"), // Stripe 託管的發票頁面 URL
  invoicePdf: text("invoicePdf"), // PDF 下載 URL
  billingReason: varchar("billingReason", { length: 50 }), // subscription_create, subscription_cycle, manual
  periodStart: timestamp("periodStart"),
  periodEnd: timestamp("periodEnd"),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StripeInvoice = typeof stripeInvoices.$inferSelect;
export type InsertStripeInvoice = typeof stripeInvoices.$inferInsert;

// ═══════════════════════════════════════════
// KPI 快照（每日記錄關鍵指標）
// ═══════════════════════════════════════════
export const kpiSnapshots = mysqlTable("kpi_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  mrr: int("mrr").default(0).notNull(), // Monthly Recurring Revenue（分為單位）
  totalSubscribers: int("totalSubscribers").default(0).notNull(),
  proCount: int("proCount").default(0).notNull(),
  enterpriseCount: int("enterpriseCount").default(0).notNull(),
  freeCount: int("freeCount").default(0).notNull(),
  trialCount: int("trialCount").default(0).notNull(),
  newSubscribers: int("newSubscribers").default(0).notNull(), // 當日新增
  churnedSubscribers: int("churnedSubscribers").default(0).notNull(), // 當日流失
  trialToPaidConversions: int("trialToPaidConversions").default(0).notNull(), // 試用轉付費
  totalCreditsConsumed: int("totalCreditsConsumed").default(0).notNull(),
  totalRevenue: int("totalRevenue").default(0).notNull(), // 當日收入（分為單位）
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;
export type InsertKpiSnapshot = typeof kpiSnapshots.$inferInsert;
