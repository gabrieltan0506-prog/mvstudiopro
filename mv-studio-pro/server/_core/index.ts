import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerStripeWebhook } from "../stripe-webhook";
import { generalApiLimit, authLimit } from "../rate-limit";
import { cleanupExpiredSessions } from "../sessionDb";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
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

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Stripe Webhook 必须在 express.json() 之前注册，使用 raw body
  registerStripeWebhook(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Rate Limiting
  app.use("/api/trpc", generalApiLimit);
  app.use("/auth", authLimit);

  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Stripe Customer Portal — 让用户自助管理订阅
  app.post("/api/stripe/portal", async (req, res) => {
    try {
      const { getStripe } = await import("../stripe");
      const stripe = getStripe();
      if (!stripe) {
        res.status(400).json({ error: "Stripe not configured" });
        return;
      }

      const { stripeCustomerId, returnUrl } = req.body;
      if (!stripeCustomerId) {
        res.status(400).json({ error: "Missing stripeCustomerId" });
        return;
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl || process.env.FRONTEND_URL || "http://localhost:8081",
      });

      // 审计日志
      const { writeAuditLog } = await import("../audit");
      await writeAuditLog({
        eventType: "portal.session.created",
        stripeCustomerId,
        action: "portal_open",
        metadata: { returnUrl },
        ipAddress: req.ip || req.socket.remoteAddress || null,
      });

      res.json({ url: portalSession.url });
    } catch (err: any) {
      console.error("[Stripe Portal] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);

    // Cleanup expired sessions every hour
    setInterval(async () => {
      try {
        await cleanupExpiredSessions();
      } catch (err) {
        console.error("[SessionCleanup] Error:", err);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Also run cleanup on startup (after a short delay to let DB connect)
    setTimeout(() => cleanupExpiredSessions().catch(() => {}), 5000);
  });
}

startServer().catch(console.error);
