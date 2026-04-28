import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { betaInviteCodes, betaCodeUsages } from "../../drizzle/schema-beta";
import { addCredits } from "../credits";
import { hasUnlimitedAccess } from "../services/access-policy";
import { users } from "../../drizzle/schema";

const SUPERVISOR_SECRET = process.env.SUPERVISOR_SECRET ?? "";

function isSupervisorToken(token: string | null | undefined): boolean {
  return !!SUPERVISOR_SECRET && !!token && token === SUPERVISOR_SECRET;
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part(4)}-${part(4)}-${part(4)}`;
}

/** 确保表存在（PostgreSQL 语法） */
async function ensureBetaTables(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "beta_invite_codes" (
        "id"         SERIAL PRIMARY KEY,
        "code"       VARCHAR(20) NOT NULL UNIQUE,
        "credits"    INTEGER NOT NULL DEFAULT 200,
        "max_uses"   INTEGER NOT NULL DEFAULT 1,
        "used_count" INTEGER NOT NULL DEFAULT 0,
        "created_by" INTEGER NOT NULL,
        "note"       VARCHAR(120),
        "expires_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "beta_code_usages" (
        "id"              SERIAL PRIMARY KEY,
        "code_id"         INTEGER NOT NULL,
        "user_id"         INTEGER NOT NULL,
        "credits_awarded" INTEGER NOT NULL,
        "redeemed_at"     TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE ("code_id", "user_id")
      )
    `);
    console.log("[betaCode] ensureBetaTables: OK");
  } catch (e) {
    console.warn("[AutoMigrate] skipped (non-fatal):", (e as Error).message?.slice(0, 80));
  }
}

export const betaCodeRouter = router({
  generate: publicProcedure
    .input(
      z.object({
        count: z.number().int().min(1).max(100).default(1),
        credits: z.number().int().min(1).max(10000).default(200),
        maxUses: z.number().int().min(1).default(1),
        note: z.string().max(120).optional(),
        expiresInDays: z.number().int().min(1).max(365).optional(),
        supervisorToken: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await ensureBetaTables(db);

      // supervisor token 直接通过
      const tokenOk = isSupervisorToken(input.supervisorToken);

      if (!tokenOk) {
        // 需要登录 session
        const userId = (ctx as any).user?.id;
        if (!userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录或提供 supervisor token" });
        const [userRow] = await db.select({ role: users.role, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (!hasUnlimitedAccess({ role: userRow?.role, email: userRow?.email })) {
          throw new TRPCError({ code: "FORBIDDEN", message: `仅 Supervisor / Admin 可生成邀请码` });
        }
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
              createdBy: (ctx as any).user?.id,
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
          // 所有尝试均失败 → 抛出明确错误，让前端看到问题
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `邀请码写入失败（${lastErr}）——请确认数据库表已创建`,
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
            eq(betaCodeUsages.userId, (ctx as any).user?.id)
          )
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "您已使用过此内测码" });
      }

      await addCredits((ctx as any).user?.id, codeRow.credits, "beta");
      await db.insert(betaCodeUsages).values({
        codeId: codeRow.id,
        userId: (ctx as any).user?.id,
        creditsAwarded: codeRow.credits,
      });
      await db
        .update(betaInviteCodes)
        .set({ usedCount: codeRow.usedCount + 1 })
        .where(eq(betaInviteCodes.id, codeRow.id));

      return {
        success: true,
        creditsAwarded: codeRow.credits,
        message: `成功兑换 ${codeRow.credits} Credits！可立即使用创作者成长营、平台趋势分析、节点工作流等功能。`,
      };
    }),

  listMine: publicProcedure
    .input(z.object({ supervisorToken: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    await ensureBetaTables(db);

    const tokenOk = isSupervisorToken(input?.supervisorToken);
    if (!tokenOk) {
      const userId = (ctx as any).user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      const [userRow] = await db.select({ role: users.role, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      if (!hasUnlimitedAccess({ role: userRow?.role, email: userRow?.email })) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Supervisor 可查看" });
      }
    }

    return db
      .select()
      .from(betaInviteCodes)
      .where(eq(betaInviteCodes.createdBy, (ctx as any).user?.id))
      .orderBy(desc(betaInviteCodes.createdAt));
  }),
});
