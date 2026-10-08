import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { FILE_CONVERSION_FREE_LIMIT_MESSAGE, type FileConversionLane, type FileConversionOutcome, type FileConversionRequest } from "../../shared/fileConversion";

export type ConversionJob = { id: string; userId: string; lane: FileConversionLane; status: string; input: FileConversionRequest; output: FileConversionOutcome | null; sourceSha: string | null; error: string | null; owner: string | null; cancelRequested: boolean; createdAt: Date; updatedAt: Date };
type SqlDb = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };
const rows = <T>(result: unknown): T[] => (result as { rows?: T[] }).rows || [];
let ready: Promise<void> | undefined;
export async function ensureConversionTables(db: SqlDb) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS file_conversion_jobs (
    id varchar(64) PRIMARY KEY, "userId" varchar(64) NOT NULL, lane text NOT NULL CHECK (lane IN ('free','paid')),
    status text NOT NULL DEFAULT 'queued', input jsonb NOT NULL, output jsonb, "sourceSha" varchar(64), error text,
    owner text, "cancelRequested" boolean NOT NULL DEFAULT false,
    "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now())`);
  // DB唯一约束保证多实例/部署交叠时每条车道最多一个执行者。
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS file_conversion_one_running_lane ON file_conversion_jobs(lane) WHERE status='running'`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS file_conversion_queue_order ON file_conversion_jobs(lane,status,"createdAt",id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS file_conversion_user_history ON file_conversion_jobs("userId","createdAt")`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS file_conversion_free_slots (
    "userId" varchar(64) NOT NULL, day date NOT NULL, sha256 varchar(64) NOT NULL, "ipHash" varchar(64) NOT NULL,
    "userSlot" integer NOT NULL CHECK ("userSlot" BETWEEN 1 AND 3), "ipSlot" integer NOT NULL CHECK ("ipSlot" BETWEEN 1 AND 3),
    consumed boolean NOT NULL DEFAULT false, "createdAt" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId",day,sha256), UNIQUE ("userId",day,"userSlot"), UNIQUE ("ipHash",day,"ipSlot"))`);
}
export async function conversionDb() {
  const db = await getDb(); if (!db) throw new Error("文件转换记录暂不可用");
  if (!ready) ready = ensureConversionTables(db).catch(error => { ready = undefined; throw error; });
  await ready; return db;
}
export function conversionJobId(userId: string, request: FileConversionRequest) {
  return `conv_${createHash("sha256").update(userId).update("\0").update(JSON.stringify(request)).digest("hex").slice(0, 59)}`;
}
export async function enqueueConversionJob(userId: string, request: FileConversionRequest) {
  const db = await conversionDb(); const id = conversionJobId(userId, request);
  if (request.lane === "free") {
    if (!request.ipHash || !request.source.sha256) throw new Error("免费文件缺少来源验证");
    let created = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      // 预约与入队是同一SQL：插入任务失败时两维名额一起回滚，不留“扣次数但没任务”。
      await db.execute(sql`WITH reserved AS (
        INSERT INTO file_conversion_free_slots("userId",day,sha256,"ipHash","userSlot","ipSlot")
        SELECT ${userId},${request.day}::date,${request.source.sha256},${request.ipHash},u.slot,i.slot
        FROM (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS (SELECT 1 FROM file_conversion_free_slots f WHERE f."userId"=${userId} AND f.day=${request.day}::date AND f."userSlot"=slot) ORDER BY slot LIMIT 1) u
        CROSS JOIN (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS (SELECT 1 FROM file_conversion_free_slots f WHERE f."ipHash"=${request.ipHash} AND f.day=${request.day}::date AND f."ipSlot"=slot) ORDER BY slot LIMIT 1) i
        ON CONFLICT DO NOTHING RETURNING sha256)
        INSERT INTO file_conversion_jobs(id,"userId",lane,input,"sourceSha")
        SELECT ${id},${userId},${request.lane},${JSON.stringify(request)}::jsonb,${request.source.sha256}
        WHERE EXISTS(SELECT 1 FROM reserved) OR EXISTS(SELECT 1 FROM file_conversion_free_slots WHERE "userId"=${userId} AND day=${request.day}::date AND sha256=${request.source.sha256})
        ON CONFLICT(id) DO NOTHING`);
      if (await getConversionJob(id)) { created = true; break; }
    }
    if (!created) throw new Error(FILE_CONVERSION_FREE_LIMIT_MESSAGE);
  } else {
    await db.execute(sql`INSERT INTO file_conversion_jobs(id,"userId",lane,input,"sourceSha") VALUES(${id},${userId},${request.lane},${JSON.stringify(request)}::jsonb,${request.source.sha256 || null}) ON CONFLICT(id) DO NOTHING`);
  }
  const job = await getConversionJob(id);
  const immutable = (input: FileConversionRequest & { settled?: boolean }) => { const { settled: _settled, ...rest } = input; return rest; };
  if (!job || job.userId !== userId || JSON.stringify(immutable(job.input)) !== JSON.stringify(request)) {
    // JSONB会重排键；结构比较使用稳定的内容散列原输入以外的语义比较。
    const { isDeepStrictEqual } = await import("node:util");
    if (!job || job.userId !== userId || !isDeepStrictEqual(immutable(job.input), request)) throw new Error("转换任务身份不一致，请保留原任务");
  }
  return { id };
}
export async function getConversionJob(id: string, db?: SqlDb) {
  return rows<ConversionJob>(await (db || await conversionDb()).execute(sql`SELECT * FROM file_conversion_jobs WHERE id=${id}`))[0] || null;
}
export async function listConversionJobs(userId: string) {
  const db = await conversionDb();
  return rows<ConversionJob>(await db.execute(sql`SELECT * FROM file_conversion_jobs WHERE "userId"=${userId} ORDER BY "createdAt" DESC LIMIT 30`));
}
export async function freeConversionQuota(userId: string, ipHash: string, day: string, db?: SqlDb) {
  const store = db || await conversionDb();
  const [count] = rows<{ account: number; ip: number }>(await store.execute(sql`SELECT
    count(*) FILTER (WHERE "userId"=${userId})::integer AS account,
    count(*) FILTER (WHERE "ipHash"=${ipHash})::integer AS ip
    FROM file_conversion_free_slots WHERE day=${day}::date AND ("userId"=${userId} OR "ipHash"=${ipHash})`));
  return { remaining: Math.max(0, 3 - Math.max(Number(count?.account || 0), Number(count?.ip || 0))), limit: 3, day };
}
/** 单行同时取得账号与IP槽；两组唯一约束让任何一维冲突都回滚整行。 */
export async function reserveFreeConversionFile(userId: string, ipHash: string, day: string, sha256: string, db?: SqlDb) {
  const store = db || await conversionDb();
  for (let attempt = 0; attempt < 4; attempt++) {
    const prior = rows<{ sha256: string }>(await store.execute(sql`SELECT sha256 FROM file_conversion_free_slots WHERE "userId"=${userId} AND day=${day}::date AND sha256=${sha256}`));
    if (prior.length) return;
    const inserted = rows(await store.execute(sql`INSERT INTO file_conversion_free_slots("userId",day,sha256,"ipHash","userSlot","ipSlot")
      SELECT ${userId},${day}::date,${sha256},${ipHash},u.slot,i.slot
      FROM (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS (SELECT 1 FROM file_conversion_free_slots f WHERE f."userId"=${userId} AND f.day=${day}::date AND f."userSlot"=slot) ORDER BY slot LIMIT 1) u
      CROSS JOIN (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS (SELECT 1 FROM file_conversion_free_slots f WHERE f."ipHash"=${ipHash} AND f.day=${day}::date AND f."ipSlot"=slot) ORDER BY slot LIMIT 1) i
      ON CONFLICT DO NOTHING RETURNING sha256`));
    if (inserted.length) return;
  }
  throw new Error(FILE_CONVERSION_FREE_LIMIT_MESSAGE);
}
export async function bindConversionSource(job: ConversionJob, sha256: string) {
  const db = await conversionDb();
  const found = rows(await db.execute(sql`UPDATE file_conversion_jobs SET "sourceSha"=${sha256} WHERE id=${job.id} AND status='running' AND owner=${job.owner} RETURNING id`));
  if (!found.length) throw new Error("转换任务归属已变化");
  if (job.lane === "free") {
    if (!job.input.ipHash) throw new Error("缺少来源验证");
    await reserveFreeConversionFile(job.userId, job.input.ipHash, job.input.day, sha256, db);
  }
}
export async function releaseFreeConversionFile(job: ConversionJob, db?: SqlDb) {
  if (job.lane !== "free" || !job.sourceSha) return;
  await (db || await conversionDb()).execute(sql`DELETE FROM file_conversion_free_slots WHERE "userId"=${job.userId} AND day=${job.input.day}::date AND sha256=${job.sourceSha} AND consumed=false
    AND NOT EXISTS(SELECT 1 FROM file_conversion_jobs other WHERE other."userId"=${job.userId} AND other."sourceSha"=${job.sourceSha}
      AND other.input->>'day'=${job.input.day} AND other.id<>${job.id} AND other.status IN ('queued','running'))`);
}
export async function countPaidConversions(includeRunning = true) {
  const db = await conversionDb();
  const [count] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::integer n FROM file_conversion_jobs WHERE lane='paid' AND status IN ${includeRunning ? sql`('queued','running','refund_pending')` : sql`('queued')`}`));
  return Number(count?.n || 0);
}
export async function conversionAhead(job: ConversionJob) {
  if (job.lane !== "free" || job.status !== "queued") return 0;
  const db = await conversionDb();
  const [count] = rows<{ n: number }>(await db.execute(sql`SELECT count(DISTINCT "userId")::integer n FROM file_conversion_jobs
    WHERE lane='free' AND status IN ('queued','running') AND "userId"<>${job.userId}
    AND ("createdAt",id)<(${job.createdAt},${job.id})`));
  return Number(count?.n || 0);
}
export async function claimConversionJob(lane: FileConversionLane, owner: string) {
  const db = await conversionDb();
  try {
    return rows<ConversionJob>(await db.execute(sql`UPDATE file_conversion_jobs SET status='running',owner=${owner},"updatedAt"=now()
      WHERE id=(SELECT id FROM file_conversion_jobs WHERE lane=${lane} AND status='queued' AND "cancelRequested"=false
        AND NOT EXISTS(SELECT 1 FROM file_conversion_jobs WHERE lane=${lane} AND status='running') ORDER BY "createdAt",id LIMIT 1)
      AND status='queued' RETURNING *`))[0] || null;
  } catch (error) { if ((error as { code?: string }).code === "23505") return null; throw error; }
}
export async function heartbeatConversion(job: ConversionJob) {
  const db = await conversionDb();
  const [updated] = rows<{ cancelRequested: boolean }>(await db.execute(sql`UPDATE file_conversion_jobs SET "updatedAt"=now() WHERE id=${job.id} AND status='running' AND owner=${job.owner} RETURNING "cancelRequested"`));
  if (!updated) throw new Error("转换任务不再由本执行者持有");
  return updated;
}
export async function finishConversionJob(job: ConversionJob, output: FileConversionOutcome | null, error?: string) {
  const db = await conversionDb();
  const [updated] = rows<ConversionJob>(await db.execute(sql`WITH finished AS (UPDATE file_conversion_jobs
    SET status=CASE WHEN "cancelRequested" OR ${!!error} THEN 'failed' ELSE 'succeeded' END,
    output=${JSON.stringify(output)}::jsonb,error=${error || null},"updatedAt"=now()
    WHERE id=${job.id} AND status='running' AND owner=${job.owner} RETURNING *), consumed AS (
      UPDATE file_conversion_free_slots q SET consumed=true FROM finished f
      WHERE f.lane='free' AND f.status='succeeded' AND f.output->>'type'='converted'
        AND q."userId"=f."userId" AND q.day=(f.input->>'day')::date AND q.sha256=f."sourceSha" RETURNING q.sha256)
    SELECT * FROM finished`));
  if (!updated) throw new Error("转换结果归属已变化，原任务回执保留");
  return updated;
}
export async function settleFreeConversion(job: ConversionJob) {
  const db = await conversionDb();
  if (job.lane !== "free") return;
  if (job.status === "succeeded" && job.output?.type === "converted") {
    await db.execute(sql`UPDATE file_conversion_free_slots SET consumed=true WHERE "userId"=${job.userId} AND day=${job.input.day}::date AND sha256=${job.sourceSha}`);
  } else if (job.status === "failed" || job.output?.type === "rejected" || (job.output?.type === "inspection" && !job.output.billing.available)) {
    await releaseFreeConversionFile(job, db);
  }
}
export async function cancelConversionJob(job: ConversionJob) {
  const db = await conversionDb();
  const [updated] = rows<ConversionJob>(await db.execute(sql`UPDATE file_conversion_jobs SET "cancelRequested"=true,status=CASE WHEN status='running' THEN status ELSE 'failed' END,"updatedAt"=now()
    WHERE id=${job.id} AND "userId"=${job.userId} AND (status IN ('queued','running') OR (status='succeeded' AND input->>'phase'='inspect')) RETURNING *`));
  if (updated?.status === "failed") await settleFreeConversion(updated);
}
export async function conversionRecoveryJobs(lane: FileConversionLane) {
  const db = await conversionDb();
  return rows<ConversionJob>(await db.execute(sql`SELECT * FROM file_conversion_jobs WHERE lane=${lane} AND
    ((status='running' AND "updatedAt"<now()-interval '10 minutes') OR status='refund_pending' OR (status IN ('succeeded','failed') AND coalesce(input->>'settled','false')<>'true')) ORDER BY "updatedAt" LIMIT 20`));
}
export async function markConversionSettled(job: ConversionJob, refundPending = false) {
  const db = await conversionDb();
  await db.execute(sql`UPDATE file_conversion_jobs SET status=CASE WHEN ${refundPending} THEN 'refund_pending' WHEN status='refund_pending' THEN 'failed' ELSE status END,
    input=jsonb_set(input,'{settled}',${JSON.stringify(!refundPending)}::jsonb),"updatedAt"=now() WHERE id=${job.id} AND status IN ('succeeded','failed','refund_pending')`);
}
export async function recoverConversionTerminal(job: ConversionJob, output: FileConversionOutcome | null) {
  const db = await conversionDb();
  const [updated] = rows<ConversionJob>(await db.execute(sql`WITH recovered AS (UPDATE file_conversion_jobs SET
    status=CASE WHEN ${output !== null} AND "cancelRequested"=false THEN 'succeeded' ELSE 'failed' END,output=${JSON.stringify(output)}::jsonb,
    error=CASE WHEN ${output !== null} AND "cancelRequested"=false THEN NULL ELSE '处理已中断，原文件保留；未自动重做' END,"updatedAt"=now()
    WHERE id=${job.id} AND status='running' AND "updatedAt"<now()-interval '10 minutes' RETURNING *), consumed AS (
      UPDATE file_conversion_free_slots q SET consumed=true FROM recovered f
      WHERE f.lane='free' AND f.status='succeeded' AND f.output->>'type'='converted'
        AND q."userId"=f."userId" AND q.day=(f.input->>'day')::date AND q.sha256=f."sourceSha" RETURNING q.sha256)
    SELECT * FROM recovered`));
  return updated || null;
}
