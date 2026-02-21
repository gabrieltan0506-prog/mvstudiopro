import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getStripe, PRICE_IDS } from "../stripe";
import { PLANS, CREDIT_COSTS, CREDIT_PACKS, type PlanType } from "../plans";
import {
  getCredits,
  addCredits,
  deductCredits,
  hasEnoughCredits,
  getUserPlan,
  getCreditTransactions,
  getUsageLogs,
} from "../credits";
import { getDb } from "../db";
import {
  stripeCustomers,
  creditBalances,
  creditTransactions,
  stripeUsageLogs,
  stripeAuditLogs,
  stripeInvoices,
  kpiSnapshots,
} from "../../drizzle/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { writeAuditLog } from "../audit";

export const stripeRouter = router({
  // ─── 获取方案列表 ──────────────────────────────
  getPlans: publicProcedure.query(() => {
    return {
      plans: PLANS,
      creditCosts: CREDIT_COSTS,
      creditPacks: CREDIT_PACKS,
    };
  }),

  // ─── 获取用户订阅状态 ──────────────────────────
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const plan = await getUserPlan(userId);
    const credits = await getCredits(userId);

    const db = await getDb();
    let subscription = null;
    if (db) {
      const rows = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.userId, userId))
        .limit(1);
      if (rows.length > 0) {
        subscription = {
          plan: rows[0].plan,
          stripeSubscriptionId: rows[0].stripeSubscriptionId,
          currentPeriodEnd: rows[0].currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: rows[0].cancelAtPeriodEnd === 1,
        };
      }
    }

    return {
      plan,
      planConfig: PLANS[plan],
      credits,
      subscription,
    };
  }),

  // ─── 获取 Credits 余额 ────────────────────────
  getCredits: protectedProcedure.query(async ({ ctx }) => {
    return getCredits(ctx.user.id);
  }),

  // ─── 获取交易记录 ─────────────────────────────
  getTransactions: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      return getCreditTransactions(ctx.user.id, input?.limit ?? 50);
    }),

  // ─── 获取使用日志 ─────────────────────────────
  getUsageLogs: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      return getUsageLogs(ctx.user.id, input?.limit ?? 50);
    }),

  // ─── 创建 Checkout Session（订阅） ────────────
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        plan: z.enum(["pro", "enterprise"]),
        interval: z.enum(["monthly", "yearly"]).default("monthly"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      if (!stripe) throw new Error("Stripe 未配置，请联系管理员");

      const userId = ctx.user.id;
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 获取或创建 Stripe Customer
      let customerId: string;
      const existing = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.userId, userId))
        .limit(1);

      if (existing.length > 0 && existing[0].stripeCustomerId) {
        customerId = existing[0].stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          email: ctx.user.email ?? undefined,
          name: ctx.user.name ?? undefined,
          metadata: { userId: userId.toString() },
        });
        customerId = customer.id;

        // 存入数据库
        if (existing.length > 0) {
          await db
            .update(stripeCustomers)
            .set({ stripeCustomerId: customerId })
            .where(eq(stripeCustomers.userId, userId));
        } else {
          await db.insert(stripeCustomers).values({
            userId,
            stripeCustomerId: customerId,
            plan: "free",
          });
        }
      }

      // 选择 Price ID
      let priceId: string;
      if (input.plan === "pro") {
        priceId = input.interval === "yearly" ? PRICE_IDS.pro_yearly : PRICE_IDS.pro_monthly;
      } else {
        priceId = PRICE_IDS.enterprise;
      }

      if (!priceId) {
        throw new Error(`Price ID 未配置: ${input.plan}_${input.interval}`);
      }

      // 构建回调 URL
      const baseUrl = process.env.FRONTEND_URL || "https://mvstudiopro.com";

      // 检查用户是否曾经使用过试用
      const hasUsedTrial = existing.length > 0 && existing[0].stripeSubscriptionId;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/pricing`,
        metadata: {
          userId: userId.toString(),
          type: "subscription",
          plan: input.plan,
        },
        subscription_data: {
          // 7 天免费试用（仅限首次订阅）
          ...(hasUsedTrial ? {} : { trial_period_days: 7 }),
          metadata: {
            userId: userId.toString(),
            plan: input.plan,
          },
        },
      });

      // 审计日志
      await writeAuditLog({
        userId,
        eventType: "checkout.session.created",
        stripeCustomerId: customerId,
        action: "create_checkout",
        metadata: { plan: input.plan, interval: input.interval, hasTrial: !hasUsedTrial },
      });

      return { url: session.url, sessionId: session.id };
    }),

  // ─── 创建 Checkout Session（Credits 加值包） ──
  createCreditPackCheckout: protectedProcedure
    .input(
      z.object({
        packId: z.enum(["small", "medium", "large"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      if (!stripe) throw new Error("Stripe 未配置，请联系管理员");

      const userId = ctx.user.id;
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const pack = CREDIT_PACKS[input.packId];

      // 获取或创建 Stripe Customer
      let customerId: string;
      const existing = await db
        .select()
        .from(stripeCustomers)
        .where(eq(stripeCustomers.userId, userId))
        .limit(1);

      if (existing.length > 0 && existing[0].stripeCustomerId) {
        customerId = existing[0].stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          email: ctx.user.email ?? undefined,
          name: ctx.user.name ?? undefined,
          metadata: { userId: userId.toString() },
        });
        customerId = customer.id;

        if (existing.length > 0) {
          await db
            .update(stripeCustomers)
            .set({ stripeCustomerId: customerId })
            .where(eq(stripeCustomers.userId, userId));
        } else {
          await db.insert(stripeCustomers).values({
            userId,
            stripeCustomerId: customerId,
            plan: "free",
          });
        }
      }

      const priceId = input.packId === "small" ? PRICE_IDS.credit_pack_small : PRICE_IDS.credit_pack_large;
      if (!priceId) {
        throw new Error(`Credit pack price ID 未配置: ${input.packId}`);
      }

      const baseUrl = process.env.FRONTEND_URL || "https://mvstudiopro.com";

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/pricing`,
        metadata: {
          userId: userId.toString(),
          type: "credit_pack",
          packId: input.packId,
        },
      });

      return { url: session.url, sessionId: session.id };
    }),

  // ─── 取消订阅（到期后不续费） ──────────────────
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe 未配置");

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const customer = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.userId, ctx.user.id))
      .limit(1);

    if (customer.length === 0 || !customer[0].stripeSubscriptionId) {
      throw new Error("未找到活跃订阅");
    }

    await stripe.subscriptions.update(customer[0].stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await db
      .update(stripeCustomers)
      .set({ cancelAtPeriodEnd: 1 })
      .where(eq(stripeCustomers.userId, ctx.user.id));

    return { success: true, message: "订阅将在当前计费周期结束后取消" };
  }),

  // ─── 恢复订阅 ─────────────────────────────────
  resumeSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe 未配置");

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const customer = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.userId, ctx.user.id))
      .limit(1);

    if (customer.length === 0 || !customer[0].stripeSubscriptionId) {
      throw new Error("未找到活跃订阅");
    }

    await stripe.subscriptions.update(customer[0].stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await db
      .update(stripeCustomers)
      .set({ cancelAtPeriodEnd: 0 })
      .where(eq(stripeCustomers.userId, ctx.user.id));

    return { success: true, message: "订阅已恢复" };
  }),

  // ─── 使用 Credits（供其他功能调用） ────────────
  useCredits: protectedProcedure
    .input(
      z.object({
        action: z.enum(["mvAnalysis", "idolGeneration", "storyboard", "videoGeneration"]),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return deductCredits(ctx.user.id, input.action, input.description);
    }),

  // ─── 检查是否有足够 Credits ───────────────────
  checkCredits: protectedProcedure
    .input(
      z.object({
        action: z.enum(["mvAnalysis", "idolGeneration", "storyboard", "videoGeneration"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const enough = await hasEnoughCredits(ctx.user.id, input.action);
      const credits = await getCredits(ctx.user.id);
      const cost = CREDIT_COSTS[input.action];
      return {
        hasEnough: enough,
        cost,
        currentBalance: credits.balance,
      };
    }),

  // ─── 管理员：财务监控指针 ─────────────────────
  adminMetrics: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new Error("无权限");
    }

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // 总订阅用户数
    const totalSubscribers = await db
      .select({ count: sql<number>`count(*)` })
      .from(stripeCustomers)
      .where(sql`${stripeCustomers.plan} != 'free'`);

    // 各方案用户数
    const planCounts = await db
      .select({
        plan: stripeCustomers.plan,
        count: sql<number>`count(*)`,
      })
      .from(stripeCustomers)
      .groupBy(stripeCustomers.plan);

    // 本月 Credits 消耗
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyUsage = await db
      .select({
        totalCredits: sql<number>`COALESCE(SUM(${stripeUsageLogs.creditsCost}), 0)`,
        totalActions: sql<number>`count(*)`,
      })
      .from(stripeUsageLogs)
      .where(gte(stripeUsageLogs.createdAt, monthStart));

    // 各功能使用次数
    const actionBreakdown = await db
      .select({
        action: stripeUsageLogs.action,
        count: sql<number>`count(*)`,
        totalCredits: sql<number>`COALESCE(SUM(${stripeUsageLogs.creditsCost}), 0)`,
      })
      .from(stripeUsageLogs)
      .where(gte(stripeUsageLogs.createdAt, monthStart))
      .groupBy(stripeUsageLogs.action);

    // 本月收入（Credits 购买）
    const monthlyRevenue = await db
      .select({
        totalCreditsAdded: sql<number>`COALESCE(SUM(${creditTransactions.amount}), 0)`,
        transactionCount: sql<number>`count(*)`,
      })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.type, "credit"),
          eq(creditTransactions.source, "purchase"),
          gte(creditTransactions.createdAt, monthStart)
        )
      );

    // 最近 10 笔交易
    const recentTransactions = await db
      .select()
      .from(creditTransactions)
      .orderBy(desc(creditTransactions.createdAt))
      .limit(10);

    // 总 Credits 余额
    const totalCreditsBalance = await db
      .select({
        total: sql<number>`COALESCE(SUM(${creditBalances.balance}), 0)`,
      })
      .from(creditBalances);

    // MRR 估算（付费用户 × 方案月费）
    const proCount = planCounts.find((p) => p.plan === "pro")?.count ?? 0;
    const enterpriseCount = planCounts.find((p) => p.plan === "enterprise")?.count ?? 0;
    const estimatedMRR = proCount * PLANS.pro.monthlyPrice + enterpriseCount * PLANS.enterprise.monthlyPrice;

    return {
      totalSubscribers: totalSubscribers[0]?.count ?? 0,
      planCounts: planCounts.reduce(
        (acc, p) => ({ ...acc, [p.plan]: p.count }),
        {} as Record<string, number>
      ),
      monthlyUsage: {
        totalCredits: monthlyUsage[0]?.totalCredits ?? 0,
        totalActions: monthlyUsage[0]?.totalActions ?? 0,
      },
      actionBreakdown: actionBreakdown.map((a) => ({
        action: a.action,
        count: a.count,
        totalCredits: a.totalCredits,
      })),
      monthlyRevenue: {
        totalCreditsAdded: monthlyRevenue[0]?.totalCreditsAdded ?? 0,
        transactionCount: monthlyRevenue[0]?.transactionCount ?? 0,
      },
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        userId: t.userId,
        amount: t.amount,
        type: t.type,
        source: t.source,
        action: t.action,
        createdAt: t.createdAt?.toISOString(),
      })),
      totalCreditsBalance: totalCreditsBalance[0]?.total ?? 0,
      estimatedMRR,
      arpu: totalSubscribers[0]?.count
        ? estimatedMRR / totalSubscribers[0].count
        : 0,
    };
  }),

  // ─── 管理员：团队成员 Credits 统计仪表板 ────────
  adminTeamCreditsStats: protectedProcedure
    .input(
      z.object({
        teamId: z.number().optional(), // 不传则查所有团队
        days: z.number().min(1).max(365).default(30), // 时间范围
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("无权限");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { teams, teamMembers, teamCreditAllocations, teamActivityLogs, users } = await import("../../drizzle/schema");

      // ── 1. 获取所有团队列表 ──
      const allTeams = await db.select().from(teams).orderBy(desc(teams.createdAt));

      // ── 2. 选定团队（默认第一个或指定的） ──
      const targetTeamId = input.teamId ?? allTeams[0]?.id;
      if (!targetTeamId) {
        return {
          teams: [],
          selectedTeamId: null,
          memberRanking: [],
          featureDistribution: [],
          dailyTrend: [],
          summary: { totalMembers: 0, totalAllocated: 0, totalUsed: 0, utilizationRate: 0 },
        };
      }

      // ── 3. 成员用量排行 ──
      const memberRanking = await db
        .select({
          memberId: teamMembers.id,
          userId: teamMembers.userId,
          role: teamMembers.role,
          allocated: teamMembers.allocatedCredits,
          used: teamMembers.usedCredits,
          status: teamMembers.status,
          userName: users.name,
          userEmail: users.email,
        })
        .from(teamMembers)
        .leftJoin(users, eq(teamMembers.userId, users.id))
        .where(
          and(
            eq(teamMembers.teamId, targetTeamId),
            eq(teamMembers.status, "active")
          )
        )
        .orderBy(desc(teamMembers.usedCredits));

      // ── 4. 功能使用分布（从 stripe_usage_logs 中查该团队成员的使用记录） ──
      const memberUserIds = memberRanking.map((m) => m.userId);
      let featureDistribution: { action: string; count: number; totalCredits: number }[] = [];
      if (memberUserIds.length > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - input.days);
        const featureResult = await db
          .select({
            action: stripeUsageLogs.action,
            count: sql<number>`count(*)`,
            totalCredits: sql<number>`COALESCE(SUM(${stripeUsageLogs.creditsCost}), 0)`,
          })
          .from(stripeUsageLogs)
          .where(
            and(
              sql`${stripeUsageLogs.userId} IN (${sql.join(memberUserIds.map(id => sql`${id}`), sql`, `)})`,
              gte(stripeUsageLogs.createdAt, cutoff)
            )
          )
          .groupBy(stripeUsageLogs.action);
        featureDistribution = featureResult.map((r) => ({
          action: r.action,
          count: r.count,
          totalCredits: r.totalCredits,
        }));
      }

      // ── 5. 每日 Credits 消耗趋势 ──
      let dailyTrend: { date: string; credits: number; actions: number }[] = [];
      if (memberUserIds.length > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - input.days);
        const trendResult = await db
          .select({
            date: sql<string>`DATE(${stripeUsageLogs.createdAt})`,
            credits: sql<number>`COALESCE(SUM(${stripeUsageLogs.creditsCost}), 0)`,
            actions: sql<number>`count(*)`,
          })
          .from(stripeUsageLogs)
          .where(
            and(
              sql`${stripeUsageLogs.userId} IN (${sql.join(memberUserIds.map(id => sql`${id}`), sql`, `)})`,
              gte(stripeUsageLogs.createdAt, cutoff)
            )
          )
          .groupBy(sql`DATE(${stripeUsageLogs.createdAt})`)
          .orderBy(sql`DATE(${stripeUsageLogs.createdAt})`);
        dailyTrend = trendResult.map((r) => ({
          date: String(r.date),
          credits: r.credits,
          actions: r.actions,
        }));
      }

      // ── 6. 每个成员的功能使用明细 ──
      let memberFeatureBreakdown: { userId: number; action: string; count: number; credits: number }[] = [];
      if (memberUserIds.length > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - input.days);
        const breakdownResult = await db
          .select({
            userId: stripeUsageLogs.userId,
            action: stripeUsageLogs.action,
            count: sql<number>`count(*)`,
            credits: sql<number>`COALESCE(SUM(${stripeUsageLogs.creditsCost}), 0)`,
          })
          .from(stripeUsageLogs)
          .where(
            and(
              sql`${stripeUsageLogs.userId} IN (${sql.join(memberUserIds.map(id => sql`${id}`), sql`, `)})`,
              gte(stripeUsageLogs.createdAt, cutoff)
            )
          )
          .groupBy(stripeUsageLogs.userId, stripeUsageLogs.action);
        memberFeatureBreakdown = breakdownResult.map((r) => ({
          userId: r.userId,
          action: r.action,
          count: r.count,
          credits: r.credits,
        }));
      }

      // ── 7. 汇总 ──
      const totalAllocated = memberRanking.reduce((s, m) => s + m.allocated, 0);
      const totalUsed = memberRanking.reduce((s, m) => s + m.used, 0);

      return {
        teams: allTeams.map((t) => ({ id: t.id, name: t.name, ownerId: t.ownerId })),
        selectedTeamId: targetTeamId,
        memberRanking: memberRanking.map((m) => ({
          ...m,
          remaining: m.allocated - m.used,
          utilizationRate: m.allocated > 0 ? Math.round((m.used / m.allocated) * 100) : 0,
        })),
        featureDistribution,
        dailyTrend,
        memberFeatureBreakdown,
        summary: {
          totalMembers: memberRanking.length,
          totalAllocated,
          totalUsed,
          utilizationRate: totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0,
        },
      };
    }),

  // ─── 管理员：手动添加 Credits ─────────────────
  adminAddCredits: protectedProcedure
    .input(
      z.object({
        targetUserId: z.number(),
        amount: z.number().min(1).max(10000),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("无权限");
      }
      const result = await addCredits(input.targetUserId, input.amount, "bonus");
      await writeAuditLog({
        userId: ctx.user.id,
        eventType: "admin.add_credits",
        action: "manual_credit_add",
        amount: input.amount,
        metadata: { targetUserId: input.targetUserId, reason: input.reason },
      });
      return result;
    }),

  // ─── 用户：获取历史发票 ─────────────────
  getInvoices: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      return db
        .select()
        .from(stripeInvoices)
        .where(eq(stripeInvoices.userId, ctx.user.id))
        .orderBy(desc(stripeInvoices.createdAt))
        .limit(input?.limit ?? 20);
    }),

  // ─── 用户：获取 Stripe Customer Portal URL ───
  getPortalUrl: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    if (!stripe) throw new Error("Stripe 未配置");

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const customer = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.userId, ctx.user.id))
      .limit(1);

    if (customer.length === 0 || !customer[0].stripeCustomerId) {
      throw new Error("未找到 Stripe 客户记录");
    }

    const baseUrl = process.env.FRONTEND_URL || "https://mvstudiopro.com";
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer[0].stripeCustomerId,
      return_url: `${baseUrl}/pricing`,
    });

    await writeAuditLog({
      userId: ctx.user.id,
      eventType: "portal.session.created",
      stripeCustomerId: customer[0].stripeCustomerId,
      action: "portal_open",
    });

    return { url: portalSession.url };
  }),

  // ─── 管理员：审计日志查找 ─────────────────
  adminAuditLogs: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(500).default(100),
        eventType: z.string().optional(),
        status: z.enum(["success", "failed", "pending"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("无权限");

      const db = await getDb();
      if (!db) return [];

      let query = db
        .select()
        .from(stripeAuditLogs)
        .orderBy(desc(stripeAuditLogs.createdAt))
        .limit(input.limit);

      return query;
    }),

  // ─── 管理员：KPI 增强指针（Trial→Paid 转化率、Churn Rate、LTV）───
  adminKpiMetrics: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("无权限");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const days = input?.days ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      // Trial → Paid 转化率
      const trialToPaidEvents = await db
        .select({ count: sql<number>`count(*)` })
        .from(stripeAuditLogs)
        .where(
          and(
            eq(stripeAuditLogs.action, "trial_to_paid"),
            gte(stripeAuditLogs.createdAt, cutoff)
          )
        );

      const trialStartEvents = await db
        .select({ count: sql<number>`count(*)` })
        .from(stripeAuditLogs)
        .where(
          and(
            eq(stripeAuditLogs.action, "subscription_update"),
            sql`JSON_EXTRACT(${stripeAuditLogs.metadata}, '$.status') = 'trialing'`,
            gte(stripeAuditLogs.createdAt, cutoff)
          )
        );

      // Churn Rate
      const churnEvents = await db
        .select({ count: sql<number>`count(*)` })
        .from(stripeAuditLogs)
        .where(
          and(
            eq(stripeAuditLogs.action, "subscription_cancelled"),
            gte(stripeAuditLogs.createdAt, cutoff)
          )
        );

      const totalPaidUsers = await db
        .select({ count: sql<number>`count(*)` })
        .from(stripeCustomers)
        .where(sql`${stripeCustomers.plan} != 'free'`);

      // 退款统计
      const refundEvents = await db
        .select({
          count: sql<number>`count(*)`,
          totalAmount: sql<number>`COALESCE(SUM(ABS(${stripeAuditLogs.amount})), 0)`,
        })
        .from(stripeAuditLogs)
        .where(
          and(
            eq(stripeAuditLogs.action, "refund_processed"),
            gte(stripeAuditLogs.createdAt, cutoff)
          )
        );

      // 付款失败统计
      const paymentFailedEvents = await db
        .select({ count: sql<number>`count(*)` })
        .from(stripeAuditLogs)
        .where(
          and(
            eq(stripeAuditLogs.eventType, "invoice.payment_failed"),
            gte(stripeAuditLogs.createdAt, cutoff)
          )
        );

      // 计算指针
      const trialToPaidCount = trialToPaidEvents[0]?.count ?? 0;
      const trialStartCount = trialStartEvents[0]?.count ?? 0;
      const churnCount = churnEvents[0]?.count ?? 0;
      const totalPaid = totalPaidUsers[0]?.count ?? 0;

      const trialConversionRate = trialStartCount > 0
        ? Math.round((trialToPaidCount / trialStartCount) * 100)
        : 0;

      const churnRate = totalPaid > 0
        ? Math.round((churnCount / totalPaid) * 100)
        : 0;

      // ARPU
      const { PLANS } = await import("../plans");
      const planCounts = await db
        .select({ plan: stripeCustomers.plan, count: sql<number>`count(*)` })
        .from(stripeCustomers)
        .groupBy(stripeCustomers.plan);

      const proCount = planCounts.find((p) => p.plan === "pro")?.count ?? 0;
      const enterpriseCount = planCounts.find((p) => p.plan === "enterprise")?.count ?? 0;
      const mrr = proCount * PLANS.pro.monthlyPrice + enterpriseCount * PLANS.enterprise.monthlyPrice;
      const arpu = totalPaid > 0 ? Math.round(mrr / totalPaid) : 0;

      // LTV 估算（ARPU / Churn Rate）
      const monthlyChurnRate = churnRate / 100;
      const estimatedLTV = monthlyChurnRate > 0
        ? Math.round(arpu / monthlyChurnRate)
        : arpu * 24; // 默认 24 个月

      return {
        period: `${days} 天`,
        trialConversion: {
          trialStarts: trialStartCount,
          trialToPaid: trialToPaidCount,
          conversionRate: trialConversionRate,
        },
        churn: {
          churnedUsers: churnCount,
          totalPaidUsers: totalPaid,
          churnRate,
        },
        refunds: {
          count: refundEvents[0]?.count ?? 0,
          totalAmount: (refundEvents[0]?.totalAmount ?? 0) / 100, // 转为美元
        },
        paymentFailures: paymentFailedEvents[0]?.count ?? 0,
        revenue: {
          mrr,
          arpu,
          estimatedLTV,
        },
      };
    }),
});
