/**
 * 小说工作台 · 创意环节计费（站长 2026-11-12：每部作品前两次免费，第三次起每次 20 积分）。
 *
 * 口径：
 * - 「一部作品」= 请求里的 workId（前台取草稿的作品身份 projectId，缺省为本季 roundId；跨刷新、跨设备随草稿走）；
 *   旧请求没有 workId 时按 roundId 计。
 * - 计次：服务端 jobs 表里本账号、本作品、成功交付（status = succeeded）的 creative_premises 请求条数；
 *   「先出 4 个核心创意」与「换一批」都算。失败、解析不通过、超时、积分不足未交付都不是 succeeded，不计次。
 * - 第几次：按创建先后排序（同一时刻再按 id），本次之前的成功条数 + 1；并发时宁可少收，不多收。
 * - 扣费沿用仓库现有通路（照 kb/billing.md 与成片调色建议的写法）：deductCreditsAmount + chargeKey 按 requestId 幂等，
 *   模型成功、校验通过后才扣（后扣，失败无需退）；管理员 / supervisor 由 deductCreditsAmount 内部 0 扣、跳过余额预检，照常计次。
 *   同 requestId 已成功的重放按同 chargeKey 幂等补扣（已扣过直接命中，不重复扣）。
 */
import { TRPCError } from "@trpc/server";
import {
  NOVEL_CREATIVE_PREMISE_CREDITS,
  NOVEL_CREATIVE_PREMISE_FREE_RUNS,
  novelCreativePremiseRunCost,
} from "../../shared/novelCreativePremise";
import type { NovelTestInput } from "../../shared/novelWorkspace";

export const NOVEL_CREATIVE_PREMISE_CHARGE_ACTION = "novelCreativePremise";
export const NOVEL_CREATIVE_PREMISE_CHARGE_DESC = "小说核心创意";
/** 预检不足时的提示（照成片调色建议的写法）。 */
export const NOVEL_CREATIVE_PREMISE_NEED_CREDITS = `核心创意需要 ${NOVEL_CREATIVE_PREMISE_CREDITS} 积分`;
/** 扣费时余额不足：本次结果不交付（不计次），原始记录保留。 */
export const NOVEL_CREATIVE_PREMISE_UNPAID = "积分不足，核心创意未交付，请充值后重新生成";

export function novelCreativePremiseChargeKey(userId: number, requestId: string) {
  return `novel-creative-premise:${userId}:${requestId}`;
}

export function novelCreativePremiseWorkId(input: Pick<NovelTestInput, "roundId"> & { workId?: string }) {
  return input.workId || input.roundId;
}

/** 成功交付的一条创意环节记录（jobs 表里读出的最小字段）。 */
export type NovelCreativePremiseRunRow = { id: string; createdAt: Date | string | number; request: { roundId?: string; workId?: string } };

const time = (v: Date | string | number) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * 本作品成功次数。before 给出时只数排在它之前的（按 createdAt，再按 id），用来算本次是第几次。
 */
export function countNovelCreativePremiseRuns(
  rows: readonly NovelCreativePremiseRunRow[],
  workId: string,
  before?: { id: string; createdAt: Date | string | number }
) {
  return rows.filter(row => {
    if (row.id === before?.id) return false;
    if (novelCreativePremiseWorkId({ roundId: row.request.roundId ?? "", workId: row.request.workId }) !== workId) return false;
    if (!before) return true;
    const a = time(row.createdAt);
    const b = time(before.createdAt);
    return a < b || (a === b && row.id < before.id);
  }).length;
}

export type NovelCreativePremiseBillingDeps = {
  /** 本账号全部成功交付的创意环节记录（不限作品，由调用方按 jobs 表读取）。 */
  listRuns: (userId: number) => Promise<NovelCreativePremiseRunRow[]>;
  balance: (userId: number) => Promise<{ totalAvailable: number }>;
  charge: (
    userId: number,
    amount: number,
    action: string,
    description?: string,
    opts?: { chargeKey?: string }
  ) => Promise<{ success: boolean; cost: number; alreadyCharged?: boolean }>;
};

export const isNovelPrivilegedRole = (role?: string | null) => role === "admin" || role === "supervisor";

/** 前台显示用：本作品已用次数与下一次的价格。管理者账号照常计次，exempt 表示按现有规则不扣积分。 */
export async function readNovelCreativePremiseUsage(
  userId: number,
  workId: string,
  role: string | null | undefined,
  deps: Pick<NovelCreativePremiseBillingDeps, "listRuns">
) {
  const used = countNovelCreativePremiseRuns(await deps.listRuns(userId), workId);
  return {
    workId,
    used,
    freeRuns: NOVEL_CREATIVE_PREMISE_FREE_RUNS,
    credits: NOVEL_CREATIVE_PREMISE_CREDITS,
    nextCost: novelCreativePremiseRunCost(used + 1),
    exempt: isNovelPrivilegedRole(role),
  };
}

