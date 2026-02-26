import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import {
  creditBalances,
  creditTransactions,
  stripeUsageLogs,
  stripeCustomers,
  teamMembers,
  teamActivityLogs,
  users,
} from "../drizzle/schema";
import { CREDIT_COSTS, PLANS, type PlanType } from "./plans";
import { hasUnlimitedAccess } from "./services/access-policy";

// ─── 检查用户是否为无限额度账户（admin/supervisor） ─────
async function isAdmin(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [user] = await db
    .select({ role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return hasUnlimitedAccess({ role: user?.role, email: user?.email });
}

// ─── 获取或创建 Credits 余额 ────────────────────────
export async function getOrCreateBalance(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  // 创建新余额
  await db.insert(creditBalances).values({
    userId,
    balance: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
  });

  const created = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId))
    .limit(1);
  return created[0];
}

// ─── 查找用户的团队成员记录 ─────────────────────────
async function getTeamMembership(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const membership = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.status, "active")
      )
    )
    .limit(1);

  return membership.length > 0 ? membership[0] : null;
}

// ─── 扣费（支持个人帐户 + 团队额度） ────────────────
export async function deductCredits(
  userId: number,
  action: keyof typeof CREDIT_COSTS,
  description?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // ─── 管理员免扣费 ─────────────────────────────────
  if (await isAdmin(userId)) {
    return {
      success: true,
      cost: 0,
      remainingBalance: -1, // 无限
      source: "admin" as const,
    };
  }

  const cost = CREDIT_COSTS[action];

  // 1. 先尝试从个人帐户扣费
  const balance = await getOrCreateBalance(userId);
  if (balance.balance >= cost) {
    // 个人帐户余额充足，直接扣除
    const newBalance = balance.balance - cost;
    const newLifetimeSpent = balance.lifetimeSpent + cost;

    await db
      .update(creditBalances)
      .set({ balance: newBalance, lifetimeSpent: newLifetimeSpent })
      .where(eq(creditBalances.userId, userId));

    await db.insert(creditTransactions).values({
      userId,
      amount: -cost,
      type: "debit",
      source: "usage",
      action,
      description: description ?? `${action} generation`,
      balanceAfter: newBalance,
    });

    await db.insert(stripeUsageLogs).values({
      userId,
      action,
      creditsCost: cost,
      isFreeQuota: 0,
      description: description ?? `${action} generation (个人帐户)`,
      balanceAfter: newBalance,
    });

    return {
      success: true,
      cost,
      remainingBalance: newBalance,
      source: "personal" as const,
    };
  }

  // 2. 个人帐户不足，尝试从团队分配额度扣费
  const membership = await getTeamMembership(userId);
  if (membership) {
    const availableTeamCredits = membership.allocatedCredits - membership.usedCredits;
    if (availableTeamCredits >= cost) {
      // 从团队额度扣除
      const newUsed = membership.usedCredits + cost;

      await db
        .update(teamMembers)
        .set({ usedCredits: newUsed })
        .where(eq(teamMembers.id, membership.id));

      // 记录使用日志
      await db.insert(stripeUsageLogs).values({
        userId,
        action,
        creditsCost: cost,
        isFreeQuota: 0,
        description: description ?? `${action} generation (团队额度)`,
        balanceAfter: membership.allocatedCredits - newUsed,
        metadata: JSON.stringify({
          source: "team",
          teamId: membership.teamId,
          memberId: membership.id,
        }),
      });

      // 记录团队活动日志
      await db.insert(teamActivityLogs).values({
        teamId: membership.teamId,
        userId,
        action: "credits_used",
        description: `使用 ${cost} Credits 进行 ${action}`,
        metadata: JSON.stringify({ action, cost, remainingAllocation: availableTeamCredits - cost }),
      });

      return {
        success: true,
        cost,
        remainingBalance: availableTeamCredits - cost,
        source: "team" as const,
        teamId: membership.teamId,
      };
    }
  }

  // 3. 个人和团队都不足
  const teamInfo = membership
    ? `（团队额度剩余: ${membership.allocatedCredits - membership.usedCredits}）`
    : "";
  throw new Error(
    `Credits 不足。需要: ${cost}, 个人帐户可用: ${balance.balance}${teamInfo}`
  );
}

// ─── 充值 ───────────────────────────────────────────
export async function addCredits(
  userId: number,
  amount: number,
  source: "subscription" | "purchase" | "bonus" | "beta" | "referral" | "payment" | "refund",
  stripePaymentIntentId?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const balance = await getOrCreateBalance(userId);
  const newBalance = balance.balance + amount;
  const newLifetimeEarned = balance.lifetimeEarned + amount;

  // 更新余额
  await db
    .update(creditBalances)
    .set({
      balance: newBalance,
      lifetimeEarned: newLifetimeEarned,
    })
    .where(eq(creditBalances.userId, userId));

  // 记录交易
  await db.insert(creditTransactions).values({
    userId,
    amount,
    type: "credit",
    source,
    description: `${source}: +${amount} credits`,
    balanceAfter: newBalance,
    stripePaymentIntentId: stripePaymentIntentId ?? null,
  });

  return { balance: newBalance };
}

