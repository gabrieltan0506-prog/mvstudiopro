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
      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "userId is required" });
      }
      if (!input || typeof input !== "object") {
        return res.status(400).json({ error: "input is required" });
      }

      const ctx = await createContext({ req: req as any, res: res as any });
      if (ctx.user && String(ctx.user.id) !== userId && ctx.user.openId !== userId) {
        return res.status(403).json({ error: "Forbidden" });
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
        userId,
        type,
        provider,
        input,
      });

      return res.status(200).json({ jobId });
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
      if (
        ctx.user &&
        String(ctx.user.id) !== String(job.userId) &&
        ctx.user.openId !== String(job.userId)
      ) {
        return res.status(403).json({ error: "Forbidden" });
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
