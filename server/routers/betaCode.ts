import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { betaInviteCodes, betaCodeUsages } from "../../drizzle/schema-beta";
import { addCredits } from "../credits";
import { hasUnlimitedAccess } from "../services/access-policy";
import { users } from "../../drizzle/schema";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part(4)}-${part(4)}-${part(4)}`;
}

export const betaCodeRouter = router({
  // Supervisor generates invite codes in batch
  generate: protectedProcedure
    .input(
      z.object({
        count: z.number().int().min(1).max(100).default(1),
        credits: z.number().int().min(1).max(10000).default(200),
        maxUses: z.number().int().min(1).default(1),
        note: z.string().max(120).optional(),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [userRow] = await db
        .select({ role: users.role, email: users.email })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!hasUnlimitedAccess({ role: userRow?.role, email: userRow?.email })) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Supervisor / Admin 可生成内测码" });
      }

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;

      const codes: string[] = [];
      for (let i = 0; i < input.count; i++) {
        let code = generateCode();
        let inserted = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            await db.insert(betaInviteCodes).values({
              code,
              credits: input.credits,
              maxUses: input.maxUses,
              usedCount: 0,
              createdBy: ctx.user.id,
              note: input.note ?? null,
              expiresAt,
            });
            codes.push(code);
            inserted = true;
            break;
          } catch {
            code = generateCode();
          }
        }
        if (!inserted) codes.push(`[FAILED-${i}]`);
      }

      return { codes, count: codes.filter((c) => !c.startsWith("[FAILED")).length };
    }),

  // User redeems a code to receive credits
  redeem: protectedProcedure
    .input(
      z.object({
        code: z
          .string()
          .min(1)
          .max(30)
          .transform((s) => s.toUpperCase().trim()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [codeRow] = await db
        .select()
        .from(betaInviteCodes)
        .where(eq(betaInviteCodes.code, input.code))
        .limit(1);

      if (!codeRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "内测码不存在或已失效" });
      }
      if (codeRow.expiresAt && codeRow.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "内测码已过期" });
      }
      if (codeRow.maxUses !== -1 && codeRow.usedCount >= codeRow.maxUses) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "内测码已达使用上限" });
      }

      const [existing] = await db
        .select()
        .from(betaCodeUsages)
        .where(
          and(
            eq(betaCodeUsages.codeId, codeRow.id),
            eq(betaCodeUsages.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "您已使用过此内测码" });
      }

      await addCredits(ctx.user.id, codeRow.credits, "beta");
      await db.insert(betaCodeUsages).values({
        codeId: codeRow.id,
        userId: ctx.user.id,
        creditsAwarded: codeRow.credits,
      });
      await db
        .update(betaInviteCodes)
        .set({ usedCount: codeRow.usedCount + 1 })
        .where(eq(betaInviteCodes.id, codeRow.id));

      return {
        success: true,
        creditsAwarded: codeRow.credits,
        message: `🎉 成功兑换 ${codeRow.credits} Credits！可立即使用创作者成长营、平台趋势分析、节点工作流等功能。`,
      };
    }),

  // Supervisor lists codes they created
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [userRow] = await db
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!hasUnlimitedAccess({ role: userRow?.role, email: userRow?.email })) {
      throw new TRPCError({ code: "FORBIDDEN", message: "仅 Supervisor 可查看" });
    }

    return db
      .select()
      .from(betaInviteCodes)
      .where(eq(betaInviteCodes.createdBy, ctx.user.id))
      .orderBy(desc(betaInviteCodes.createdAt));
  }),
});
