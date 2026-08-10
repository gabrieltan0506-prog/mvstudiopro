import { eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  creditBalances,
  creditTransactions,
  stripeUsageLogs,
  stripeCustomers,
  teamMembers,
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

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** 余额不足（个人+团队都扣不动）。调用方据此回 402，别的异常一律不是 402。 */
export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS";
}

function executeRows(res: unknown): Record<string, unknown>[] {
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * 个人扣费 = 单条 SQL（neon-http 没有跨语句事务，只有单语句是原子的）：
 * 余额条件 UPDATE、交易行、使用日志三件事全在一条数据修改 CTE 里，
 * 要么全落库要么全不落——不存在「余额已扣、日志没写」的中间态。
 * 够不够由 WHERE 判，不在 JS 里比大小（并发双扣的老病根）。
 *
 * @returns 扣减后的余额；余额不足或被并发抢先时返回 null（此时一分未扣）
 */
async function deductPersonalAtomic(
  db: Db,
  userId: number,
  cost: number,
  action: string,
  txDescription: string,
  usageDescription: string,
  chargeKey?: string,
): Promise<number | null> {
  const res = await db.execute(sql`
    WITH upd AS (
      UPDATE credit_balances
      SET "balance" = "balance" - ${cost},
          "lifetimeSpent" = "lifetimeSpent" + ${cost},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "balance" >= ${cost}
      RETURNING "balance"
    ),
    tx_log AS (
      INSERT INTO credit_transactions
        ("userId", "amount", "type", "source", "action", "description", "balanceAfter")
      SELECT ${userId}, ${-cost}, 'debit', 'usage', ${action}, ${txDescription}, upd."balance"
      FROM upd
    ),
    usage_log AS (
      INSERT INTO stripe_usage_logs
        ("userId", "action", "creditsCost", "isFreeQuota", "description", "balanceAfter", "chargeKey")
      SELECT ${userId}, ${action}, ${cost}, 0, ${usageDescription}, upd."balance", ${chargeKey ?? null}
      FROM upd
    )
    SELECT "balance" FROM upd
  `);
  const rows = executeRows(res);
  return rows.length ? Number(rows[0].balance) : null;
}

/** 团队额度扣费；同 {@link deductPersonalAtomic}，额度 UPDATE 与两条日志同一条 SQL */
async function deductTeamAtomic(
  db: Db,
  membership: { id: number; teamId: number },
  userId: number,
  cost: number,
  action: string,
  usageDescription: string,
  activityDescription: string,
  chargeKey?: string,
): Promise<{ allocated: number; used: number } | null> {
  const usageMetadata = JSON.stringify({
    source: "team",
    teamId: membership.teamId,
    memberId: membership.id,
  });
  const res = await db.execute(sql`
    WITH upd AS (
      UPDATE team_members
      SET "usedCredits" = "usedCredits" + ${cost},
          "updatedAt" = NOW()
      WHERE "id" = ${membership.id}
        AND "allocatedCredits" - "usedCredits" >= ${cost}
      RETURNING "allocatedCredits", "usedCredits"
    ),
    usage_log AS (
      INSERT INTO stripe_usage_logs
        ("userId", "action", "creditsCost", "isFreeQuota", "description", "balanceAfter", "metadata", "chargeKey")
      SELECT ${userId}, ${action}, ${cost}, 0, ${usageDescription},
             upd."allocatedCredits" - upd."usedCredits", ${usageMetadata}, ${chargeKey ?? null}
      FROM upd
    ),
    activity_log AS (
      INSERT INTO team_activity_logs ("teamId", "userId", "action", "description", "metadata")
      SELECT ${membership.teamId}, ${userId}, 'credits_used', ${activityDescription},
             jsonb_build_object(
               'action', ${action}::text,
               'cost', ${cost}::int,
               'remainingAllocation', upd."allocatedCredits" - upd."usedCredits"
             )::text
      FROM upd
    )
    SELECT "allocatedCredits" AS allocated, "usedCredits" AS used FROM upd
  `);
  const rows = executeRows(res);
  return rows.length
    ? { allocated: Number(rows[0].allocated), used: Number(rows[0].used) }
    : null;
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

  // 1. 先尝试从个人帐户扣费（先确保余额行存在，否则条件 UPDATE 会扑空）
  const balance = await getOrCreateBalance(userId);
  const newBalance = await deductPersonalAtomic(
    db,
    userId,
    cost,
    action,
    description ?? `${action} generation`,
    description ?? `${action} generation (个人帐户)`,
  );
  if (newBalance !== null) {
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
    const team = await deductTeamAtomic(
      db,
      membership,
      userId,
      cost,
      action,
      description ?? `${action} generation (团队额度)`,
      `使用 ${cost} Credits 进行 ${action}`,
    );
    if (team) {
      return {
        success: true,
        cost,
        remainingBalance: team.allocated - team.used,
        source: "team" as const,
        teamId: membership.teamId,
        teamMemberId: membership.id,
      };
    }
  }

  // 3. 个人和团队都不足
  const teamInfo = membership
    ? `（团队额度剩余: ${membership.allocatedCredits - membership.usedCredits}）`
    : "";
  throw new InsufficientCreditsError(
    `Credits 不足。需要: ${cost}, 个人帐户可用: ${balance.balance}${teamInfo}`
  );
}

/** 唯一约束撞击 = 同 chargeKey 已扣过（并发/重试的另一腿先落库） */
function isChargeKeyUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /stripe_usage_logs_charge_key_uniq|duplicate key value/i.test(msg);
}

