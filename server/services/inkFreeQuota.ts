import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import type { Request } from "express";
import { getDb } from "../db";
import { conversionDay, fileConversionIpHash } from "./fileConversionIp";
import { INK_DAILY_NEW_ACCOUNTS, inkFreeMessage, type InkFreeQuote } from "../../shared/inkFree";

type Db = { execute(query: ReturnType<typeof sql>): Promise<unknown> };
type Job = { id: string; userId: string; type: string; status: string; input: unknown };
export type InkSource = { day: string; ipHash: string };
export type InkFreeJob = { id: string; userId: string; format: "pptx" | "mp4"; input: unknown; provider: string; type: "platform" | "post_prod" };
const rows = <T>(result: unknown): T[] => (result as { rows?: T[] }).rows || [];
let ready: Promise<void> | undefined;

export function inkSource(req: Request, now = new Date()): InkSource {
  const day = conversionDay(now);
  return { day, ipHash: createHash("sha256").update(`ink/v1/${fileConversionIpHash(req, day)}`).digest("hex") };
}
export async function ensureInkFreeTable(db: Db) {
  // userId是跨日主键，不能把day加进账号唯一键，否则会变成每天一次。
  await db.execute(sql`CREATE TABLE IF NOT EXISTS ink_free_claims (
    "userId" varchar(64) PRIMARY KEY, day date NOT NULL,
    "ipHash" varchar(64) NOT NULL, slot integer NOT NULL CHECK(slot BETWEEN 1 AND 10),
    "jobId" varchar(64) NOT NULL UNIQUE, format text NOT NULL CHECK(format IN ('pptx','mp4')),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    UNIQUE(day,slot), UNIQUE(day,"ipHash"))`);
}
async function store(provided?: Db) {
  if (provided) return provided;
  const db = await getDb();
  if (!db) throw new Error("免费名额暂时无法核对，本次未提交、未扣费");
  if (!ready) ready = ensureInkFreeTable(db).catch(e => { ready = undefined; throw e; });
  await ready;
  return db;
}
const live = sql`NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=c."jobId" AND j.status='failed')`;

export async function quoteInkFree(userId: string, source: InkSource, provided?: Db): Promise<InkFreeQuote> {
  const db = await store(provided);
  const [counts] = rows<{ used: number; accountJob: string | null; accountFormat: "pptx" | "mp4" | null; accountStatus: string | null; ipUsed: boolean }>(await db.execute(sql`SELECT
    (SELECT count(*)::int FROM ink_free_claims c WHERE c.day=${source.day}::date AND ${live}) AS used,
    (SELECT c."jobId" FROM ink_free_claims c WHERE c."userId"=${userId} AND ${live}) AS "accountJob",
    (SELECT c.format FROM ink_free_claims c WHERE c."userId"=${userId} AND ${live}) AS "accountFormat",
    (SELECT j.status FROM ink_free_claims c LEFT JOIN jobs j ON j.id=c."jobId" WHERE c."userId"=${userId} AND ${live}) AS "accountStatus",
    EXISTS(SELECT 1 FROM ink_free_claims c WHERE c.day=${source.day}::date AND c."ipHash"=${source.ipHash} AND c."userId"<>${userId} AND ${live}) AS "ipUsed"`));
  if (!counts || !Number.isFinite(Number(counts.used))) throw new Error("免费名额回执异常，未提交任务");
  const reason: InkFreeQuote["reason"] = counts.accountJob ? (counts.accountStatus === "succeeded" ? "account_used" : "account_pending")
    : counts.ipUsed ? "ip_used" : Number(counts.used) >= INK_DAILY_NEW_ACCOUNTS ? "daily_full" : "available";
  return { day: source.day, eligible: reason === "available", reason, remainingAccounts: Math.max(0, INK_DAILY_NEW_ACCOUNTS - Number(counts.used)),
    ...(counts.accountJob ? { jobId: counts.accountJob, format: counts.accountFormat! } : {}) };
}
async function priorJob(db: Db, request: InkFreeJob) {
  const row = rows<Job>(await db.execute(sql`SELECT id,"userId",type,status,input FROM jobs WHERE id=${request.id}`))[0];
  if (row && (row.userId !== request.userId || row.type !== request.type || !isDeepStrictEqual(row.input, request.input)))
    throw new Error("请求编号与原任务内容不一致，请保留原任务");
  return row;
}

