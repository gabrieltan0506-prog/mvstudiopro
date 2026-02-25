import type { VercelRequest, VercelResponse } from "@vercel/node";
import cookieParser from "cookie-parser";
import express from "express";
import { SignJWT, jwtVerify } from "jose";
import { sendTencentSesTestEmail } from "./tencentSes.js";
type SessionPayload = {
  email: string;
  googleId: string;
};

const app = express();
const textEncoder = new TextEncoder();
const TEST_EMAIL_IDEMPOTENCY_WINDOW_MS = 60 * 1000;
const recentTestEmailSends = new Map<string, number>();

app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function signSession(payload: SessionPayload): Promise<string> {
  const jwtSecret = getRequiredEnv("JWT_SECRET");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(textEncoder.encode(jwtSecret));
}

async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const jwtSecret = getRequiredEnv("JWT_SECRET");
    const { payload } = await jwtVerify(token, textEncoder.encode(jwtSecret));

    if (typeof payload.email !== "string" || typeof payload.googleId !== "string") {
      return null;
    }

    return {
      email: payload.email,
      googleId: payload.googleId,
    };
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/api/diag/smoke", async (_req, res) => {
  const checks = {
    apiHandler: true,
    jobFunction: false,
    envLoaded: false,
  };

  try {
    checks.envLoaded = typeof process?.env === "object";
    // Validate internal wiring by confirming the job factory export is callable.
    const jobModule = await import("../server/jobs/repository.js");
    checks.jobFunction = typeof jobModule.createJob === "function";

    const status = checks.apiHandler && checks.jobFunction && checks.envLoaded ? "ok" : "error";
    return res.status(200).json({
      status,
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Smoke diagnostic failed", error);
    return res.status(200).json({
      status: "error",
      checks,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/api/auth/google/start", (_req, res) => {
  try {
    const appUrl = normalizeBaseUrl(getRequiredEnv("APP_URL"));
    const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
    const redirectUri = `${appUrl}/api/auth/google/callback`;

    const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    oauthUrl.searchParams.set("client_id", clientId);
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("scope", "openid email profile");
    oauthUrl.searchParams.set("access_type", "online");
    oauthUrl.searchParams.set("prompt", "consent");

    res.redirect(oauthUrl.toString());
  } catch (error) {
    console.error("Failed to start Google OAuth", error);
    res.status(500).json({ error: "OAuth is not configured" });
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (typeof code !== "string" || !code) {
      return res.status(400).json({ error: "Missing OAuth code" });
    }

    const appUrl = normalizeBaseUrl(getRequiredEnv("APP_URL"));
    const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
    const clientSecret = getRequiredEnv("GOOGLE_CLIENT_SECRET");
    const redirectUri = `${appUrl}/api/auth/google/callback`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      console.error("Google token exchange failed", tokenResponse.status, details);
      return res.status(502).json({ error: "Failed to exchange OAuth code" });
    }

    const tokenJson = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      return res.status(502).json({ error: "Missing access token" });
    }

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      const details = await userInfoResponse.text();
      console.error("Google userinfo failed", userInfoResponse.status, details);
      return res.status(502).json({ error: "Failed to load user profile" });
    }

    const userInfo = (await userInfoResponse.json()) as { sub?: string; email?: string };
    if (!userInfo.sub || !userInfo.email) {
      return res.status(502).json({ error: "Invalid user profile from Google" });
    }

    const sessionToken = await signSession({
      email: userInfo.email,
      googleId: userInfo.sub,
    });

    res.cookie("mvsp_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.redirect("/");
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return res.status(500).json({ error: "OAuth callback failed" });
  }
});

app.get("/api/me", async (req, res) => {
  const sessionToken = req.cookies?.mvsp_session;
  if (typeof sessionToken !== "string" || !sessionToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const session = await verifySession(sessionToken);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.status(200).json({ email: session.email, googleId: session.googleId });
});

app.get("/api/test-email", async (req, res) => {
  const { to } = req.query;
  if (typeof to !== "string" || !to.trim()) {
    return res.status(400).json({ error: "Query param 'to' is required" });
  }

  const normalizedTo = to.trim().toLowerCase();
  const now = Date.now();
  const lastSentAt = recentTestEmailSends.get(normalizedTo);
  if (typeof lastSentAt === "number" && now - lastSentAt < TEST_EMAIL_IDEMPOTENCY_WINDOW_MS) {
    return res.status(200).json({ success: true, to: to.trim() });
  }

  recentTestEmailSends.set(normalizedTo, now);
  try {
    await sendTencentSesTestEmail(to.trim());
    return res.status(200).json({ success: true, to: to.trim() });
  } catch (error) {
    recentTestEmailSends.delete(normalizedTo);
    console.error("Failed to send Tencent SES test email", error);
    return res.status(500).json({ error: "Failed to send test email" });
  }
});

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}