/** 按 chargeKey 读已落库的那笔扣费（含来源快照），供撞唯一约束后复原返回值 */
async function findChargeByKey(
  db: Db,
  userId: number,
  chargeKey: string,
): Promise<
  | { cost: number; source: "personal" | "team"; teamId?: number; teamMemberId?: number }
  | null
> {
  const [row] = await db
    .select({
      creditsCost: stripeUsageLogs.creditsCost,
      metadata: stripeUsageLogs.metadata,
    })
    .from(stripeUsageLogs)
    .where(and(eq(stripeUsageLogs.userId, userId), eq(stripeUsageLogs.chargeKey, chargeKey)))
    .limit(1);
  if (!row) return null;
  let meta: { source?: string; teamId?: number; memberId?: number } = {};
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    meta = {};
  }
  if (meta.source === "team") {
    return {
      cost: Math.max(0, Number(row.creditsCost) || 0),
      source: "team",
      teamId: Number(meta.teamId) || undefined,
      teamMemberId: Number(meta.memberId) || undefined,
    };
  }
  return { cost: Math.max(0, Number(row.creditsCost) || 0), source: "personal" };
}

/**
 * 按固定数额扣费（用于放大等 = 基准单价 × 倍率的场景）。
 * opts.chargeKey：幂等扣费键——写进 stripe_usage_logs 唯一索引列，与余额 UPDATE
 * 同一条 SQL；并发/重试双扣时后到者整条语句回滚，本函数捕获后按已落库那笔复原返回
 * （alreadyCharged=true），DB 层兜死 SELECT-再-扣 的 TOCTOU。
 */
export async function deductCreditsAmount(
  userId: number,
  amount: number,
  action: string,
  description?: string,
  opts?: { chargeKey?: string },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (cost <= 0) {
    return { success: true, cost: 0, remainingBalance: -1, source: "none" as const };
  }

  if (await isAdmin(userId)) {
    return {
      success: true,
      cost: 0,
      remainingBalance: -1,
      source: "admin" as const,
    };
  }

  const chargeKey = String(opts?.chargeKey || "").trim().slice(0, 120) || undefined;

  // 先确保余额行存在，否则条件 UPDATE 会扑空
  const balance = await getOrCreateBalance(userId);
  // 扣减与日志行同一条 SQL：中间态不存在，幂等重试按 chargeKey 查账口径可靠
  let newBalance: number | null = null;
  try {
    newBalance = await deductPersonalAtomic(
      db,
      userId,
      cost,
      action.slice(0, 50),
      description ?? `${action} (${cost} cr)`,
      description ?? `${action} (${cost} cr, 个人帐户)`,
      chargeKey,
    );
  } catch (e) {
    if (chargeKey && isChargeKeyUniqueViolation(e)) {
      const prior = await findChargeByKey(db, userId, chargeKey);
      if (prior) {
        return prior.source === "team"
          ? {
              success: true,
              cost: prior.cost,
              remainingBalance: -1,
              source: "team" as const,
              teamId: prior.teamId,
              teamMemberId: prior.teamMemberId,
              alreadyCharged: true,
            }
          : {
              success: true,
              cost: prior.cost,
              remainingBalance: -1,
              source: "personal" as const,
              alreadyCharged: true,
            };
      }
    }
    throw e;
  }
  if (newBalance !== null) {
    return {
      success: true,
      cost,
      remainingBalance: newBalance,
      source: "personal" as const,
    };
  }

  const membership = await getTeamMembership(userId);
  if (membership) {
    let team: { allocated: number; used: number } | null = null;
    try {
      team = await deductTeamAtomic(
        db,
        membership,
        userId,
        cost,
        action.slice(0, 50),
        description ?? `${action} (${cost} cr, 团队额度)`,
        `使用 ${cost} Credits 进行 ${action}`,
        chargeKey,
      );
    } catch (e) {
      if (chargeKey && isChargeKeyUniqueViolation(e)) {
        const prior = await findChargeByKey(db, userId, chargeKey);
        if (prior?.source === "team") {
          return {
            success: true,
            cost: prior.cost,
            remainingBalance: -1,
            source: "team" as const,
            teamId: prior.teamId,
            teamMemberId: prior.teamMemberId,
            alreadyCharged: true,
          };
        }
        if (prior) {
          return {
            success: true,
            cost: prior.cost,
            remainingBalance: -1,
            source: "personal" as const,
            alreadyCharged: true,
          };
        }
      }
      throw e;
    }
    if (team) {
      return {
        success: true,
        cost,
        remainingBalance: team.allocated - team.used,
        source: "team" as const,
        teamId: membership.teamId,
        teamMemberId: membership.id,
      };
    }
  }

  const teamInfo = membership
    ? `（团队额度剩余: ${membership.allocatedCredits - membership.usedCredits}）`
    : "";
  throw new InsufficientCreditsError(
    `Credits 不足。需要: ${cost}, 个人帐户可用: ${balance.balance}${teamInfo}`
  );
}

