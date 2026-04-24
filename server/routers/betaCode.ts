import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
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

/** 確保表存在（生產環境可能尚未跑 migration） */
async function ensureBetaTables(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`beta_invite_codes\` (
        \`id\`         INT AUTO_INCREMENT PRIMARY KEY,
        \`code\`       VARCHAR(20) NOT NULL UNIQUE,
        \`credits\`    INT NOT NULL DEFAULT 200,
        \`max_uses\`   INT NOT NULL DEFAULT 1,
        \`used_count\` INT NOT NULL DEFAULT 0,
        \`created_by\` INT NOT NULL,
        \`note\`       VARCHAR(120),
        \`expires_at\` TIMESTAMP NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`beta_code_usages\` (
        \`id\`              INT AUTO_INCREMENT PRIMARY KEY,
        \`code_id\`         INT NOT NULL,
        \`user_id\`         INT NOT NULL,
        \`credits_awarded\` INT NOT NULL,
        \`redeemed_at\`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_code_user\` (\`code_id\`, \`user_id\`)
      )
    `);
    console.log("[betaCode] ensureBetaTables: OK");
  } catch (e) {
    console.warn("[betaCode] ensureBetaTables:", e);
  }
}

export const betaCodeRouter = router({
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

      // 確保表存在
      await ensureBetaTables(db);

      const [userRow] = await db
        .select({ role: users.role, email: users.email })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!hasUnlimitedAccess({ role: userRow?.role, email: userRow?.email })) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `僅 Supervisor / Admin 可生成邀請碼（角色：${userRow?.role ?? "未知"}，郵箱：${userRow?.email ?? "未綁定"}）`,
        });
      }

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;

      const codes: string[] = [];
      let lastErr = "";
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
          } catch (err: any) {
            lastErr = String(err?.message ?? err);
            code = generateCode();
          }
        }
        if (!inserted) {
          // 所有嘗試均失敗 → 拋出明確錯誤，讓前端看到問題
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `邀請碼寫入失敗（${lastErr}）——請確認數據庫表已建立`,
          });
        }
      }

      return { codes, count: codes.length };
    }),

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

      await ensureBetaTables(db);

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
        message: `成功兌換 ${codeRow.credits} Credits！可立即使用創作者成長營、平台趨勢分析、節點工作流等功能。`,
      };
    }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    await ensureBetaTables(db);

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
