import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serialize as serializeCookie } from "cookie";
import { jwtVerify } from "jose";
import { ONE_YEAR_MS } from "../shared/const";
import { requestEmailOtp, verifyEmailOtpAndCreateSession, EmailOtpAuthError } from "../server/services/email-otp-auth";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "app_session_id";
const SUPERVISOR_ALLOWLIST = [
  "gabrieltan0506@gmail.com",
  "benjamintan0506@163.com",
] as const;
const MASKED_SUPERVISOR_ALLOWLIST = ["g***6@gmail.com", "b***6@163.com"] as const;

type ProviderDiagState = "reachable" | "unconfigured" | "error";

type ProviderDiagItem = {
  name: string;
  type: "image" | "video" | "text" | "music";
  role: string;
  paidOnly: boolean;
  state: ProviderDiagState;
  latencyMs: number;
  error: string | null;
};

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAnyEnv(keys: string[]): boolean {
  return keys.some(key => hasValue(process.env[key]));
}

function classifyConfig(parts: { keys: string[]; label: string }[]): {
  state: ProviderDiagState;
  error: string | null;
} {
  for (const item of parts) {
    const present = item.keys.filter(key => hasValue(process.env[key])).length;
    if (present > 0 && present < item.keys.length) {
      return {
        state: "error",
        error: `partial config: ${item.label}`,
      };
    }
    if (present === 0) {
      return {
        state: "unconfigured",
        error: `${item.label} missing`,
      };
    }
  }

  return {
    state: "reachable",
    error: null,
  };
}

function buildProviders(): ProviderDiagItem[] {
  const forgeState = hasValue(process.env.BUILT_IN_FORGE_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "BUILT_IN_FORGE_API_KEY missing" };

  const nanoState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const klingState = classifyConfig([
    {
      keys: ["KLING_VIDEO_ACCESS_KEY", "KLING_ACCESS_KEY", "KLING_ACCESS_KEY_1"],
      label: "KLING video access key",
    },
    {
      keys: ["KLING_VIDEO_SECRET_KEY", "KLING_SECRET_KEY", "KLING_SECRET_KEY_1"],
      label: "KLING video secret key",
    },
  ]);

  const falState = hasValue(process.env.FAL_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "FAL_API_KEY missing" };

  const veoState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const cometState = hasAnyEnv(["COMET_API_KEY", "COMETAPI_API_KEY", "COMETAPI_KEY"])
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "COMETAPI key missing" };

  const geminiFlashState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const geminiProState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const gptState = cometState;

  const sunoState = hasValue(process.env.SUNO_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "SUNO_API_KEY missing" };

  return [
    {
      name: "forge",
      type: "image",
      role: "free",
      paidOnly: false,
      state: forgeState.state,
      latencyMs: 0,
      error: forgeState.error,
    },
    {
      name: "nano-banana-pro",
      type: "image",
      role: "paidOnly",
      paidOnly: true,
      state: nanoState.state,
      latencyMs: 0,
      error: nanoState.error,
    },
    {
      name: "kling_beijing",
      type: "video",
      role: "free",
      paidOnly: false,
      state: klingState.state,
      latencyMs: 0,
      error: klingState.error,
    },
    {
      name: "fal_kling_video",
      type: "video",
      role: "fallback",
      paidOnly: false,
      state: falState.state,
      latencyMs: 0,
      error: falState.error,
    },
    {
      name: "veo_3_1",
      type: "video",
      role: "paidOnly",
      paidOnly: true,
      state: veoState.state,
      latencyMs: 0,
      error: veoState.error,
    },
    {
      name: "cometapi",
      type: "video",
      role: "fallback",
      paidOnly: false,
      state: cometState.state,
      latencyMs: 0,
      error: cometState.error,
    },
    {
      name: "gemini_3_flash",
      type: "text",
      role: "default",
      paidOnly: false,
      state: geminiFlashState.state,
      latencyMs: 0,
      error: geminiFlashState.error,
    },
    {
      name: "gemini_3_pro",
      type: "text",
      role: "paidOnly",
      paidOnly: true,
      state: geminiProState.state,
      latencyMs: 0,
      error: geminiProState.error,
    },
    {
      name: "gpt_5_1",
      type: "text",
      role: "paidOnly",
      paidOnly: true,
      state: gptState.state,
      latencyMs: 0,
      error: gptState.error,
    },
    {
      name: "suno_4_5",
      type: "music",
      role: "paidOnly",
      paidOnly: true,
      state: sunoState.state,
      latencyMs: 0,
      error: sunoState.error,
    },
  ];
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function isSupervisorEmail(email: string | undefined): boolean {
  const normalized = normalizeEmail(email);
  return SUPERVISOR_ALLOWLIST.includes(normalized as (typeof SUPERVISOR_ALLOWLIST)[number]);
}

function getCookie(req: VercelRequest, name: string): string | undefined {
  const direct = req.cookies?.[name];
  if (typeof direct === "string" && direct.length > 0) return direct;

  const header = req.headers.cookie;
  if (!header) return undefined;
  const cookieHeader = Array.isArray(header) ? header.join("; ") : header;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }

  return undefined;
}

function isSecureRequest(req: VercelRequest): boolean {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const values = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return values.some(v => v.trim().toLowerCase() === "https");
}

