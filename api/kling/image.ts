import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function buildJwt(ak: string, sk: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: ak,
      exp: now + 1800,
      nbf: now - 5,
    })
  ).toString("base64url");
  const msg = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", sk).update(msg).digest("base64url");
  return `${msg}.${sig}`;
}

function getRouteBaseUrl(route: string) {
  // UI 不出现 Global/CN，只用线路：beijing / singapore / auto
  const beijing = process.env.KLING_ROUTE_BEIJING_BASE_URL || process.env.KLING_CN_BASE_URL || "https://api-beijing.klingai.com";
  const singapore = process.env.KLING_ROUTE_SINGAPORE_BASE_URL || "https://api-singapore.klingai.com";
  if (route === "beijing") return beijing;
  if (route === "singapore") return singapore;
  return beijing; // auto 先用 beijing，前端会做测速后选路由；后端也会 fallback
}

function getKeys(route: string) {
  // 允许为 singapore 单独配置，否则复用 CN
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

async function callCreate(baseUrl: string, token: string, body: any) {
  const r = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, raw: j ?? text };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

    const body = (req.body || {}) as any;
    const prompt = (body.prompt || "").toString().trim();
    if (!prompt) return json(res, 400, { ok: false, error: "missing_prompt" });

    const modelName = (body.model_name || body.modelName || "kling-v2-1").toString().trim();
    const negativePrompt = (body.negative_prompt || body.negativePrompt || "").toString();
    const n = Number(body.n ?? 1) || 1;

    const route = (body.route || req.query?.route || "beijing").toString(); // beijing / singapore / auto
    const routesToTry = route === "auto" ? ["singapore", "beijing"] : [route, route === "beijing" ? "singapore" : "beijing"];

    let lastErr: any = null;

    for (const rt of routesToTry) {
      const baseUrl = getRouteBaseUrl(rt);
      const { ak, sk } = getKeys(rt);
      const token = buildJwt(ak, sk);

      const out = await callCreate(baseUrl, token, {
        model_name: modelName,
        prompt,
        negative_prompt: negativePrompt,
        n,
        external_task_id: body.external_task_id || "",
        callback_url: body.callback_url || "",
      });

      if (out.ok && out.raw?.code === 0 && out.raw?.data?.task_id) {
        return json(res, 200, {
          ok: true,
          provider: "kling_image",
          routeUsed: rt,
          baseUrl,
          model_name: modelName,
          taskId: out.raw.data.task_id,
          raw: out.raw,
        });
      }

      lastErr = { route: rt, baseUrl, out };
    }

    return json(res, 502, { ok: false, error: "kling_create_failed", detail: lastErr });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: "server_error", detail: e?.message || String(e) });
  }
}
