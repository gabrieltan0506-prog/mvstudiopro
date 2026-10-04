import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { MANHUA_ADVISOR_PROJECT_FREE } from "../../shared/manhuaAdvisorPolicy";
import { quotaUsed } from "./manhuaAdvisorDailyQuota";

type Ledger = { seed: number; claims: Record<string, "reserved" | "released"> };
export function advisorProjectQuotaId(userId: number, projectId?: string) {
  return `mqp_${createHash("sha256").update(JSON.stringify([userId, projectId || "legacy"])).digest("hex").slice(0, 40)}`;
}
async function database() { const db = await getDb(); if (!db) throw new Error("作品顾问额度暂不可用，请稍后重试"); return db; }

/** 作品身份由登录账户+已保存的云对象验证，不信任剧名、确认时间或前端余额。 */
export async function assertAdvisorProject(userId: number, projectId?: string) {
  if (!projectId) return; // 每账户仅一个旧工作区，不随改名/清空/重新确认增加额度。
  const { manhuaCloudDraftGcsUri } = await import("./manhuaCloudDraftGcsStore");
  const { statGcsObjectVersion } = await import("./gcs");
  try { await statGcsObjectVersion({ gcsUri: manhuaCloudDraftGcsUri(userId, projectId) }); }
  catch { throw new Error("尚未确认这部作品的云端保存，请先保存作品再咨询；本次未扣费。"); }
}

export async function readAdvisorProjectQuota(userId: number, projectId?: string) {
  const db = await database(), id = advisorProjectQuotaId(userId, projectId);
  // 只对明确失败的原请求释放占位；不能把无响应当失败。
  await db.execute(sql`UPDATE jobs quota SET output = jsonb_set(quota.output::jsonb, '{claims}',
    (SELECT COALESCE(jsonb_object_agg(claim.key, CASE WHEN EXISTS (
      SELECT 1 FROM jobs operation WHERE operation."userId" = ${String(userId)}
        AND operation.input->>'action' = 'manhua_advisor_qa'
        AND operation.input->>'requestId' = claim.key AND operation.status = 'failed'
    ) THEN 'released' ELSE claim.value END), '{}'::jsonb)
     FROM jsonb_each_text((quota.output->'claims')::jsonb) claim))
    WHERE quota.id = ${id} AND quota."userId" = ${String(userId)}`);
  const [row] = await db.select({ output: jobs.output }).from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, String(userId))));
  const used = row ? quotaUsed(row.output as Ledger) : 0;
  return { used, remaining: Math.max(0, MANHUA_ADVISOR_PROJECT_FREE - used), limit: MANHUA_ADVISOR_PROJECT_FREE };
}

/** 原子行锁/UPSERT，最后一个免费名额只能被一个请求取得。 */
export async function reserveAdvisorProjectQuota(userId: number, projectId: string | undefined, requestId: string) {
  const db = await database();
  const [row] = await db.insert(jobs).values({
    id: advisorProjectQuotaId(userId, projectId), userId: String(userId), type: "platform", provider: "advisor-quota", status: "succeeded",
    input: { action: "manhua_advisor_project_quota", projectId: projectId || "legacy" },
    output: { seed: 0, claims: { [requestId]: "reserved" } },
  }).onConflictDoUpdate({ target: jobs.id, set: {
    output: sql`CASE WHEN (${jobs.output}->'claims')::jsonb ? ${requestId} THEN ${jobs.output}::jsonb
      WHEN (${jobs.output}->>'seed')::int + (SELECT count(*) FROM jsonb_each_text((${jobs.output}->'claims')::jsonb) q WHERE q.value = 'reserved') < ${MANHUA_ADVISOR_PROJECT_FREE}
      THEN jsonb_set(${jobs.output}::jsonb, '{claims}', (${jobs.output}->'claims')::jsonb || ${JSON.stringify({ [requestId]: "reserved" })}::jsonb)
      ELSE ${jobs.output}::jsonb END`, updatedAt: new Date(),
  } }).returning({ output: jobs.output });
  const ledger = row.output as Ledger, used = quotaUsed(ledger);
  return { reserved: ledger.claims[requestId] === "reserved", used, remaining: Math.max(0, MANHUA_ADVISOR_PROJECT_FREE - used) };
}

export async function releaseAdvisorProjectQuota(userId: number, projectId: string | undefined, requestId: string) {
  const db = await database();
  await db.update(jobs).set({ output: sql`jsonb_set(${jobs.output}::jsonb, '{claims}', (${jobs.output}->'claims')::jsonb || ${JSON.stringify({ [requestId]: "released" })}::jsonb)`, updatedAt: new Date() })
    .where(and(eq(jobs.id, advisorProjectQuotaId(userId, projectId)), eq(jobs.userId, String(userId)), sql`${jobs.output}->'claims'->>${requestId} = 'reserved'`));
}
