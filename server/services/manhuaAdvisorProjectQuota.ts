import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { MANHUA_ADVISOR_PROJECT_FREE } from "../../shared/manhuaAdvisorPolicy";
import type { AdvisorProjectKind, AdvisorProjectRef } from "../../shared/manhuaCreativeAdvisor";
import { quotaUsed } from "./manhuaAdvisorDailyQuota";

type Ledger = { seed: number; claims: Record<string, "reserved" | "released"> };
function resolveRef(ref: AdvisorProjectRef): { kind: AdvisorProjectKind; projectId?: string } {
  return ref && typeof ref === "object" ? ref : { kind: "manhua", projectId: ref };
}
export function advisorProjectQuotaId(userId: number, ref?: AdvisorProjectRef) {
  const { kind, projectId } = resolveRef(ref);
  if (kind !== "manhua" && !projectId) throw new Error("缺少作品编号，无法核对本作品额度；本次未扣费。");
  const key = kind === "manhua" ? [userId, projectId || "legacy"] : [userId, kind, projectId];
  return `mqp_${createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 40)}`;
}
async function database() { const db = await getDb(); if (!db) throw new Error("作品顾问额度暂不可用，请稍后重试"); return db; }

const MISSING_WORK_ZH: Record<Exclude<AdvisorProjectKind, "manhua">, string> = {
  code_motion: "尚未确认这部代码动画的云端保存，请先保存作品再咨询；本次未扣费。",
  marketing: "这份营销稿还没有合成成片，请先合成成片再咨询；本次未扣费。",
  digital_human: "尚未确认这部数字人作品的云端保存，请先保存制作稿再咨询；本次未扣费。",
};
/** 非漫剧作品是否属于本人且存在：代码动画查云端存档；营销查本人该稿的成片后期任务；数字人查云端制作稿且作品编号一致。 */
async function advisorWorkExists(userId: number, kind: Exclude<AdvisorProjectKind, "manhua">, projectId: string): Promise<boolean> {
  if (kind === "code_motion") {
    const { codeMotionObjectName } = await import("./codeMotionStore");
    const { getGcsBucketName, statGcsObjectVersion } = await import("./gcs");
    try { await statGcsObjectVersion({ gcsUri: `gs://${getGcsBucketName()}/${codeMotionObjectName(String(userId), projectId)}` }); return true; }
    catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return false; throw e; }
  }
  if (kind === "digital_human") {
    const { readDigitalHumanCloudDraft } = await import("./digitalHumanDraftStore");
    const { draft } = await readDigitalHumanCloudDraft(userId);
    // 与数字人后期工作台同口径：有项目取项目编号，否则取稿件编号；只认当前云端制作稿，不按任意编号放行
    return Boolean(draft && (draft.project?.id || draft.id) === projectId);
  }
  const { marketingProductionScopeKey } = await import("../../shared/marketingProduction");
  const db = await database();
  const rows = await db.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.userId, String(userId)), eq(jobs.type, "post_prod"),
    sql`${jobs.input}->>'action' = 'concat'`, sql`${jobs.input}->>'scopeKey' = ${marketingProductionScopeKey(projectId)}`,
  )).limit(1);
  return rows.length > 0;
}

/** 作品身份由登录账户+已保存的云对象（或本人成片任务）验证，不信任剧名、确认时间或前端余额。 */
export async function assertAdvisorProject(userId: number, ref?: AdvisorProjectRef) {
  const { kind, projectId } = resolveRef(ref);
  if (kind === "manhua") {
    if (!projectId) return; // 每账户仅一个旧工作区，不随改名/清空/重新确认增加额度。
    const { manhuaCloudDraftGcsUri } = await import("./manhuaCloudDraftGcsStore");
    const { statGcsObjectVersion } = await import("./gcs");
    try { await statGcsObjectVersion({ gcsUri: manhuaCloudDraftGcsUri(userId, projectId) }); }
    catch { throw new Error("尚未确认这部作品的云端保存，请先保存作品再咨询；本次未扣费。"); }
    return;
  }
  if (!projectId) throw new Error("缺少作品编号，无法核对本作品额度；本次未扣费。");
  let exists: boolean;
  try { exists = await advisorWorkExists(userId, kind, projectId); }
  catch { throw new Error("暂时无法核对这部作品，请稍后重试；本次未扣费。"); }
  if (!exists) throw new Error(MISSING_WORK_ZH[kind]);
}

export async function readAdvisorProjectQuota(userId: number, projectId?: AdvisorProjectRef) {
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
export async function reserveAdvisorProjectQuota(userId: number, projectId: AdvisorProjectRef, requestId: string) {
  const db = await database();
  const work = resolveRef(projectId);
  const [row] = await db.insert(jobs).values({
    id: advisorProjectQuotaId(userId, projectId), userId: String(userId), type: "platform", provider: "advisor-quota", status: "succeeded",
    input: { action: "manhua_advisor_project_quota", projectId: work.projectId || "legacy", ...(work.kind !== "manhua" ? { projectKind: work.kind } : {}) },
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

export async function releaseAdvisorProjectQuota(userId: number, projectId: AdvisorProjectRef, requestId: string) {
  const db = await database();
  await db.update(jobs).set({ output: sql`jsonb_set(${jobs.output}::jsonb, '{claims}', (${jobs.output}->'claims')::jsonb || ${JSON.stringify({ [requestId]: "released" })}::jsonb)`, updatedAt: new Date() })
    .where(and(eq(jobs.id, advisorProjectQuotaId(userId, projectId)), eq(jobs.userId, String(userId)), sql`${jobs.output}->'claims'->>${requestId} = 'reserved'`));
}
