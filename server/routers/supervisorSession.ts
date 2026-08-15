import type { Express } from "express";
import { createContext } from "../_core/context";
import { isValidSupervisorSecret } from "../services/access-policy";
import {
  createSupervisorSessionToken,
  getSupervisorSessionCookieOptions,
  SUPERVISOR_SESSION_COOKIE_NAME,
  SUPERVISOR_SESSION_TTL_MS,
} from "../services/supervisor-session";

export function registerSupervisorSessionRoutes(app: Express) {
  app.post("/api/supervisor-session", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    const ctx = await createContext({ req: req as never, res: res as never } as never);
    if (!ctx.user) {
      return res.status(ctx.authUnavailable ? 503 : 401).json({ error: "请先登录" });
    }
    const secret = typeof req.body?.secret === "string" ? req.body.secret.trim() : "";
    if (!isValidSupervisorSecret(secret)) {
      return res.status(403).json({ error: "监管密钥无效" });
    }
    const issued = createSupervisorSessionToken(ctx.user.id);
    res.cookie(SUPERVISOR_SESSION_COOKIE_NAME, issued.token, {
      ...getSupervisorSessionCookieOptions(req),
      maxAge: SUPERVISOR_SESSION_TTL_MS,
    });
    return res.status(200).json({ ok: true, expiresAt: issued.session.expiresAt });
  });

  app.delete("/api/supervisor-session", (req, res) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.clearCookie(SUPERVISOR_SESSION_COOKIE_NAME, {
      ...getSupervisorSessionCookieOptions(req),
      maxAge: -1,
    });
    return res.status(200).json({ ok: true });
  });
}
