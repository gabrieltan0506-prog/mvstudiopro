import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean } from "drizzle-orm/mysql-core";

/**
 * Extended schema for usage tracking, subscriptions, and phone verification
 */

// User phone verification
export const userPhones = mysqlTable("user_phones", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Foreign key to users.id
  phoneNumber: varchar("phoneNumber", { length: 20 }).notNull().unique(), // E.164 format
  verified: boolean("verified").default(false).notNull(),
  verificationCode: varchar("verificationCode", { length: 10 }),
  verificationExpiry: timestamp("verificationExpiry"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPhone = typeof userPhones.$inferSelect;
export type InsertUserPhone = typeof userPhones.$inferInsert;

// Usage tracking for free tier limits
export const usageTracking = mysqlTable("usage_tracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Foreign key to users.id
  featureType: mysqlEnum("featureType", [
    "storyboard", // 視頻分鏡腳本
    "analysis", // 視頻 PK 評分
    "avatar", // 虛擬偶像生成
    "videoGeneration", // 視頻生成
  ]).notNull(),
  usageCount: int("usageCount").default(0).notNull(), // Current month usage count
  lastResetAt: timestamp("lastResetAt").defaultNow().notNull(), // Last monthly reset
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UsageTracking = typeof usageTracking.$inferSelect;
export type InsertUsageTracking = typeof usageTracking.$inferInsert;

// Student subscriptions (教育優惠)
export const studentSubscriptions = mysqlTable("student_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // Foreign key to users.id, one subscription per user
  subscriptionType: mysqlEnum("subscriptionType", ["trial", "halfYear", "fullYear"]).notNull(),
  status: mysqlEnum("status", ["pending", "active", "expired", "cancelled"]).default("pending").notNull(),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // USD
  paymentMethod: varchar("paymentMethod", { length: 50 }), // stripe, wechat, etc.
  paymentId: varchar("paymentId", { length: 255 }), // External payment reference
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StudentSubscription = typeof studentSubscriptions.$inferSelect;
export type InsertStudentSubscription = typeof studentSubscriptions.$inferInsert;

// Student verification (學生身份驗證)
export const studentVerifications = mysqlTable("student_verifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // Foreign key to users.id
  studentIdImageUrl: varchar("studentIdImageUrl", { length: 500 }), // S3 URL of student ID photo
  schoolEmail: varchar("schoolEmail", { length: 320 }).notNull(), // School email address
  schoolEmailVerified: boolean("schoolEmailVerified").default(false).notNull(),
  verificationCode: varchar("verificationCode", { length: 10 }),
  verificationExpiry: timestamp("verificationExpiry"),
  educationLevel: mysqlEnum("educationLevel", [
    "elementary", // 小學
    "middle", // 初中
    "high", // 高中
    "university", // 大學
  ]).notNull(),
  schoolName: varchar("schoolName", { length: 255 }),
  verificationStatus: mysqlEnum("verificationStatus", [
    "pending", // 待審核
    "approved", // 已通過
    "rejected", // 已拒絕
  ]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  verifiedAt: timestamp("verifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StudentVerification = typeof studentVerifications.$inferSelect;
export type InsertStudentVerification = typeof studentVerifications.$inferInsert;

// Payment transactions
export const paymentTransactions = mysqlTable("payment_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Foreign key to users.id
  transactionType: mysqlEnum("transactionType", [
    "storyboard_pack", // 視頻分鏡腳本套餐 ($12/4次)
    "analysis_pack", // 視頻 PK 評分套餐 ($15/2次)
    "avatar_pack", // 虛擬偶像套餐 ($3/5次)
    "student_subscription", // 學生訂閱
  ]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // USD
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 50 }).notNull(), // stripe, wechat, alipay
  paymentId: varchar("paymentId", { length: 255 }).notNull(), // External payment reference
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"]).default("pending").notNull(),
  metadata: text("metadata"), // JSON string for additional data
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = typeof paymentTransactions.$inferInsert;

// User content usage rights (教育優惠用戶協議)
export const contentUsageAgreements = mysqlTable("content_usage_agreements", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // Foreign key to users.id
  agreedToTerms: boolean("agreedToTerms").default(false).notNull(),
  agreedAt: timestamp("agreedAt"),
  allowPlatformDisplay: boolean("allowPlatformDisplay").default(true).notNull(), // 允許平台展示
  allowMarketingUse: boolean("allowMarketingUse").default(true).notNull(), // 允許市場推廣
  allowModelTraining: boolean("allowModelTraining").default(true).notNull(), // 允許訓練 AI 模型
  preferAnonymous: boolean("preferAnonymous").default(false).notNull(), // 偏好匿名展示
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContentUsageAgreement = typeof contentUsageAgreements.$inferSelect;
export type InsertContentUsageAgreement = typeof contentUsageAgreements.$inferInsert;
