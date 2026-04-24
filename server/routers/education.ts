/**
 * 教育合作洽詢路由
 * 用戶填表 → 發送通知 email 到 benjamintan0506@163.com
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { sendMailWithAttachments } from "../services/smtp-mailer";

const INQUIRY_TO = "benjamintan0506@163.com";

export const educationRouter = router({
  inquiry: publicProcedure
    .input(
      z.object({
        name:         z.string().min(1).max(60),
        email:        z.string().email().max(200),
        phone:        z.string().max(30).optional(),
        organization: z.string().max(100).optional(),
        message:      z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { name, email, phone, organization, message } = input;
      const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

      const html = `
<div style="font-family:sans-serif;max-width:600px;padding:24px;background:#f9f9f9;border-radius:12px">
  <h2 style="color:#FF6B35;margin-top:0">📚 教育项目合作洽询</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:6px 0;color:#888;width:90px">姓名</td><td style="font-weight:bold">${name}</td></tr>
    <tr><td style="padding:6px 0;color:#888">邮箱</td><td>${email}</td></tr>
    <tr><td style="padding:6px 0;color:#888">联系电话</td><td>${phone || "（未填写）"}</td></tr>
    <tr><td style="padding:6px 0;color:#888">机构 / 院校</td><td>${organization || "（未填写）"}</td></tr>
    <tr><td style="padding:6px 0;color:#888">留言</td><td>${message || "（无）"}</td></tr>
    <tr><td style="padding:6px 0;color:#888">提交时间</td><td>${now}</td></tr>
  </table>
</div>`;

      try {
        await sendMailWithAttachments({
          to: INQUIRY_TO,
          subject: `[MV Studio Pro] 教育合作洽询 — ${name}（${organization || email}）`,
          text: `姓名：${name}\n邮箱：${email}\n电话：${phone || "无"}\n机构：${organization || "无"}\n留言：${message || "无"}\n时间：${now}`,
          html,
        });
      } catch (err) {
        // 郵件失敗不影響用戶端成功提示，僅後端 log
        console.error("[education.inquiry] mail failed:", err);
      }

      return { success: true };
    }),
});
