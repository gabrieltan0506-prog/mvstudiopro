import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, userFeedback } from "../../drizzle/schema";
import { addCredits } from "../credits";
import { sendMailWithAttachments } from "../services/smtp-mailer";

const FEEDBACK_REWARD = 100;

export const feedbackRouter = router({
  submit: protectedProcedure
    .input(
      z.object({
        subject: z.string().min(2).max(120),
        message: z.string().min(10).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.insert(userFeedback).values({
        userId: ctx.user.id,
        subject: input.subject,
        message: input.message,
        status: "pending",
      });
      return { success: true as const, message: "感谢反馈，我们已收到。" };
    }),

  listForAdmin: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        id: userFeedback.id,
        userId: userFeedback.userId,
        subject: userFeedback.subject,
        message: userFeedback.message,
        status: userFeedback.status,
        creditsAwarded: userFeedback.creditsAwarded,
        adoptedAt: userFeedback.adoptedAt,
        adminNote: userFeedback.adminNote,
        createdAt: userFeedback.createdAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(userFeedback)
      .leftJoin(users, eq(users.id, userFeedback.userId))
      .orderBy(desc(userFeedback.createdAt))
      .limit(200);
    return rows;
  }),

  adopt: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        adminNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [existing] = await db
        .select()
        .from(userFeedback)
        .where(eq(userFeedback.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "记录不存在" });
      }
      if (existing.status === "adopted") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "已发放过奖励" });
      }

      const userId = existing.userId;
      await addCredits(userId, FEEDBACK_REWARD, "bonus");

      await db
        .update(userFeedback)
        .set({
          status: "adopted",
          creditsAwarded: FEEDBACK_REWARD,
          adoptedAt: new Date(),
          adoptedBy: ctx.user.id,
          adminNote: input.adminNote ?? null,
        })
        .where(eq(userFeedback.id, input.id));

      const [u] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const to = String(u?.email || "").trim();
      let emailed = false;
      if (to) {
        try {
          await sendMailWithAttachments({
            to,
            subject: "【MV Studio Pro】您的反馈已被采纳，100 Credits 已发放",
            text: `您好，\n\n我们已采纳您的反馈（#${input.id}），并向你发放 ${FEEDBACK_REWARD} Credits，已入账至账户余额。\n\n祝创作顺利！\nMV Studio Pro 团队`,
            html: `<p>您好，</p><p>我们已采纳您的反馈（工单 <b>#${input.id}</b>），并向你发放 <b>${FEEDBACK_REWARD} Credits</b>，已入账至账户余额。</p><p>祝创作顺利！<br/>MV Studio Pro 团队</p>`,
          });
          emailed = true;
        } catch (e) {
          console.warn("[feedback.adopt] mail failed:", e);
        }
      }

      return { success: true as const, credits: FEEDBACK_REWARD, emailed };
    }),
});
