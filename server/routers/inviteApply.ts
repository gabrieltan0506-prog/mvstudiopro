import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { sendSimpleMail } from "../services/smtp-mailer";
import { TRPCError } from "@trpc/server";

const ADMIN_EMAIL = "benjamintan0506@163.com";

export const inviteApplyRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        purpose: z.string().min(5, "请填写用途（至少5字）").max(500),
        contact: z.string().min(3, "请填写微信号或邮箱").max(100),
        name: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { purpose, contact, name } = input;
      const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

      const text = [
        `【MVStudioPro 邀请码申请】`,
        `时间：${now}`,
        `姓名：${name || "（未填写）"}`,
        `联系方式：${contact}`,
        `用途：${purpose}`,
      ].join("\n");

      const html = `
        <div style="font-family:sans-serif;max-width:560px;padding:24px;background:#0e0920;color:#e0d8f8;border-radius:12px">
          <h2 style="color:#a78bfa;margin:0 0 16px">📩 MVStudioPro 邀请码申请</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#8b7fd4;width:90px">时间</td><td style="padding:8px 0">${now}</td></tr>
            <tr><td style="padding:8px 0;color:#8b7fd4">姓名</td><td style="padding:8px 0">${name || "（未填写）"}</td></tr>
            <tr><td style="padding:8px 0;color:#8b7fd4">联系方式</td><td style="padding:8px 0;font-weight:700;color:#c4b5fd">${contact}</td></tr>
            <tr><td style="padding:8px 0;color:#8b7fd4;vertical-align:top">用途</td><td style="padding:8px 0;line-height:1.7">${purpose.replace(/\n/g, "<br>")}</td></tr>
          </table>
        </div>
      `;

      try {
        await sendSimpleMail({
          to: ADMIN_EMAIL,
          subject: `【邀请码申请】${contact}`,
          text,
          html,
        });
      } catch (e) {
        console.error("[inviteApply] mail error:", e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "发送失败，请稍后再试" });
      }

      return { ok: true };
    }),
});