/** 提交前预检（不调模型前）：下一次要收费且不是管理者时，余额不够就拒绝，不登记、不调用。 */
export async function assertNovelCreativePremiseAffordable(
  userId: number,
  workId: string,
  role: string | null | undefined,
  deps: Pick<NovelCreativePremiseBillingDeps, "listRuns" | "balance">
) {
  if (isNovelPrivilegedRole(role)) return;
  const used = countNovelCreativePremiseRuns(await deps.listRuns(userId), workId);
  const cost = novelCreativePremiseRunCost(used + 1);
  if (cost > 0 && (await deps.balance(userId)).totalAvailable < cost)
    throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_CREATIVE_PREMISE_NEED_CREDITS });
}

/**
 * 成功、校验通过后结算：算出本次是本作品第几次，第三次起按 requestId 幂等扣费。
 * 余额不足（或扣费未成功）抛 PAYMENT_REQUIRED，调用方把这次记为未交付（不计次）。
 */
export async function settleNovelCreativePremiseRun(
  userId: number,
  self: { id: string; createdAt: Date | string | number; requestId: string; workId: string },
  deps: Pick<NovelCreativePremiseBillingDeps, "listRuns" | "charge">
) {
  const ordinal = countNovelCreativePremiseRuns(await deps.listRuns(userId), self.workId, self) + 1;
  const price = novelCreativePremiseRunCost(ordinal);
  const chargeKey = novelCreativePremiseChargeKey(userId, self.requestId);
  if (price <= 0) return { workId: self.workId, ordinal, price, cost: 0, chargeKey };
  let deduction: Awaited<ReturnType<NovelCreativePremiseBillingDeps["charge"]>>;
  try {
    deduction = await deps.charge(userId, price, NOVEL_CREATIVE_PREMISE_CHARGE_ACTION, NOVEL_CREATIVE_PREMISE_CHARGE_DESC, { chargeKey });
  } catch (error) {
    if ((error as Error)?.name === "InsufficientCreditsError" || /不足/.test(String((error as Error)?.message ?? "")))
      throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_CREATIVE_PREMISE_UNPAID });
    throw error;
  }
  if (!deduction.success) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_CREATIVE_PREMISE_UNPAID });
  return { workId: self.workId, ordinal, price, cost: deduction.cost, chargeKey };
}

/** 同 requestId 已成功的重放：按记录的价格与同 chargeKey 幂等补扣（已扣过直接命中，不重复扣）。 */
export async function replayNovelCreativePremiseCharge(
  userId: number,
  billing: { price?: number; chargeKey?: string } | undefined,
  deps: Pick<NovelCreativePremiseBillingDeps, "charge">
) {
  if (!billing?.price || !billing.chargeKey) return;
  const deduction = await deps.charge(userId, billing.price, NOVEL_CREATIVE_PREMISE_CHARGE_ACTION, NOVEL_CREATIVE_PREMISE_CHARGE_DESC, {
    chargeKey: billing.chargeKey,
  });
  if (!deduction.success) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: NOVEL_CREATIVE_PREMISE_UNPAID });
}

/** 生产依赖：jobs 表读本账号成功交付的创意环节记录；扣费 / 余额走 server/credits.ts 现有函数。 */
export function defaultNovelCreativePremiseBillingDeps(): NovelCreativePremiseBillingDeps {
  return {
    listRuns: async userId => {
      const [{ getDb }, { jobs }, { and, eq, sql }] = await Promise.all([
        import("../db"),
        import("../../drizzle/schema"),
        import("drizzle-orm"),
      ]);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "测试记录暂不可用，未提交" });
      const rows = await db
        .select({ id: jobs.id, createdAt: jobs.createdAt, input: jobs.input })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, String(userId)),
            eq(jobs.status, "succeeded"),
            sql`${jobs.input}::jsonb->>'action' = 'novel_workspace_test'`,
            sql`${jobs.input}::jsonb->'request'->>'advisorIntent' = 'creative_premises'`
          )
        );
      return rows.map(row => ({
        id: row.id,
        createdAt: row.createdAt ?? 0,
        request: ((row.input as { request?: { roundId?: string; workId?: string } })?.request ?? {}),
      }));
    },
    balance: async userId => (await import("../credits")).getCredits(userId),
    charge: async (...args) => (await import("../credits")).deductCreditsAmount(...args),
  };
}
