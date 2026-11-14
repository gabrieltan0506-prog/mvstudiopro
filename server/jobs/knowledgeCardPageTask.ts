import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { isDeepStrictEqual } from "node:util";
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

/**
 * 读档建单 + 同源在途去重（1114 用户令：两个标签页重复提交同一本书只跑一单）。
 * 同一用户、同一原稿身份（dedupeKey 已含提炼档位/成稿档/计费口径）若已有活着的 queued/running 提炼，
 * 不建第二单，直接回原任务编号让第二个页面跟进同一进度与结果；不产生新扣费身份。
 * 「活着」沿用僵尸清理器的窗口：running 看心跳刷的 updatedAt，queued 看最近一次写入；
 * 已结束（成功/失败/取消）或已请求停止的任务不挡新提交。
 * 本请求编号已有行（重试/刷新占位）时仍走原有 createKnowledgeCardPageJob 语义。
 * 可串行化事务：两页同时提交只会有一单插入，另一单冲突重试后跟进。
 */
export async function createKnowledgeCardDistillJob(args: {
  userId: string; requestId?: string; params: Record<string, unknown>; dedupeKey?: string | null;
}): Promise<{ id: string; attachedToExistingJob: boolean }> {
  const action = "knowledge_card_distill" as const;
  const dedupeKey = String(args.dedupeKey || "").trim();
  if (!dedupeKey) {
    return { id: await createKnowledgeCardPageJob({ userId: args.userId, action, requestId: args.requestId, params: args.params }), attachedToExistingJob: false };
  }
  const id = args.requestId ? knowledgeCardPageJobId(args.userId, action, args.requestId) : nanoid(16);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot create knowledge card job");
  const { resolveStaleWallMinutes, resolveQueuedStaleMinutes } = await import("./staleJobsReaper");
  const input = JSON.parse(JSON.stringify({ action, params: args.params, dedupeKey }));
  const text = `
    WITH own AS (
      SELECT id FROM jobs WHERE id = $1
    ), alive AS (
      SELECT id FROM jobs
      WHERE "userId" = $2 AND type = 'platform' AND id <> $1
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
      RETURNING id
    )
    SELECT 'own' AS kind, id FROM own
    UNION ALL SELECT 'attach' AS kind, id FROM alive WHERE NOT EXISTS (SELECT 1 FROM own)
    UNION ALL SELECT 'new' AS kind, id FROM inserted`;
  const params = [id, args.userId, dedupeKey, resolveStaleWallMinutes(), resolveQueuedStaleMinutes(), JSON.stringify(input)];
  const client = (db as unknown as { $client: { transaction: (fn: (tx: { query: (t: string, p: unknown[]) => unknown }) => unknown[], opts: Record<string, unknown>) => Promise<unknown[]> } }).$client;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await client.transaction(tx => [tx.query(text, params)], { isolationLevel: "Serializable", fullResults: false, arrayMode: false });
      const rows = (results[0] as Array<{ kind: string; id: string }>) || [];
      const row = rows.find(r => r.kind === "own") || rows.find(r => r.kind === "attach") || rows.find(r => r.kind === "new");
      if (!row) break;
      if (row.kind === "attach") return { id: row.id, attachedToExistingJob: true };
      if (row.kind === "new") return { id, attachedToExistingJob: false };
      // 本请求编号已登记（重试或刷新占位）：沿用原校验，不复活、不换原稿
      return { id: await createKnowledgeCardPageJob({ userId: args.userId, action, requestId: args.requestId, params: args.params }), attachedToExistingJob: false };
    } catch (error) {
      // 并发两页同时建单：可串行化冲突只重试这条建单语句，重试时会看到对方已建的任务
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "40001" && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("无法确认读档任务，请稍后重试");
}

export async function cancelKnowledgeCardPageRequest(args: {
  userId: string; action: KnowledgeCardPageAction; requestId: string;
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