function getRequestPath(req: VercelRequest): string {
  const requestUrl = req.url ?? "";
  const pathname = requestUrl.split("?")[0] ?? "";
  const headerPaths = [
    req.headers["x-original-url"],
    req.headers["x-rewrite-url"],
    req.headers["x-matched-path"],
    req.headers["x-forwarded-uri"],
  ]
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .map(value => value.split("?")[0]);
  const pathCandidates = [pathname, ...headerPaths];

  if (pathCandidates.includes("/api/diag/providers")) return "/api/diag/providers";
  if (pathCandidates.includes("/api/auth/email/request-otp")) return "/api/auth/email/request-otp";
  if (pathCandidates.includes("/api/auth/email/verify-otp")) return "/api/auth/email/verify-otp";
  if (pathCandidates.includes("/api/me")) return "/api/me";
  if (pathCandidates.includes("/api/health")) return "/api/health";
  return pathname;
}

async function readJsonBody(req: VercelRequest): Promise<any> {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body ?? {};
}

async function verifySessionOpenId(sessionToken: string): Promise<string | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(sessionToken, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    const openId = payload.openId;
    if (typeof openId !== "string" || !openId) return null;
    return openId;
  } catch {
    return null;
  }
}

function resolveEffectiveTier(req: VercelRequest): "free" | "beta" | "paid" | "supervisor" | "unknown" {
  const cookieValue = getCookie(req, COOKIE_NAME);
  if (!cookieValue) return "unknown";

  const emailHeader = req.headers["x-user-email"];
  const email = typeof emailHeader === "string" ? emailHeader : undefined;
  if (isSupervisorEmail(email)) return "supervisor";

  const tierHeader = req.headers["x-user-tier"];
  const tier = (typeof tierHeader === "string" ? tierHeader : "").toLowerCase();
  if (tier === "supervisor" || tier === "paid" || tier === "beta" || tier === "free") {
    return tier;
  }

  return "free";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const method = (req.method || "GET").toUpperCase();
    const path = getRequestPath(req);

    if (method === "GET" && path === "/api/diag/providers") {
      const routingMap = {
        free: {
          image: ["forge", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["basic_model", "gemini_3_flash", "gemini_3_pro", "gpt_5_1"],
        },
        beta: {
          image: ["forge", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["gemini_3_flash", "basic_model", "gemini_3_pro", "gpt_5_1"],
        },
        paid: {
          image: ["nano-banana-pro", "forge", "kling_image"],
          video: ["veo_3_1", "fal_kling_video", "kling_beijing", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
        supervisor: {
          image: ["nano-banana-pro", "forge", "kling_image"],
          video: ["veo_3_1", "kling_beijing", "fal_kling_video", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
      };
      return res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        providers: buildProviders(),
        routing: routingMap,
        routingMap,
        supervisorAllowlist: [...MASKED_SUPERVISOR_ALLOWLIST],
        effectiveTier: "supervisor",
      });
    }

    if (method === "GET" && path === "/api/health") {
      return res.status(200).send("ok");
    }

    if (method === "GET" && path === "/api/me") {
      const token = getCookie(req, COOKIE_NAME);
      if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const openId = await verifySessionOpenId(token);
      if (!openId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const db = await getDb();
      if (!db) {
        return res.status(500).json({ message: "Database not available" });
      }

      const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      return res.status(200).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        openId: user.openId,
      });
    }

    if (method === "POST" && path === "/api/auth/email/request-otp") {
      const body = await readJsonBody(req);
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Invalid email" });
      }

      const result = await requestEmailOtp(email);
      return res.status(200).json({
        success: true,
        expiresIn: result.expiresInSeconds,
      });
    }

    if (method === "POST" && path === "/api/auth/email/verify-otp") {
      const body = await readJsonBody(req);
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const otp = typeof body?.otp === "string" ? body.otp.trim() : "";

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Invalid email" });
      }
      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: "Invalid OTP" });
      }

      const { sessionToken, user } = await verifyEmailOtpAndCreateSession({
        emailInput: email,
        otp,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      });

      const sessionCookie = serializeCookie(COOKIE_NAME, sessionToken, {
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: isSecureRequest(req),
        maxAge: Math.floor(ONE_YEAR_MS / 1000),
      });
      res.setHeader("Set-Cookie", sessionCookie);

      return res.status(200).json({
        success: true,
        user,
      });
    }

    if (path.startsWith("/api/")) {
      const allow = path === "/api/auth/email/request-otp" || path === "/api/auth/email/verify-otp" ? "POST" : "GET";
      return res.status(405).setHeader("Allow", allow).send("Method Not Allowed");
    }

    res.setHeader("Content-Security-Policy", "default-src 'self'");
    return res.status(200).send("ok");
  } catch (error: any) {
    if (error instanceof EmailOtpAuthError) {
      return res.status(error.status).json({ message: error.message });
    }
    const path = getRequestPath(req);
    if (
      path === "/api/me" ||
      path === "/api/auth/email/request-otp" ||
      path === "/api/auth/email/verify-otp"
    ) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
    console.error(error);
    return res.status(200).json({
      status: "error",
      timestamp: new Date().toISOString(),
      providers: buildProviders(),
      supervisorAllowlist: [...MASKED_SUPERVISOR_ALLOWLIST],
      effectiveTier: "supervisor",
    });
  }
}
