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
import { saveVideoShortLink } from "../services/video-short-links";
import {
  DEFAULT_TRACK_SECONDS,
  consumeMusicGenerationCredit,
  isDownloadAllowedForMode,
} from "../music-membership";

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
  warnLegacyKlingEnvIgnored();

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
  registerAuthApiRoutes(app);

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
      const inputRecord = input as Record<string, any>;
      let inputToPersist: Record<string, any> = inputRecord;
      const provider =
        type === "audio"
          ? "suno"
          : type === "video"
          ? "kling-cn"
          : action === "nano_image"
          ? "nano"
          : "kling-cn";

      if (type === "audio" && action === "suno_music") {
        if (!ctx.user || !Number.isFinite(Number(ctx.user.id))) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const requestedSecondsRaw = inputRecord?.params?.requestedSeconds;
        const requestedSeconds =
          typeof requestedSecondsRaw === "number" && Number.isFinite(requestedSecondsRaw)
            ? requestedSecondsRaw
            : DEFAULT_TRACK_SECONDS;

        try {
          const billing = await consumeMusicGenerationCredit(Number(ctx.user.id), requestedSeconds);
          inputToPersist = {
            ...inputRecord,
            params: {
              ...(inputRecord.params ?? {}),
              __musicBillingMode: billing.mode,
              __musicDeducted: billing.deducted,
              __musicRequestedSeconds: requestedSeconds,
            },
          };
        } catch (musicError: any) {
          return res.status(403).json({
            error: musicError?.message || "Music credits exhausted",
          });
        }
      }

      const jobId = nanoid(16);
      await createJob({
        id: jobId,
        userId: resolvedUserId,
        type,
        provider,
        input: inputToPersist,
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

      const output = (job.output && typeof job.output === "object")
        ? { ...(job.output as Record<string, unknown>) }
        : undefined;
      const jobInput = (job.input && typeof job.input === "object")
        ? (job.input as Record<string, any>)
        : null;

      if (job.status === "succeeded" && output) {
        if (job.type === "audio" && jobInput?.action === "suno_music") {
          const modeFromOutput = typeof output.billingMode === "string" ? output.billingMode : undefined;
          const modeFromInput = typeof jobInput?.params?.__musicBillingMode === "string"
            ? jobInput.params.__musicBillingMode
            : undefined;
          const billingMode = modeFromOutput ?? modeFromInput ?? "free";
          const downloadAllowed = isDownloadAllowedForMode(billingMode);
          output.billingMode = billingMode;
          output.downloadAllowed = downloadAllowed;

          if (Array.isArray(output.songs)) {
            output.songs = output.songs.map((song) => {
              if (!song || typeof song !== "object") return song;
              return {
                ...(song as Record<string, unknown>),
                downloadAllowed,
              };
            });
          }
        }

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
