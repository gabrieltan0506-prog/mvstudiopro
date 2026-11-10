import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { hasSupervisorRole } from "../shared/internalMediaEndpointPolicy.js";

function s(v:any){
  if(v==null) return "";
  if(Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function b64url(b:Buffer){
  return b.toString("base64")
    .replace(/\+/g,"-")
    .replace(/\//g,"_")
    .replace(/=+$/g,"");
}

function jwtHS256(iss:string, secret:string){
  const header = b64url(Buffer.from(JSON.stringify({ alg:"HS256", typ:"JWT" })));
  const now = Math.floor(Date.now()/1000);
  const payload = b64url(Buffer.from(JSON.stringify({
    iss, iat: now, nbf: now, exp: now + 3600
  })));
  const unsigned = `${header}.${payload}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(unsigned).digest());
  return `${unsigned}.${sig}`;
}

function tryParse(t:string){
  try { return JSON.parse(t); } catch { return null; }
}

/** 取登录用户与角色；未登录/校验失败返回 null（不抛）。 */
async function resolveKlingImageUser(req: VercelRequest): Promise<{ userId: number; role: string } | null> {
  try {
    const { sdk } = await import("../server/_core/sdk.js");
    const user = await sdk.authenticateRequest(req as any, { silentMissing: true });
    const userId = Number((user as any)?.id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { userId, role: String((user as any)?.role || "") };
  } catch {
    return null;
  }
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    // 本入口直调付费出图上游且不扣费，只有管理员测试台在用：一律须监管/管理员登录（原先匿名可调，含 op=probe 真实出图）。
    const viewer = await resolveKlingImageUser(req);
    if (!viewer) return res.status(401).json({ ok:false, error:"authentication_required", message:"请先登录后再使用" });
    if (!hasSupervisorRole(viewer.role)) return res.status(403).json({ ok:false, error:"supervisor_only", message:"该入口仅供监管验收" });

    const AK = s(process.env.KLING_CN_IMAGE_ACCESS_KEY).trim();
    const SK = s(process.env.KLING_CN_IMAGE_SECRET_KEY).trim();
    const BASE = (s(process.env.KLING_CN_BASE_URL) || "https://api-beijing.klingai.com").replace(/\/+$/,"");

    if(!AK || !SK){
      return res.status(500).json({
        ok:false,
        error:"missing_env",
        detail:"KLING_CN_IMAGE_ACCESS_KEY/SECRET_KEY"
      });
    }

    const token = jwtHS256(AK, SK);
    const headers = {
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json",
      Accept:"application/json"
    };

    const op = s((req.query as any)?.op || "");
    const taskId = s((req.query as any)?.taskId || (req.query as any)?.task_id || "");

    if(op === "probe"){
      const resp = await fetch(`${BASE}/v1/images/generations`, {
        method:"POST",
        headers,
        body: JSON.stringify({
          prompt:"cinematic city background, no characters",
          n:1,
          image_size:"1024x576"
        })
      });

      const bodyText = await resp.text();

      return res.status(200).json({
        ok:true,
        httpStatus:resp.status,
        bodyPreview:bodyText.slice(0,500)
      });
    }

    if(req.method === "GET"){
      if(!taskId){
        return res.status(400).json({ ok:false, error:"missing_taskId" });
      }

      const resp = await fetch(`${BASE}/v1/images/generations/${encodeURIComponent(taskId)}`, {
        method:"GET",
        headers
      });

      const respText = await resp.text();
      const respJson = tryParse(respText);

      const imageUrl =
        respJson?.data?.task_result?.images?.[0]?.url ||
        respJson?.data?.images?.[0]?.url ||
        respJson?.data?.[0]?.url ||
        null;

      return res.status(resp.ok ? 200 : 502).json({
        ok: resp.ok,
        status: resp.status,
        taskId,
        task_status: respJson?.data?.task_status || null,
        imageUrl,
        raw: respJson ?? respText.slice(0,2000)
      });
    }

    if(req.method !== "POST"){
      return res.status(405).json({ ok:false, error:"Method not allowed" });
    }

    const bodyData =
      typeof req.body === "string"
        ? (tryParse(req.body) || {})
        : (req.body || {});

    const prompt = s((bodyData as any).prompt);
    const image_size = s((bodyData as any).image_size || (bodyData as any).size || "1024x576");
    const n = Number((bodyData as any).n || 1) || 1;

    if(!prompt){
      return res.status(400).json({ ok:false, error:"missing_prompt" });
    }

    const resp = await fetch(`${BASE}/v1/images/generations`, {
      method:"POST",
      headers,
      body: JSON.stringify({ prompt, n, image_size })
    });

    const respText = await resp.text();
    const respJson = tryParse(respText);

    const createTaskId =
      respJson?.data?.task_id ||
      respJson?.data?.id ||
      null;

    const imageUrl =
      respJson?.data?.task_result?.images?.[0]?.url ||
      respJson?.data?.images?.[0]?.url ||
      respJson?.data?.[0]?.url ||
      null;

    return res.status(resp.ok ? 200 : 502).json({
      ok: resp.ok,
      status: resp.status,
      taskId: createTaskId,
      task_status: respJson?.data?.task_status || null,
      imageUrl,
      raw: respJson ?? respText.slice(0,2000)
    });

  }catch(e:any){
    return res.status(500).json({
      ok:false,
      error:"server_error",
      message:e?.message||String(e)
    });
  }
}
