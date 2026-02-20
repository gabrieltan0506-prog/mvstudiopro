import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean } from "drizzle-orm/mysql-core";

// ═══════════════════════════════════════════
// Users
// ═══════════════════════════════════════════
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ═══════════════════════════════════════════
// Guestbook Messages
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
// MV Reviews
// ═══════════════════════════════════════════
export const mvReviews = mysqlTable("mv_reviews", {
  id: int("id").autoincrement().primaryKey(),
  mvId: varchar("mvId", { length: 64 }).notNull(),
  nickname: varchar("nickname", { length: 100 }).notNull(),
  rating: int("rating").notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MvReview = typeof mvReviews.$inferSelect;
export type InsertMvReview = typeof mvReviews.$inferInsert;

// ═══════════════════════════════════════════
// Storyboards
// ═══════════════════════════════════════════
export const storyboards = mysqlTable("storyboards", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  lyrics: text("lyrics").notNull(),
  sceneCount: int("sceneCount").notNull(),
  storyboard: text("storyboard").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Storyboard = typeof storyboards.$inferSelect;
export type InsertStoryboard = typeof storyboards.$inferInsert;

// ═══════════════════════════════════════════
// Payment Submissions
// ═══════════════════════════════════════════
export const paymentSubmissions = mysqlTable("payment_submissions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  packageType: varchar("packageType", { length: 50 }).notNull(),
  amount: varchar("amount", { length: 20 }).notNull(),
  paymentMethod: varchar("paymentMethod", { length: 50 }),
  screenshotUrl: text("screenshotUrl").notNull(),
  status: mysqlEnum("paymentStatus", ["pending", "approved", "rejected"]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PaymentSubmission = typeof paymentSubmissions.$inferSelect;
export type InsertPaymentSubmission = typeof paymentSubmissions.$inferInsert;

// ═══════════════════════════════════════════
// Usage Tracking
// ═══════════════════════════════════════════
export const usageTracking = mysqlTable("usage_tracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  featureType: mysqlEnum("featureType", ["storyboard", "analysis", "avatar"]).notNull(),
  usageCount: int("usageCount").default(0).notNull(),
  lastResetAt: timestamp("lastResetAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type UsageTracking = typeof usageTracking.$inferSelect;
export type InsertUsageTracking = typeof usageTracking.$inferInsert;

// ═══════════════════════════════════════════
// Credit Balances
// ═══════════════════════════════════════════
export const creditBalances = mysqlTable("credit_balances", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  balance: int("balance").default(0).notNull(),
  lifetimeEarned: int("lifetimeEarned").default(0).notNull(),
  lifetimeSpent: int("lifetimeSpent").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CreditBalance = typeof creditBalances.$inferSelect;
export type InsertCreditBalance = typeof creditBalances.$inferInsert;

// ═══════════════════════════════════════════
// Credit Transactions
// ═══════════════════════════════════════════
export const creditTransactions = mysqlTable("credit_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  amount: int("amount").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  action: varchar("action", { length: 50 }),
  description: text("description"),
  balanceAfter: int("balanceAfter").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactions.$inferInsert;

// ═══════════════════════════════════════════
// Teams
// ═══════════════════════════════════════════
export const teams = mysqlTable("teams", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  ownerId: int("ownerId").notNull(),
  maxMembers: int("maxMembers").default(10).notNull(),
  creditPool: int("creditPool").default(0).notNull(),
  creditAllocated: int("creditAllocated").default(0).notNull(),
  inviteCode: varchar("inviteCode", { length: 20 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

// ═══════════════════════════════════════════
// Team Members
// ═══════════════════════════════════════════
export const teamMembers = mysqlTable("team_members", {
  id: int("id").autoincrement().primaryKey(),
  teamId: int("teamId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("teamRole", ["owner", "admin", "member"]).default("member").notNull(),
  allocatedCredits: int("allocatedCredits").default(0).notNull(),
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
// Team Activity Logs
// ═══════════════════════════════════════════
export const teamActivityLogs = mysqlTable("team_activity_logs", {
  id: int("id").autoincrement().primaryKey(),
  teamId: int("teamId").notNull(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  targetUserId: int("targetUserId"),
  description: text("description"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TeamActivityLog = typeof teamActivityLogs.$inferSelect;
export type InsertTeamActivityLog = typeof teamActivityLogs.$inferInsert;

// ═══════════════════════════════════════════
// Beta Quotas
// ═══════════════════════════════════════════
export const betaQuotas = mysqlTable("beta_quotas", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  totalQuota: int("totalQuota").default(0).notNull(),
  usedCount: int("usedCount").default(0).notNull(),
  bonusQuota: int("bonusQuota").default(0).notNull(),
  inviteCode: varchar("inviteCode", { length: 16 }).notNull().unique(),
  isActive: boolean("isActive").default(true).notNull(),
  grantedBy: int("grantedBy").notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type BetaQuota = typeof betaQuotas.$inferSelect;
export type InsertBetaQuota = typeof betaQuotas.$inferInsert;

// ═══════════════════════════════════════════
// Beta Referrals
// ═══════════════════════════════════════════
export const betaReferrals = mysqlTable("beta_referrals", {
  id: int("id").autoincrement().primaryKey(),
  inviterUserId: int("inviterUserId").notNull(),
  inviteeUserId: int("inviteeUserId").notNull(),
  inviteCode: varchar("inviteCode", { length: 16 }).notNull(),
  bonusGranted: int("bonusGranted").default(10).notNull(),
  status: mysqlEnum("referralStatus", ["pending", "completed", "revoked"]).default("completed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type BetaReferral = typeof betaReferrals.$inferSelect;
export type InsertBetaReferral = typeof betaReferrals.$inferInsert;

// ═══════════════════════════════════════════
// Stripe Audit Logs
// ═══════════════════════════════════════════
export const stripeAuditLogs = mysqlTable("stripe_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  eventId: varchar("eventId", { length: 255 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  action: varchar("auditAction", { length: 100 }).notNull(),
  status: varchar("auditStatus", { length: 20 }).default("success").notNull(),
  amount: int("amount"),
  currency: varchar("currency", { length: 10 }).default("usd"),
  metadata: text("metadata"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type StripeAuditLog = typeof stripeAuditLogs.$inferSelect;
export type InsertStripeAuditLog = typeof stripeAuditLogs.$inferInsert;

// ═══════════════════════════════════════════
// KPI Snapshots
// ═══════════════════════════════════════════
export const kpiSnapshots = mysqlTable("kpi_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 10 }).notNull(),
  mrr: int("mrr").default(0).notNull(),
  totalSubscribers: int("totalSubscribers").default(0).notNull(),
  proCount: int("proCount").default(0).notNull(),
  enterpriseCount: int("enterpriseCount").default(0).notNull(),
  freeCount: int("freeCount").default(0).notNull(),
  newSubscribers: int("newSubscribers").default(0).notNull(),
  totalCreditsConsumed: int("totalCreditsConsumed").default(0).notNull(),
  totalRevenue: int("totalRevenue").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;
export type InsertKpiSnapshot = typeof kpiSnapshots.$inferInsert;

// ═══════════════════════════════════════════
// Email Auth
// ═══════════════════════════════════════════
export const emailAuth = mysqlTable("email_auth", {
  id: int("id").primaryKey().autoincrement(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  userId: int("userId").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
});
export type EmailAuth = typeof emailAuth.$inferSelect;
export type NewEmailAuth = typeof emailAuth.$inferInsert;

// ═══════════════════════════════════════════
// Stripe Customers
// ═══════════════════════════════════════════
export const stripeCustomers = mysqlTable("stripe_customers", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }).notNull().unique(),
  plan: varchar("plan", { length: 20 }).default("free").notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  cancelAtPeriodEnd: int("cancelAtPeriodEnd").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type InsertStripeCustomer = typeof stripeCustomers.$inferInsert;

// ═══════════════════════════════════════════
// Usage Logs
// ═══════════════════════════════════════════
export const stripeUsageLogs = mysqlTable("stripe_usage_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("usageAction", { length: 50 }).notNull(),
  creditsCost: int("creditsCost").default(0).notNull(),
  isFreeQuota: int("isFreeQuota").default(0).notNull(),
  description: text("description"),
  balanceAfter: int("balanceAfter"),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type StripeUsageLog = typeof stripeUsageLogs.$inferSelect;
export type InsertStripeUsageLog = typeof stripeUsageLogs.$inferInsert;

// ═══════════════════════════════════════════
// Student Verifications
// ═══════════════════════════════════════════
export const studentVerifications = mysqlTable("student_verifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  schoolEmail: varchar("schoolEmail", { length: 320 }).notNull(),
  schoolEmailVerified: boolean("schoolEmailVerified").default(false).notNull(),
  educationLevel: mysqlEnum("educationLevel", ["elementary", "middle", "high", "university"]).notNull(),
  schoolName: varchar("schoolName", { length: 255 }),
  verificationStatus: mysqlEnum("verificationStatus", ["pending", "approved", "rejected"]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"),
  verifiedAt: timestamp("verifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type StudentVerification = typeof studentVerifications.$inferSelect;
export type InsertStudentVerification = typeof studentVerifications.$inferInsert;

// ═══════════════════════════════════════════
// Video Generations (Veo 3.1)
// ═══════════════════════════════════════════
export const videoGenerations = mysqlTable("video_generations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  storyboardId: int("storyboardId"),
  prompt: text("prompt").notNull(),
  imageUrl: text("imageUrl"),
  videoUrl: text("videoUrl"),
  quality: mysqlEnum("quality", ["fast", "standard"]).default("fast").notNull(),
  resolution: varchar("resolution", { length: 10 }).default("720p").notNull(),
  aspectRatio: varchar("aspectRatio", { length: 10 }).default("16:9").notNull(),
  emotionFilter: varchar("emotionFilter", { length: 50 }),
  transition: varchar("transition", { length: 50 }),
  status: mysqlEnum("status", ["pending", "generating", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  creditsUsed: int("creditsUsed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});
export type VideoGeneration = typeof videoGenerations.$inferSelect;
export type InsertVideoGeneration = typeof videoGenerations.$inferInsert;
