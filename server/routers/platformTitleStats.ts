import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { platformTitleVariantEvents } from "../../drizzle/schema";

const TOPIC_ID_MAX = 512;

function assertVariantId(v: string): v is "a" | "b" {
  return v === "a" || v === "b";
}

export const platformTitleStatsRouter = router({
  record: protectedProcedure
    .input(
      z.object({
        topicId: z.string().min(1).max(TOPIC_ID_MAX),
        variantId: z.string().min(1).max(32),
        kind: z.enum(["view", "pick"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!assertVariantId(input.variantId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "无效变体" });
      }
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库未就绪" });
      }
      await db.insert(platformTitleVariantEvents).values({
        userId: ctx.user.id,
        topicId: input.topicId,
        variantId: input.variantId,
        kind: input.kind,
      });
      return { ok: true as const };
    }),

  aggregates: publicProcedure
    .input(z.object({ topicId: z.string().min(1).max(TOPIC_ID_MAX) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return { byVariant: {} as Record<string, { views: number; picks: number }> };
      }
      const rows = await db
        .select()
        .from(platformTitleVariantEvents)
        .where(eq(platformTitleVariantEvents.topicId, input.topicId));
      const byVariant: Record<string, { views: number; picks: number }> = {};
      for (const r of rows) {
        if (!byVariant[r.variantId]) {
          byVariant[r.variantId] = { views: 0, picks: 0 };
        }
        if (r.kind === "view") byVariant[r.variantId].views++;
        else if (r.kind === "pick") byVariant[r.variantId].picks++;
      }
      return { byVariant };
    }),
});
