import type { Express, Request } from "express";
import { randomInt, randomUUID, createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { creditLedger, users } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import { COOKIE_NAME } from "../../shared/const";
import * as sessionDb from "../sessionDb";
import { getDb } from "../db";
import { sendOtpMail } from "../services/smtp-mailer";

type CaptchaRecord = {
  text: string;
  expiresAt: number;
};

type OtpRecord = {
  code: string;
  expiresAt: number;
  attempts: number;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const CAPTCHA_TTL_MS = 2 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const EMAIL_RATE_LIMIT_MAX = 3;
const IP_RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SIGNUP_BONUS = 100;
const VERIFIED_BONUS = 20;

const captchaStore = new Map<string, CaptchaRecord>();
const otpStore = new Map<string, OtpRecord>();
const emailRateLimitStore = new Map<string, RateLimitRecord>();
const ipRateLimitStore = new Map<string, RateLimitRecord>();

type RoleTag = "normal" | "student" | "teacher" | "military_police";
type VerifyStatus = "none" | "pending" | "approved" | "rejected";

function pruneExpired() {
  const now = Date.now();

  for (const [captchaId, record] of Array.from(captchaStore.entries())) {
    if (record.expiresAt <= now) captchaStore.delete(captchaId);
  }

  for (const [email, record] of Array.from(otpStore.entries())) {
    if (record.expiresAt <= now) otpStore.delete(email);
  }

  for (const [key, record] of Array.from(emailRateLimitStore.entries())) {
    if (record.resetAt <= now) emailRateLimitStore.delete(key);
  }

  for (const [key, record] of Array.from(ipRateLimitStore.entries())) {
    if (record.resetAt <= now) ipRateLimitStore.delete(key);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0]?.trim() || req.ip || "unknown";
  }
  if (Array.isArray(xff) && xff[0]) {
    return xff[0].split(",")[0]?.trim() || req.ip || "unknown";
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function consumeRateLimit(store: Map<string, RateLimitRecord>, key: string, max: number): boolean {
  const now = Date.now();
  const record = store.get(key);

  if (!record || record.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= max) {
    return false;
  }

  record.count += 1;
  return true;
}

function generateCaptchaText(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < 5; i++) {
    value += chars[randomInt(0, chars.length)];
  }
  return value;
}

function svgToBase64(svg: string): string {
  return Buffer.from(svg, "utf8").toString("base64");
}

function generateCaptchaImage(text: string): string {
  const chars = text
    .split("")
    .map((char, i) => {
      const x = 20 + i * 24;
      const y = 34 + randomInt(-4, 5);
      const rotate = randomInt(-25, 26);
      return `<text x=\"${x}\" y=\"${y}\" transform=\"rotate(${rotate} ${x} ${y})\" font-size=\"24\" fill=\"#1f2937\" font-family=\"Verdana\" font-weight=\"700\">${char}</text>`;
    })
    .join("");

  const lines = Array.from({ length: 6 })
    .map(() => {
      const x1 = randomInt(0, 160);
      const y1 = randomInt(0, 50);
      const x2 = randomInt(0, 160);
      const y2 = randomInt(0, 50);
      const opacity = (Math.random() * 0.4 + 0.2).toFixed(2);
      return `<line x1=\"${x1}\" y1=\"${y1}\" x2=\"${x2}\" y2=\"${y2}\" stroke=\"#6b7280\" stroke-width=\"1\" opacity=\"${opacity}\" />`;
    })
    .join("");

  const dots = Array.from({ length: 20 })
    .map(() => {
      const x = randomInt(0, 160);
      const y = randomInt(0, 50);
      const r = randomInt(1, 3);
      const opacity = (Math.random() * 0.35 + 0.15).toFixed(2);
      return `<circle cx=\"${x}\" cy=\"${y}\" r=\"${r}\" fill=\"#9ca3af\" opacity=\"${opacity}\" />`;
    })
    .join("");

  const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"160\" height=\"50\" viewBox=\"0 0 160 50\"><rect width=\"160\" height=\"50\" fill=\"#f9fafb\"/>${lines}${dots}${chars}</svg>`;
  return `data:image/svg+xml;base64,${svgToBase64(svg)}`;
}

function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}

function createEmailOpenId(email: string): string {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return `emailotp_${digest}`;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeRoleTag(value: unknown): RoleTag {
  if (value === "student" || value === "teacher" || value === "military_police") {
    return value;
  }
  return "normal";
}

function normalizeContact(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasAnyContact(contactWechat: string | null, contactPhone: string | null): boolean {
  return Boolean(contactWechat || contactPhone);
}

async function consumeValidOtp(email: string, otp: string) {
  const record = otpStore.get(email);
  if (!record) {
    throw new Error("请先发送验证码");
  }
  if (record.expiresAt <= Date.now()) {
    otpStore.delete(email);
    throw new Error("验证码已过期，请重新发送");
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(email);
    throw new Error("验证失败次数过多，请重新发送验证码");
  }

  record.attempts += 1;
  if (record.code !== otp) {
    const remaining = OTP_MAX_ATTEMPTS - record.attempts;
    if (remaining <= 0) {
      otpStore.delete(email);
      throw new Error("验证失败次数过多，请重新发送验证码");
    }
    throw new Error(`验证码错误，还可尝试 ${remaining} 次`);
  }
  otpStore.delete(email);
}

async function authenticateApiUser(req: Request) {
  return sdk.authenticateRequest(req);
}

export function registerAuthApiRoutes(app: Express) {
  app.get("/api/auth/captcha", (_req, res) => {
    pruneExpired();
    const captchaId = randomUUID();
    const text = generateCaptchaText();

    captchaStore.set(captchaId, {
      text,
      expiresAt: Date.now() + CAPTCHA_TTL_MS,
    });

    return res.status(200).json({
      imageBase64: generateCaptchaImage(text),
      captchaId,
    });
  });

  app.post("/api/auth/send-otp", async (req, res) => {
    try {
      pruneExpired();
      const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
      const captchaId = typeof req.body?.captchaId === "string" ? req.body.captchaId : "";
      const captchaText = typeof req.body?.captchaText === "string" ? req.body.captchaText : "";

      const email = normalizeEmail(emailRaw);

      if (!validateEmail(email)) {
        return res.status(400).json({ error: "请输入有效的邮箱地址" });
      }
      if (!captchaId || !captchaText.trim()) {
        return res.status(400).json({ error: "请完整填写图形验证码" });
      }

      const captchaRecord = captchaStore.get(captchaId);
      if (!captchaRecord || captchaRecord.expiresAt <= Date.now()) {
        captchaStore.delete(captchaId);
        return res.status(400).json({ error: "图形验证码已过期，请刷新后重试" });
      }

      if (captchaRecord.text.toUpperCase() !== captchaText.trim().toUpperCase()) {
        return res.status(400).json({ error: "图形验证码错误" });
      }

      captchaStore.delete(captchaId);

      const clientIp = getClientIp(req);
      if (!consumeRateLimit(emailRateLimitStore, email, EMAIL_RATE_LIMIT_MAX)) {
        return res.status(429).json({ error: "该邮箱请求过于频繁，请 10 分钟后再试" });
      }

      if (!consumeRateLimit(ipRateLimitStore, clientIp, IP_RATE_LIMIT_MAX)) {
        return res.status(429).json({ error: "请求过于频繁，请稍后再试" });
      }

      const otp = generateOtp();
      otpStore.set(email, {
        code: otp,
        expiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0,
      });

      await sendOtpMail(email, otp);

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Auth API] send-otp 失败:", error);
      const message = error instanceof Error ? error.message : "发送验证码失败，请稍后重试";
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/auth/verify-otp", async (req, res) => {
    try {
      pruneExpired();
      const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
      const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
      const email = normalizeEmail(emailRaw);

      if (!validateEmail(email)) {
        return res.status(400).json({ error: "请输入有效的邮箱地址" });
      }

      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({ error: "请输入 6 位数字验证码" });
      }

      const record = otpStore.get(email);
      if (!record) {
        return res.status(400).json({ error: "请先发送验证码" });
      }

      if (record.expiresAt <= Date.now()) {
        otpStore.delete(email);
        return res.status(400).json({ error: "验证码已过期，请重新发送" });
      }

      if (record.attempts >= OTP_MAX_ATTEMPTS) {
        otpStore.delete(email);
        return res.status(429).json({ error: "验证失败次数过多，请重新发送验证码" });
      }

      record.attempts += 1;

      if (record.code !== otp) {
        const remaining = OTP_MAX_ATTEMPTS - record.attempts;
        if (remaining <= 0) {
          otpStore.delete(email);
          return res.status(429).json({ error: "验证失败次数过多，请重新发送验证码" });
        }
        return res.status(400).json({ error: `验证码错误，还可尝试 ${remaining} 次` });
      }

      otpStore.delete(email);

      const db = await getDb();
      const fallbackOpenId = createEmailOpenId(email);
      let openId = fallbackOpenId;
      let userId: number | null = null;
      let userName = email;

      if (db) {
        let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        if (!user) {
          const [insertResult] = await db
            .insert(users)
            .values({
              openId: fallbackOpenId,
              email,
              name: email.split("@")[0],
              loginMethod: "email_otp",
              role: "free",
            });
          [user] = await db.select().from(users).where(eq(users.id, insertResult.insertId)).limit(1);
        }

        await db
          .update(users)
          .set({
            lastSignedIn: new Date(),
            loginMethod: "email_otp",
          })
          .where(eq(users.id, user.id));

        openId = user.openId;
        userId = user.id;
        userName = user.name || userName;
      } else {
        console.warn("[Auth API] 数据库不可用，将使用临时会话模式");
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: userName,
        expiresInMs: SESSION_TTL_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, cookieOptions);

      if (userId != null) {
        await sessionDb.createSession({
          userId,
          openId,
          token: sessionToken,
          loginMethod: "email_otp",
          userAgent: req.headers["user-agent"] ?? null,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Auth API] verify-otp 失败:", error);
      return res.status(500).json({ error: "登录失败，请稍后重试" });
    }
  });

  app.post("/api/auth/signup", async (req, res) => {
    try {
      pruneExpired();
      const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
      const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
      const roleTag = normalizeRoleTag(req.body?.roleTag);
      const contactWechat = normalizeContact(req.body?.contactWechat);
      const contactPhone = normalizeContact(req.body?.contactPhone);
      const email = normalizeEmail(emailRaw);

      if (!validateEmail(email)) {
        return res.status(400).json({ error: "请输入有效的邮箱地址" });
      }
      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({ error: "请输入 6 位数字验证码" });
      }

      try {
        await consumeValidOtp(email, otp);
      } catch (error) {
        const message = error instanceof Error ? error.message : "验证码无效";
        return res.status(400).json({ error: message });
      }

      const db = await getDb();
      if (!db) {
        return res.status(500).json({ error: "Database not available" });
      }

      const fallbackOpenId = createEmailOpenId(email);
      let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        const [insertResult] = await db
          .insert(users)
          .values({
            openId: fallbackOpenId,
            email,
            name: email.split("@")[0],
            loginMethod: "email_otp",
            role: "free",
            credits: 0,
            roleTag: "normal",
            verifyStatus: "none",
          });
        [user] = await db.select().from(users).where(eq(users.id, insertResult.insertId)).limit(1);
      }

      const shouldSetPending = roleTag !== "normal" && hasAnyContact(contactWechat, contactPhone);
      const nextVerifyStatus: VerifyStatus =
        user.verifyStatus === "approved"
          ? "approved"
          : shouldSetPending
          ? "pending"
          : "none";

      await db
        .update(users)
        .set({
          loginMethod: "email_otp",
          lastSignedIn: new Date(),
          roleTag,
          contactWechat,
          contactPhone,
          verifyStatus: nextVerifyStatus,
        })
        .where(eq(users.id, user.id));

      const [hasSignupBonus] = await db
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.userId, user.id), eq(creditLedger.reason, "signup_bonus")))
        .limit(1);

      if (!hasSignupBonus) {
        await db
          .update(users)
          .set({ credits: sql`${users.credits} + ${SIGNUP_BONUS}` })
          .where(eq(users.id, user.id));

        await db.insert(creditLedger).values({
          userId: user.id,
          delta: SIGNUP_BONUS,
          reason: "signup_bonus",
        });
      }

      const [freshUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);

      const sessionToken = await sdk.createSessionToken(freshUser.openId, {
        name: freshUser.name || email,
        expiresInMs: SESSION_TTL_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, cookieOptions);

      await sessionDb.createSession({
        userId: freshUser.id,
        openId: freshUser.openId,
        token: sessionToken,
        loginMethod: "email_otp",
        userAgent: req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });

      return res.status(200).json({
        ok: true,
        credits: freshUser.credits,
        verifyStatus: freshUser.verifyStatus,
      });
    } catch (error) {
      console.error("[Auth API] signup 失败:", error);
      return res.status(500).json({ error: "注册失败，请稍后重试" });
    }
  });

  app.post("/api/verify/request", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });

      let user;
      try {
        user = await authenticateApiUser(req);
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const roleTag = normalizeRoleTag(req.body?.roleTag);
      const contactWechat = normalizeContact(req.body?.contactWechat);
      const contactPhone = normalizeContact(req.body?.contactPhone);

      if (roleTag === "normal") {
        await db
          .update(users)
          .set({
            roleTag,
            contactWechat,
            contactPhone,
            verifyStatus: "none",
          })
          .where(eq(users.id, user.id));
        return res.status(200).json({ ok: true, verifyStatus: "none" });
      }

      if (!hasAnyContact(contactWechat, contactPhone)) {
        return res.status(400).json({ error: "请至少填写微信或电话后再提交认证" });
      }

      await db
        .update(users)
        .set({
          roleTag,
          contactWechat,
          contactPhone,
          verifyStatus: "pending",
        })
        .where(eq(users.id, user.id));

      return res.status(200).json({ ok: true, verifyStatus: "pending" });
    } catch (error) {
      console.error("[Verify API] request 失败:", error);
      return res.status(500).json({ error: "提交认证失败，请稍后重试" });
    }
  });

  app.get("/api/me", async (req, res) => {
    try {
      let authedUser;
      try {
        authedUser = await authenticateApiUser(req);
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });
      const [user] = await db.select().from(users).where(eq(users.id, authedUser.id)).limit(1);
      if (!user) return res.status(404).json({ error: "User not found" });

      return res.status(200).json({
        id: user.id,
        email: user.email,
        role: user.role,
        credits: user.credits,
        verifyStatus: user.verifyStatus,
        roleTag: user.roleTag,
        contactWechat: user.contactWechat,
        contactPhone: user.contactPhone,
      });
    } catch (error) {
      console.error("[Auth API] me 失败:", error);
      return res.status(500).json({ error: "查询用户信息失败" });
    }
  });

  app.get("/api/admin/verifications", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });

      let user;
      try {
        user = await authenticateApiUser(req);
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (user.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const pendingUsers = await db
        .select({
          id: users.id,
          email: users.email,
          roleTag: users.roleTag,
          contactWechat: users.contactWechat,
          contactPhone: users.contactPhone,
          verifyStatus: users.verifyStatus,
          credits: users.credits,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.verifyStatus, "pending"));

      return res.status(200).json({ ok: true, items: pendingUsers });
    } catch (error) {
      console.error("[Admin Verify API] list 失败:", error);
      return res.status(500).json({ error: "获取待审核列表失败" });
    }
  });

  app.post("/api/admin/verifications/:userId/approve", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });

      let adminUser;
      try {
        adminUser = await authenticateApiUser(req);
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (adminUser.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: "Invalid userId" });
      }

      let approvedCredits = 0;
      let finalVerifyStatus: VerifyStatus = "approved";
      await db.transaction(async (tx) => {
        const [target] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!target) {
          throw new Error("USER_NOT_FOUND");
        }
        if (target.verifyStatus !== "pending") {
          throw new Error("INVALID_VERIFY_STATUS");
        }
        if (!hasAnyContact(target.contactWechat, target.contactPhone)) {
          throw new Error("MISSING_CONTACT");
        }

        const [bonusExists] = await tx
          .select({ id: creditLedger.id })
          .from(creditLedger)
          .where(and(eq(creditLedger.userId, target.id), eq(creditLedger.reason, "verified_bonus")))
          .limit(1);

        if (!bonusExists) {
          await tx
            .update(users)
            .set({
              credits: sql`${users.credits} + ${VERIFIED_BONUS}`,
              verifyStatus: "approved",
            })
            .where(eq(users.id, target.id));
          await tx.insert(creditLedger).values({
            userId: target.id,
            delta: VERIFIED_BONUS,
            reason: "verified_bonus",
          });
          approvedCredits = VERIFIED_BONUS;
        } else {
          await tx.update(users).set({ verifyStatus: "approved" }).where(eq(users.id, target.id));
          approvedCredits = 0;
        }
      });

      return res.status(200).json({
        ok: true,
        verifyStatus: finalVerifyStatus,
        bonusGranted: approvedCredits,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "USER_NOT_FOUND") return res.status(404).json({ error: "用户不存在" });
        if (error.message === "INVALID_VERIFY_STATUS") return res.status(400).json({ error: "仅可审核 pending 用户" });
        if (error.message === "MISSING_CONTACT") return res.status(400).json({ error: "缺少联系方式，不能通过认证" });
      }
      console.error("[Admin Verify API] approve 失败:", error);
      return res.status(500).json({ error: "审核通过失败" });
    }
  });

  app.post("/api/admin/verifications/:userId/reject", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database not available" });

      let adminUser;
      try {
        adminUser = await authenticateApiUser(req);
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (adminUser.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(400).json({ error: "Invalid userId" });
      }

      await db
        .update(users)
        .set({ verifyStatus: "rejected" })
        .where(eq(users.id, userId));

      return res.status(200).json({ ok: true, verifyStatus: "rejected" });
    } catch (error) {
      console.error("[Admin Verify API] reject 失败:", error);
      return res.status(500).json({ error: "审核拒绝失败" });
    }
  });
}
