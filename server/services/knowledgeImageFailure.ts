import { and, eq, ne, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import type { KnowledgeImageRetryReason } from "../../shared/knowledgeImageRetry";

/** 终态与可重试证据同一次落盘；已成功图片不因后续结算报错降为失败。 */
export async function markKnowledgeImageFailed(id: string, owner: string, error: string, reason: KnowledgeImageRetryReason) {
  const db = await getDb();
  if (!db) throw new Error("无法保存配图失败与结算状态，请保留原请求等待核对");
  const receipt = { version: 1, reason, checkedAt: new Date().toISOString() };
  await db.update(jobs).set({
    status: "failed", error, updatedAt: new Date(),
    output: sql`coalesce(${jobs.output}::jsonb, '{}'::jsonb) || ${JSON.stringify({ knowledgeImageRetry: receipt })}::jsonb`,
  }).where(and(eq(jobs.id, id), eq(jobs.userId, owner), ne(jobs.status, "succeeded")));
}
