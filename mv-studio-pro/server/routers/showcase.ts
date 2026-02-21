/**
 * 展厅交互路由（点赞/收藏/评论）+ 维护通知系统
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  showcaseLikes,
  showcaseFavorites,
  showcaseComments,
  maintenanceNotices,
  trafficStats,
  videoSubmissions,
  users,
} from "../../drizzle/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

export const showcaseRouter = router({
  // ─── 点赞 ──────────────────────────────────
  toggleLike: protectedProcedure
    .input(z.object({ videoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 检查是否已点赞
      const existing = await db
        .select()
        .from(showcaseLikes)
        .where(
          and(
            eq(showcaseLikes.userId, ctx.user.id),
            eq(showcaseLikes.videoSubmissionId, input.videoId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // 取消点赞
        await db
          .delete(showcaseLikes)
          .where(eq(showcaseLikes.id, existing[0].id));
        // 更新计数
        await db
          .update(videoSubmissions)
          .set({ likeCount: sql`GREATEST(${videoSubmissions.likeCount} - 1, 0)` })
          .where(eq(videoSubmissions.id, input.videoId));
        return { liked: false };
      } else {
        // 点赞
        await db.insert(showcaseLikes).values({
          userId: ctx.user.id,
          videoSubmissionId: input.videoId,
        });
        await db
          .update(videoSubmissions)
          .set({ likeCount: sql`${videoSubmissions.likeCount} + 1` })
          .where(eq(videoSubmissions.id, input.videoId));
        return { liked: true };
      }
    }),

  // ─── 收藏 ──────────────────────────────────
  toggleFavorite: protectedProcedure
    .input(z.object({ videoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const existing = await db
        .select()
        .from(showcaseFavorites)
        .where(
          and(
            eq(showcaseFavorites.userId, ctx.user.id),
            eq(showcaseFavorites.videoSubmissionId, input.videoId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .delete(showcaseFavorites)
          .where(eq(showcaseFavorites.id, existing[0].id));
        return { favorited: false };
      } else {
        await db.insert(showcaseFavorites).values({
          userId: ctx.user.id,
          videoSubmissionId: input.videoId,
        });
        return { favorited: true };
      }
    }),

  // ─── 获取用户的点赞/收藏状态 ──────────────
  getUserInteractions: protectedProcedure
    .input(z.object({ videoIds: z.array(z.number()) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { likes: [], favorites: [] };

      const likes = await db
        .select({ videoSubmissionId: showcaseLikes.videoSubmissionId })
        .from(showcaseLikes)
        .where(eq(showcaseLikes.userId, ctx.user.id));

      const favorites = await db
        .select({ videoSubmissionId: showcaseFavorites.videoSubmissionId })
        .from(showcaseFavorites)
        .where(eq(showcaseFavorites.userId, ctx.user.id));

      const likedIds = likes.map((l) => l.videoSubmissionId);
      const favoritedIds = favorites.map((f) => f.videoSubmissionId);

      return {
        likes: input.videoIds.filter((id) => likedIds.includes(id)),
        favorites: input.videoIds.filter((id) => favoritedIds.includes(id)),
      };
    }),

  // ─── 评论 ──────────────────────────────────
  addComment: protectedProcedure
    .input(
      z.object({
        videoId: z.number(),
        content: z.string().min(1).max(500),
        parentId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(showcaseComments).values({
        userId: ctx.user.id,
        videoSubmissionId: input.videoId,
        content: input.content,
        parentId: input.parentId || null,
      });

      return { success: true };
    }),

  getComments: publicProcedure
    .input(
      z.object({
        videoId: z.number(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { comments: [], total: 0 };

      const comments = await db
        .select({
          id: showcaseComments.id,
          content: showcaseComments.content,
          parentId: showcaseComments.parentId,
          createdAt: showcaseComments.createdAt,
          userId: showcaseComments.userId,
          userName: users.name,
        })
        .from(showcaseComments)
        .leftJoin(users, eq(showcaseComments.userId, users.id))
        .where(eq(showcaseComments.videoSubmissionId, input.videoId))
        .orderBy(desc(showcaseComments.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(showcaseComments)
        .where(eq(showcaseComments.videoSubmissionId, input.videoId));

      return {
        comments,
        total: countResult[0]?.count || 0,
      };
    }),

  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const comment = await db
        .select()
        .from(showcaseComments)
        .where(eq(showcaseComments.id, input.commentId))
        .limit(1);

      if (comment.length === 0) throw new Error("Comment not found");
      if (comment[0].userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Unauthorized");
      }

      await db
        .delete(showcaseComments)
        .where(eq(showcaseComments.id, input.commentId));

      return { success: true };
    }),

  // ─── 维护通知 ──────────────────────────────
  getActiveNotice: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;

    const now = new Date();
    const notices = await db
      .select()
      .from(maintenanceNotices)
      .where(
        and(
          eq(maintenanceNotices.isActive, 1),
          lte(maintenanceNotices.startTime, now)
        )
      )
      .orderBy(desc(maintenanceNotices.createdAt))
      .limit(1);

    // 也返回即将到来的维护通知（提前 24 小时通知）
    const upcoming = await db
      .select()
      .from(maintenanceNotices)
      .where(
        and(
          eq(maintenanceNotices.isActive, 1),
          gte(maintenanceNotices.startTime, now)
        )
      )
      .orderBy(maintenanceNotices.startTime)
      .limit(1);

    return {
      active: notices.length > 0 ? notices[0] : null,
      upcoming: upcoming.length > 0 ? upcoming[0] : null,
    };
  }),

  // 管理员：创建维护公告
  adminCreateNotice: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        content: z.string().min(1),
        startTime: z.string(), // ISO datetime
        endTime: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(maintenanceNotices).values({
        title: input.title,
        content: input.content,
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        isActive: 1,
        createdBy: ctx.user.id,
      });

      return { success: true };
    }),

  // 管理员：获取所有维护公告
  adminGetNotices: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new Error("Unauthorized");

    const db = await getDb();
    if (!db) return [];

    return db
      .select()
      .from(maintenanceNotices)
      .orderBy(desc(maintenanceNotices.createdAt));
  }),

  // 管理员：停用维护公告
  adminToggleNotice: protectedProcedure
    .input(z.object({ noticeId: z.number(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(maintenanceNotices)
        .set({ isActive: input.isActive ? 1 : 0 })
        .where(eq(maintenanceNotices.id, input.noticeId));

      return { success: true };
    }),

  // ─── 流量统计 ──────────────────────────────
  adminGetTrafficStats: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) return [];

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      return db
        .select()
        .from(trafficStats)
        .where(gte(trafficStats.hourBucket, since))
        .orderBy(trafficStats.hourBucket);
    }),

  // 管理员：获取所有视频（含所有状态，用于审核）
  adminGetAllVideos: protectedProcedure
    .input(
      z.object({
        status: z.enum(["all", "pending", "scoring", "scored", "failed"]).default("all"),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) return { videos: [], total: 0 };

      let query = db.select().from(videoSubmissions);
      if (input.status !== "all") {
        query = query.where(eq(videoSubmissions.scoreStatus, input.status)) as any;
      }

      const videos = await (query as any)
        .orderBy(desc(videoSubmissions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // 获取用户信息和平台链接
      const { videoPlatformLinks } = await import("../../drizzle/schema");
      const enriched = await Promise.all(
        videos.map(async (v: any) => {
          const links = await db
            .select()
            .from(videoPlatformLinks)
            .where(eq(videoPlatformLinks.videoSubmissionId, v.id));
          const user = await db
            .select({ name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, v.userId))
            .limit(1);
          return { ...v, platformLinks: links, user: user[0] || null };
        })
      );

      const countResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(videoSubmissions);

      return {
        videos: enriched,
        total: countResult[0]?.count || 0,
      };
    }),

  // 管理员：手动调整评分
  adminAdjustScore: protectedProcedure
    .input(
      z.object({
        videoId: z.number(),
        newScore: z.number().min(0).max(100),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const video = await db
        .select()
        .from(videoSubmissions)
        .where(eq(videoSubmissions.id, input.videoId))
        .limit(1);

      if (video.length === 0) throw new Error("Video not found");

      const oldScore = video[0].viralScore || 0;
      const oldReward = video[0].creditsRewarded || 0;

      // 计算新奖励
      const newReward = input.newScore >= 90 ? 80 : input.newScore >= 80 ? 30 : 0;
      const rewardDiff = newReward - oldReward;

      await db
        .update(videoSubmissions)
        .set({
          viralScore: input.newScore,
          scoreStatus: "scored",
          creditsRewarded: newReward,
          rewardedAt: newReward > 0 ? new Date() : null,
          showcaseStatus: newReward > 0 ? "showcased" : "private",
          adminNotes: input.notes || `管理员调整评分: ${oldScore} → ${input.newScore}`,
        })
        .where(eq(videoSubmissions.id, input.videoId));

      // 调整 Credits（增减差额）
      if (rewardDiff !== 0) {
        const { addCredits } = await import("../credits");
        if (rewardDiff > 0) {
          await addCredits(video[0].userId, rewardDiff, "bonus");
        }
        // 如果减少，记录但不扣除（避免负数问题）
      }

      return {
        success: true,
        oldScore,
        newScore: input.newScore,
        oldReward,
        newReward,
        message: `评分已从 ${oldScore} 调整为 ${input.newScore}`,
      };
    }),

  // 管理员：标记视频为异常
  adminFlagVideo: protectedProcedure
    .input(
      z.object({
        videoId: z.number(),
        action: z.enum(["flag", "unflag", "reject"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const updates: Record<string, any> = {};

      if (input.action === "flag") {
        updates.scoreStatus = "pending";
        updates.adminNotes = input.notes || "管理员标记为异常，需复审";
      } else if (input.action === "unflag") {
        updates.adminNotes = input.notes || "管理员解除异常标记";
      } else if (input.action === "reject") {
        updates.showcaseStatus = "rejected";
        updates.adminNotes = input.notes || "管理员拒绝展示";
      }

      await db
        .update(videoSubmissions)
        .set(updates)
        .where(eq(videoSubmissions.id, input.videoId));

      return { success: true };
    }),
});
