import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";

/** 沿用平台 Terra 日额度；同一行原子认领防止映刻并发超领。终态从原操作读取，不按时间猜测失败。 */
export async function reserveCodeMotionConsultQuota(userId: number, jobId: string, limit: number) {
  const db = await getDb();
  if (!db) throw new Error("今日咨询额度暂不可用，本次未调用模型");
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const id = `cmq_${createHash("sha256").update(`${userId}:${start.toISOString()}`).digest("hex").slice(0, 40)}`;
  const used = sql`(SELECT count(*)::int FROM stripe_usage_logs usage WHERE usage."userId" = ${userId}
    AND usage.action IN ('platformSkillQaTerra', 'platformSkillQa') AND usage."createdAt" >= ${start.toISOString()}::timestamp)`;
  const active = sql`(SELECT count(*)::int FROM jsonb_each_text(COALESCE((${jobs.output}->'claims')::jsonb, '{}'::jsonb)) claim
    WHERE NOT EXISTS (SELECT 1 FROM jobs operation WHERE operation.id = claim.key AND operation."userId" = ${String(userId)} AND operation.status IN ('failed', 'succeeded')))`;
  const claim = JSON.stringify({ [jobId]: "reserved" });
  const [row] = await db.insert(jobs).values({
    id, userId: String(userId), type: "platform", provider: "advisor-quota", status: "succeeded",
    input: { action: "code_motion_consult_quota" },
    output: sql`jsonb_build_object('claims', CASE WHEN ${used} < ${limit} THEN ${claim}::jsonb ELSE '{}'::jsonb END, 'used', ${used} + CASE WHEN ${used} < ${limit} THEN 1 ELSE 0 END)`,
  }).onConflictDoUpdate({ target: jobs.id, set: {
    output: sql`CASE WHEN (${jobs.output}->'claims')::jsonb ? ${jobId} THEN ${jobs.output}::jsonb
      ELSE jsonb_build_object('claims', COALESCE((${jobs.output}->'claims')::jsonb, '{}'::jsonb) || CASE WHEN ${used} + ${active} < ${limit} THEN ${claim}::jsonb ELSE '{}'::jsonb END,
        'used', ${used} + ${active} + CASE WHEN ${used} + ${active} < ${limit} THEN 1 ELSE 0 END) END`,
    updatedAt: new Date(),
  } }).returning({ output: jobs.output });
  const receipt = row?.output as { claims?: Record<string, string>; used?: number };
  if (!receipt?.claims || !Number.isFinite(receipt.used)) throw new Error("咨询额度回执异常，本次未调用模型");
  return { reserved: receipt.claims[jobId] === "reserved", used: Number(receipt.used) };
}
