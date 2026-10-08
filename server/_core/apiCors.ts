import type express from "express";

export function isAllowedCorsOrigin(origin: string) {
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

    if (hostname.endsWith(".vercel.app")) {
      return true;
    }

    if (hostname.endsWith(".fly.dev")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function applyApiCors(req: express.Request, res: express.Response) {
  const origin = String(req.headers.origin || "").trim();
  if (!isAllowedCorsOrigin(origin)) return false;

  res.header("Access-Control-Allow-Origin", origin);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", /^\/(?:api\/)?file-conversion\/upload\/[a-f0-9-]{36}$/.test(req.path) ? "PUT,OPTIONS" : req.path === "/gcs-transfer" || req.path === "/api/gcs-transfer" ? "GET,PUT,HEAD,OPTIONS" : "GET,POST,OPTIONS");
  res.header("Access-Control-Max-Age", "86400");
  res.header(
    "Access-Control-Allow-Headers",
    String(req.headers["access-control-request-headers"] || "Content-Type, Authorization, X-Requested-With"),
  );
  return true;
}

export const apiCorsMiddleware: express.RequestHandler = (req, res, next) => {
    // Fly 的全局 OPTIONS 会在 jobs handler 前结束；公开世界素材要单独响应
    // sandbox iframe 的 Origin:null 预检，不改变其余鉴权 API 的来源规则。
    if (req.method === "OPTIONS" && req.path === "/jobs" && String(req.query.op || "").toLowerCase() === "manhuabridgemedia") {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Range");
      res.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
      return res.status(204).end();
    }
    applyApiCors(req, res);
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
};
