import type { VercelRequest, VercelResponse } from "@vercel/node";
import { aimusicFetch, getAimusicKey } from "./_core/aimusicapi.js";

function send(res: VercelResponse, status: number, body: any) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const op = String(req.query.op || "");
    const key = getAimusicKey();
    const headers = {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    if (req.method === "GET" && op === "credits") {
      const r = await aimusicFetch("/api/v1/get-credits", { method: "GET", headers });
      return send(res, r.ok ? 200 : 502, r);
    }

    if (req.method === "POST" && op === "sonicCreate") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const r = await aimusicFetch("/api/v1/sonic/create", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      return send(res, r.ok ? 200 : 502, r);
    }

    if (req.method === "GET" && op === "sonicTask") {
      const taskId = String(req.query.taskId || "");
      if (!taskId) return send(res, 400, { ok: false, error: "missing taskId" });
      const r = await aimusicFetch(`/api/v1/sonic/task/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers,
      });
      return send(res, r.ok ? 200 : 502, r);
    }

    return send(res, 400, { ok: false, error: "unknown op", allowed: ["credits", "sonicCreate", "sonicTask"] });
  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
