import { and, eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { getJobByIdStrict } from "../jobs/repository.js";

/** 显式恢复同一任务；保留原输入、原始响应与已读页，网关占用仍阻止未定态请求重买。 */
export async function resumeKnowledgeCardReadingJob(userId: number, progressJobId: string) {
  if (!/^kc[re]_[a-f0-9]{48}$/.test(progressJobId)) throw new Error("阅读任务编号无效");
  const job = await getJobByIdStrict(progressJobId);
  if (!job || job.userId !== String(userId)) throw new Error("找不到当前账号的阅读任务");
  const action = (job.input as { action?: string } | null)?.action;
  if (action !== "knowledge_card_reading" && action !== "knowledge_card_edition") throw new Error("此任务不属于文档精读");
  if (job.status !== "failed") return { progressJobId, status: job.status };
  const db = await getDb();
  if (!db) throw new Error("任务恢复暂不可用，原任务与证据已保留");
  await db.update(jobs).set({ status: "queued", error: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, progressJobId), eq(jobs.userId, String(userId)), eq(jobs.status, "failed")));
  const restored = await getJobByIdStrict(progressJobId);
  if (!restored || restored.status === "failed") throw new Error("任务尚未恢复，请保留原编号稍后查询");
  return { progressJobId, status: restored.status };
}
