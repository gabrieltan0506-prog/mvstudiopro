import { eq, and, gte } from "drizzle-orm";
import { getDb } from "./db";
import {
  userPhones,
  InsertUserPhone,
  usageTracking,
  InsertUsageTracking,
  studentSubscriptions,
  InsertStudentSubscription,
  studentVerifications,
  InsertStudentVerification,
  paymentTransactions,
  InsertPaymentTransaction,
  contentUsageAgreements,
  InsertContentUsageAgreement,
} from "../drizzle/schema";

// ── User Phone Verification ──

export async function createOrUpdateUserPhone(data: InsertUserPhone) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(userPhones)
    .where(eq(userPhones.userId, data.userId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(userPhones).set(data).where(eq(userPhones.userId, data.userId));
    return existing[0].id;
  } else {
    const result = await db.insert(userPhones).values(data);
    return result[0].insertId;
  }
}

export async function getUserPhoneByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(userPhones).where(eq(userPhones.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserPhoneByPhoneNumber(phoneNumber: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(userPhones).where(eq(userPhones.phoneNumber, phoneNumber)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function verifyUserPhone(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(userPhones).set({ verified: true }).where(eq(userPhones.userId, userId));
}

// ── Usage Tracking ──

export async function getOrCreateUsageTracking(userId: number, featureType: "storyboard" | "analysis" | "avatar" | "videoGeneration") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(usageTracking)
    .where(and(eq(usageTracking.userId, userId), eq(usageTracking.featureType, featureType)))
    .limit(1);

  if (existing.length > 0) {
    const record = existing[0];
    // Check if we need to reset monthly usage
    const now = new Date();
    const lastReset = new Date(record.lastResetAt);
    const monthsSinceReset =
      (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());

    if (monthsSinceReset >= 1) {
      // Reset usage count for new month
      await db
        .update(usageTracking)
        .set({ usageCount: 0, lastResetAt: now })
        .where(eq(usageTracking.id, record.id));
      return { ...record, usageCount: 0, lastResetAt: now };
    }

    return record;
  } else {
    const data: InsertUsageTracking = {
      userId,
      featureType,
      usageCount: 0,
      lastResetAt: new Date(),
    };
    const result = await db.insert(usageTracking).values(data);
    return { id: result[0].insertId, ...data };
  }
}

export async function incrementUsageCount(userId: number, featureType: "storyboard" | "analysis" | "avatar" | "videoGeneration") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const record = await getOrCreateUsageTracking(userId, featureType);

  const newCount = (record.usageCount ?? 0) + 1;
  await db
    .update(usageTracking)
    .set({ usageCount: newCount })
    .where(eq(usageTracking.id, record.id));

  return newCount;
}

/**
 * Decrease usage count (add credits) for a user's feature.
 * This is used when a user purchases a package to add usage credits.
 */
export async function decreaseUsageCount(userId: number, featureType: "storyboard" | "analysis" | "avatar" | "videoGeneration", amount: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const record = await getOrCreateUsageTracking(userId, featureType);

  // Decrease usage count (add credits)
  const newCount = Math.max(0, (record.usageCount ?? 0) - amount);
  await db
    .update(usageTracking)
    .set({ usageCount: newCount })
    .where(eq(usageTracking.id, record.id));

  return newCount;
}

export async function checkUsageLimit(
  userId: number,
  featureType: "storyboard" | "analysis" | "avatar" | "videoGeneration"
): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
  const record = await getOrCreateUsageTracking(userId, featureType);

  const limits: Record<string, number> = {
    storyboard: 1, // First one free
    analysis: 2, // First 2 free
    avatar: 3, // First 3 free
    videoGeneration: 0, // No free video generation
  };

  const limit = limits[featureType] ?? 0;
  const currentCount = record.usageCount ?? 0;
  const allowed = currentCount < limit;

  return { allowed, currentCount, limit };
}

// ── Student Subscriptions ──

export async function createStudentSubscription(data: InsertStudentSubscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(studentSubscriptions).values(data);
  return result[0].insertId;
}

export async function getStudentSubscriptionByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(studentSubscriptions)
    .where(eq(studentSubscriptions.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function hasActiveStudentSubscription(userId: number): Promise<boolean> {
  const subscription = await getStudentSubscriptionByUserId(userId);
  if (!subscription) return false;

  if (subscription.status !== "active") return false;

  if (subscription.endDate) {
    const now = new Date();
    return now <= subscription.endDate;
  }

  return true;
}

export async function updateStudentSubscriptionStatus(
  userId: number,
  status: "pending" | "active" | "expired" | "cancelled"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(studentSubscriptions).set({ status }).where(eq(studentSubscriptions.userId, userId));
}

export async function deleteStudentSubscription(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(studentSubscriptions).where(eq(studentSubscriptions.userId, userId));
}

// ── Student Verifications ──

export async function createOrUpdateStudentVerification(data: InsertStudentVerification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(studentVerifications)
    .where(eq(studentVerifications.userId, data.userId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(studentVerifications).set(data).where(eq(studentVerifications.userId, data.userId));
    return existing[0].id;
  } else {
    const result = await db.insert(studentVerifications).values(data);
    return result[0].insertId;
  }
}

export async function getStudentVerificationByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(studentVerifications)
    .where(eq(studentVerifications.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateStudentVerificationStatus(
  userId: number,
  status: "pending" | "approved" | "rejected",
  rejectionReason?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = { verificationStatus: status };
  if (status === "approved") {
    updateData.verifiedAt = new Date();
  }
  if (status === "rejected" && rejectionReason) {
    updateData.rejectionReason = rejectionReason;
  }

  await db.update(studentVerifications).set(updateData).where(eq(studentVerifications.userId, userId));
}

// ── Payment Transactions ──

export async function createPaymentTransaction(data: InsertPaymentTransaction) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(paymentTransactions).values(data);
  return result[0].insertId;
}

export async function getPaymentTransactionsByUserId(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(paymentTransactions).where(eq(paymentTransactions.userId, userId)).limit(limit);
}

export async function updatePaymentTransactionStatus(
  transactionId: number,
  status: "pending" | "completed" | "failed" | "refunded"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(paymentTransactions).set({ status }).where(eq(paymentTransactions.id, transactionId));
}

// ── Content Usage Agreements ──

export async function createOrUpdateContentUsageAgreement(data: InsertContentUsageAgreement) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(contentUsageAgreements)
    .where(eq(contentUsageAgreements.userId, data.userId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(contentUsageAgreements).set(data).where(eq(contentUsageAgreements.userId, data.userId));
    return existing[0].id;
  } else {
    const result = await db.insert(contentUsageAgreements).values(data);
    return result[0].insertId;
  }
}

export async function getContentUsageAgreementByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(contentUsageAgreements)
    .where(eq(contentUsageAgreements.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function hasAgreedToContentUsage(userId: number): Promise<boolean> {
  const agreement = await getContentUsageAgreementByUserId(userId);
  return agreement?.agreedToTerms ?? false;
}
