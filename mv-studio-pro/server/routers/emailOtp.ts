import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import { getSessionCookieOptions } from "../_core/cookies";
import * as sessionDb from "../sessionDb";
import * as crypto from "crypto";

/**
 * Email OTP (One-Time Password) Login
 * - User enters email → receives 6-digit verification code
 * - User enters code → verified → session cookie set → logged in
 * 
 * Note: Currently uses console.log for code delivery.
 * TODO: Integrate with email service (SendGrid, AWS SES, Resend, etc.)
 */

// In-memory OTP store (in production, use Redis or database)
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

// Rate limiting: max 5 OTP requests per email per 10 minutes
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function checkRateLimit(email: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(email);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(email, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }

  if (record.count >= 5) return false;
  record.count++;
  return true;
}

/**
 * Send OTP via email
 * Currently logs to console; replace with actual email service in production
 */
async function sendEmailOTP(email: string, code: string): Promise<boolean> {
  // TODO: Replace with actual email service
  // Options: SendGrid, AWS SES, Resend, Mailgun, 腾讯云邮件
  console.log(`\n========================================`);
  console.log(`[Email OTP] 验证码: ${code}`);
  console.log(`[Email OTP] 收件人: ${email}`);
  console.log(`[Email OTP] 有效期: 10 分钟`);
  console.log(`========================================\n`);
  return true;
}

export const emailOtpRouter = router({
  // ─── Send OTP to email ───
  sendCode: publicProcedure
    .input(
      z.object({
        email: z.string().email("请输入有效的电子邮件地址"),
      })
    )
    .mutation(async ({ input }) => {
      const email = input.email.toLowerCase().trim();

      // Rate limit check
      if (!checkRateLimit(email)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "发送过于频繁，请 10 分钟后再试",
        });
      }

      // Generate OTP
      const code = generateOTP();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      // Store OTP
      otpStore.set(email, { code, expiresAt, attempts: 0 });

      // Send email
      const sent = await sendEmailOTP(email, code);
      if (!sent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "发送验证码失败，请稍后再试",
        });
      }

      return {
        success: true,
        message: "验证码已发送到您的邮箱",
        expiresIn: 600, // seconds
      };
    }),

  // ─── Verify OTP and login ───
  verifyAndLogin: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        code: z.string().length(6, "验证码必须为 6 位数字"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const email = input.email.toLowerCase().trim();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Get stored OTP
      const storedOtp = otpStore.get(email);
      if (!storedOtp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先发送验证码" });
      }

      // Check expiry
      if (Date.now() > storedOtp.expiresAt) {
        otpStore.delete(email);
        throw new TRPCError({ code: "BAD_REQUEST", message: "验证码已过期，请重新发送" });
      }

      // Check attempts (max 5)
      if (storedOtp.attempts >= 5) {
        otpStore.delete(email);
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证次数过多，请重新发送验证码" });
      }

      storedOtp.attempts++;

      // Verify code
      if (storedOtp.code !== input.code) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "验证码错误" });
      }

      // OTP verified - delete it
      otpStore.delete(email);

      // Find or create user
      const openId = `email_${email}`;
      let [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

      if (!user) {
        // Also check by email field (might have been created by admin via beta system)
        [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        if (user) {
          // Update openId to match email login pattern
          if (!user.openId.startsWith("email_")) {
            await db.update(users).set({ openId, loginMethod: "email_otp" }).where(eq(users.id, user.id));
          }
        } else {
          // Create new user
          const [result] = await db.insert(users).values({
            openId,
            email,
            name: email.split("@")[0],
            loginMethod: "email_otp",
            role: "user",
          });
          [user] = await db.select().from(users).where(eq(users.id, result.insertId)).limit(1);
        }
      }

      // Update last signed in
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));

      // Create session token
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      // Set session cookie
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Persist session to database
      await sessionDb.createSession({
        userId: user.id,
        openId: user.openId,
        token: sessionToken,
        loginMethod: "email_otp",
        userAgent: ctx.req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + ONE_YEAR_MS),
      });

      return {
        success: true,
        message: "登录成功",
        sessionToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    }),
});

/**
 * Phone OTP Login (预留，暂不上线)
 * 
 * 与 Email OTP 逻辑相同，只是发送渠道改为短信
 * 等 ICP 备案完成 + 腾讯云短信服务开通后激活
 */
export const phoneOtpRouter = router({
  // ─── Send OTP via SMS ───
  sendCode: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(/^1[3-9]\d{9}$/, "请输入有效的中国大陆手机号码"),
      })
    )
    .mutation(async ({ input }) => {
      const phone = input.phone.trim();

      // Rate limit check
      if (!checkRateLimit(`phone_${phone}`)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "发送过于频繁，请 10 分钟后再试",
        });
      }

      // Generate OTP
      const code = generateOTP();
      const expiresAt = Date.now() + 10 * 60 * 1000;

      otpStore.set(`phone_${phone}`, { code, expiresAt, attempts: 0 });

      // TODO: Replace with actual SMS service (腾讯云短信/阿里云短信)
      console.log(`\n========================================`);
      console.log(`[SMS OTP] 验证码: ${code}`);
      console.log(`[SMS OTP] 手机号: ${phone}`);
      console.log(`[SMS OTP] 有效期: 10 分钟`);
      console.log(`========================================\n`);

      return {
        success: true,
        message: "验证码已发送到您的手机",
        expiresIn: 600,
      };
    }),

  // ─── Verify SMS OTP and login ───
  verifyAndLogin: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        code: z.string().length(6, "验证码必须为 6 位数字"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const phone = input.phone.trim();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const storeKey = `phone_${phone}`;
      const storedOtp = otpStore.get(storeKey);
      if (!storedOtp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先发送验证码" });
      }

      if (Date.now() > storedOtp.expiresAt) {
        otpStore.delete(storeKey);
        throw new TRPCError({ code: "BAD_REQUEST", message: "验证码已过期，请重新发送" });
      }

      if (storedOtp.attempts >= 5) {
        otpStore.delete(storeKey);
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证次数过多，请重新发送验证码" });
      }

      storedOtp.attempts++;

      if (storedOtp.code !== input.code) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "验证码错误" });
      }

      otpStore.delete(storeKey);

      // Find or create user by phone
      const openId = `phone_${phone}`;
      let [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

      if (!user) {
        const [result] = await db.insert(users).values({
          openId,
          name: `用户${phone.slice(-4)}`,
          loginMethod: "phone_otp",
          role: "user",
        });
        [user] = await db.select().from(users).where(eq(users.id, result.insertId)).limit(1);
      }

      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Persist session to database
      await sessionDb.createSession({
        userId: user.id,
        openId: user.openId,
        token: sessionToken,
        loginMethod: "phone_otp",
        userAgent: ctx.req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + ONE_YEAR_MS),
      });

      return {
        success: true,
        message: "登录成功",
        sessionToken,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
        },
      };
    }),
});
