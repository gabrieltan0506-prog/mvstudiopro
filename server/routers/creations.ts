/**
 * Creations & Favorites Router
 * 
 * Unified system for:
 * - Auto-recording all generations (idol, music, 3D, video, kling)
 * - User favorites/bookmarks management
 * - Retention policy enforcement
 * - Expiry reminders
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { userCreations, userFavorites } from "../../drizzle/schema-creations";
import { eq, and, desc, sql, lt, lte, isNull, or, inArray } from "drizzle-orm";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// ─── Types ────────────────────────────────────────────

const creationTypeSchema = z.enum([
  "idol_image", "idol_3d", "music", "video", "storyboard",
  "kling_video", "kling_lipsync", "kling_motion", "kling_image",
]);

export type CreationType = z.infer<typeof creationTypeSchema>;

// ─── Retention Policy ─────────────────────────────────

/** Returns expiry date based on user plan */
export function getExpiryDate(plan: string): Date {
  const now = new Date();
  switch (plan) {
    case "enterprise":
      return new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 6 months
    case "pro":
      return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);  // 3 months
    default:
      return new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);  // 10 days
  }
}

/** Returns reminder threshold (days before expiry to remind) */
function getReminderThreshold(plan: string): number {
  switch (plan) {
    case "enterprise": return 30; // 30 days before
    case "pro": return 14;        // 14 days before
    default: return 8;            // 8 days (= 2 days after creation for 10-day retention)
  }
}

// ─── Helper: Record a creation ────────────────────────

export async function recordCreation(params: {
  userId: number;
  type: CreationType;
  title?: string;
  outputUrl?: string;
  secondaryUrl?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
  quality?: string;
  creditsUsed?: number;
  plan?: string;
  status?: "pending" | "completed" | "failed";
}): Promise<number> {
  const expiresAt = getExpiryDate(params.plan ?? "free");
  const database = await db();
  const [result] = await database.insert(userCreations).values({
    userId: params.userId,
    type: params.type,
    title: params.title ?? null,
    outputUrl: params.outputUrl ?? null,
    secondaryUrl: params.secondaryUrl ?? null,
    thumbnailUrl: params.thumbnailUrl ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    quality: params.quality ?? null,
    creditsUsed: params.creditsUsed ?? 0,
    status: params.status ?? "completed",
    expiresAt,
    expiryReminded: false,
  });
  return result.insertId;
}

// ─── Router ───────────────────────────────────────────