// ─── 充值 ───────────────────────────────────────────
export async function addCredits(
  userId: number,
  amount: number,
  source:
    | "subscription"
    | "purchase"
    | "bonus"
    | "beta"
    | "referral"
    | "payment"
    | "refund"
    | "credit_restore",
  stripePaymentIntentId?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await getOrCreateBalance(userId);
  // 相对更新 + 单条 SQL：绝对 SET 会把并发扣费覆盖掉（读到旧值再写回）
  const res = await db.execute(sql`
    WITH upd AS (
      UPDATE credit_balances
      SET "balance" = "balance" + ${amount},
          "lifetimeEarned" = "lifetimeEarned" + ${amount},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
      RETURNING "balance"
    ),
    mirror AS (
      -- 同步 users.credits，保持首页积分显示一致
      UPDATE users
      SET "credits" = COALESCE("credits", 0) + ${amount}
      WHERE "id" = ${userId}
    )
    INSERT INTO credit_transactions
      ("userId", "amount", "type", "source", "description", "balanceAfter", "stripePaymentIntentId")
    SELECT ${userId}, ${amount}, 'credit', ${source}, ${`${source}: +${amount} credits`},
           upd."balance", ${stripePaymentIntentId ?? null}
    FROM upd
    RETURNING "balanceAfter"
  `);
  const rows = executeRows(res);
  if (!rows.length) throw new Error(`addCredits: balance row missing userId=${userId}`);
  return { balance: Number(rows[0].balanceAfter) };
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

/** 兑换码 / 活动赠送积分来源（先花赠送：估算剩余） */
const GIFTED_CREDIT_SOURCES = new Set(["beta", "bonus", "referral"]);

/**
 * 估算个人帐户尚未花完的赠送积分（兑换码 beta、活动 bonus、邀请 referral）。
 * 假设历史扣费优先消耗赠送余额：remaining = min(balance, max(0, giftedIn - spent))。
 * 无限额度账号返回 0（不阻断半价）。
 */
export async function estimateRemainingGiftedCredits(
  userId: number,
): Promise<number> {
  if (await isAdmin(userId)) return 0;
  const db = await getDb();
  if (!db) return 0;

  const rows = await db
    .select({
      amount: creditTransactions.amount,
      type: creditTransactions.type,
      source: creditTransactions.source,
    })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));

  let giftedIn = 0;
  let spent = 0;
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    if (r.type === "credit" && GIFTED_CREDIT_SOURCES.has(String(r.source))) {
      giftedIn += Math.max(0, amt);
    } else if (r.type === "debit") {
      spent += Math.abs(amt);
    }
  }

  const balance = await getOrCreateBalance(userId);
  return Math.min(
    Math.max(0, Number(balance.balance) || 0),
    Math.max(0, giftedIn - spent),
  );
}

