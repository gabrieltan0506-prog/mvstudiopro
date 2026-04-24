import { boolean, decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Extended schema for usage tracking, subscriptions, and phone verification
 */

// User phone verification
export const userPhones = pgTable("user_phones", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(), // Foreign key to users.id
  phoneNumber: varchar("phoneNumber", { length: 20 }).notNull().unique(), // E.164 format
  verified: boolean("verified").default(false).notNull(),
  verificationCode: varchar("verificationCode", { length: 10 }),
  verificationExpiry: timestamp("verificationExpiry"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type UserPhone = typeof userPhones.$inferSelect;
export type InsertUserPhone = typeof userPhones.$inferInsert;

// Usage tracking for free tier limits
export const usageTracking = pgTable("usage_tracking", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(), // Foreign key to users.id
  featureType: text("featureType").notNull(),
  usageCount: integer("usageCount").default(0).notNull(), // Current month usage count
  lastResetAt: timestamp("lastResetAt").defaultNow().notNull(), // Last monthly reset
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type UsageTracking = typeof usageTracking.$inferSelect;
export type InsertUsageTracking = typeof usageTracking.$inferInsert;

// Student subscriptions (教育優惠)
export const studentSubscriptions = pgTable("student_subscriptions", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull().unique(), // Foreign key to users.id, one subscription per user
  subscriptionType: text("subscriptionType").notNull(),
  status: text("status").default("pending").notNull(),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // USD
  paymentMethod: varchar("paymentMethod", { length: 50 }), // stripe, wechat, etc.
  paymentId: varchar("paymentId", { length: 255 }), // External payment reference
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type StudentSubscription = typeof studentSubscriptions.$inferSelect;
export type InsertStudentSubscription = typeof studentSubscriptions.$inferInsert;

// Student verification (學生身份驗證)
export const studentVerifications = pgTable("student_verifications", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull().unique(), // Foreign key to users.id
  studentIdImageUrl: varchar("studentIdImageUrl", { length: 500 }), // S3 URL of student ID photo
  schoolEmail: varchar("schoolEmail", { length: 320 }).notNull(), // School email address
  schoolEmailVerified: boolean("schoolEmailVerified").default(false).notNull(),
  verificationCode: varchar("verificationCode", { length: 10 }),
  verificationExpiry: timestamp("verificationExpiry"),
  educationLevel: text("educationLevel").notNull(),
  schoolName: varchar("schoolName", { length: 255 }),
  verificationStatus: text("verificationStatus").default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  verifiedAt: timestamp("verifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type StudentVerification = typeof studentVerifications.$inferSelect;
export type InsertStudentVerification = typeof studentVerifications.$inferInsert;

// Payment transactions
export const paymentTransactions = pgTable("payment_transactions", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(), // Foreign key to users.id
  transactionType: text("transactionType").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // USD
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 50 }).notNull(), // stripe, wechat, alipay
  paymentId: varchar("paymentId", { length: 255 }).notNull(), // External payment reference
  status: text("status").default("pending").notNull(),
  metadata: text("metadata"), // JSON string for additional data
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = typeof paymentTransactions.$inferInsert;

// User content usage rights (教育優惠用戶協議)
export const contentUsageAgreements = pgTable("content_usage_agreements", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull().unique(), // Foreign key to users.id
  agreedToTerms: boolean("agreedToTerms").default(false).notNull(),
  agreedAt: timestamp("agreedAt"),
  allowPlatformDisplay: boolean("allowPlatformDisplay").default(true).notNull(), // 允許平台展示
  allowMarketingUse: boolean("allowMarketingUse").default(true).notNull(), // 允許市場推廣
  allowModelTraining: boolean("allowModelTraining").default(true).notNull(), // 允許訓練 AI 模型
  preferAnonymous: boolean("preferAnonymous").default(false).notNull(), // 偏好匿名展示
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ContentUsageAgreement = typeof contentUsageAgreements.$inferSelect;
export type InsertContentUsageAgreement = typeof contentUsageAgreements.$inferInsert;
