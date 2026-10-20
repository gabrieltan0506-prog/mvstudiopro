import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { jobs, type Job } from "../../drizzle/schema.js";
import { stripeUsageLogs } from "../../drizzle/schema-stripe.js";
import { getDb } from "../db.js";
import { deductCreditsAmount, getCredits } from "../credits.js";
import { getJobByIdStrict, patchJobRunningProgressStrict } from "./repository.js";
import { countPlatformPersonaPolishEver, countPlatformPersonaPolishToday } from "../services/platformPersonaPolish.js";
import { resolvePlatformPersonaPolishQuota } from "../../shared/platformPersonaPolish.js";
import {
  MARKETING_PLAN_ACTION, MARKETING_PLAN_VERSION, MARKETING_PLAN_STEPS,
  marketingContextSchema, marketingPlanSchema, newMarketingPlan,
  type MarketingPlanResult, type MarketingPlanStep,
} from "../../shared/marketingPlan.js";
import { callMarketingPlanModel, runMarketingPlan } from "../services/platformMarketingPlan.js";

const inputSchema = z.object({ action: z.literal(MARKETING_PLAN_ACTION), params: z.object({
  context: marketingContextSchema, cost: z.number().int().nonnegative(), free: z.boolean(),
}) });

export async function marketingPlanQuota(userId: number, exempt: boolean) {
  const [usedEver, usedToday] = await Promise.all([countPlatformPersonaPolishEver(userId), countPlatformPersonaPolishToday(userId)]);
  const quota = resolvePlatformPersonaPolishQuota({ usedEver, usedToday, tier: "excellent" });
  return { ...quota, nextCredits: exempt ? 0 : quota.nextCredits, exempt };
}

export function marketingPlanJobId(userId: number, context: string): string {
  return "mkt_" + createHash("sha256").update(JSON.stringify([userId, MARKETING_PLAN_VERSION, context.trim()])).digest("hex").slice(0, 48);
}

function readPlan(job: Pick<Job, "input" | "output">): MarketingPlanResult {
  const input = inputSchema.parse(job.input);
  const output = job.output as { marketingPlan?: unknown } | null;
  return output?.marketingPlan ? marketingPlanSchema.parse(output.marketingPlan) : newMarketingPlan(input.params.context);
}

