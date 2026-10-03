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
  userId: string; action: KnowledgeCardPageAction; requestId?: string; params: Record<string, unknown>;
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
    error: "页面已刷新或关闭，已停止读档",
  }).onConflictDoNothing({ target: jobs.id });
  return requestPlatformJobCancel({ jobId: id, userId: args.userId, actions: [args.action], queuedError: "页面已刷新或关闭，已停止读档" });
}
