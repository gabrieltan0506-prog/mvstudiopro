import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { paidTrafficReviews } from "../../drizzle/schema-paid-traffic-reviews";

const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => {
    const n = Math.max(0, Number(v) || 0);
    return n.toFixed(2);
  });

export const paidTrafficReviewsRouter = router({
  /** 回填一条实测投放复盘数据 */
  create: protectedProcedure
    .input(
      z.object({
        platform: z.string().max(32).optional(),
        campaignName: z.string().max(255).optional(),
        spend: moneyString,
        impressions: z.number().int().min(0).max(1_000_000_000).default(0),
        clicks: z.number().int().min(0).max(1_000_000_000).default(0),
        conversions: z.number().int().min(0).max(1_000_000_000).default(0),
        revenue: moneyString.default("0"),
        notes: z.string().max(2000).optional(),
        measuredAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库暂不可用" });
      const [row] = await db
        .insert(paidTrafficReviews)
        .values({
          userId: ctx.user.id,
          platform: input.platform ?? null,
          campaignName: input.campaignName?.trim() || null,
          spend: input.spend,
          impressions: input.impressions,
          clicks: input.clicks,
          conversions: input.conversions,
          revenue: input.revenue,
          notes: input.notes?.trim() || null,
          measuredAt: input.measuredAt ? new Date(input.measuredAt) : null,
        })
        .returning({ id: paidTrafficReviews.id });
      return { success: true as const, id: row?.id ?? 0 };
    }),

  /** 按当前用户列出复盘记录（默认按记录时间升序，便于画 ROI 曲线） */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(paidTrafficReviews)
        .where(eq(paidTrafficReviews.userId, ctx.user.id))
        .orderBy(desc(paidTrafficReviews.createdAt))
        .limit(input?.limit ?? 100);
      return rows;
    }),

  /** 删除自己的一条复盘记录 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库暂不可用" });
      await db
        .delete(paidTrafficReviews)
        .where(and(eq(paidTrafficReviews.id, input.id), eq(paidTrafficReviews.userId, ctx.user.id)));
      return { success: true as const };
    }),
});
