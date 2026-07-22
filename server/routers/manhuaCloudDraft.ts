import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { manhuaCloudDrafts } from "../../drizzle/schema-manhua-cloud-draft";
import {
  MANHUA_CLOUD_DRAFT_MAX_CHARS,
  isManhuaCloudDraftExpired,
  manhuaCloudDraftPayloadSizeOk,
  parseManhuaCloudDraftPayload,
  serializeManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "../../shared/manhuaCloudDraft";
import {
  commitManhuaCloudDraftAfterDirectUpload,
  createManhuaCloudDraftSignedUpload,
  readManhuaCloudDraftFromGcs,
  writeManhuaCloudDraftToGcs,
} from "../services/manhuaCloudDraftGcsStore";

/** Neon 仅作迁移期回读；新写入一律 GCS */
async function loadDraftFromNeonLegacy(userId: number): Promise<{
  payload: ManhuaCloudDraftPayload;
  updatedAt: string;
} | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select()
      .from(manhuaCloudDrafts)
      .where(eq(manhuaCloudDrafts.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row?.payloadJson) return null;
    const updatedAt =
      row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
    if (isManhuaCloudDraftExpired(updatedAt)) {
      try {
        await db.delete(manhuaCloudDrafts).where(eq(manhuaCloudDrafts.userId, userId));
      } catch {
        /* ignore */
      }
      return null;
    }
    const payload = parseManhuaCloudDraftPayload(row.payloadJson);
    if (!payload) return null;
    return { payload, updatedAt: updatedAt.toISOString() };
  } catch (e) {
    console.warn(
      "[manhuaCloudDraft] neon legacy read failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

async function loadDraftForUser(userId: number): Promise<{
  payload: ManhuaCloudDraftPayload;
  updatedAt: string;
} | null> {
  const fromGcs = await readManhuaCloudDraftFromGcs(userId);
  if (fromGcs) {
    return { payload: fromGcs.payload, updatedAt: fromGcs.serverUpdatedAt };
  }
  const legacy = await loadDraftFromNeonLegacy(userId);
  if (!legacy) return null;
  // 读到旧 Neon 时写穿到 GCS，后续不再依赖库内大 JSON
  try {
    await writeManhuaCloudDraftToGcs({ userId, payload: legacy.payload });
  } catch (e) {
    console.warn(
      "[manhuaCloudDraft] neon→gcs write-through failed:",
      e instanceof Error ? e.message : e,
    );
  }
  return legacy;
}

export const manhuaCloudDraftRouter = router({
  /** 拉取当前用户云端草稿（GCS 优先；Neon 仅迁移回读） */
  get: protectedProcedure.query(async ({ ctx }) => {
    const hit = await loadDraftForUser(ctx.user.id);
    if (!hit) {
      return { draft: null as ManhuaCloudDraftPayload | null, serverUpdatedAt: null as string | null };
    }
    return { draft: hit.payload, serverUpdatedAt: hit.updatedAt };
  }),

  /**
   * 直传准备：浏览器把草稿 JSON PUT 到 GCS，避开大包经 API 超时（Failed to fetch）。
   */
  prepareDirectUpload: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const signed = await createManhuaCloudDraftSignedUpload(ctx.user.id);
      return {
        uploadUrl: signed.uploadUrl,
        gcsUri: signed.gcsUri,
        objectName: signed.objectName,
        requiredHeaders: {
          "Content-Type": "application/json",
          ...(signed.requiredHeaders || {}),
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "草稿上传通道不可用";
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: msg });
    }
  }),

  /** 直传完成后校验 GCS 对象 */
  commitDirectUpload: protectedProcedure.mutation(async ({ ctx }) => {
    const hit = await commitManhuaCloudDraftAfterDirectUpload(ctx.user.id);
    if (!hit) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "未读到云端草稿，请重试上传",
      });
    }
    return {
      ok: true as const,
      clientUpdatedAt: hit.payload.clientUpdatedAt,
      serverUpdatedAt: hit.serverUpdatedAt,
      blockCount: hit.payload.canvas.blocks.length,
      hasWriterPack: Boolean(hit.payload.writerSession.writerPack),
      storage: "gcs" as const,
    };
  }),

  /**
   * 兼容旧客户端：仍收 payloadJson，但写入 GCS（不再写 Neon）。
   * 大包仍可能在网关超时；新客户端请走 prepareDirectUpload。
   */
  upsert: protectedProcedure
    .input(
      z.object({
        payloadJson: z.string().min(2).max(MANHUA_CLOUD_DRAFT_MAX_CHARS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const payload = parseManhuaCloudDraftPayload(input.payloadJson);
      if (!payload) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "草稿格式无效，请刷新后重试" });
      }
      const serialized = serializeManhuaCloudDraftPayload(payload);
      if (!manhuaCloudDraftPayloadSizeOk(serialized)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "草稿过大，请减少节点或先导出备份后再同步",
        });
      }
      try {
        const written = await writeManhuaCloudDraftToGcs({
          userId: ctx.user.id,
          payload,
        });
        return {
          ok: true as const,
          clientUpdatedAt: payload.clientUpdatedAt,
          serverUpdatedAt: written.serverUpdatedAt,
          blockCount: payload.canvas.blocks.length,
          hasWriterPack: Boolean(payload.writerSession.writerPack),
          storage: "gcs" as const,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "草稿服务暂不可用";
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: msg });
      }
    }),
});
