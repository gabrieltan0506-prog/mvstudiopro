import express from "express";
import cookieParser from "cookie-parser";
import { createContext } from "./context";
import { getProviderDiagnostics, getProviderDiagnosticsFallback } from "../services/provider-diagnostics";
import { getSupervisorAllowlist } from "../services/access-policy";
import { resolveUserTier, type UserTier } from "../services/tier-provider-routing";
import { registerAuthApiRoutes } from "../routers/authApi";
import { registerSmsAuthRoutes } from "../routers/smsAuth";
import { registerSpeechApiRoutes } from "../routers/speechApi";

export function createApp() {
  if (!process.env.JWT_SECRET) {
    console.error("⚠️  [STARTUP] JWT_SECRET 未设置！Email OTP 登录将无法签发 session token。请运行: flyctl secrets set JWT_SECRET=<随机长字符串>");
  }

  const app = express();

  app.use(cookieParser());
  app.use(express.json({ limit: "650mb" }));
  app.use(express.urlencoded({ extended: true, limit: "650mb" }));
  registerAuthApiRoutes(app);
  registerSmsAuthRoutes(app);
  registerSpeechApiRoutes(app);

  // health check
  app.get("/api/health", (_req, res) => {
    res.status(200).send("ok");
  });

  app.get("/api/diag/providers", async (req, res) => {
    let effectiveTier: UserTier | "unknown" = "unknown";
    try {
      const ctx = await createContext({ req: req as any, res: res as any } as any);
      if (ctx.user?.id) {
        effectiveTier = await resolveUserTier(ctx.user.id, ctx.user.role === "admin");
      }
      const diagnostics = await getProviderDiagnostics(8000, effectiveTier);
      res.status(200).json({
        ...diagnostics,
        supervisorAllowlist: getSupervisorAllowlist(true),
      });
    } catch (error) {
      console.error("[Diag] /api/diag/providers failed:", error);
      res.status(200).json({
        ...getProviderDiagnosticsFallback(effectiveTier),
        supervisorAllowlist: getSupervisorAllowlist(true),
      });
    }
  });

  return app;
}
