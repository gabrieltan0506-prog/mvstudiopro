import express from "express";
import cookieParser from "cookie-parser";
import { getProviderDiagnostics } from "../services/provider-diagnostics";
import { getTierProviderChain } from "../services/tier-provider-routing";
import { getSupervisorAllowlist } from "../services/access-policy";

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

export function createApp() {
  const app = express();

  app.use(cookieParser());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // health check
  app.get("/api/health", (_req, res) => {
    res.status(200).send("ok");
  });

  app.get("/api/diag/providers", async (_req, res) => {
    try {
      const diagnostics = await getProviderDiagnostics(8000);
      const routingMap = (diagnostics as any).routingMap ?? diagnostics.routing ?? buildRoutingMap();
      res.status(200).json({
        ...diagnostics,
        routingMap,
        supervisorAllowlist: getSupervisorAllowlist(true),
        effectiveTier: "unknown",
      });
    } catch (error) {
      console.error("[Diag] /api/diag/providers failed:", error);
      const routingMap = buildRoutingMap();
      res.status(200).json({
        status: "degraded",
        timestamp: new Date().toISOString(),
        providers: [],
        routing: routingMap,
        routingMap,
        supervisorAllowlist: getSupervisorAllowlist(true),
        effectiveTier: "unknown",
      });
    }
  });

  return app;
}
