import { eq } from "drizzle-orm";
import { platformDrSecondaryStaging } from "../../drizzle/schema-dr-secondary-staging.js";
import { getDb } from "../db";

export type DrProSecondaryFrozenPayload = {
  topicHook: string;
  context: string;
};

export async function insertDrProSecondaryStaging(row: {
  jobId: string;
  userId: number;
  primarySceneId: string;
  secondarySceneId: string;
  secondaryTopicHook: string;
  secondaryContext: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot stage DR secondary");
  await db.insert(platformDrSecondaryStaging).values({
    jobId: row.jobId,
    userId: row.userId,
    primarySceneId: row.primarySceneId,
    secondarySceneId: row.secondarySceneId,
    secondaryTopicHook: row.secondaryTopicHook,
    secondaryContext: row.secondaryContext,
  });
}

/** 在對應 platform job 終態（JobsRepo markJobSucceeded / markJobFailed）時按 jobId 刪除。套裝 job 僅在封面與 2×4 均 settle 後才終態，故不會在只跑完封面時刪。 */
export async function deleteDrProSecondaryStagingByJobId(jobId: string): Promise<void> {
  const id = String(jobId ?? "").trim();
  if (!id) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(platformDrSecondaryStaging).where(eq(platformDrSecondaryStaging.jobId, id));
  } catch (e) {
    console.warn(
      "[drProSecondaryStaging] delete failed:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
  }
}

export async function getDrProSecondaryStagingByJobId(
  jobId: string,
): Promise<DrProSecondaryFrozenPayload | null> {
  const id = String(jobId ?? "").trim();
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select({
        secondaryTopicHook: platformDrSecondaryStaging.secondaryTopicHook,
        secondaryContext: platformDrSecondaryStaging.secondaryContext,
      })
      .from(platformDrSecondaryStaging)
      .where(eq(platformDrSecondaryStaging.jobId, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    const hook = String(r.secondaryTopicHook ?? "").trim();
    const ctx = String(r.secondaryContext ?? "").trim();
    if (!hook && !ctx) return null;
    return { topicHook: hook, context: ctx };
  } catch (e) {
    console.warn(
      "[drProSecondaryStaging] select failed:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
    return null;
  }
}
