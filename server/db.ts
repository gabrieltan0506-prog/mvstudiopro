import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  guestbookMessages, InsertGuestbookMessage,
  mvReviews, InsertMvReview,
  storyboards, InsertStoryboard,
  paymentSubmissions, InsertPaymentSubmission,
  usageTracking, InsertUsageTracking,
  creditBalances, InsertCreditBalance,
  creditTransactions, InsertCreditTransaction,
  teams, InsertTeam, teamMembers, InsertTeamMember, teamActivityLogs, InsertTeamActivityLog,
  betaQuotas, InsertBetaQuota, betaReferrals,
  stripeAuditLogs, kpiSnapshots,
  stripeCustomers, stripeUsageLogs,
  studentVerifications, InsertStudentVerification,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { CREDIT_COSTS } from "../shared/plans";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch (e) { console.warn("[DB] Failed:", e); _db = null; }
  }
  return _db;
}

// ─── User ────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach(f => { const v = user[f]; if (v !== undefined) { values[f] = v ?? null; updateSet[f] = v ?? null; } });
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; } else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return r[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const r = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return r[0];
}

// ─── Guestbook ───────────────────────────
export async function createGuestbookMessage(data: InsertGuestbookMessage) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(guestbookMessages).values(data);
  return r[0].insertId;
}
export async function getGuestbookMessages(limit = 50) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(guestbookMessages).orderBy(desc(guestbookMessages.createdAt)).limit(limit);
}

// ─── MV Reviews ──────────────────────────
export async function createMvReview(data: InsertMvReview) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(mvReviews).values(data);
  return r[0].insertId;
}
export async function getMvReviewsByMvId(mvId: string, limit = 50) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(mvReviews).where(eq(mvReviews.mvId, mvId)).orderBy(desc(mvReviews.createdAt)).limit(limit);
}

// ─── Storyboards ─────────────────────────
export async function createStoryboard(data: InsertStoryboard) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(storyboards).values(data);
  return r[0].insertId;
}
export async function getStoryboardsByUserId(userId: number, limit = 20) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(storyboards).where(eq(storyboards.userId, userId)).orderBy(desc(storyboards.createdAt)).limit(limit);
}
export async function getAllStoryboards(limit = 50) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(storyboards).orderBy(desc(storyboards.createdAt)).limit(limit);
}
export async function updateStoryboardStatus(id: number, status: "pending" | "approved" | "rejected", reviewedBy: number, rejectionReason?: string) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  await db.update(storyboards).set({ status, reviewedBy, reviewedAt: new Date(), rejectionReason: rejectionReason ?? null }).where(eq(storyboards.id, id));
}

// ─── Payment Submissions ─────────────────
export async function createPaymentSubmission(data: InsertPaymentSubmission) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(paymentSubmissions).values(data);
  return r[0].insertId;
}
export async function getPaymentSubmissions(status?: "pending" | "approved" | "rejected", limit = 50) {
  const db = await getDb(); if (!db) return [];
  const q = status ? db.select().from(paymentSubmissions).where(eq(paymentSubmissions.status, status)) : db.select().from(paymentSubmissions);
  return q.orderBy(desc(paymentSubmissions.createdAt)).limit(limit);
}
export async function updatePaymentSubmissionStatus(id: number, status: "pending" | "approved" | "rejected", reviewedBy: number, rejectionReason?: string) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  await db.update(paymentSubmissions).set({ status, reviewedBy, reviewedAt: new Date(), rejectionReason: rejectionReason ?? null }).where(eq(paymentSubmissions.id, id));
}

// ─── Usage Tracking ──────────────────────
export async function getOrCreateUsageTracking(userId: number, featureType: "storyboard" | "analysis" | "avatar") {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const existing = await db.select().from(usageTracking).where(and(eq(usageTracking.userId, userId), eq(usageTracking.featureType, featureType))).limit(1);
  if (existing.length > 0) {
    const rec = existing[0];
    const now = new Date(); const last = new Date(rec.lastResetAt);
    if ((now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth()) >= 1) {
      await db.update(usageTracking).set({ usageCount: 0, lastResetAt: now }).where(eq(usageTracking.id, rec.id));
      return { ...rec, usageCount: 0, lastResetAt: now };
    }
    return rec;
  }
  const data: InsertUsageTracking = { userId, featureType, usageCount: 0, lastResetAt: new Date() };
  const r = await db.insert(usageTracking).values(data);
  return { id: r[0].insertId, ...data, createdAt: new Date(), updatedAt: new Date() };
}
export async function incrementUsageCount(userId: number, featureType: "storyboard" | "analysis" | "avatar") {
  const rec = await getOrCreateUsageTracking(userId, featureType);
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const newCount = (rec.usageCount ?? 0) + 1;
  await db.update(usageTracking).set({ usageCount: newCount }).where(eq(usageTracking.id, rec.id));
  return newCount;
}
export async function checkUsageLimit(userId: number, featureType: "storyboard" | "analysis" | "avatar") {
  const rec = await getOrCreateUsageTracking(userId, featureType);
  const limits = { storyboard: 1, analysis: 2, avatar: 3 };
  const limit = limits[featureType];
  const currentCount = rec.usageCount ?? 0;
  return { allowed: currentCount < limit, currentCount, limit };
}

