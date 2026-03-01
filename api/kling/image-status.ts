import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function buildJwt(ak: string, sk: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })).toString("base64url");
  const msg = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", sk).update(msg).digest("base64url");
  return `${msg}.${sig}`;
}

function getRouteBaseUrl(route: string) {
  const beijing = process.env.KLING_ROUTE_BEIJING_BASE_URL || process.env.KLING_CN_BASE_URL || "https://api-beijing.klingai.com";
  const singapore = process.env.KLING_ROUTE_SINGAPORE_BASE_URL || "https://api-singapore.klingai.com";
  if (route === "beijing") return beijing;
  if (route === "singapore") return singapore;
  return beijing;
}

function getKeys(route: string) {
  const ak =
    (route === "singapore" ? process.env.KLING_SG_IMAGE_ACCESS_KEY : undefined) ||
    process.env.KLING_CN_IMAGE_ACCESS_KEY ||
    process.env.KLING_CN_VIDEO_ACCESS_KEY ||
    "";
  const sk =
    (route === "singapore" ? process.env.KLING_SG_IMAGE_SECRET_KEY : undefined) ||
    process.env.KLING_CN_IMAGE_SECRET_KEY ||
    process.env.KLING_CN_VIDEO_SECRET_KEY ||
    "";
  if (!ak || !sk) throw new Error("Missing env: KLING_CN_IMAGE_ACCESS_KEY / KLING_CN_IMAGE_SECRET_KEY");
  return { ak, sk };
}

function tryExtractImageUrl(raw: any): string | null {
  // 尽量兼容不同返回结构
  const candidates: any[] = [];

  const d = raw?.data;
  if (d) candidates.push(d);

  const arr = raw?.data?.task_result?.images || raw?.data?.images || raw?.data?.result?.images;
  if (Array.isArray(arr) && arr[0]) {
    const u = arr[0].url || arr[0].image_url || arr[0].imageUrl;
    if (u) return u;
  }

  // 深层扫描 url 字段
  function walk(x: any) {
    if (!x || typeof x !== "object") return;
    if (typeof x.url === "string" && (x.url.includes("http") || x.url.startsWith("data:"))) candidates.push(x.url);
    for (const k of Object.keys(x)) walk(x[k]);
  }
  walk(raw);

  for (const c of candidates) if (typeof c === "string") return c;
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "method_not_allowed" });

    const taskId = (req.query?.taskId || req.query?.task_id || "").toString().trim();
    if (!taskId) return json(res, 400, { ok: false, error: "missing_taskId" });

    const route = (req.query?.route || "beijing").toString();
    const routesToTry = route === "auto" ? ["singapore", "beijing"] : [route, route === "beijing" ? "singapore" : "beijing"];

    let lastErr: any = null;

    for (const rt of routesToTry) {
      const baseUrl = getRouteBaseUrl(rt);
      const { ak, sk } = getKeys(rt);
      const token = buildJwt(ak, sk);

      const r = await fetch(`${baseUrl}/v1/images/generations/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const text = await r.text();
      let raw: any = null;
      try { raw = JSON.parse(text); } catch {}

      if (!r.ok) {
        lastErr = { route: rt, status: r.status, raw: raw ?? text };
        continue;
      }

      const imageUrl = tryExtractImageUrl(raw);
      return json(res, 200, {
        ok: true,
        provider: "kling_image",
        routeUsed: rt,
        baseUrl,
        taskId,
        status: raw?.data?.task_status || raw?.data?.taskStatus || null,
        imageUrl,
        raw,
      });
    }

    return json(res, 502, { ok: false, error: "kling_status_failed", detail: lastErr });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: "server_error", detail: e?.message || String(e) });
  }
}
