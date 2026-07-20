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

async function loadDraftForUser(userId: number): Promise<{
  payload: ManhuaCloudDraftPayload;
  updatedAt: string;
} | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(manhuaCloudDrafts)
    .where(eq(manhuaCloudDrafts.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row?.payloadJson) return null;
  const updatedAt =
    row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  // 超过约 30 天未同步：清除并视为无草稿（促使用户以导出为准）
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
  return {
    payload,
    updatedAt: updatedAt.toISOString(),
  };
}

export const manhuaCloudDraftRouter = router({
  /** 拉取当前用户云端草稿（无则 null） */
  get: protectedProcedure.query(async ({ ctx }) => {
    const hit = await loadDraftForUser(ctx.user.id);
    if (!hit) return { draft: null as ManhuaCloudDraftPayload | null, serverUpdatedAt: null as string | null };
    return { draft: hit.payload, serverUpdatedAt: hit.updatedAt };
  }),

  /** 上传/覆盖云端草稿（分集剧本 + 静帧；服务端再校验去视频） */
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
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "草稿服务暂不可用" });
      }
      const clientUpdatedAt = new Date(payload.clientUpdatedAt);
      const now = new Date();
      const existing = await db
        .select({ id: manhuaCloudDrafts.id })
        .from(manhuaCloudDrafts)
        .where(eq(manhuaCloudDrafts.userId, ctx.user.id))
        .limit(1);
      if (existing[0]) {
        await db
          .update(manhuaCloudDrafts)
          .set({
            payloadJson: serialized,
            clientUpdatedAt,
            updatedAt: now,
          })
          .where(eq(manhuaCloudDrafts.userId, ctx.user.id));
      } else {
        await db.insert(manhuaCloudDrafts).values({
          userId: ctx.user.id,
          payloadJson: serialized,
          clientUpdatedAt,
          createdAt: now,
          updatedAt: now,
        });
      }
      return {
        ok: true as const,
        clientUpdatedAt: payload.clientUpdatedAt,
        serverUpdatedAt: now.toISOString(),
        blockCount: payload.canvas.blocks.length,
        hasWriterPack: Boolean(payload.writerSession.writerPack),
      };
    }),
});
