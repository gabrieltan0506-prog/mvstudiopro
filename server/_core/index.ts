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
import { warnLegacyKlingEnvIgnored } from "../config/klingCn";
import { registerAuthApiRoutes } from "../routers/authApi";
import { registerSmsAuthRoutes } from "../routers/smsAuth";
import { registerSpeechApiRoutes } from "../routers/speechApi";
import { saveVideoShortLink } from "../services/video-short-links";
import { bootstrapGrowthTrendScheduler } from "../growth/trendScheduler";
import workflowJobsHandler from "../../api/jobs";
import blobPutImageHandler from "../../api/blob-put-image";
import exportHandler from "../../api/export";
import googleHandler from "../../api/google";
import klingImageHandler from "../../api/kling-image";

function isGrowthTrendSchedulerDisabled() {
  const raw = String(process.env.DISABLE_GROWTH_TREND_SCHEDULER || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isAllowedCorsOrigin(origin: string) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "mvstudiopro.com" || hostname === "www.mvstudiopro.com") {
      return true;
    }

    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return true;
    }

    return hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function applyApiCors(req: express.Request, res: express.Response) {
  const origin = String(req.headers.origin || "").trim();
  if (!isAllowedCorsOrigin(origin)) return false;

  res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    String(req.headers["access-control-request-headers"] || "Content-Type, Authorization, X-Requested-With"),
  );
  return true;
}

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

async function runAutoMigrations() {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;

    // 内测码系统表（幂等，IF NOT EXISTS 安全重跑）
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`beta_invite_codes\` (
        \`id\`         INT AUTO_INCREMENT PRIMARY KEY,
        \`code\`       VARCHAR(20) NOT NULL UNIQUE,
        \`credits\`    INT NOT NULL DEFAULT 200,
        \`max_uses\`   INT NOT NULL DEFAULT 1,
        \`used_count\` INT NOT NULL DEFAULT 0,
        \`created_by\` INT NOT NULL,
        \`note\`       VARCHAR(120),
        \`expires_at\` TIMESTAMP NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`beta_code_usages\` (
        \`id\`              INT AUTO_INCREMENT PRIMARY KEY,
        \`code_id\`         INT NOT NULL,
        \`user_id\`         INT NOT NULL,
        \`credits_awarded\` INT NOT NULL,
        \`redeemed_at\`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_code_user\` (\`code_id\`, \`user_id\`)
      )
    `);
    console.log("[AutoMigrate] beta_invite_codes & beta_code_usages: OK");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`user_feedback\` (
        \`id\`              INT AUTO_INCREMENT PRIMARY KEY,
        \`userId\`          INT NOT NULL,
        \`subject\`         VARCHAR(200) NOT NULL,
        \`message\`         TEXT NOT NULL,
        \`status\`          ENUM('pending','adopted','dismissed') NOT NULL DEFAULT 'pending',
        \`creditsAwarded\`  INT NULL,
        \`adoptedAt\`       TIMESTAMP NULL,
        \`adoptedBy\`        INT NULL,
        \`adminNote\`       VARCHAR(500) NULL,
        \`createdAt\`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("[AutoMigrate] user_feedback: OK");
  } catch (err) {
    console.warn("[AutoMigrate] skipped (non-fatal):", err instanceof Error ? err.message : err);
  }
}

async function startServer() {
  warnLegacyKlingEnvIgnored();
  void runAutoMigrations();

  const app = express();
  const server = createServer(app);
  // PDF generation via Cloud Run can take several minutes for large pages;
  // increase socket timeout well beyond Cloud Run's max 3600s to avoid premature drops.
  server.setTimeout(900_000); // 15 minutes
  server.keepAliveTimeout = 905_000;
  server.headersTimeout = 910_000;
  // Stripe webhook MUST be registered BEFORE express.json() for signature verification
  registerStripeWebhook(app);
  // Keep JSON/urlencoded limits aligned with larger creator uploads and long debug payloads.
  app.use(express.json({ limit: "650mb" }));
  app.use(express.urlencoded({ limit: "650mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // File upload
  app.use(uploadRouter);
  registerAuthApiRoutes(app);
  registerSmsAuthRoutes(app);
  registerSpeechApiRoutes(app);

  app.all("/api/blob-put-image", async (req, res) => {
    return blobPutImageHandler(req as any, res as any);
  });

  app.all("/api/export", async (req, res) => {
    return exportHandler(req as any, res as any);
  });

  app.all("/api/google", async (req, res) => {
    return googleHandler(req as any, res as any);
  });

  app.all("/api/kling-image", async (req, res) => {
    return klingImageHandler(req as any, res as any);
  });

  app.all("/api/jobs", async (req, res) => {
    const op = typeof req.query?.op === "string" ? req.query.op.trim() : "";
    if (op) {
      return workflowJobsHandler(req as any, res as any);
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

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

      const ctx = await createContext({ req: req as any, res: res as any } as any);
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
      return res.status(500).json({
        error: "Failed to create job",
        detail: error instanceof Error ? error.message : String(error),
      });
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

      const ctx = await createContext({ req: req as any, res: res as any } as any);
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

      const output = (job.output && typeof job.output === "object")
        ? { ...(job.output as Record<string, unknown>) }
        : undefined;

      if (job.status === "succeeded" && output) {
        const taskId = typeof output.taskId === "string" ? output.taskId.trim() : "";
        const videoUrl = typeof output.videoUrl === "string" ? output.videoUrl.trim() : "";
        if (taskId && videoUrl) {
          await saveVideoShortLink(taskId, videoUrl);
          output.shortUrl = `/api/v/${encodeURIComponent(taskId)}`;
        }
      }

      return res.status(200).json({
        status: job.status,
        output,
        error: job.error ?? undefined,
      });
    } catch (error) {
      console.error("[Jobs] GET /api/jobs/:id failed:", error);
      return res.status(500).json({
        error: "Failed to fetch job",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/diag/providers", async (req, res) => {
    try {
      let effectiveTier: "free" | "beta" | "paid" | "supervisor" | "unknown" = "unknown";
      try {
        const ctx = await createContext({ req: req as any, res: res as any } as any);
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

  // Keep Fly health checks on a cheap route that never falls through to SPA static handling.
  app.get("/api/health", (_req, res) => {
    res.status(200).type("text/plain").send("ok");
  });

  app.use("/api/trpc", (req, res, next) => {
    applyApiCors(req, res);
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  app.get("/api/getGrowthSystemStatus", async (req, res) => {
    applyApiCors(req, res);
    try {
      const caller = appRouter.createCaller({} as any);
      const result = await caller.mvAnalysis.getGrowthSystemStatus();
      res.status(200).json(result);
    } catch (error) {
      console.error("[Growth] GET /api/getGrowthSystemStatus failed:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch growth status",
      });
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
  const isDevelopment = process.env.NODE_ENV === "development";
  const port = isDevelopment ? await findAvailablePort(preferredPort) : preferredPort;

  if (isDevelopment && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const host = isDevelopment ? "127.0.0.1" : "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Defer background worker startup until the HTTP listener is ready.
    startJobWorker();
    if (isGrowthTrendSchedulerDisabled()) {
      console.warn("[growth.scheduler] disabled by DISABLE_GROWTH_TREND_SCHEDULER");
    } else {
      bootstrapGrowthTrendScheduler().catch((error) => {
        console.warn("[growth.scheduler] bootstrap failed:", error);
      });
    }
  });
}

startServer().catch(console.error);