export async function assertInkFreeJob(userId: string, jobId: string, format: "pptx" | "mp4", provided?: Db) {
  const db = await store(provided);
  const claim = rows<{ jobId: string }>(await db.execute(sql`SELECT "jobId" FROM ink_free_claims WHERE "userId"=${userId} AND "jobId"=${jobId} AND format=${format}`))[0];
  if (!claim && format === "mp4") {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS ink_free_production_exports ("userId" varchar(64) NOT NULL,"grantId" varchar(64) NOT NULL,"jobId" varchar(64) NOT NULL UNIQUE,PRIMARY KEY("userId","grantId"))`);
    await db.execute(sql`ALTER TABLE ink_free_production_exports ADD COLUMN IF NOT EXISTS "rootGrantId" varchar(64)`);
    const linked = rows<{jobId:string}>(await db.execute(sql`SELECT e."jobId" FROM ink_free_production_exports e JOIN ink_free_claims c ON c."userId"=e."userId" AND c."jobId"=('ink_prod_' || COALESCE(e."rootGrantId",e."grantId")) WHERE e."userId"=${userId} AND e."jobId"=${jobId}`))[0];
    if (linked) return;
    await db.execute(sql`CREATE TABLE IF NOT EXISTS ink_paid_production_exports ("userId" varchar(64) NOT NULL,"grantId" varchar(64) NOT NULL,"jobId" varchar(64) NOT NULL UNIQUE,PRIMARY KEY("userId","grantId"))`);
    const paid = rows<{jobId:string}>(await db.execute(sql`SELECT "jobId" FROM ink_paid_production_exports WHERE "userId"=${userId} AND "jobId"=${jobId}`))[0];
    if (paid) return;
  }
  if (!claim) throw new Error("本任务没有可核对的免费名额，未开始生成");
}
const isRollback = (e: unknown) => {
  const error = e as { code?: string; cause?: { code?: string } };
  return error.code === "22012" || error.cause?.code === "22012" || /division by zero/.test(String(e));
};

/** 唯一约束与同一SQL内的名额/任务写入，保证跨实例不超领；不调用模型。 */
export async function enqueueInkFree(request: InkFreeJob, source: InkSource, provided?: Db) {
  const db = await store(provided);
  const existing = await priorJob(db, request);
  if (existing) return { jobId: existing.id, status: existing.status, cost: 0 as const };
  // 只释放数据库已经确认的终态失败；运行中、回执缺失或跨日均不猜测释放。
  await db.execute(sql`DELETE FROM ink_free_claims c USING jobs j WHERE c."jobId"=j.id AND j.status='failed'`);
  for (let attempt = 0; attempt <= INK_DAILY_NEW_ACCOUNTS; attempt++) {
    try {
      await db.execute(sql`WITH claimed AS (
        INSERT INTO ink_free_claims("userId",day,"ipHash",slot,"jobId",format)
        SELECT ${request.userId},${source.day}::date,${source.ipHash},s,${request.id},${request.format}
        FROM generate_series(1,10) s
        WHERE NOT EXISTS(SELECT 1 FROM ink_free_claims WHERE day=${source.day}::date AND slot=s)
          AND NOT EXISTS(SELECT 1 FROM jobs WHERE id=${request.id})
        ORDER BY s LIMIT 1 ON CONFLICT DO NOTHING RETURNING "jobId"
      ), inserted AS (
        INSERT INTO jobs(id,"userId",type,provider,status,input,attempts)
        SELECT ${request.id},${request.userId},${request.type},${request.provider},'queued',${JSON.stringify(request.input)}::json,0
        FROM claimed ON CONFLICT(id) DO NOTHING RETURNING id
      ) SELECT 1 / CASE WHEN EXISTS(SELECT 1 FROM inserted) OR EXISTS(SELECT 1 FROM jobs WHERE id=${request.id}) THEN 1 ELSE 0 END AS ok`);
    } catch (e) { if (!isRollback(e)) throw e; }
    const created = await priorJob(db, request);
    if (created) return { jobId: created.id, status: created.status, cost: 0 as const };
    const quote = await quoteInkFree(request.userId, source, db);
    if (!quote.eligible) throw new Error(inkFreeMessage(quote));
  }
  throw new Error("免费名额正在被领取，请用原请求编号稍后核对；未转为付费");
}