// ─── 生成失败时退回已扣除积分（非金流退款）──────────
export async function refundCredits(
  userId: number,
  amount: number,
  reason: string
): Promise<void> {
  const db = await getDb();
  // DB 不可用必须抛错：静默 return 会让调用方把「没退成」谎报成「已退回」，
  // 该进持久化 refund_pending 的走不进去
  if (!db) throw new Error("Database not available (refund not executed)");

  await getOrCreateBalance(userId);
  // 相对更新 + 单条 SQL：绝对 SET 会覆盖并发账变（读 100 → 并发扣到 70 → SET 120 抹掉扣款）；
  // 余额与交易行同一条语句，不存在「余额已加、无交易行」，退分对账（按 refundKey 查交易行）口径可靠
  const res = await db.execute(sql`
    WITH upd AS (
      UPDATE credit_balances
      SET "balance" = "balance" + ${amount},
          "lifetimeEarned" = "lifetimeEarned" + ${amount},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
      RETURNING "balance"
    )
    INSERT INTO credit_transactions
      ("userId", "amount", "type", "source", "description", "balanceAfter")
    SELECT ${userId}, ${amount}, 'credit', 'credit_restore', ${reason}, upd."balance"
    FROM upd
    RETURNING "balanceAfter"
  `);
  if (!executeRows(res).length) {
    throw new Error(`refundCredits: balance row missing userId=${userId} (refund not executed)`);
  }

  console.log(`[Credits] restoreCredits: userId=${userId}, amount=+${amount}, reason=${reason}`);
}

/**
 * 與 {@link deductCreditsAmount} 對稱：依扣款時的 **來源（個人 / 團隊）** 退回同額度，避免「團隊扣款、失敗卻加回個人」的帳務錯亂。
 */
export async function refundCreditsForDeductAmount(
  userId: number,
  reason: string,
  deduct: Awaited<ReturnType<typeof deductCreditsAmount>>,
  actionForLog: string,
): Promise<void> {
  const cost = deduct.cost;
  if (!deduct.success || cost <= 0) return;
  if (deduct.source === "admin" || deduct.source === "none") return;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const act = actionForLog.slice(0, 50);

  if (deduct.source === "personal") {
    await refundCredits(userId, cost, reason);
    return;
  }

  if (deduct.source === "team") {
    const teamMemberId = deduct.teamMemberId;
    const teamId = deduct.teamId;
    if (teamMemberId == null || teamId == null) {
      console.error(
        `[Credits] refundCreditsForDeductAmount: team source but missing teamMemberId/teamId userId=${userId} cost=${cost}`,
      );
      throw new Error("team_refund_metadata_missing");
    }

    const usageMetadata = JSON.stringify({
      source: "team_refund",
      teamId,
      teamMemberId,
      restoredCredits: cost,
    });
    const activityMetadata = JSON.stringify({ action: act, cost, teamMemberId });
    // 相对回冲 + 单条 SQL：绝对 SET 会覆盖并发扣款/并发退款；
    // 额度回冲与两条日志同一条语句，退分对账（查 stripeUsageLogs 里的 refundKey）口径可靠
    const res = await db.execute(sql`
      WITH upd AS (
        UPDATE team_members
        SET "usedCredits" = GREATEST(0, "usedCredits" - ${cost}),
            "updatedAt" = NOW()
        WHERE "id" = ${teamMemberId}
        RETURNING "allocatedCredits", "usedCredits"
      ),
      usage_log AS (
        INSERT INTO stripe_usage_logs
          ("userId", "action", "creditsCost", "isFreeQuota", "description", "balanceAfter", "metadata")
        SELECT ${userId}, ${act}, 0, 0,
               ${reason} || '（' || ${cost}::text || ' cr · 团队额度退回 · used→' || upd."usedCredits"::text || '）',
               upd."allocatedCredits" - upd."usedCredits", ${usageMetadata}
        FROM upd
      ),
      activity_log AS (
        INSERT INTO team_activity_logs ("teamId", "userId", "action", "description", "metadata")
        SELECT ${teamId}, ${userId}, 'credits_refund',
               ${`退回 ${cost} Credits（团队分配额度）：${reason}`}, ${activityMetadata}
        FROM upd
      )
      SELECT "usedCredits" FROM upd
    `);
    if (!executeRows(res).length) {
      console.error(`[Credits] refundCreditsForDeductAmount: teamMembers.id=${teamMemberId} not found`);
      throw new Error("team_member_not_found_for_refund");
    }
  }
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
