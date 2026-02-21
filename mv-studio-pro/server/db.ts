import { eq, desc, and, avg, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, guestbookMessages, InsertGuestbookMessage, mvReviews, InsertMvReview, storyboards, InsertStoryboard, Storyboard, paymentSubmissions } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ── Guestbook Messages ──

export async function createGuestbookMessage(data: InsertGuestbookMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(guestbookMessages).values(data);
  return result[0].insertId;
}

export async function getGuestbookMessages(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(guestbookMessages)
    .orderBy(desc(guestbookMessages.createdAt))
    .limit(limit);
}

// ── MV Reviews ──

export async function createMvReview(data: InsertMvReview) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(mvReviews).values(data);
  return result[0].insertId;
}

export async function getMvReviews(mvId: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(mvReviews)
    .where(eq(mvReviews.mvId, mvId))
    .orderBy(desc(mvReviews.createdAt))
    .limit(limit);
}

export async function getMvRatingStats(mvId: string) {
  const db = await getDb();
  if (!db) return { avgRating: 0, totalReviews: 0 };
  const result = await db
    .select({
      avgRating: avg(mvReviews.rating),
      totalReviews: count(mvReviews.id),
    })
    .from(mvReviews)
    .where(eq(mvReviews.mvId, mvId));
  return {
    avgRating: result[0]?.avgRating ? parseFloat(String(result[0].avgRating)) : 0,
    totalReviews: result[0]?.totalReviews ?? 0,
  };
}

// ── Storyboards ──

export async function createStoryboard(data: InsertStoryboard) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(storyboards).values(data);
  return result[0].insertId;
}

export async function getStoryboardById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(storyboards).where(eq(storyboards.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserStoryboards(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(storyboards)
    .where(eq(storyboards.userId, userId))
    .orderBy(desc(storyboards.createdAt))
    .limit(limit);
}

export async function getPendingStoryboards(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(storyboards)
    .where(eq(storyboards.status, "pending"))
    .orderBy(desc(storyboards.createdAt))
    .limit(limit);
}

export async function updateStoryboardStatus(
  id: number,
  status: "approved" | "rejected",
  reviewedBy: number,
  rejectionReason?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(storyboards)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      rejectionReason: rejectionReason || null,
    })
    .where(eq(storyboards.id, id));
}

// Payment submission functions
export async function createPaymentSubmission(data: {
  userId: number;
  packageType: string;
  amount: string;
  paymentMethod?: string;
  screenshotUrl: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(paymentSubmissions).values({
    userId: data.userId,
    packageType: data.packageType,
    amount: data.amount,
    paymentMethod: data.paymentMethod || null,
    screenshotUrl: data.screenshotUrl,
    status: "pending",
  });
  
  return result;
}

export async function getPendingPayments(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(paymentSubmissions)
    .where(eq(paymentSubmissions.status, "pending"))
    .orderBy(desc(paymentSubmissions.createdAt))
    .limit(limit);
}

export async function updatePaymentStatus(
  id: number,
  status: "approved" | "rejected",
  reviewedBy: number,
  rejectionReason?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(paymentSubmissions)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      rejectionReason: rejectionReason || null,
    })
    .where(eq(paymentSubmissions.id, id));
}

export async function getPaymentById(paymentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(paymentSubmissions)
    .where(eq(paymentSubmissions.id, paymentId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserPayments(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(paymentSubmissions)
    .where(eq(paymentSubmissions.userId, userId))
    .orderBy(desc(paymentSubmissions.createdAt))
    .limit(limit);
}
