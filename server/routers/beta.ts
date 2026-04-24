import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { betaQuotas, betaReferrals, users } from "../../drizzle/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import * as crypto from "crypto";

/**
 * Beta Tester 等级系统
 * - Starter: 0 邀请 (基础内测用户)
 * - Advocate: 3+ 邀请
 * - Ambassador: 10+ 邀请
 * - Champion: 25+ 邀请
 * - Legend: 50+ 邀请
 */
export const BETA_LEVELS = [
  { level: "Legend", minReferrals: 50, color: "#FFD700", icon: "🏆", description: "传奇推广者" },
  { level: "Champion", minReferrals: 25, color: "#FF6B6B", icon: "🔥", description: "冠军推广者" },
  { level: "Ambassador", minReferrals: 10, color: "#C77DBA", icon: "⭐", description: "大使级推广者" },
  { level: "Advocate", minReferrals: 3, color: "#64D2FF", icon: "💎", description: "活跃推广者" },
  { level: "Starter", minReferrals: 0, color: "#30D158", icon: "🌱", description: "内测先锋" },
] as const;

function getBetaLevel(referralCount: number) {
  for (const level of BETA_LEVELS) {
    if (referralCount >= level.minReferrals) {
      return level;
    }
  }
  return BETA_LEVELS[BETA_LEVELS.length - 1];
}

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase(); // 8-char code like "A3F2B1C9"
}