/** 同一账号、同一需求与提示词版本复用任务；数据库主键挡住并发重复提交。 */
export async function enqueueMarketingPlan(userId: number, exempt: boolean, raw: string, expectedCredits: number) {
  const context = marketingContextSchema.parse(raw);
  const id = marketingPlanJobId(userId, context);
  const db = await getDb();
  if (!db) throw new Error("服务暂不可用，尚未提交模型请求");
  const existing = await getJobByIdStrict(id);
  if (existing) {
    if (existing.userId !== String(userId)) throw new Error("任务身份不匹配");
    inputSchema.parse(existing.input);
    return { jobId: id, reused: true };
  }
  const [active] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.userId, String(userId)),
    inArray(jobs.status, ["queued", "running"]), sql`${jobs.input}::jsonb->>'action' = ${MARKETING_PLAN_ACTION}`)).limit(1);
  if (active) throw new Error("已有营销方案正在生成，请先查看该任务，避免重复提交。");
  const quota = await marketingPlanQuota(userId, exempt);
  if (quota.nextCredits !== expectedCredits) throw new Error("额度已变化，请刷新本次费用后再提交。");
  if (quota.nextCredits > 0 && (await getCredits(userId)).totalAvailable < quota.nextCredits) throw new Error("积分不足，尚未提交模型请求。");
  // 查询只用于友好提示；跨进程竞争由唯一索引兜底，不能两份需求同时占同一免费次数。
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS marketing_plan_one_active_per_user
    ON jobs ("userId") WHERE type='platform' AND input->>'action'='platform_marketing_plan' AND status IN ('queued','running')`);
  const inserted = await db.insert(jobs).values({ id, userId: String(userId), type: "platform", provider: "openrouter", status: "queued", attempts: 0,
    input: { action: MARKETING_PLAN_ACTION, params: { context, cost: quota.nextCredits, free: quota.nextFree } },
    output: { marketingPlan: newMarketingPlan(context) },
  }).onConflictDoNothing().returning({ id: jobs.id });
  if (!inserted.length) {
    const raced = await getJobByIdStrict(id);
    if (raced?.userId === String(userId)) return { jobId: id, reused: true };
    throw new Error("已有另一份营销方案正在生成，请先查看该任务。");
  }
  return { jobId: id, reused: false };
}

/** 所有查询均从已鉴权userId过滤；不接受前端传入原稿作为“成功回执”。 */
export async function getMarketingPlan(userId: number, jobId?: string) {
  const db = await getDb();
  if (!db) throw new Error("暂时无法读取已保存方案");
  const [job] = await db.select().from(jobs).where(and(eq(jobs.userId, String(userId)),
    sql`${jobs.input}::jsonb->>'action' = ${MARKETING_PLAN_ACTION}`,
    ...(jobId ? [eq(jobs.id, jobId)] : []),
  )).orderBy(desc(jobs.createdAt)).limit(1);
  if (!job) {
    if (jobId) throw new Error("方案不存在或无权访问");
    return null;
  }
  return { jobId: job.id, status: job.status, result: readPlan(job), error: job.error || null };
}

export async function retryMarketingPlan(userId: number, jobId: string, step: MarketingPlanStep | "settle" | "resume") {
  const current = await getMarketingPlan(userId, jobId);
  if (!current) throw new Error("方案不存在");
  if (current.status === "queued" || current.status === "running") return { jobId };
  const expectedOutput = JSON.stringify({ marketingPlan: current.result });
  const result = current.result;
  if (step === "settle") {
    if (result.billing !== "failed") throw new Error("没有失败的结算步骤");
  } else if (step === "resume") {
    if (!MARKETING_PLAN_STEPS.some(key => ["pending", "running"].includes(result.steps[key].status)) && result.billing === "succeeded") throw new Error("没有未完成的步骤");
  } else {
    const previous = result.steps[step];
    if (!["failed", "unknown", "running"].includes(previous.status)) throw new Error("该步骤没有失败，不会重复生成已成功原稿");
    if (step === "integrated" && (result.steps.deepseek.status !== "succeeded" || result.steps.glm.status !== "succeeded")) throw new Error("先恢复两份原稿，再整合");
    result.steps[step] = { status: "pending", attempts: previous.attempts,
      history: [...(previous.history || []), { text: previous.text, error: previous.error, receipt: previous.receipt }] };
  }
  const db = await getDb();
  if (!db) throw new Error("服务暂不可用，未重试模型");
  const updated = await db.update(jobs).set({ status: "queued", error: null, updatedAt: new Date(), output: { marketingPlan: result } })
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, String(userId)), eq(jobs.status, current.status),
      // 同一旧快照只允许一个重试请求生效。
      sql`${jobs.output}::jsonb = ${expectedOutput}::jsonb`,
    )).returning({ id: jobs.id });
  if (!updated.length) throw new Error("任务状态已变化，请刷新后查看；未重复提交。");
  return { jobId };
}

export async function processMarketingPlanJob(jobId: string, userId: string) {
  const job = await getJobByIdStrict(jobId);
  if (!job || job.userId !== userId) throw new Error("营销任务身份不匹配");
  const input = inputSchema.parse(job.input);
  const saved = readPlan(job);
  const chargeKey = `marketingPlan/${userId}/${jobId}`;
  const result = await runMarketingPlan(jobId, saved, {
    call: callMarketingPlanModel,
    save: plan => patchJobRunningProgressStrict(jobId, { marketingPlan: structuredClone(plan) }),
    settle: async () => {
      const { cost, free, context } = input.params;
      if (cost > 0) {
        await deductCreditsAmount(Number(userId), cost, "platformPersonaPolish", "营销分析：双模型原稿与整合方案", { chargeKey });
      } else {
        const db = await getDb();
        if (!db) throw new Error("结算数据库不可用");
        // 复用既有额度记录与chargeKey唯一索引；重启只补账，不重复消耗免费次数。
        await db.insert(stripeUsageLogs).values({ userId: Number(userId), action: "platformPersonaPolish", creditsCost: 0,
          isFreeQuota: free ? 1 : 0, description: `营销分析 · ${context.length}字`, chargeKey, balanceAfter: null }).onConflictDoNothing();
      }
      return cost;
    },
  });
  return { output: { marketingPlan: result }, provider: "openrouter" };
}
