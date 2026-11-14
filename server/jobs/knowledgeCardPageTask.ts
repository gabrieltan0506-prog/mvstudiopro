import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { isDeepStrictEqual } from "node:util";
import { and, eq, gte, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { createJob, getJobByIdStrict, requestPlatformJobCancel } from "./repository";
import { KNOWLEDGE_CARD_REQUEST_ID, type KnowledgeCardPageAction } from "../../shared/knowledgeCardPageTask";

export function knowledgeCardPageJobId(userId: string, action: KnowledgeCardPageAction, requestId: string): string {
  if (!KNOWLEDGE_CARD_REQUEST_ID.test(requestId)) throw new Error("无效的读档请求编号");
  return `kc_${createHash("sha256").update(JSON.stringify([userId, action, requestId.toLowerCase()])).digest("hex").slice(0, 56)}`;
}

export async function createKnowledgeCardPageJob(args: {
  userId: string; action: Exclude<KnowledgeCardPageAction, "platform_composite_sheet_progress">; requestId?: string; params: Record<string, unknown>;
}): Promise<string> {
  const id = args.requestId ? knowledgeCardPageJobId(args.userId, args.action, args.requestId) : nanoid(16);
  const input = { action: args.action, params: args.params };
  if (!args.requestId) {
    return createJob({ id, userId: args.userId, type: "platform", provider: "evolink", input });
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot create knowledge card job");
  // Cancellation may have inserted a failed tombstone first. Never overwrite it or requeue.
  await db.insert(jobs).values({ id, userId: args.userId, type: "platform", provider: "evolink", status: "queued", input, attempts: 0 })
    .onConflictDoNothing({ target: jobs.id });
  const row = await getJobByIdStrict(id);
  if (!row || row.userId !== args.userId || (row.input as { action?: string })?.action !== args.action) {
    throw new Error("无法确认读档任务，请查看原任务");
  }
  const existingInput = row.input as { params?: unknown; cancelRequestedAt?: unknown };
  if (!existingInput.cancelRequestedAt && !isDeepStrictEqual(existingInput.params, JSON.parse(JSON.stringify(args.params)))) {
    throw new Error("该请求编号已绑定另一份原稿，请重新提交");
  }
  return id;
}

/** 跟进记录：第二页挂靠原任务时为本页请求编号落的轻量指针。status 永不为 queued/running，执行器、僵尸清理器、在途计数都不认。 */
export const KNOWLEDGE_CARD_FOLLOW_ACTION = "knowledge_card_distill_follow" as const;
export const KNOWLEDGE_CARD_FOLLOW_STATUS = "following" as const;
/** 跟进页轮询会续这条记录；超过此时长没有轮询视为该页已离开，不再替原任务挡停止。 */
export const KNOWLEDGE_CARD_FOLLOW_STALE_MS = 3 * 60_000;
export const KNOWLEDGE_CARD_FOLLOW_DETACHED_MESSAGE = "本页已停止跟进，资料仍在原页面处理";
/** 原始页已离开、任务交给了多个跟进页，本页离开但还有别的页在跟 */
export const KNOWLEDGE_CARD_FOLLOW_DETACHED_OTHERS_MESSAGE = "本页已停止跟进，资料仍在其他页面处理";
export const KNOWLEDGE_CARD_FOLLOW_STOPPED_MESSAGE = "已按你的要求停止读档";
/**
 * 兜底：任务已交接（原始页已离开）且所有跟进页都超过此时长没有轮询、也没送到离页信标，
 * 按离页口径停止。取 10 分钟：跟进存活窗口本身是 3 分钟（已容忍后台标签每分钟一次的节流），
 * 再给 3 倍余量覆盖短暂休眠与断网；最坏多跑约 10 分钟提炼。
 */
export const KNOWLEDGE_CARD_HANDOFF_ABANDON_MS = 10 * 60_000;
export const KNOWLEDGE_CARD_STOPPED_ELSEWHERE_MESSAGE = "任务已在另一页被停止";

type JobRowLike = { id: string; userId: string; status: string; input: unknown; output?: unknown; error?: string | null };
const inputOf = (row: { input: unknown }) => (row.input && typeof row.input === "object" ? row.input : {}) as Record<string, unknown>;
export function isKnowledgeCardFollowJob(row: { input: unknown } | null | undefined): boolean {
  return Boolean(row && inputOf(row).action === KNOWLEDGE_CARD_FOLLOW_ACTION);
}

/**
 * 读档建单 + 同源在途去重（1114 用户令：两个标签页重复提交同一本书只跑一单）。
 * 同一用户、同一原稿身份（dedupeKey 已含提炼档位/成稿档/计费口径）若已有活着的 queued/running 提炼，
 * 不建第二单；为本页请求编号落一条跟进记录指向原任务（不计费、不执行），本页仍按自己的编号轮询，
 * 回包丢失也能经跟进记录跟到原任务。
 * 「活着」沿用僵尸清理器的窗口：running 看心跳刷的 updatedAt，queued 看最近一次写入；
 * 已结束（成功/失败/取消）或已请求停止的任务不挡新提交。
 * 本请求编号已有行（重试/刷新占位）时仍走原有 createKnowledgeCardPageJob 语义。
 * 同一用户的建单先取事务级咨询锁串行化，第二条语句读已提交快照，看得到对方刚建的任务；不用可串行化，避免全表冲突重试。
 */
export async function createKnowledgeCardDistillJob(args: {
  userId: string; requestId?: string; params: Record<string, unknown>; dedupeKey?: string | null;
}): Promise<{ id: string; attachedTo: string | null; followRecorded?: boolean }> {
  const action = "knowledge_card_distill" as const;
  const dedupeKey = String(args.dedupeKey || "").trim();
  const fallback = async () => ({ id: await createKnowledgeCardPageJob({ userId: args.userId, action, requestId: args.requestId, params: args.params }), attachedTo: null });
  if (!dedupeKey) return fallback();
  const id = args.requestId ? knowledgeCardPageJobId(args.userId, action, args.requestId) : nanoid(16);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot create knowledge card job");
  const { resolveStaleWallMinutes, resolveQueuedStaleMinutes } = await import("./staleJobsReaper");
  const input = JSON.parse(JSON.stringify({ action, params: args.params, dedupeKey }));
  const follow = { action: KNOWLEDGE_CARD_FOLLOW_ACTION, dedupeKey };
  const admission = (withFollow: boolean) => `
    WITH own AS (
      SELECT id, input::jsonb->>'action' AS action, input::jsonb->>'attachedTo' AS "attachedTo" FROM jobs WHERE id = $1
    ), alive AS (
      SELECT id FROM jobs
      WHERE "userId" = $2 AND status IN ('queued', 'running') AND type = 'platform' AND id <> $1
        AND input::jsonb->>'action' = 'knowledge_card_distill'
        AND input::jsonb->>'dedupeKey' = $3
        AND coalesce(input::jsonb->>'cancelRequestedAt', '') = ''
        AND ((status = 'running' AND "updatedAt" >= NOW() - ($4::int * INTERVAL '1 minute'))
          OR (status = 'queued' AND greatest("createdAt", "updatedAt") >= NOW() - ($5::int * INTERVAL '1 minute')))
      ORDER BY "createdAt" ASC
      LIMIT 1
    ), inserted AS (
      INSERT INTO jobs (id, "userId", type, provider, status, input, attempts)
      SELECT $1, $2, 'platform', 'evolink', 'queued', $6::json, 0
      WHERE NOT EXISTS (SELECT 1 FROM own) AND NOT EXISTS (SELECT 1 FROM alive)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    ), followed AS (
      ${withFollow ? `INSERT INTO jobs (id, "userId", type, provider, status, input, attempts)
      SELECT $1, $2, 'platform', 'evolink', '${KNOWLEDGE_CARD_FOLLOW_STATUS}', ($7::jsonb || jsonb_build_object('attachedTo', alive.id))::json, 0
      FROM alive WHERE NOT EXISTS (SELECT 1 FROM own)
      ON CONFLICT (id) DO NOTHING
      RETURNING id, input::jsonb->>'attachedTo' AS "attachedTo"` : `SELECT NULL::varchar AS id, id AS "attachedTo" FROM alive WHERE NOT EXISTS (SELECT 1 FROM own) AND $7::text IS NOT NULL`}
    )
    SELECT 'own' AS kind, id, action, "attachedTo" FROM own
    UNION ALL SELECT 'attach' AS kind, id, NULL, "attachedTo" FROM followed
    UNION ALL SELECT 'new' AS kind, id, NULL, NULL FROM inserted`;
  const params = [id, args.userId, dedupeKey, resolveStaleWallMinutes(), resolveQueuedStaleMinutes(), JSON.stringify(input), JSON.stringify(follow)];
  let rows: Array<{ kind: string; id: string | null; action?: string | null; attachedTo?: string | null }>;
  let followRecorded = true;
  try {
    rows = (await runUnderUserLock(db, args.userId, [{ text: admission(true), params }]))[0] as typeof rows;
  } catch (error) {
    // 保险：跟进记录写不进（如线上状态列不接受 following）时整条语句回滚；不带跟进记录重做一次建单判断。
    // 降级后挂靠直接回原任务编号，前端按原任务编号跟进；仍不建第二单、不扣费。
    console.warn(`[knowledgeCardPageTask] follow record admission failed, retry without follow record user=${args.userId}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
    followRecorded = false;
    rows = (await runUnderUserLock(db, args.userId, [{ text: admission(false), params }]))[0] as typeof rows;
  }
  const own = rows.find(r => r.kind === "own");
  if (own?.action === KNOWLEDGE_CARD_FOLLOW_ACTION && own.attachedTo) return { id, attachedTo: own.attachedTo, followRecorded: true };
  const attach = rows.find(r => r.kind === "attach");
  if (!own && attach?.attachedTo) {
    return followRecorded ? { id, attachedTo: attach.attachedTo, followRecorded } : { id: attach.attachedTo, attachedTo: attach.attachedTo, followRecorded };
  }
  if (!own && rows.some(r => r.kind === "new")) return { id, attachedTo: null };
  // 本请求编号已登记（重试或刷新占位），或与刷新占位同时到达：沿用原校验，不复活、不换原稿
  return fallback();
}

type TxClient = { transaction: (fn: (tx: { query: (t: string, p: unknown[]) => unknown }) => unknown[], opts: Record<string, unknown>) => Promise<unknown[]> };
/** 同一用户的读档建单 / 交接判断 / 跟进解除串行：先取事务级咨询锁，后续语句读已提交快照。 */
async function runUnderUserLock(db: unknown, userId: string, queries: Array<{ text: string; params: unknown[] }>): Promise<unknown[]> {
  const client = (db as { $client: TxClient }).$client;
  const results = await client.transaction(tx => [
    tx.query("SELECT pg_advisory_xact_lock(hashtext($1)) IS NULL AS locked", [`knowledge_card_distill_admission:${userId}`]),
    ...queries.map(q => tx.query(q.text, q.params)),
  ], { isolationLevel: "ReadCommitted", fullResults: false, arrayMode: false });
  return results.slice(1);
}

const LIVE_FOLLOWER_SQL = (jobParam: string, userParam: string, msParam: string, excludeParam?: string) => `EXISTS (
  SELECT 1 FROM jobs f WHERE f."userId" = ${userParam} AND f.status = '${KNOWLEDGE_CARD_FOLLOW_STATUS}'
    AND f.input::jsonb->>'action' = '${KNOWLEDGE_CARD_FOLLOW_ACTION}' AND f.input::jsonb->>'attachedTo' = ${jobParam}
    ${excludeParam ? `AND f.id <> ${excludeParam}` : ""}
    AND f."updatedAt" >= NOW() - (${msParam}::int * INTERVAL '1 millisecond'))`;

/**
 * 跟进页轮询自己的编号：续跟进记录，并把原任务的进度/结果原样给出。
 * 原任务被别处停止时，跟进页看到的原因统一是「任务已在另一页被停止」。
 */
export async function resolveKnowledgeCardFollowJob(pointer: JobRowLike): Promise<{ status: string; output?: unknown; error?: string }> {
  if (pointer.status !== KNOWLEDGE_CARD_FOLLOW_STATUS) return { status: "failed", error: pointer.error || KNOWLEDGE_CARD_FOLLOW_DETACHED_MESSAGE };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot read followed job");
  await db.update(jobs).set({ updatedAt: new Date() })
    .where(and(eq(jobs.id, pointer.id), eq(jobs.userId, pointer.userId), eq(jobs.status, KNOWLEDGE_CARD_FOLLOW_STATUS)));
  const targetId = String(inputOf(pointer).attachedTo || "");
  const target = targetId ? await getJobByIdStrict(targetId) : null;
  if (!target || String(target.userId) !== String(pointer.userId) || inputOf(target).action !== "knowledge_card_distill") {
    return { status: "failed", error: "原任务已无法查看，请重新提交" };
  }
  if (target.status === "failed" && inputOf(target).cancelRequestedAt) {
    return { status: "failed", output: target.output ?? undefined, error: KNOWLEDGE_CARD_STOPPED_ELSEWHERE_MESSAGE };
  }
  return { status: target.status, output: target.output ?? undefined, error: target.error ?? undefined };
}

/**
 * 解除本页跟进。原始页仍在（原任务未交接）：只解除本页，原任务不动。
 * 原任务已交接（原始页已离开）：
 *  - 主动按停止（explicit）→ 真正停止原任务；
 *  - 离页/刷新 → 解除后若再无其他活着的跟进页，按离页口径停止原任务；还有就不停。
 * 非本人跟进记录返回 null。
 */
export async function detachKnowledgeCardFollow(args: { userId: string; jobId: string; explicit?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot detach follow");
  const row = await getJobByIdStrict(args.jobId);
  if (!row || String(row.userId) !== String(args.userId) || !isKnowledgeCardFollowJob(row)) return null;
  if (row.status === KNOWLEDGE_CARD_FOLLOW_STATUS) {
    const [detachedRows, targetRows] = await runUnderUserLock(db, args.userId, [
      { text: `UPDATE jobs SET status = 'failed', input = (coalesce(input::jsonb, '{}'::jsonb) || jsonb_build_object('detachedAt', $3::text))::json,
          error = $4, "updatedAt" = NOW()
        WHERE id = $1 AND "userId" = $2 AND status = '${KNOWLEDGE_CARD_FOLLOW_STATUS}' RETURNING id`,
        params: [args.jobId, args.userId, new Date().toISOString(), KNOWLEDGE_CARD_FOLLOW_DETACHED_MESSAGE] },
      { text: `SELECT t.id, coalesce(t.input::jsonb->>'handedOffAt', '') <> '' AS "handedOff", ${LIVE_FOLLOWER_SQL("t.id", "$2", "$3", "$4")} AS "othersLive"
        FROM jobs t WHERE t.id = $1 AND t."userId" = $2 AND t.input::jsonb->>'action' = 'knowledge_card_distill'
          AND t.status IN ('queued', 'running') AND coalesce(t.input::jsonb->>'cancelRequestedAt', '') = ''`,
        params: [String(inputOf(row).attachedTo || ""), args.userId, KNOWLEDGE_CARD_FOLLOW_STALE_MS, args.jobId] },
    ]) as [Array<{ id: string }>, Array<{ id: string; handedOff: boolean; othersLive: boolean }>];
    const target = detachedRows.length ? targetRows[0] : undefined;
    let message = KNOWLEDGE_CARD_FOLLOW_DETACHED_MESSAGE;
    if (target?.handedOff) {
      if (args.explicit || !target.othersLive) {
        await requestPlatformJobCancel({
          jobId: target.id, userId: args.userId, actions: ["knowledge_card_distill"],
          queuedError: args.explicit ? KNOWLEDGE_CARD_FOLLOW_STOPPED_MESSAGE : "页面已刷新或关闭，已停止知识卡后续处理",
        });
        message = KNOWLEDGE_CARD_FOLLOW_STOPPED_MESSAGE;
      } else {
        message = KNOWLEDGE_CARD_FOLLOW_DETACHED_OTHERS_MESSAGE;
      }
    }
    if (message !== KNOWLEDGE_CARD_FOLLOW_DETACHED_MESSAGE) {
      await db.update(jobs).set({ error: message }).where(and(eq(jobs.id, args.jobId), eq(jobs.userId, args.userId)));
    }
  }
  const detached = await getJobByIdStrict(args.jobId);
  return detached ? Object.assign(detached, { followDetached: true as const }) : null;
}

/** 是否还有别的页面在跟进这一单（跟进记录未解除且近期仍在轮询）。 */
export async function hasLiveKnowledgeCardFollowers(userId: string, jobId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.userId, userId),
    eq(jobs.status, KNOWLEDGE_CARD_FOLLOW_STATUS),
    sql`${jobs.input}::jsonb->>'action' = ${KNOWLEDGE_CARD_FOLLOW_ACTION}`,
    sql`${jobs.input}::jsonb->>'attachedTo' = ${jobId}`,
    gte(jobs.updatedAt, new Date(Date.now() - KNOWLEDGE_CARD_FOLLOW_STALE_MS)),
  )).limit(1);
  return rows.length > 0;
}

/** 原始页离开：在同一把用户锁下判断有无活着的跟进页，有则在原任务上记 handedOffAt 并交接。 */
async function handOffKnowledgeCardJobIfFollowed(db: unknown, userId: string, jobId: string): Promise<boolean> {
  try {
    const [rows] = await runUnderUserLock(db, userId, [{
      text: `UPDATE jobs SET input = (coalesce(input::jsonb, '{}'::jsonb) || jsonb_build_object('handedOffAt', $3::text))::json
        WHERE id = $1 AND "userId" = $2 AND status IN ('queued', 'running')
          AND input::jsonb->>'action' = 'knowledge_card_distill'
          AND coalesce(input::jsonb->>'cancelRequestedAt', '') = ''
          AND ${LIVE_FOLLOWER_SQL("$1", "$2", "$4")}
        RETURNING id`,
      params: [jobId, userId, new Date().toISOString(), KNOWLEDGE_CARD_FOLLOW_STALE_MS],
    }]) as [Array<{ id: string }>];
    return rows.length > 0;
  } catch (error) {
    // 查不到跟进者时按原有离页语义停止，不让任务因查询故障失去停止路径
    console.warn(`[knowledgeCardPageTask] handoff check failed job=${jobId}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
    return false;
  }
}

/**
 * 兜底：已交接且所有跟进页超过 KNOWLEDGE_CARD_HANDOFF_ABANDON_MS 没有轮询（离页信标也没送到），按离页口径停止。
 * running 只记停止请求，由执行器的取消监视收口；queued 直接判失败（与 requestPlatformJobCancel 同口径）。
 * jobId 给定时只查这一单（执行器取消监视顺手调用）；不给时扫全部（僵尸清理器调用）。
 */
export async function stopAbandonedHandedOffKnowledgeCardJobs(jobId?: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date().toISOString();
  const abandoned = and(
    eq(jobs.type, "platform"),
    sql`${jobs.status} in ('queued', 'running')`,
    sql`${jobs.input}::jsonb->>'action' = 'knowledge_card_distill'`,
    sql`coalesce(${jobs.input}::jsonb->>'handedOffAt', '') <> ''`,
    sql`coalesce(${jobs.input}::jsonb->>'cancelRequestedAt', '') = ''`,
    sql`not (coalesce(${jobs.output}::jsonb, '{}'::jsonb) ? 'knowledgeCardSettlement')`,
    sql`not exists (select 1 from jobs f where f."userId" = ${jobs.userId} and f.status = ${KNOWLEDGE_CARD_FOLLOW_STATUS}
      and f.input::jsonb->>'action' = ${KNOWLEDGE_CARD_FOLLOW_ACTION} and f.input::jsonb->>'attachedTo' = ${jobs.id}
      and f."updatedAt" >= NOW() - (${KNOWLEDGE_CARD_HANDOFF_ABANDON_MS}::int * INTERVAL '1 millisecond'))`,
    ...(jobId ? [eq(jobs.id, jobId)] : []),
  );
  const rows = await db.update(jobs).set({
    input: sql`coalesce(${jobs.input}::jsonb, '{}'::jsonb) || ${JSON.stringify({ cancelRequestedAt: now, abandonedAfterHandoffAt: now })}::jsonb` as never,
    status: sql`case when ${jobs.status} = 'queued' then 'failed' else ${jobs.status} end` as never,
    error: sql`case when ${jobs.status} = 'queued' then '页面已关闭，已停止知识卡后续处理' else ${jobs.error} end` as never,
  }).where(abandoned).returning({ id: jobs.id });
  return rows.length;
}

/**
 * 按请求编号停止（离页信标 / 刷新恢复 / 面板「停止」按钮）。
 * - 本页是跟进页：见 detachKnowledgeCardFollow。
 * - 本页是原始页且只是离页/刷新（explicit=false）：仍有别的页在跟进时不停任务，记 handedOffAt 交给跟进页。
 * - 用户主动按停止（explicit=true）：照常停止；跟进页看到「任务已在另一页被停止」。
 */
export async function cancelKnowledgeCardPageRequest(args: {
  userId: string; action: KnowledgeCardPageAction; requestId: string; explicit?: boolean;
}) {
  const id = knowledgeCardPageJobId(args.userId, args.action, args.requestId);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot cancel knowledge card job");
  // Same unique row serializes cancel-before-enqueue and enqueue-before-cancel, across restarts.
  await db.insert(jobs).values({
    id, userId: args.userId, type: "platform", provider: "evolink", status: "failed", attempts: 0,
    input: { action: args.action, cancelRequestedAt: new Date().toISOString() },
    ...(args.action === "platform_composite_sheet_progress" ? { output: { knowledgeImageRetry: { version: 1, reason: "not_charged", checkedAt: new Date().toISOString() } } } : {}),
    error: "页面已刷新或关闭，已停止知识卡后续处理",
  }).onConflictDoNothing({ target: jobs.id });
  if (args.action === "knowledge_card_distill") {
    const row = await getJobByIdStrict(id);
    if (row && String(row.userId) === String(args.userId) && isKnowledgeCardFollowJob(row)) {
      return detachKnowledgeCardFollow({ userId: args.userId, jobId: id, explicit: args.explicit });
    }
    if (!args.explicit && row && String(row.userId) === String(args.userId) && (row.status === "queued" || row.status === "running")
      && !inputOf(row).cancelRequestedAt && await handOffKnowledgeCardJobIfFollowed(db, args.userId, id)) {
      return Object.assign((await getJobByIdStrict(id)) ?? row, { handedOff: true as const });
    }
  }
  return requestPlatformJobCancel({ jobId: id, userId: args.userId, actions: [args.action], queuedError: "页面已刷新或关闭，已停止知识卡后续处理" });
}

/** Claim before charging. A refresh tombstone or duplicate request never buys another image. */
export async function reserveKnowledgeCardImageJob(args: {
  userId: string; requestId: string; params: Record<string, unknown>;
}): Promise<{ id: string; claimed: boolean }> {
  const action = "platform_composite_sheet_progress" as const;
  const id = knowledgeCardPageJobId(args.userId, action, args.requestId);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot reserve knowledge card image");
  const inserted = await db.insert(jobs).values({
    id, userId: args.userId, type: "platform", provider: "vertex", status: "running", attempts: 1,
    input: { action, params: args.params },
    output: { imageGenFlowLog: [], compositeSheetProgress: true, kind: "single_page_knowledge_card" },
  }).onConflictDoNothing({ target: jobs.id }).returning({ id: jobs.id });
  // The inserted values are ours. Read cancellation inside the caller's protected execution.
  if (inserted.length === 1) return { id, claimed: true };
  const row = await getJobByIdStrict(id);
  if (!row || row.userId !== args.userId || (row.input as { action?: string })?.action !== action) {
    throw new Error("无法确认知识卡出图任务");
  }
  const input = row.input as { params?: unknown; cancelRequestedAt?: unknown };
  if (!input.cancelRequestedAt && !isDeepStrictEqual(input.params, JSON.parse(JSON.stringify(args.params)))) {
    throw new Error("该请求编号已绑定另一张知识卡，请重新提交");
  }
  return { id, claimed: false };
}

/** Cooperative boundary: do not interrupt an already purchased image or discard its result. */
export async function checkKnowledgeCardImageMaySubmit(id: string): Promise<void> {
  const row = await getJobByIdStrict(id);
  if (!row || row.status !== "running" || (row.input as { cancelRequestedAt?: unknown })?.cancelRequestedAt) {
    const error = new Error("页面已刷新或关闭，已停止知识卡后续出图");
    Object.assign(error, { kind: "cancelled" });
    throw error;
  }
}
