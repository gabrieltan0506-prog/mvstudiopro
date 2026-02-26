import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as crypto from "crypto";
import { emailOtps, users } from "../../drizzle/schema";
import { ONE_YEAR_MS } from "../../shared/const";
import { getDb } from "../db";
import { sdk } from "../_core/sdk";
import * as sessionDb from "../sessionDb";
import { sendTencentSesOtpEmail } from "../../api/tencentSes";

const OTP_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

export class EmailOtpAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getOtpSecret(): string {
  const secret = process.env.OTP_HASH_SECRET || process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new EmailOtpAuthError(500, "OTP secret not configured");
  }
  return secret;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashOtp(email: string, otp: string): string {
  return crypto
    .createHmac("sha256", getOtpSecret())
    .update(`${email}:${otp}`)
    .digest("hex");
}

function isOtpMatch(storedHash: string, candidateHash: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getUserByEmailOrOpenId(email: string) {
  const db = await getDb();
  if (!db) throw new EmailOtpAuthError(500, "Database not available");

  const openId = `email_${email}`;
  const [byOpenId] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  if (byOpenId) return byOpenId;

  const [byEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (byEmail) return byEmail;

  return null;
}

export async function requestEmailOtp(emailInput: string): Promise<{ expiresInSeconds: number }> {
  const db = await getDb();
  if (!db) throw new EmailOtpAuthError(500, "Database not available");

  const email = normalizeEmail(emailInput);
  const now = new Date();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailOtps)
    .where(and(eq(emailOtps.email, email), gte(emailOtps.createdAt, windowStart)));

  const sentCount = Number(countRow?.count ?? 0);
  if (sentCount >= RATE_LIMIT_MAX_REQUESTS) {
    throw new EmailOtpAuthError(429, "Too many OTP requests. Please try again later.");
  }

  const otp = generateOtpCode();
  const otpHash = hashOtp(email, otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await db
    .update(emailOtps)
    .set({ used: true, updatedAt: now })
    .where(and(eq(emailOtps.email, email), eq(emailOtps.used, false)));

  await db.insert(emailOtps).values({
    email,
    otpHash,
    expiresAt,
    used: false,
  });

  await sendTencentSesOtpEmail(email, otp, Math.floor(OTP_TTL_MS / 60_000));

  return { expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
}

export async function verifyEmailOtpAndCreateSession(params: {
  emailInput: string;
  otp: string;
  userAgent?: string | null;
}) {
  const { emailInput, otp, userAgent } = params;
  const db = await getDb();
  if (!db) throw new EmailOtpAuthError(500, "Database not available");

  const email = normalizeEmail(emailInput);
  const now = new Date();

  const [latestOtp] = await db
    .select()
    .from(emailOtps)
    .where(and(eq(emailOtps.email, email), eq(emailOtps.used, false)))
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);

  if (!latestOtp) {
    throw new EmailOtpAuthError(400, "OTP not found. Please request a new code.");
  }

  if (latestOtp.expiresAt.getTime() < Date.now()) {
    await db.update(emailOtps).set({ used: true, updatedAt: now }).where(eq(emailOtps.id, latestOtp.id));
    throw new EmailOtpAuthError(400, "OTP expired. Please request a new code.");
  }

  const candidateHash = hashOtp(email, otp);
  if (!isOtpMatch(latestOtp.otpHash, candidateHash)) {
    throw new EmailOtpAuthError(401, "Invalid OTP.");
  }

  await db.update(emailOtps).set({ used: true, updatedAt: now }).where(eq(emailOtps.id, latestOtp.id));

  const openId = `email_${email}`;
  let user = await getUserByEmailOrOpenId(email);

  if (!user) {
    const [inserted] = await db.insert(users).values({
      openId,
      email,
      name: email.split("@")[0] || "user",
      loginMethod: "email_otp",
      role: "user",
    });
    [user] = await db.select().from(users).where(eq(users.id, inserted.insertId)).limit(1);
  } else if (user.openId !== openId || user.loginMethod !== "email_otp" || user.email !== email) {
    await db
      .update(users)
      .set({
        openId,
        email,
        loginMethod: "email_otp",
      })
      .where(eq(users.id, user.id));
    [user] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  }

  if (!user) throw new EmailOtpAuthError(500, "Failed to load user");

  await db.update(users).set({ lastSignedIn: now }).where(eq(users.id, user.id));

  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || email.split("@")[0] || "user",
    expiresInMs: ONE_YEAR_MS,
  });

  await sessionDb.createSession({
    userId: user.id,
    openId: user.openId,
    token: sessionToken,
    loginMethod: "email_otp",
    userAgent: userAgent ?? null,
    expiresAt: new Date(Date.now() + ONE_YEAR_MS),
  });

  return {
    sessionToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}
