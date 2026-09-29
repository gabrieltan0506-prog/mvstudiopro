import { createHash } from "node:crypto";
import { and, count, eq, gte, lt, inArray, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { stripeUsageLogs } from "../../drizzle/schema-stripe";
import { getDb } from "../db";

export type AdvisorQuotaKind = "consult" | "previs";
export const ADVISOR_DAILY_LIMITS = { consult: 5, previs: 3 } as const;
export function advisorQuotaDay(now = new Date()) {
  const start = Math.floor((now.getTime() + 8 * 3600_000) / 86400_000) * 86400_000 - 8 * 3600_000;
  return { day: new Date(start + 8 * 3600_000).toISOString().slice(0, 10), start: new Date(start), resetsAt: new Date(start + 86400_000).toISOString() };
}
type Ledger = { seed: number; claims: Record<string, "reserved" | "released"> };
function idFor(userId: number, kind: AdvisorQuotaKind, day: string) {
  return `mqd_${createHash("sha256").update(`${userId}:${kind}:${day}`).digest("hex").slice(0, 40)}`;
}
export function quotaUsed(value: Ledger): number {
  if (!Number.isInteger(value.seed) || value.seed < 0 || !value.claims || Object.values(value.claims).some(v => v !== "reserved" && v !== "released")) throw new Error("顾问额度记录异常，已停止提交");
  return value.seed + Object.values(value.claims).filter(v => v === "reserved").length;
}
async function database() { const db = await getDb(); if (!db) throw new Error("今日顾问额度暂不可用，请稍后重试"); return db; }

async function legacyUsage(db: Awaited<ReturnType<typeof database>>, userId: number, kind: AdvisorQuotaKind, period: ReturnType<typeof advisorQuotaDay>) {
  if (kind === "consult") {
    const [row] = await db.select({ c: count() }).from(stripeUsageLogs).where(and(eq(stripeUsageLogs.userId, userId), eq(stripeUsageLogs.isFreeQuota, 1), inArray(stripeUsageLogs.action, ["platformSkillQa", "platformSkillQaTerra", "platformSkillQaSol"]), gte(stripeUsageLogs.createdAt, period.start), lt(stripeUsageLogs.createdAt, new Date(period.resetsAt))));
    return Number(row?.c || 0);
  }
  const [row] = await db.select({ c: count() }).from(jobs).where(and(eq(jobs.userId, String(userId)), eq(jobs.provider, "blender-previs"), inArray(jobs.status, ["queued", "running", "succeeded"]), gte(jobs.createdAt, period.start), lt(jobs.createdAt, new Date(period.resetsAt))));
  return Number(row?.c || 0);
}

/** 成功终态的额度账本不进入 worker 队列；跨档位共用一个用户日桶。 */
export async function readAdvisorDailyQuota(userId: number, kind: AdvisorQuotaKind) {
  const db = await database(), period = advisorQuotaDay();
  // 进程中断后由原业务请求终态决定退回；不按时间猜测任务失败。
  if (kind === "consult") await db.execute(sql`
    UPDATE jobs quota SET output = jsonb_set(quota.output::jsonb, '{claims}',
      (SELECT COALESCE(jsonb_object_agg(claim.key, CASE WHEN EXISTS (
        SELECT 1 FROM jobs operation WHERE operation."userId" = ${String(userId)}
          AND operation.input->>'action' = 'manhua_advisor_qa'
          AND operation.input->>'requestId' = claim.key AND operation.status = 'failed'
      ) THEN 'released' ELSE claim.value END), '{}'::jsonb)
       FROM jsonb_each_text((quota.output->'claims')::jsonb) claim))
    WHERE quota.id = ${idFor(userId, kind, period.day)} AND quota."userId" = ${String(userId)}
  `);
  const [row] = await db.select({ output: jobs.output }).from(jobs).where(and(eq(jobs.id, idFor(userId, kind, period.day)), eq(jobs.userId, String(userId))));
  const used = row ? quotaUsed(row.output as Ledger) : await legacyUsage(db, userId, kind, period);
  return { used, remaining: Math.max(0, ADVISOR_DAILY_LIMITS[kind] - used), dailyLimit: ADVISOR_DAILY_LIMITS[kind], ...period };
}

/** 单行原子 UPSERT：同日并发请求不能超领；相同请求不会重复占位。 */
export async function reserveAdvisorDailyQuota(userId: number, kind: AdvisorQuotaKind, requestId: string) {
  const db = await database(), period = advisorQuotaDay(), limit = ADVISOR_DAILY_LIMITS[kind];
  const legacyUsed = await legacyUsage(db, userId, kind, period);
  const first: Ledger = { seed: legacyUsed, claims: legacyUsed < limit ? { [requestId]: "reserved" } : {} };
  const claim = JSON.stringify({ [requestId]: "reserved" });
  const [row] = await db.insert(jobs).values({
    id: idFor(userId, kind, period.day), userId: String(userId), type: "platform", provider: "advisor-quota", status: "succeeded",
    input: { action: "manhua_advisor_daily_quota", day: period.day, kind }, output: first,
  }).onConflictDoUpdate({ target: jobs.id, set: {
    output: sql`CASE WHEN (${jobs.output}->'claims')::jsonb ? ${requestId} THEN ${jobs.output}::jsonb
      WHEN (${jobs.output}->>'seed')::int + (SELECT count(*) FROM jsonb_each_text((${jobs.output}->'claims')::jsonb) q WHERE q.value = 'reserved') < ${limit}
      THEN jsonb_set(${jobs.output}::jsonb, '{claims}', (${jobs.output}->'claims')::jsonb || ${claim}::jsonb)
      ELSE ${jobs.output}::jsonb END`, updatedAt: new Date(),
  } }).returning({ output: jobs.output });
  const value = row.output as Ledger, used = quotaUsed(value);
  return { reserved: value.claims[requestId] === "reserved", used, remaining: Math.max(0, limit - used), day: period.day };
}

/** 只在业务请求已确认失败后恢复免费次数；跨日失败退回原日，不赠送新日次数。 */
export async function releaseAdvisorDailyQuota(userId: number, kind: AdvisorQuotaKind, requestId: string, day: string) {
  const db = await database();
  await db.update(jobs).set({ output: sql`jsonb_set(${jobs.output}::jsonb, '{claims}', (${jobs.output}->'claims')::jsonb || ${JSON.stringify({ [requestId]: "released" })}::jsonb)`, updatedAt: new Date() })
    .where(and(eq(jobs.id, idFor(userId, kind, day)), eq(jobs.userId, String(userId)), sql`${jobs.output}->'claims'->>${requestId} = 'reserved'`));
}
