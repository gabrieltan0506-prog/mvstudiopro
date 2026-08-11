/**
 * 教育合作洽询路由
 * 用户填表 → 发送通知 email 到 benjamintan0506@163.com
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { sendMailWithAttachments } from "../services/smtp-mailer";

const INQUIRY_TO = "benjamintan0506@163.com";

// 按邮箱频控：3 次/10 分钟（同 emailOtp 的 Map 模式；防止公开路由轰炸站主邮箱）
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function checkInquiryRateLimit(key: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (record.count >= 3) return false;
  record.count++;
  return true;
}

// 表单值直插邮件 HTML 前转义，防注入钓鱼链接/图片
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
      if (!checkInquiryRateLimit(email.toLowerCase())) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "提交太频繁了，请 10 分钟后再试",
        });
      }
      const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

      const html = `
<div style="font-family:sans-serif;max-width:600px;padding:24px;background:#f9f9f9;border-radius:12px">
  <h2 style="color:#FF6B35;margin-top:0">📚 教育项目合作洽询</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:6px 0;color:#888;width:90px">姓名</td><td style="font-weight:bold">${escapeHtml(name)}</td></tr>
    <tr><td style="padding:6px 0;color:#888">邮箱</td><td>${escapeHtml(email)}</td></tr>
    <tr><td style="padding:6px 0;color:#888">联系电话</td><td>${escapeHtml(phone || "（未填写）")}</td></tr>
    <tr><td style="padding:6px 0;color:#888">机构 / 院校</td><td>${escapeHtml(organization || "（未填写）")}</td></tr>
    <tr><td style="padding:6px 0;color:#888">留言</td><td>${escapeHtml(message || "（无）")}</td></tr>
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
        // 此路由无 DB 落库，邮件是唯一持久化：失败必须抛错让用户重试，不能静默丢线索
        console.error("[education.inquiry] mail failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "提交没有送达，请稍后重试或直接邮件联系我们",
        });
      }

      return { success: true };
    }),
});