// ─── Credits ─────────────────────────────
async function isAdmin(userId: number): Promise<boolean> {
  const db = await getDb(); if (!db) return false;
  const u = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return u.length > 0 && u[0].role === "admin";
}

export async function getOrCreateBalance(userId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const existing = await db.select().from(creditBalances).where(eq(creditBalances.userId, userId)).limit(1);
  if (existing.length > 0) return existing[0];
  await db.insert(creditBalances).values({ userId, balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 });
  const created = await db.select().from(creditBalances).where(eq(creditBalances.userId, userId)).limit(1);
  return created[0];
}

export async function deductCredits(userId: number, action: keyof typeof CREDIT_COSTS, description?: string) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  if (await isAdmin(userId)) return { success: true, cost: 0, remainingBalance: -1, source: "admin" as const };
  const cost = CREDIT_COSTS[action];
  const balance = await getOrCreateBalance(userId);
  if (balance.balance < cost) return { success: false, cost, remainingBalance: balance.balance, source: "insufficient" as const };
  const newBalance = balance.balance - cost;
  await db.update(creditBalances).set({ balance: newBalance, lifetimeSpent: balance.lifetimeSpent + cost }).where(eq(creditBalances.userId, userId));
  await db.insert(creditTransactions).values({ userId, amount: -cost, type: "debit", source: "usage", action, description: description ?? `Used ${action}`, balanceAfter: newBalance });
  return { success: true, cost, remainingBalance: newBalance, source: "personal" as const };
}

export async function addCredits(userId: number, amount: number, source: string, description?: string) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const balance = await getOrCreateBalance(userId);
  const newBalance = balance.balance + amount;
  await db.update(creditBalances).set({ balance: newBalance, lifetimeEarned: balance.lifetimeEarned + amount }).where(eq(creditBalances.userId, userId));
  await db.insert(creditTransactions).values({ userId, amount, type: "credit", source, description: description ?? `Added ${amount} credits`, balanceAfter: newBalance });
  return newBalance;
}

export async function getCreditTransactions(userId: number, limit = 50) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt)).limit(limit);
}

// ─── Teams ───────────────────────────────
export async function createTeam(data: InsertTeam) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(teams).values(data);
  return r[0].insertId;
}
export async function getTeamById(id: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
  return r[0];
}
export async function getTeamByOwnerId(ownerId: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(teams).where(eq(teams.ownerId, ownerId)).limit(1);
  return r[0];
}
export async function getTeamByInviteCode(code: string) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(teams).where(eq(teams.inviteCode, code)).limit(1);
  return r[0];
}
export async function addTeamMember(data: InsertTeamMember) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(teamMembers).values(data);
  return r[0].insertId;
}
export async function getTeamMembers(teamId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
}
export async function getUserTeamMembership(userId: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(teamMembers).where(and(eq(teamMembers.userId, userId), eq(teamMembers.status, "active"))).limit(1);
  return r[0];
}
export async function removeTeamMember(memberId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  await db.update(teamMembers).set({ status: "removed" }).where(eq(teamMembers.id, memberId));
}
export async function logTeamActivity(data: InsertTeamActivityLog) {
  const db = await getDb(); if (!db) return;
  await db.insert(teamActivityLogs).values(data);
}
export async function getAllTeams(limit = 50) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(teams).orderBy(desc(teams.createdAt)).limit(limit);
}

// ─── Beta ────────────────────────────────
export async function createBetaQuota(data: InsertBetaQuota) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(betaQuotas).values(data);
  return r[0].insertId;
}
export async function getBetaQuotaByUserId(userId: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(betaQuotas).where(eq(betaQuotas.userId, userId)).limit(1);
  return r[0];
}
export async function getAllBetaQuotas(limit = 100) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(betaQuotas).orderBy(desc(betaQuotas.createdAt)).limit(limit);
}
export async function updateBetaQuota(userId: number, updates: Partial<{ totalQuota: number; isActive: boolean; note: string }>) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  await db.update(betaQuotas).set(updates).where(eq(betaQuotas.userId, userId));
}

// ─── Student Verification ────────────────
export async function createStudentVerification(data: InsertStudentVerification) {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(studentVerifications).values(data);
  return r[0].insertId;
}
export async function getStudentVerificationByUserId(userId: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(studentVerifications).where(eq(studentVerifications.userId, userId)).limit(1);
  return r[0];
}

// ─── Admin Stats ─────────────────────────
export async function getAdminStats() {
  const db = await getDb(); if (!db) return null;
  const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const [teamCount] = await db.select({ count: sql<number>`count(*)` }).from(teams);
  const [pendingPayments] = await db.select({ count: sql<number>`count(*)` }).from(paymentSubmissions).where(eq(paymentSubmissions.status, "pending"));
  const [betaCount] = await db.select({ count: sql<number>`count(*)` }).from(betaQuotas);
  return { users: userCount.count, teams: teamCount.count, pendingPayments: pendingPayments.count, betaUsers: betaCount.count };
}
