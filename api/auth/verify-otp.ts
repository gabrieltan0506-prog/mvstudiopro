import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { serialize } from "cookie";
import { users } from "../../drizzle/schema";
import { getSessionCookieOptions } from "../../server/_core/cookies";
import { sdk } from "../../server/_core/sdk";
import { getDb } from "../../server/db";
import * as sessionDb from "../../server/sessionDb";
import { COOKIE_NAME } from "../../shared/const";
import {
  OTP_MAX_ATTEMPTS,
  normalizeEmail,
  otpStore,
  pruneExpired,
  readBody,
  validateEmail,
} from "./_state";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function createEmailOpenId(email: string): string {
  const digest = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return `emailotp_${digest}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    pruneExpired();
    const body = readBody(req);

    const emailRaw = typeof body.email === "string" ? body.email : "";
    const otp = typeof body.otp === "string" ? body.otp.trim() : "";
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

    const cookieOptions = getSessionCookieOptions(req as any);
    const cookie = serialize(COOKIE_NAME, sessionToken, {
      ...cookieOptions,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    res.setHeader("Set-Cookie", cookie);

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
}
