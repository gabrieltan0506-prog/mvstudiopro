/**
 * 扩写失败条的「免费重跑」额度。
 *
 * 用户 2026-08-06 明文：**重跑不再扣费**——上游抖动（OpenRouter 空 200 等）导致的
 * 没出稿是平台自己的坑，赚的钱一部分本来就该拿来补这些坑，不该让用户为同一条再付一次。
 *
 * 不新增表：额度直接从该用户最近的 `platform_topic_expand` 任务里推导——
 * 任务 output.diagnostics.failedPicks 里的条目就是欠他的，认领后把 id 写回
 * 同一条任务的 output.freeRetryClaimedIds，保证同一次失败只能免费换一次。
 */

import { and, desc, eq, gt } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";

/** 失败超过这个时长就不再补免费重跑（避免翻旧账无限白跑） */
const FREE_RETRY_WINDOW_MS = 48 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readFailedPickIds(output: Record<string, unknown> | null): string[] {
  const diag = asRecord(output?.diagnostics);
  const list = diag?.failedPicks;
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => String(asRecord(row)?.id || "").trim())
    .filter((id) => id.length > 0);
}

function readClaimedIds(output: Record<string, unknown> | null): string[] {
  const list = output?.freeRetryClaimedIds;
  if (!Array.isArray(list)) return [];
  return list.map((id) => String(id || "").trim()).filter((id) => id.length > 0);
}

/**
 * 这批 picks 是否全部都是「上次没出稿」的条目：是则本次免费。
 *
 * 只有整批都被欠着才免费；混进新选题就照常计费（否则夹带一条旧失败就能白跑一整批）。
 */
export async function claimFreeExpandRetry(params: {
  userId: number | string;
  pickIds: string[];
}): Promise<{ free: boolean; claimedIds: string[] }> {
  const wanted = Array.from(
    new Set(params.pickIds.map((id) => String(id || "").trim()).filter(Boolean)),
  );
  if (!wanted.length) return { free: false, claimedIds: [] };

  const db = await getDb();
  if (!db) return { free: false, claimedIds: [] };

  try {
    const since = new Date(Date.now() - FREE_RETRY_WINDOW_MS);
    const rows = await db
      .select({ id: jobs.id, input: jobs.input, output: jobs.output })
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, String(params.userId)),
          eq(jobs.type, "platform"),
          gt(jobs.createdAt, since),
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(40);

    const remaining = new Set(wanted);
    /** jobId → 本次要写回的已认领 id（含该任务原有的） */
    const claimsByJob = new Map<string, string[]>();

    for (const row of rows) {
      if (!remaining.size) break;
      const input = asRecord(row.input);
      if (String(input?.action || "") !== "platform_topic_expand") continue;
      const output = asRecord(row.output);
      const claimed = new Set(readClaimedIds(output));
      const owed = readFailedPickIds(output).filter((id) => !claimed.has(id));
      if (!owed.length) continue;

      const hit = owed.filter((id) => remaining.has(id));
      if (!hit.length) continue;
      for (const id of hit) remaining.delete(id);
      claimsByJob.set(row.id, Array.from(new Set(Array.from(claimed).concat(hit))));
    }

    // 必须整批都被欠着才免费
    if (remaining.size > 0) return { free: false, claimedIds: [] };

    for (const [jobId, claimedIds] of Array.from(claimsByJob.entries())) {
      const row = rows.find((r) => r.id === jobId);
      const prevOutput = asRecord(row?.output) ?? {};
      await db
        .update(jobs)
        .set({
          output: { ...prevOutput, freeRetryClaimedIds: claimedIds } as never,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
    }

    return { free: true, claimedIds: wanted };
  } catch (error) {
    // 认领失败就照常计费，不要因为查不到额度把重跑卡死
    console.warn(
      "[claimFreeExpandRetry] 查询免费重跑额度失败，按计费处理:",
      error instanceof Error ? error.message.slice(0, 200) : error,
    );
    return { free: false, claimedIds: [] };
  }
}
