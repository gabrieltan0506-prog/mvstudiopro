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
  await db.execute(sql`CREATE TABLE IF NOT EXISTS file_conversion_free_ip_slots (
    "userId" varchar(64) NOT NULL, day date NOT NULL, sha256 varchar(64) NOT NULL, "ipHash" varchar(64) NOT NULL,
    "ipSlot" integer NOT NULL CHECK ("ipSlot" BETWEEN 1 AND 3), PRIMARY KEY("userId",day,sha256,"ipHash"), UNIQUE("ipHash",day,"ipSlot"))`);
  await db.execute(sql`INSERT INTO file_conversion_free_ip_slots("userId",day,sha256,"ipHash","ipSlot")
    SELECT "userId",day,sha256,"ipHash","ipSlot" FROM file_conversion_free_slots ON CONFLICT DO NOTHING`);
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
  const existing = await getConversionJob(id);
  if (!existing && request.lane === "free") {
    if (!request.ipHash || !request.source.sha256) throw new Error("免费文件缺少来源验证");
    let created = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      // 预约与入队是同一SQL：插入任务失败时两维名额一起回滚，不留“扣次数但没任务”。
      try { await db.execute(sql`WITH ${freeReservationSql(userId, request.ipHash, request.day, request.source.sha256, id)}
        , inserted AS (INSERT INTO file_conversion_jobs(id,"userId",lane,input,"sourceSha")
        SELECT ${id},${userId},${request.lane},${JSON.stringify(request)}::jsonb,${request.source.sha256}
        WHERE (EXISTS(SELECT 1 FROM reserved) OR EXISTS(SELECT 1 FROM file_conversion_free_slots WHERE "userId"=${userId} AND day=${request.day}::date AND sha256=${request.source.sha256}))
          AND (EXISTS(SELECT 1 FROM ip_reserved) OR EXISTS(SELECT 1 FROM file_conversion_free_ip_slots WHERE "userId"=${userId} AND day=${request.day}::date AND sha256=${request.source.sha256} AND "ipHash"=${request.ipHash}))
        ON CONFLICT(id) DO NOTHING RETURNING id)
        SELECT 1 / CASE WHEN EXISTS(SELECT 1 FROM inserted) OR EXISTS(SELECT 1 FROM file_conversion_jobs WHERE id=${id}) THEN 1 ELSE 0 END AS ok`);
      } catch (error) { if (!isQuotaRollback(error)) throw error; }
      if (await getConversionJob(id)) { created = true; break; }
    }
    if (!created) throw new Error(FILE_CONVERSION_FREE_LIMIT_MESSAGE);
  } else if (!existing) {
    await db.execute(sql`INSERT INTO file_conversion_jobs(id,"userId",lane,input,"sourceSha") VALUES(${id},${userId},${request.lane},${JSON.stringify(request)}::jsonb,${request.source.sha256 || null}) ON CONFLICT(id) DO NOTHING`);
  }
  const job = await getConversionJob(id);
  const immutable = (input: FileConversionRequest & { settled?: boolean }) => { const { settled: _settled, ...rest } = input; return rest; };
  if (!job || job.userId !== userId || JSON.stringify(immutable(job.input)) !== JSON.stringify(request)) {
    // JSONB会重排键；结构比较使用稳定的内容散列原输入以外的语义比较。
    const { isDeepStrictEqual } = await import("node:util");
    if (!job || job.userId !== userId || !isDeepStrictEqual(immutable(job.input), request)) throw new Error("转换任务身份不一致，请保留原任务");
  }
  return { id, status: job.status };
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
    (SELECT count(*) FROM file_conversion_free_slots WHERE day=${day}::date AND "userId"=${userId})::integer AS account,
    (SELECT count(*) FROM file_conversion_free_ip_slots WHERE day=${day}::date AND "ipHash"=${ipHash})::integer AS ip`));
  return { remaining: Math.max(0, 3 - Math.max(Number(count?.account || 0), Number(count?.ip || 0))), limit: 3, day };
}
/** 单行同时取得账号与IP槽；两组唯一约束让任何一维冲突都回滚整行。 */
export async function reserveFreeConversionFile(userId: string, ipHash: string, day: string, sha256: string, db?: SqlDb) {
  const store = db || await conversionDb();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
    const [reserved] = rows<{ ok: number }>(await store.execute(sql`WITH ${freeReservationSql(userId, ipHash, day, sha256)}
      SELECT 1 / CASE WHEN (EXISTS(SELECT 1 FROM reserved) OR EXISTS(SELECT 1 FROM file_conversion_free_slots WHERE "userId"=${userId} AND day=${day}::date AND sha256=${sha256}))
        AND (EXISTS(SELECT 1 FROM ip_reserved) OR EXISTS(SELECT 1 FROM file_conversion_free_ip_slots WHERE "userId"=${userId} AND day=${day}::date AND sha256=${sha256} AND "ipHash"=${ipHash})) THEN 1 ELSE 0 END AS ok`));
    if (reserved?.ok) return;
    } catch (error) { if (!isQuotaRollback(error)) throw error; }
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
  await (db || await conversionDb()).execute(sql`WITH released AS (DELETE FROM file_conversion_free_slots WHERE "userId"=${job.userId} AND day=${job.input.day}::date AND sha256=${job.sourceSha} AND consumed=false
    AND NOT EXISTS(SELECT 1 FROM file_conversion_jobs other WHERE other."userId"=${job.userId} AND other."sourceSha"=${job.sourceSha}
      AND other.input->>'day'=${job.input.day} AND other.id<>${job.id} AND other.status IN ('queued','running','receipt_pending')) RETURNING "userId",day,sha256)
    DELETE FROM file_conversion_free_ip_slots ip USING released r WHERE ip."userId"=r."userId" AND ip.day=r.day AND ip.sha256=r.sha256`);
}
export async function countPaidConversions(includeRunning = true) {
  const db = await conversionDb();
  const [count] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::integer n FROM file_conversion_jobs WHERE lane='paid' AND status IN ${includeRunning ? sql`('queued','running','receipt_pending','refund_pending')` : sql`('queued')`}`));
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
  const [updated] = rows<ConversionJob>(await db.execute(sql`UPDATE file_conversion_jobs SET "cancelRequested"=true,status=CASE WHEN status IN ('running','receipt_pending') THEN status ELSE 'failed' END,"updatedAt"=now()
    WHERE id=${job.id} AND "userId"=${job.userId} AND (status IN ('queued','running','receipt_pending') OR (status='succeeded' AND input->>'phase'='inspect')) RETURNING *`));
  if (updated?.status === "failed") await settleFreeConversion(updated);
}
export async function conversionRecoveryJobs(lane: FileConversionLane) {
  const db = await conversionDb();
  return rows<ConversionJob>(await db.execute(sql`SELECT * FROM file_conversion_jobs WHERE lane=${lane} AND
    ((status='running' AND "updatedAt"<now()-interval '10 minutes') OR status IN ('receipt_pending','refund_pending') OR (status IN ('succeeded','failed') AND coalesce(input->>'settled','false')<>'true')) ORDER BY "updatedAt" LIMIT 20`));
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

/** DB先保存已取得的结果；归档故障不占执行车道，也不重新运行转换。 */
export async function deferConversionReceipt(job: ConversionJob, output: FileConversionOutcome | null, error?: string) {
  const db = await conversionDb();
  const [saved] = rows<ConversionJob>(await db.execute(sql`UPDATE file_conversion_jobs SET status='receipt_pending',
    output=${JSON.stringify(output)}::jsonb,error=${error || null},owner=NULL,"updatedAt"=now()
    WHERE id=${job.id} AND status='running' AND owner=${job.owner} RETURNING *`));
  if (!saved) throw new Error("转换结果归属已变化，不能覆盖原结果");
  return saved;
}
export async function completeConversionReceipt(job: ConversionJob) {
  const db = await conversionDb();
  const [saved] = rows<ConversionJob>(await db.execute(sql`UPDATE file_conversion_jobs SET
    status=CASE WHEN "cancelRequested" OR error IS NOT NULL THEN 'failed' ELSE 'succeeded' END,
    "updatedAt"=now() WHERE id=${job.id} AND status='receipt_pending' RETURNING *`));
  return saved || await getConversionJob(job.id);
}

/** 账号原件去重；每个本次来源IP另有绑定，换IP不能借旧名额绕过当前IP限额。 */
function freeReservationSql(userId: string, ipHash: string, day: string, sha256: string, jobId?: string) {
  const noPriorJob = jobId ? sql`NOT EXISTS(SELECT 1 FROM file_conversion_jobs WHERE id=${jobId})` : sql`true`;
  return sql`reserved AS (
    INSERT INTO file_conversion_free_slots("userId",day,sha256,"ipHash","userSlot","ipSlot")
    SELECT ${userId},${day}::date,${sha256},${ipHash},u.slot,i.slot
    FROM (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS(SELECT 1 FROM file_conversion_free_slots WHERE "userId"=${userId} AND day=${day}::date AND "userSlot"=slot) ORDER BY slot LIMIT 1) u
    CROSS JOIN (SELECT slot FROM generate_series(1,3) slot WHERE NOT EXISTS(SELECT 1 FROM file_conversion_free_ip_slots WHERE "ipHash"=${ipHash} AND day=${day}::date AND "ipSlot"=slot) ORDER BY slot LIMIT 1) i
    WHERE ${noPriorJob} ON CONFLICT DO NOTHING RETURNING sha256), ip_reserved AS (
    INSERT INTO file_conversion_free_ip_slots("userId",day,sha256,"ipHash","ipSlot")
    SELECT ${userId},${day}::date,${sha256},${ipHash},slot FROM generate_series(1,3) slot
    WHERE ${noPriorJob} AND (EXISTS(SELECT 1 FROM reserved) OR EXISTS(SELECT 1 FROM file_conversion_free_slots WHERE "userId"=${userId} AND day=${day}::date AND sha256=${sha256}))
      AND NOT EXISTS(SELECT 1 FROM file_conversion_free_ip_slots WHERE "ipHash"=${ipHash} AND day=${day}::date AND "ipSlot"=slot)
    ORDER BY slot LIMIT 1 ON CONFLICT DO NOTHING RETURNING sha256)`;
}

// 配额任一维未取得时由SQL条件除零回滚整条语句，防止并发留下单维预约。
function isQuotaRollback(error: unknown) {
  return (error as { code?: string; cause?: { code?: string } }).code === "22012"
    || (error as { cause?: { code?: string } }).cause?.code === "22012" || /division by zero/.test(String(error));
}
