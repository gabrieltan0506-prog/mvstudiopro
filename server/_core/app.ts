import express from "express";
import cookieParser from "cookie-parser";
import { getProviderDiagnostics } from "../services/provider-diagnostics";

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
      res.status(200).json(diagnostics);
    } catch (error) {
      console.error("[Diag] /api/diag/providers failed:", error);
      res.status(500).json({
        status: "error",
        timestamp: new Date().toISOString(),
        providers: [],
      });
    }
  });

  return app;
}