export const creationsRouter = router({

  // ═══════════════════════════════════════════════════
  // List user's creations (with pagination & filtering)
  // ═══════════════════════════════════════════════════

  list: protectedProcedure
    .input(z.object({
      type: creationTypeSchema.optional(),
      status: z.enum(["pending", "completed", "failed", "expired"]).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const offset = (input.page - 1) * input.pageSize;

      const conditions = [eq(userCreations.userId, userId)];
      if (input.type) conditions.push(eq(userCreations.type, input.type));
      if (input.status) conditions.push(eq(userCreations.status, input.status));

      const database = await db();
      const items = await database
        .select()
        .from(userCreations)
        .where(and(...conditions))
        .orderBy(desc(userCreations.createdAt))
        .limit(input.pageSize)
        .offset(offset);

      const [countResult] = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(userCreations)
        .where(and(...conditions));

      // Parse metadata JSON
      const parsed = items.map((item: any) => ({
        ...item,
        metadata: item.metadata ? JSON.parse(item.metadata) : null,
      }));

      return {
        items: parsed,
        total: countResult.count,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(countResult.count / input.pageSize),
      };
    }),

  // ═══════════════════════════════════════════════════
  // Get single creation
  // ═══════════════════════════════════════════════════

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const database = await db();
      const [item] = await database
        .select()
        .from(userCreations)
        .where(and(
          eq(userCreations.id, input.id),
          eq(userCreations.userId, ctx.user.id),
        ));
      if (!item) return null;
      return {
        ...item,
        metadata: item.metadata ? JSON.parse(item.metadata) : null,
      };
    }),

  // ═══════════════════════════════════════════════════
  // Delete creation
  // ═══════════════════════════════════════════════════

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      // Also remove from favorites
      await database.delete(userFavorites).where(
        and(eq(userFavorites.creationId, input.id), eq(userFavorites.userId, ctx.user.id))
      );
      await database.delete(userCreations).where(
        and(eq(userCreations.id, input.id), eq(userCreations.userId, ctx.user.id))
      );
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════
  // Favorites Management
  // ═══════════════════════════════════════════════════

  addFavorite: protectedProcedure
    .input(z.object({
      creationId: z.number(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      try {
        await database.insert(userFavorites).values({
          userId: ctx.user.id,
          creationId: input.creationId,
          note: input.note ?? null,
        });
      } catch (err: any) {
        // Duplicate entry - already favorited
        if (err.code === "ER_DUP_ENTRY") {
          return { success: true, alreadyFavorited: true };
        }
        throw err;
      }
      return { success: true, alreadyFavorited: false };
    }),

  removeFavorite: protectedProcedure
    .input(z.object({ creationId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      await database.delete(userFavorites).where(
        and(eq(userFavorites.creationId, input.creationId), eq(userFavorites.userId, ctx.user.id))
      );
      return { success: true };
    }),

  listFavorites: protectedProcedure
    .input(z.object({
      type: creationTypeSchema.optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const offset = (input.page - 1) * input.pageSize;

      // Join favorites with creations
      const favConditions = [eq(userFavorites.userId, userId)];

      const database = await db();
      const favorites = await database
        .select({
          favoriteId: userFavorites.id,
          note: userFavorites.note,
          favoritedAt: userFavorites.createdAt,
          creation: userCreations,
        })
        .from(userFavorites)
        .innerJoin(userCreations, eq(userFavorites.creationId, userCreations.id))
        .where(and(
          ...favConditions,
          ...(input.type ? [eq(userCreations.type, input.type)] : []),
        ))
        .orderBy(desc(userFavorites.createdAt))
        .limit(input.pageSize)
        .offset(offset);

      const [countResult] = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(userFavorites)
        .innerJoin(userCreations, eq(userFavorites.creationId, userCreations.id))
        .where(and(
          ...favConditions,
          ...(input.type ? [eq(userCreations.type, input.type)] : []),
        ));

      return {
        items: favorites.map((f: any) => ({
          ...f,
          creation: {
            ...f.creation,
            metadata: f.creation.metadata ? JSON.parse(f.creation.metadata) : null,
          },
        })),
        total: countResult.count,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // Check if a creation is favorited
  isFavorited: protectedProcedure
    .input(z.object({ creationId: z.number() }))
    .query(async ({ input, ctx }) => {
      const database = await db();
      const [fav] = await database
        .select()
        .from(userFavorites)
        .where(and(
          eq(userFavorites.creationId, input.creationId),
          eq(userFavorites.userId, ctx.user.id),
        ));
      return { favorited: !!fav };
    }),

  // Batch check favorites
  batchCheckFavorites: protectedProcedure
    .input(z.object({ creationIds: z.array(z.number()) }))
    .query(async ({ input, ctx }) => {
      if (input.creationIds.length === 0) return { favorites: {} };
      const database = await db();
      const favs = await database
        .select({ creationId: userFavorites.creationId })
        .from(userFavorites)
        .where(and(
          eq(userFavorites.userId, ctx.user.id),
          inArray(userFavorites.creationId, input.creationIds),
        ));
      const favMap: Record<number, boolean> = {};
      for (const f of favs) favMap[f.creationId] = true;
      return { favorites: favMap };
    }),

  // ═══════════════════════════════════════════════════
  // Retention & Expiry
  // ═══════════════════════════════════════════════════

  /** Get items that are expiring soon (for frontend banner) */
  getExpiringItems: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const now = new Date();
    const reminderDate = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days from now

      const database = await db();
      const expiring = await database
        .select()
        .from(userCreations)
      .where(and(
        eq(userCreations.userId, userId),
        eq(userCreations.status, "completed"),
        lte(userCreations.expiresAt, reminderDate),
        sql`${userCreations.expiresAt} > NOW()`,
      ))
      .orderBy(userCreations.expiresAt)
      .limit(50);

    return {
      items: expiring.map((item: any) => ({
        ...item,
        metadata: item.metadata ? JSON.parse(item.metadata) : null,
        daysUntilExpiry: Math.ceil((new Date(item.expiresAt!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      })),
      count: expiring.length,
    };
  }),

  /** Get creation stats for the user */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
      const database = await db();
      const stats = await database
        .select({
          type: userCreations.type,
          count: sql<number>`COUNT(*)`,
        })
        .from(userCreations)
        .where(and(
          eq(userCreations.userId, userId),
          eq(userCreations.status, "completed"),
        ))
        .groupBy(userCreations.type);

      const favCount = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(userFavorites)
        .where(eq(userFavorites.userId, userId));

    return {
      byType: Object.fromEntries(stats.map((s: any) => [s.type, s.count])),
      totalCreations: stats.reduce((sum: number, s: any) => sum + s.count, 0),
      totalFavorites: favCount[0]?.count ?? 0,
    };
  }),
});
