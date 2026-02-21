import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import { getUserByOpenId, upsertUser } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import * as sessionDb from "../sessionDb";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

async function syncUser(userInfo: {
  openId?: string | null;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  platform?: string | null;
}) {
  if (!userInfo.openId) {
    throw new Error("openId missing from user info");
  }

  const lastSignedIn = new Date();
  await upsertUser({
    openId: userInfo.openId,
    name: userInfo.name || null,
    email: userInfo.email ?? null,
    loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
    lastSignedIn,
  });
  const saved = await getUserByOpenId(userInfo.openId);
  return (
    saved ?? {
      openId: userInfo.openId,
      name: userInfo.name,
      email: userInfo.email,
      loginMethod: userInfo.loginMethod ?? null,
      lastSignedIn,
    }
  );
}

function buildUserResponse(
  user:
    | Awaited<ReturnType<typeof getUserByOpenId>>
    | {
        openId: string;
        name?: string | null;
        email?: string | null;
        loginMethod?: string | null;
        lastSignedIn?: Date | null;
      },
) {
  return {
    id: (user as any)?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? null,
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
    role: (user as any)?.role ?? null,
  };
}

/**
 * Determine the frontend URL to redirect to after OAuth callback.
 *
 * In production, the OAuth callback hits the Manus sandbox API URL
 * (because the Manus Portal only whitelists sandbox domains).
 * After processing, we redirect the user to the actual frontend
 * (FRONTEND_URL = https://mvstudiopro.com or https://www.mvstudiopro.com).
 *
 * Priority:
 * 1. FRONTEND_URL env var (set in Vercel: https://mvstudiopro.com)
 * 2. Derive from request Host header
 * 3. Fallback to localhost
 */
function getFrontendUrl(req: Request): string {
  // 1. Use FRONTEND_URL if set (this is the production custom domain)
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, '');
  }

  // 2. Derive from request headers
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) {
    const hostStr = typeof host === 'string' ? host : host[0];
    // In development sandbox: API is on 3000-xxx, frontend is on 8081-xxx
    if (hostStr.startsWith('3000-')) {
      const webHost = hostStr.replace(/^3000-/, '8081-');
      return `${proto}://${webHost}`;
    }
    return `${proto}://${hostStr}`;
  }

  // 3. Fallback
  return process.env.EXPO_WEB_PREVIEW_URL ||
    process.env.EXPO_PACKAGER_PROXY_URL ||
    "http://localhost:8081";
}

export function registerOAuthRoutes(app: Express) {
  /**
   * GET /api/oauth/start
   * 
   * Generates the OAuth login URL dynamically at runtime.
   * This solves the stale sandbox URL problem: the frontend no longer
   * hardcodes the sandbox URL at build time. Instead, the backend
   * generates the redirect_uri using its current runtime environment.
   */
  app.get("/api/oauth/start", (req: Request, res: Response) => {
    try {
      const appId = process.env.VITE_APP_ID || "";
      const portalUrl = process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL || "https://manus.im";

      // Determine the API base URL for redirect_uri
      // Priority: EXPO_PUBLIC_API_BASE_URL (runtime env) > derive from request
      let apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || "";
      
      if (!apiBaseUrl) {
        // Derive from request headers
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (host) {
          const hostStr = typeof host === 'string' ? host : host[0];
          apiBaseUrl = `${proto}://${hostStr}`;
        }
      }

      // Remove trailing slash
      apiBaseUrl = apiBaseUrl.replace(/\/$/, '');

      const redirectUri = `${apiBaseUrl}/api/oauth/callback`;
      const state = Buffer.from(redirectUri).toString('base64');

      const url = new URL(`${portalUrl}/app-auth`);
      url.searchParams.set('appId', appId);
      url.searchParams.set('redirectUri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('type', 'signIn');

      const loginUrl = url.toString();
      console.log(`[OAuth] /api/oauth/start -> redirectUri: ${redirectUri}`);
      console.log(`[OAuth] /api/oauth/start -> loginUrl: ${loginUrl}`);

      res.json({ loginUrl, redirectUri });
    } catch (error) {
      console.error('[OAuth] /api/oauth/start failed:', error);
      res.status(500).json({ error: 'Failed to generate OAuth URL' });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      await syncUser(userInfo);
      const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Get user from database
      const user = await getUserByOpenId(userInfo.openId!);
      const userResponse = buildUserResponse(user || userInfo);

      // Persist session to database
      await sessionDb.createSession({
        userId: user?.id ?? 0,
        openId: userInfo.openId!,
        token: sessionToken,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? "oauth",
        userAgent: req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + ONE_YEAR_MS),
      });

      // Get the frontend URL (custom domain like mvstudiopro.com)
      const frontendUrl = getFrontendUrl(req);
      
      // Encode user info as base64
      const userBase64 = Buffer.from(JSON.stringify(userResponse)).toString("base64");
      
      // Redirect to the FRONTEND URL's /oauth/callback with session token and user info
      // This is the key: even though the OAuth callback came to the sandbox API URL,
      // we redirect the user to the actual custom domain
      const redirectUrl = `${frontendUrl}/oauth/callback?sessionToken=${encodeURIComponent(sessionToken)}&user=${encodeURIComponent(userBase64)}`;
      
      console.log(`[OAuth] Redirecting to frontend: ${frontendUrl}/oauth/callback`);
      res.redirect(302, redirectUrl);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      
      // On error, still try to redirect to frontend with error info
      try {
        const frontendUrl = getFrontendUrl(req);
        res.redirect(302, `${frontendUrl}/login?error=oauth_failed`);
      } catch {
        res.status(500).json({ error: "OAuth callback failed" });
      }
    }
  });

  app.get("/api/oauth/mobile", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      const user = await syncUser(userInfo);

      const sessionToken = await sdk.createSessionToken(userInfo.openId!, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Persist session to database
      const savedUser = await getUserByOpenId(userInfo.openId!);
      await sessionDb.createSession({
        userId: savedUser?.id ?? 0,
        openId: userInfo.openId!,
        token: sessionToken,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? "oauth",
        userAgent: req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + ONE_YEAR_MS),
      });

      res.json({
        app_session_id: sessionToken,
        user: buildUserResponse(user),
      });
    } catch (error) {
      console.error("[OAuth] Mobile exchange failed", error);
      res.status(500).json({ error: "OAuth mobile exchange failed" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    // Delete session from database
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token: string | undefined;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice("Bearer ".length).trim();
    }
    const cookies = req.headers.cookie
      ? Object.fromEntries(req.headers.cookie.split("; ").map(c => c.split("=").map(s => s.trim())))
      : {};
    const sessionToken = token || cookies[COOKIE_NAME];
    if (sessionToken) {
      await sessionDb.deleteSessionByToken(sessionToken);
    }

    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });

  // Get current authenticated user - works with both cookie (web) and Bearer token (mobile)
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/me failed:", error);
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  // Establish session cookie from Bearer token
  // Used by iframe preview: frontend receives token via postMessage, then calls this endpoint
  // to get a proper Set-Cookie response from the backend (3000-xxx domain)
  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      // Authenticate using Bearer token from Authorization header
      const user = await sdk.authenticateRequest(req);

      // Get the token from the Authorization header to set as cookie
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();

      // Set cookie for this domain (3000-xxx)
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, user: buildUserResponse(user) });
    } catch (error) {
      console.error("[Auth] /api/auth/session failed:", error);
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