export const betaRouter = router({
  // ─── Admin: Lookup user by email (for granting quota) ───
  lookupUserByEmail: adminProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: `找不到 Email 为 ${input.email} 的用户，请确认该用户已注册` });
      }
      return { userId: user.id, name: user.name, email: user.email };
    }),

  // ─── Admin: Grant beta quota to a user ───
  grantQuota: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        totalQuota: z.number().int().min(1).max(1000),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Check if user exists
      const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      }

      // Check if user already has beta quota
      const [existing] = await db.select().from(betaQuotas).where(eq(betaQuotas.userId, input.userId)).limit(1);

      if (existing) {
        // Update existing quota
        await db.update(betaQuotas).set({
          totalQuota: input.totalQuota,
          isActive: true,
          note: input.note || existing.note,
        }).where(eq(betaQuotas.id, existing.id));

        return {
          success: true,
          message: `已更新用户 ${user.name || user.email || user.id} 的内测配额为 ${input.totalQuota} 次`,
          inviteCode: existing.inviteCode,
        };
      }

      // Create new beta quota with unique invite code
      const inviteCode = generateInviteCode();
      await db.insert(betaQuotas).values({
        userId: input.userId,
        totalQuota: input.totalQuota,
        usedCount: 0,
        bonusQuota: 0,
        inviteCode,
        isActive: true,
        grantedBy: ctx.user.id,
        note: input.note || null,
      });

      return {
        success: true,
        message: `已授予用户 ${user.name || user.email || user.id} ${input.totalQuota} 次内测配额`,
        inviteCode,
      };
    }),

  // ─── Admin: Revoke beta quota ───
  revokeQuota: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await db.update(betaQuotas).set({ isActive: false }).where(eq(betaQuotas.userId, input.userId));
      return { success: true, message: "已撤销内测配额" };
    }),

  // ─── Admin: List all beta users ───
  listBetaUsers: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const results = await db
      .select({
        betaId: betaQuotas.id,
        userId: betaQuotas.userId,
        userName: users.name,
        userEmail: users.email,
        totalQuota: betaQuotas.totalQuota,
        usedCount: betaQuotas.usedCount,
        bonusQuota: betaQuotas.bonusQuota,
        inviteCode: betaQuotas.inviteCode,
        isActive: betaQuotas.isActive,
        note: betaQuotas.note,
        createdAt: betaQuotas.createdAt,
      })
      .from(betaQuotas)
      .leftJoin(users, eq(betaQuotas.userId, users.id))
      .orderBy(desc(betaQuotas.createdAt));

    // Get referral counts for each beta user
    const enriched = await Promise.all(
      results.map(async (r) => {
        const [refCount] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(betaReferrals)
          .where(eq(betaReferrals.inviterUserId, r.userId));

        const referralCount = Number(refCount?.count ?? 0);
        const level = getBetaLevel(referralCount);

        return {
          ...r,
          remaining: r.totalQuota + r.bonusQuota - r.usedCount,
          referralCount,
          level: level.level,
          levelColor: level.color,
          levelIcon: level.icon,
        };
      })
    );

    return enriched;
  }),

  // ─── Admin: Add beta user by email (create user if needed + grant quota) ───
  addBetaUserByEmail: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        totalQuota: z.number().int().min(1).max(1000).default(20),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Find or create user by email
      let [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

      if (!user) {
        // Create a placeholder user for this email
        const [newRow] = await db.insert(users).values({
          openId: `beta_${input.email}`,
          email: input.email,
          name: input.email.split("@")[0],
          loginMethod: "beta_invite",
          role: "user",
        }).returning({ id: users.id });
        [user] = await db.select().from(users).where(eq(users.id, newRow!.id)).limit(1);
      }

      // Check if already has beta quota
      const [existing] = await db.select().from(betaQuotas).where(eq(betaQuotas.userId, user.id)).limit(1);
      if (existing) {
        await db.update(betaQuotas).set({
          totalQuota: input.totalQuota,
          isActive: true,
          note: input.note || existing.note,
        }).where(eq(betaQuotas.id, existing.id));

        return {
          success: true,
          userId: user.id,
          inviteCode: existing.inviteCode,
          message: `已更新 ${input.email} 的内测配额为 ${input.totalQuota} 次`,
        };
      }

      const inviteCode = generateInviteCode();
      await db.insert(betaQuotas).values({
        userId: user.id,
        totalQuota: input.totalQuota,
        usedCount: 0,
        bonusQuota: 0,
        inviteCode,
        isActive: true,
        grantedBy: ctx.user.id,
        note: input.note || null,
      });

      return {
        success: true,
        userId: user.id,
        inviteCode,
        message: `已授予 ${input.email} ${input.totalQuota} 次内测配额，邀请码: ${inviteCode}`,
      };
    }),

  // ─── Admin: Add beta user by phone (for future SMS login) ───
  addBetaUserByPhone: adminProcedure
    .input(
      z.object({
        phone: z.string().min(5).max(20),
        name: z.string().max(100).optional(),
        totalQuota: z.number().int().min(1).max(1000).default(20),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Find or create user by phone-based openId
      const phoneOpenId = `phone_${input.phone}`;
      let [user] = await db.select().from(users).where(eq(users.openId, phoneOpenId)).limit(1);

      if (!user) {
        const [newRow] = await db.insert(users).values({
          openId: phoneOpenId,
          name: input.name || input.phone,
          loginMethod: "phone",
          role: "user",
        }).returning({ id: users.id });
        [user] = await db.select().from(users).where(eq(users.id, newRow!.id)).limit(1);
      }

      // Check if already has beta quota
      const [existing] = await db.select().from(betaQuotas).where(eq(betaQuotas.userId, user.id)).limit(1);
      if (existing) {
        await db.update(betaQuotas).set({
          totalQuota: input.totalQuota,
          isActive: true,
          note: input.note || existing.note,
        }).where(eq(betaQuotas.id, existing.id));

        return {
          success: true,
          userId: user.id,
          inviteCode: existing.inviteCode,
          message: `已更新 ${input.phone} 的内测配额为 ${input.totalQuota} 次`,
        };
      }

      const inviteCode = generateInviteCode();
      await db.insert(betaQuotas).values({
        userId: user.id,
        totalQuota: input.totalQuota,
        usedCount: 0,
        bonusQuota: 0,
        inviteCode,
        isActive: true,
        grantedBy: ctx.user.id,
        note: input.note || null,
      });

      return {
        success: true,
        userId: user.id,
        inviteCode,
        message: `已授予 ${input.phone} ${input.totalQuota} 次内测配额，邀请码: ${inviteCode}`,
      };
    }),

  // ─── User: Check own beta status ───
  myStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const [quota] = await db.select().from(betaQuotas).where(eq(betaQuotas.userId, ctx.user.id)).limit(1);
    if (!quota || !quota.isActive) return null;

    // Get referral count
    const [refCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(betaReferrals)
      .where(eq(betaReferrals.inviterUserId, ctx.user.id));

    const referralCount = Number(refCount?.count ?? 0);
    const level = getBetaLevel(referralCount);

    // Get referral list
    const referrals = await db
      .select({
        id: betaReferrals.id,
        inviteeName: users.name,
        inviteeEmail: users.email,
        bonusGranted: betaReferrals.bonusGranted,
        createdAt: betaReferrals.createdAt,
      })
      .from(betaReferrals)
      .leftJoin(users, eq(betaReferrals.inviteeUserId, users.id))
      .where(eq(betaReferrals.inviterUserId, ctx.user.id))
      .orderBy(desc(betaReferrals.createdAt));

    return {
      totalQuota: quota.totalQuota,
      usedCount: quota.usedCount,
      bonusQuota: quota.bonusQuota,
      remaining: quota.totalQuota + quota.bonusQuota - quota.usedCount,
      inviteCode: quota.inviteCode,
      referralCount,
      referrals,
      level: level.level,
      levelColor: level.color,
      levelIcon: level.icon,
      levelDescription: level.description,
      // Next level info
      nextLevel: BETA_LEVELS.find((l) => l.minReferrals > referralCount) || null,
    };
  }),

  // ─── User: Use beta quota (called when using any feature) ───
  useQuota: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const [quota] = await db.select().from(betaQuotas).where(eq(betaQuotas.userId, ctx.user.id)).limit(1);
    if (!quota || !quota.isActive) {
      throw new TRPCError({ code: "FORBIDDEN", message: "您没有内测配额" });
    }

    const remaining = quota.totalQuota + quota.bonusQuota - quota.usedCount;
    if (remaining <= 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "内测配额已用完，邀请朋友可获得额外配额" });
    }

    await db.update(betaQuotas).set({
      usedCount: quota.usedCount + 1,
    }).where(eq(betaQuotas.id, quota.id));

    return {
      success: true,
      remaining: remaining - 1,
    };
  }),

  // ─── User: Check if has beta access (for feature gating) ───
  checkAccess: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { hasBeta: false, remaining: 0 };

    const [quota] = await db.select().from(betaQuotas).where(eq(betaQuotas.userId, ctx.user.id)).limit(1);
    if (!quota || !quota.isActive) return { hasBeta: false, remaining: 0 };

    const remaining = quota.totalQuota + quota.bonusQuota - quota.usedCount;
    return { hasBeta: true, remaining };
  }),

  // ─── Public: Redeem invite code ───
  redeemInviteCode: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(1).max(16) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Find the invite code
      const [inviterQuota] = await db
        .select()
        .from(betaQuotas)
        .where(and(eq(betaQuotas.inviteCode, input.inviteCode.toUpperCase()), eq(betaQuotas.isActive, true)))
        .limit(1);

      if (!inviterQuota) {
        throw new TRPCError({ code: "NOT_FOUND", message: "无效的邀请码" });
      }

      // Can't invite yourself
      if (inviterQuota.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能使用自己的邀请码" });
      }

      // Check if already redeemed by this user
      const [existingReferral] = await db
        .select()
        .from(betaReferrals)
        .where(eq(betaReferrals.inviteeUserId, ctx.user.id))
        .limit(1);

      if (existingReferral) {
        throw new TRPCError({ code: "CONFLICT", message: "您已经使用过邀请码了" });
      }

      const BONUS_PER_REFERRAL = 10;

      // Grant bonus to inviter
      await db.update(betaQuotas).set({
        bonusQuota: inviterQuota.bonusQuota + BONUS_PER_REFERRAL,
      }).where(eq(betaQuotas.id, inviterQuota.id));

      // Check if invitee already has beta quota
      const [inviteeQuota] = await db
        .select()
        .from(betaQuotas)
        .where(eq(betaQuotas.userId, ctx.user.id))
        .limit(1);

      if (inviteeQuota) {
        // Add bonus to existing quota
        await db.update(betaQuotas).set({
          bonusQuota: inviteeQuota.bonusQuota + BONUS_PER_REFERRAL,
          isActive: true,
        }).where(eq(betaQuotas.id, inviteeQuota.id));
      } else {
        // Create new beta quota for invitee with bonus
        const newInviteCode = generateInviteCode();
        await db.insert(betaQuotas).values({
          userId: ctx.user.id,
          totalQuota: BONUS_PER_REFERRAL, // Start with referral bonus as base
          usedCount: 0,
          bonusQuota: 0,
          inviteCode: newInviteCode,
          isActive: true,
          grantedBy: inviterQuota.userId,
          note: `通过邀请码 ${input.inviteCode} 加入`,
        });
      }

      // Record referral
      await db.insert(betaReferrals).values({
        inviterUserId: inviterQuota.userId,
        inviteeUserId: ctx.user.id,
        inviteCode: input.inviteCode.toUpperCase(),
        bonusGranted: BONUS_PER_REFERRAL,
        status: "completed",
      });

      return {
        success: true,
        message: `邀请码兑换成功！您和邀请者各获得 ${BONUS_PER_REFERRAL} 次额外配额`,
        bonusGranted: BONUS_PER_REFERRAL,
      };
    }),

  // ─── Public: Leaderboard (top inviters) ───
  leaderboard: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const results = await db
        .select({
          userId: betaReferrals.inviterUserId,
          userName: users.name,
          referralCount: sql<number>`COUNT(*)`.as("referralCount"),
        })
        .from(betaReferrals)
        .leftJoin(users, eq(betaReferrals.inviterUserId, users.id))
        .where(eq(betaReferrals.status, "completed"))
        .groupBy(betaReferrals.inviterUserId, users.name)
        .orderBy(sql`referralCount DESC`)
        .limit(input.limit);

      return results.map((r, index) => {
        const count = Number(r.referralCount);
        const level = getBetaLevel(count);
        return {
          rank: index + 1,
          userId: r.userId,
          userName: r.userName || "匿名用户",
          referralCount: count,
          level: level.level,
          levelColor: level.color,
          levelIcon: level.icon,
        };
      });
    }),
});