// ─── 查找余额（含团队额度） ─────────────────────────
export async function getCredits(userId: number) {
  // 管理员返回虚拟无限余额
  if (await isAdmin(userId)) {
    return {
      balance: 999999,
      lifetimeEarned: 999999,
      lifetimeSpent: 0,
      teamCredits: null,
      totalAvailable: 999999,
    };
  }

  const balance = await getOrCreateBalance(userId);
  const membership = await getTeamMembership(userId);

  const teamCredits = membership
    ? {
        allocated: membership.allocatedCredits,
        used: membership.usedCredits,
        available: membership.allocatedCredits - membership.usedCredits,
        teamId: membership.teamId,
      }
    : null;

  return {
    balance: balance.balance,
    lifetimeEarned: balance.lifetimeEarned,
    lifetimeSpent: balance.lifetimeSpent,
    teamCredits,
    totalAvailable: balance.balance + (teamCredits?.available ?? 0),
  };
}

// ─── 检查是否有足够 Credits（个人+团队） ────────────
export async function hasEnoughCredits(
  userId: number,
  action: keyof typeof CREDIT_COSTS
): Promise<boolean> {
  const credits = await getCredits(userId);
  return credits.totalAvailable >= CREDIT_COSTS[action];
}

/**
 * 批量扣除 NBP 图片 Credits（用于分镜图/偶像批量生成）
 * @param count 图片数量
 * @param resolution "2k" | "4k"
 * @returns 成功扣除的数量，如果 Credits 不足则返回可扣除的最大数量
 */
export async function deductNbpCredits(
  userId: number,
  count: number,
  resolution: "2k" | "4k",
  description?: string
) {
  const action = resolution === "4k" ? "nbpImage4K" : "nbpImage2K";
  const costPerImage = CREDIT_COSTS[action];
  const totalCost = costPerImage * count;

  const credits = await getCredits(userId);
  const maxAffordable = Math.floor(credits.totalAvailable / costPerImage);
  const actualCount = Math.min(count, maxAffordable);

  if (actualCount <= 0) {
    return {
      success: false,
      requested: count,
      generated: 0,
      totalCost: 0,
      remainingBalance: credits.totalAvailable,
      fallbackToForge: true,
    };
  }

  // Deduct credits for the affordable count
  const actualCost = costPerImage * actualCount;
  const result = await deductCredits(userId, action, description ?? `NBP ${resolution} x${actualCount}`);

  // If we need to deduct more than one image's worth, do additional deductions
  for (let i = 1; i < actualCount; i++) {
    try {
      await deductCredits(userId, action, description ?? `NBP ${resolution} x${actualCount} (${i + 1}/${actualCount})`);
    } catch {
      // Credits ran out mid-batch
      return {
        success: true,
        requested: count,
        generated: i + 1,
        totalCost: costPerImage * (i + 1),
        remainingBalance: result.remainingBalance - costPerImage * i,
        fallbackToForge: count > i + 1,
      };
    }
  }

  return {
    success: true,
    requested: count,
    generated: actualCount,
    totalCost: actualCost,
    remainingBalance: result.remainingBalance - costPerImage * (actualCount - 1),
    fallbackToForge: count > actualCount,
  };
}

/**
 * 检查用户是否有足够 Credits 生成 NBP 图片
 * 返回可生成的最大数量
 */
export async function checkNbpCapacity(
  userId: number,
  resolution: "2k" | "4k"
): Promise<{ maxImages: number; totalAvailable: number; costPerImage: number }> {
  const action = resolution === "4k" ? "nbpImage4K" : "nbpImage2K";
  const costPerImage = CREDIT_COSTS[action];
  const credits = await getCredits(userId);
  return {
    maxImages: Math.floor(credits.totalAvailable / costPerImage),
    totalAvailable: credits.totalAvailable,
    costPerImage,
  };
}

// ─── 获取用户方案 ──────────────────────────────────
export async function getUserPlan(userId: number): Promise<PlanType> {
  // 管理员始终返回最高方案
  if (await isAdmin(userId)) return "enterprise";

  const db = await getDb();
  if (!db) return "free";

  const customer = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.userId, userId))
    .limit(1);

  if (customer.length === 0) return "free";
  return (customer[0].plan as PlanType) || "free";
}

// ─── 更新订阅方案 ──────────────────────────────────
export async function updateSubscription(
  userId: number,
  plan: PlanType,
  stripeCustomerId?: string,
  stripeSubscriptionId?: string,
  currentPeriodEnd?: Date
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(stripeCustomers)
      .set({
        plan,
        stripeSubscriptionId: stripeSubscriptionId ?? existing[0].stripeSubscriptionId,
        currentPeriodEnd: currentPeriodEnd ?? existing[0].currentPeriodEnd,
      })
      .where(eq(stripeCustomers.userId, userId));
  } else if (stripeCustomerId) {
    await db.insert(stripeCustomers).values({
      userId,
      stripeCustomerId,
      plan,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      currentPeriodEnd: currentPeriodEnd ?? null,
    });
  }

  // 发放月度 Credits（仅订阅方案）
  const planConfig = PLANS[plan];
  if (planConfig.monthlyCredits > 0) {
    await addCredits(userId, planConfig.monthlyCredits, "subscription");
  }
}

// ─── 获取交易记录 ──────────────────────────────────
export async function getCreditTransactions(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];

  const { desc } = await import("drizzle-orm");
  return db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit);
}

// ─── 获取使用日志 ──────────────────────────────────
export async function getUsageLogs(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];

  const { desc } = await import("drizzle-orm");
  return db
    .select()
    .from(stripeUsageLogs)
    .where(eq(stripeUsageLogs.userId, userId))
    .orderBy(desc(stripeUsageLogs.createdAt))
    .limit(limit);
}
