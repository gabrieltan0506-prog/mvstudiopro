import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { nanoid } from "nanoid";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import uploadRouter from "../upload";
import { registerStripeWebhook } from "../stripe-webhook";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createJob, getJobById, type JobType } from "../jobs/repository";
import { startJobWorker } from "../jobs/runner";
import { getProviderDiagnostics, getProviderDiagnosticsFallback } from "../services/provider-diagnostics";
import { getTierProviderChain, resolveUserTier } from "../services/tier-provider-routing";
import { getSupervisorAllowlist } from "../services/access-policy";
import { requestEmailOtp, verifyEmailOtpAndCreateSession, EmailOtpAuthError } from "../services/email-otp-auth";
import { getSessionCookieOptions } from "./cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";

function buildRoutingMap() {
  return {
    free: {
      image: getTierProviderChain("free", "image"),
      video: getTierProviderChain("free", "video"),
      text: getTierProviderChain("free", "text"),
    },
    beta: {
      image: getTierProviderChain("beta", "image"),
      video: getTierProviderChain("beta", "video"),
      text: getTierProviderChain("beta", "text"),
    },
    paid: {
      image: getTierProviderChain("paid", "image"),
      video: getTierProviderChain("paid", "video"),
      text: getTierProviderChain("paid", "text"),
    },
    supervisor: {
      image: getTierProviderChain("supervisor", "image"),
      video: getTierProviderChain("supervisor", "video"),
      text: getTierProviderChain("supervisor", "text"),
    },
  };
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Stripe webhook MUST be registered BEFORE express.json() for signature verification
  registerStripeWebhook(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // File upload
  app.use(uploadRouter);

  app.post("/api/jobs", async (req, res) => {
    try {
      const { type, input, userId } = (req.body ?? {}) as {
        type?: JobType;
        input?: unknown;
        userId?: string;
      };

      if (type !== "video" && type !== "image" && type !== "audio") {
        return res.status(400).json({ error: "Invalid job type" });
      }
      if (!input || typeof input !== "object") {
        return res.status(400).json({ error: "input is required" });
      }

      const ctx = await createContext({ req: req as any, res: res as any });
      let resolvedUserId = "public";
      if (typeof userId === "string" && userId.trim()) {
        if (!ctx.user) {
          return res.status(401).json({ error: "Unauthorized" });
        }
        if (String(ctx.user.id) !== userId && ctx.user.openId !== userId) {
          return res.status(403).json({ error: "Forbidden" });
        }
        resolvedUserId = userId;
      } else if (ctx.user) {
        resolvedUserId = String(ctx.user.id ?? ctx.user.openId);
      }

      const action = typeof (input as any).action === "string" ? String((input as any).action) : "";
      const provider =
        type === "audio"
          ? "suno"
          : type === "video"
          ? "kling-cn"
          : action === "nano_image"
          ? "nano"
          : "kling-cn";

      const jobId = nanoid(16);
      await createJob({
        id: jobId,
        userId: resolvedUserId,
        type,
        provider,
        input,
      });

      return res.status(200).json({ jobId, status: "queued" });
    } catch (error) {
      console.error("[Jobs] POST /api/jobs failed:", error);
      return res.status(500).json({ error: "Failed to create job" });
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const jobId = req.params.id;
      if (!jobId) {
        return res.status(400).json({ error: "Job id is required" });
      }

      const job = await getJobById(jobId);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      const ctx = await createContext({ req: req as any, res: res as any });
      if (job.userId !== "public") {
        if (!ctx.user) {
          return res.status(401).json({ error: "Unauthorized" });
        }
        if (
          String(ctx.user.id) !== String(job.userId) &&
          ctx.user.openId !== String(job.userId)
        ) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      return res.status(200).json({
        status: job.status,
        output: job.output ?? undefined,
        error: job.error ?? undefined,
      });
    } catch (error) {
      console.error("[Jobs] GET /api/jobs/:id failed:", error);
      return res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  app.get("/api/diag/providers", async (req, res) => {
    try {
      let effectiveTier: "free" | "beta" | "paid" | "supervisor" | "unknown" = "unknown";
      try {
        const ctx = await createContext({ req: req as any, res: res as any });
        const rawUserId = ctx.user?.id;
        const userId = Number(rawUserId);
        if (rawUserId != null && Number.isFinite(userId)) {
          effectiveTier = await resolveUserTier(userId, ctx.user?.role === "admin");
        }
      } catch (tierError) {
        console.warn("[Diag] unable to resolve effectiveTier:", tierError);
      }
      const diagnostics = await getProviderDiagnostics(8000, effectiveTier);
      const routingMap = (diagnostics as any).routingMap ?? diagnostics.routing ?? buildRoutingMap();

      return res.status(200).json({
        ...diagnostics,
        routingMap,
        supervisorAllowlist: getSupervisorAllowlist(true),
        effectiveTier,
      });
    } catch (error) {
      console.error("[Diag] GET /api/diag/providers failed:", error);
      const routingMap = buildRoutingMap();
      return res.status(200).json({
        ...getProviderDiagnosticsFallback("unknown"),
        routing: routingMap,
        routingMap,
        supervisorAllowlist: getSupervisorAllowlist(true),
        effectiveTier: "unknown",
      });
    }
  });

  app.get("/api/me", async (req, res) => {
    try {
      const ctx = await createContext({ req: req as any, res: res as any });
      if (!ctx.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      return res.status(200).json({
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        role: ctx.user.role,
        openId: ctx.user.openId,
      });
    } catch (error) {
      console.error("[Auth] GET /api/me failed:", error);
      return res.status(401).json({ message: "Unauthorized" });
    }
  });

  app.post("/api/auth/email/request-otp", async (req, res) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Invalid email" });
      }

      const result = await requestEmailOtp(email);
      return res.status(200).json({
        success: true,
        expiresIn: result.expiresInSeconds,
      });
    } catch (error) {
      if (error instanceof EmailOtpAuthError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("[Auth] POST /api/auth/email/request-otp failed:", error);
      return res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/api/auth/email/verify-otp", async (req, res) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
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

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      return res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      if (error instanceof EmailOtpAuthError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("[Auth] POST /api/auth/email/verify-otp failed:", error);
      return res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  startJobWorker();

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
