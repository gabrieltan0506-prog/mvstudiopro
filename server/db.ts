import { eq, desc, and, avg, count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, guestbookMessages, InsertGuestbookMessage, mvReviews, InsertMvReview, storyboards, InsertStoryboard, Storyboard, paymentSubmissions } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { isSupervisorEmail } from "./services/access-policy";

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
    } else if (isSupervisorEmail(user.email)) {
      values.role = "supervisor";
      updateSet.role = "supervisor";
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



// === Restored functions (simplified stubs for missing tables) ===
import { teams } from "../drizzle/schema-teams";
import { betaQuotas } from "../drizzle/schema-beta";

export type AdminStats = {
  totalUsers: number;
  totalTeams: number;
  totalBetaQuotas: number;
  /** 今日有登录/会话刷新（lastSignedIn 为今日） */
  dau: number;
  /** 近 7 天活跃（lastSignedIn） */
  wau7: number;
  /** 近 30 天活跃（lastSignedIn） */
  mau30: number;
  /** 今日新注册 */
  newUsersToday: number;
  /** 各角色人数 */
  usersByRole: Record<string, number>;
};

export async function getAdminStats(): Promise<AdminStats> {
  const empty: AdminStats = {
    totalUsers: 0,
    totalTeams: 0,
    totalBetaQuotas: 0,
    dau: 0,
    wau7: 0,
    mau30: 0,
    newUsersToday: 0,
    usersByRole: {},
  };
  const db = await getDb();
  if (!db) return empty;

  const [userCount] = await db.select({ count: count() }).from(users);
  const [teamCount] = await db.select({ count: count() }).from(teams);
  const [betaCount] = await db.select({ count: count() }).from(betaQuotas);

  const [dauRow] = await db
    .select({ c: count() })
    .from(users)
    .where(sql`DATE(${users.lastSignedIn}) = CURDATE()`);
  const [wauRow] = await db
    .select({ c: count() })
    .from(users)
    .where(sql`${users.lastSignedIn} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`);
  const [mauRow] = await db
    .select({ c: count() })
    .from(users)
    .where(sql`${users.lastSignedIn} >= DATE_SUB(NOW(), INTERVAL 30 DAY)`);
  const [newTodayRow] = await db
    .select({ c: count() })
    .from(users)
    .where(sql`DATE(${users.createdAt}) = CURDATE()`);

  const roleRows = await db
    .select({ role: users.role, c: count() })
    .from(users)
    .groupBy(users.role);

  const usersByRole: Record<string, number> = {};
  for (const row of roleRows) {
    usersByRole[String(row.role)] = row.c;
  }

  return {
    totalUsers: userCount?.count ?? 0,
    totalTeams: teamCount?.count ?? 0,
    totalBetaQuotas: betaCount?.count ?? 0,
    dau: dauRow?.c ?? 0,
    wau7: wauRow?.c ?? 0,
    mau30: mauRow?.c ?? 0,
    newUsersToday: newTodayRow?.c ?? 0,
    usersByRole,
  };
}

// Video comments - in-memory store (until videoComments table is created)
const commentsStore: Array<{
  id: number; videoUrl: string; userId: number; parentId?: number;
  content: string; createdAt: Date; likes: number; likedBy: Set<number>;
}> = [];
let commentIdCounter = 1;

export async function getVideoComments(videoUrl: string) {
  return commentsStore
    .filter(c => c.videoUrl === videoUrl)
    .map(c => ({ ...c, likedBy: undefined }));
}

export async function addVideoComment(data: { videoUrl: string; userId: number; parentId?: number; content: string }) {
  const comment = {
    id: commentIdCounter++,
    ...data,
    createdAt: new Date(),
    likes: 0,
    likedBy: new Set<number>(),
  };
  commentsStore.push(comment);
  return comment.id;
}

export async function deleteVideoComment(commentId: number, userId: number) {
  const idx = commentsStore.findIndex(c => c.id === commentId && c.userId === userId);
  if (idx >= 0) commentsStore.splice(idx, 1);
}

export async function toggleCommentLike(commentId: number, userId: number): Promise<{ liked: boolean }> {
  const comment = commentsStore.find(c => c.id === commentId);
  if (!comment) return { liked: false };
  if (comment.likedBy.has(userId)) {
    comment.likedBy.delete(userId);
    comment.likes--;
    return { liked: false };
  } else {
    comment.likedBy.add(userId);
    comment.likes++;
    return { liked: true };
  }
}
