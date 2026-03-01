import { randomInt } from "crypto";
import type { VercelRequest } from "@vercel/node";

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

export const CAPTCHA_TTL_MS = 2 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const EMAIL_RATE_LIMIT_MAX = 3;
export const IP_RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const captchaStore = new Map<string, CaptchaRecord>();
export const otpStore = new Map<string, OtpRecord>();
export const emailRateLimitStore = new Map<string, RateLimitRecord>();
export const ipRateLimitStore = new Map<string, RateLimitRecord>();

export function pruneExpired() {
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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getClientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  }
  if (Array.isArray(xff) && xff[0]) {
    return xff[0].split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  }
  return req.socket.remoteAddress || "unknown";
}

export function consumeRateLimit(store: Map<string, RateLimitRecord>, key: string, max: number): boolean {
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

export function generateCaptchaText(): string {
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

export function generateCaptchaImage(text: string): string {
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

export function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}

export function readBody(req: VercelRequest): Record<string, unknown> {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (req.body as Record<string, unknown>) ?? {};
}
