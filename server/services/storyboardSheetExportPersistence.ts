import { and, eq } from "drizzle-orm";
import { jobs } from "../../drizzle/schema-jobs";
import { userCreations } from "../../drizzle/schema-creations";
import { getJobById } from "../jobs/repository";
import { getDb } from "../db";

/** 寫入 userCreations.metadata.storyboardSheetExport（Cam7 匯出讀取）及 platform job 的 output 備份 */
export type StoryboardSheetExportPayload = {
  imageUrl: string;
  scriptContextForPanels: string;
  executionDetails?: string;
  reportTitle: string;
  sceneId: string;
  kind: string;
  updatedAt: string;
};

export async function persistStoryboardSheetExportAfterGeneration(params: {
  userId: number;
  creationRecordId?: number | null | undefined;
  jobId?: string | null | undefined;
  sceneId: string;
  payload: StoryboardSheetExportPayload;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[persistStoryboardSheetExport] DB unavailable, skip");
    return;
  }

  const sheetForMeta: Record<string, unknown> = {
    imageUrl: params.payload.imageUrl,
    scriptContextForPanels: params.payload.scriptContextForPanels,
    reportTitle: params.payload.reportTitle,
    sceneId: params.payload.sceneId,
    kind: params.payload.kind,
    updatedAt: params.payload.updatedAt,
  };
  if (params.payload.executionDetails?.trim()) {
    sheetForMeta.executionDetails = params.payload.executionDetails.trim();
    sheetForMeta.lightingDetails = params.payload.executionDetails.trim();
  }

  if (params.creationRecordId) {
    const rows = await db
      .select()
      .from(userCreations)
      .where(and(eq(userCreations.id, params.creationRecordId), eq(userCreations.userId, params.userId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      console.warn(
        `[persistStoryboardSheetExport] user_creations id=${params.creationRecordId} not found or forbidden for userId=${params.userId}`,
      );
    } else if (row.type !== "deep_research_report") {
      console.warn(
        `[persistStoryboardSheetExport] user_creations id=${params.creationRecordId} type=${row.type} is not deep_research_report, skip metadata write`,
      );
    } else {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
      } catch {
        meta = {};
      }
      meta.storyboardSheetExport = sheetForMeta;
      await db
        .update(userCreations)
        .set({ metadata: JSON.stringify(meta), updatedAt: new Date() })
        .where(eq(userCreations.id, params.creationRecordId));
    }
  }

  if (params.jobId) {
    const j = await getJobById(params.jobId);
    if (!j || j.userId !== String(params.userId) || j.type !== "platform") {
      console.warn(`[persistStoryboardSheetExport] job ${params.jobId} skip (missing, user mismatch, or type != platform)`);
      return;
    }
    const prev =
      j.output && typeof j.output === "object" && !Array.isArray(j.output)
        ? { ...(j.output as Record<string, unknown>) }
        : {};
    const rawMap = prev["storyboardSheetExportsByScene"];
    const byScene: Record<string, unknown> =
      rawMap && typeof rawMap === "object" && !Array.isArray(rawMap) ? { ...(rawMap as Record<string, unknown>) } : {};
    byScene[params.sceneId] = { ...sheetForMeta };
    prev["storyboardSheetExportsByScene"] = byScene;
    await db.update(jobs).set({ output: prev, updatedAt: new Date() }).where(eq(jobs.id, params.jobId));
  }
}
