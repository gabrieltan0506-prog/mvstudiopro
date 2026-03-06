import type { VercelRequest, VercelResponse } from "@vercel/node";

async function safeFetch(url: string, init: any = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      text,
      json,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      statusText: "FETCH_FAILED",
      text: "",
      json: null,
      fetchError: e?.message || String(e),
      fetchName: e?.name || "",
    };
  } finally {
    clearTimeout(timer);
  }
}
import crypto from "node:crypto";

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0]??""); return String(v); }
function jparse(t:string){ try{return JSON.parse(t)}catch{return null} }
function b64url(b:Buffer){ return b.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function jwtHS256(iss:string, secret:string){
  const header=b64url(Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const now=Math.floor(Date.now()/1000);
  const payload=b64url(Buffer.from(JSON.stringify({iss,iat:now,nbf:now,exp:now+3600})));
  const unsigned=`${header}.${payload}`;
  const sig=b64url(crypto.createHmac("sha256", secret).update(unsigned).digest());
  return `${unsigned}.${sig}`;
}
function getBody(req:VercelRequest){
  const b:any = (req as any).body;
  if(!b) return {};
  if(typeof b==="string") return jparse(b) ?? {};
  return b;
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const AK=s(process.env.KLING_CN_IMAGE_ACCESS_KEY).trim();
    const SK=s(process.env.KLING_CN_IMAGE_SECRET_KEY).trim();
    const BASE=(s(process.env.KLING_CN_BASE_URL)||"https://api-beijing.klingai.com").replace(/\/+$/,"");
    if(!AK||!SK) return res.status(500).json({ok:false,error:"missing_env",detail:"KLING_CN_IMAGE_ACCESS_KEY/SECRET_KEY"});

    const token=jwtHS256(AK,SK);
    const q:any = req.query || {};
    const b:any = req.method==="POST" ? getBody(req) : {};

    // task polling
    const taskId = s(q.taskId || b.taskId).trim();
    if(req.method==="GET" && taskId){
      const r = await safeFetch(`${BASE}/v1/images/generations/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{
          "Authorization":"Bearer "+token,
          "Accept":"application/json"
        }
      });
      const t = await r.text();
      const j = jparse(t);
      const imageUrl =
        j?.data?.task_result?.images?.[0]?.url ||
        j?.data?.images?.[0]?.url ||
        j?.data?.url ||
        null;
      const task_status = j?.data?.task_status || null;
      return res.status(r.ok?200:502).json({
        ok:r.ok,
        status:r.status,
        taskId,
        task_status,
        imageUrl,
        raw: j ?? t.slice(0,2000)
      });
    }

    // probe
    const op=s(q.op || b.op).trim();
    if(req.method==="GET" && op==="probe"){
      const r=await safeFetch(`${BASE}/v1/images/generations`,{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+token,
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body: JSON.stringify({
          model_name: "kling-v2-1",
          prompt: "cinematic city night background, no people, ultra detailed",
          resolution: "1k",
          aspect_ratio: "16:9"
        })
      });
      const t=await r.text();
      return res.status(200).json({ ok:true, httpStatus:r.status, bodyPreview:t.slice(0,800) });
    }

    if(req.method!=="POST") return res.status(405).json({ok:false,error:"Method not allowed"});

    const prompt = s(b.prompt).trim();
    if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

    const payload:any = {
      model_name: s(b.model_name || "kling-v2-1"),
      prompt,
      resolution: s(b.resolution || "1k"),
      aspect_ratio: s(b.aspect_ratio || "16:9")
    };

    if (s(b.negative_prompt)) payload.negative_prompt = s(b.negative_prompt);
    if (s(b.image)) payload.image = s(b.image);
    if (s(b.image_reference)) payload.image_reference = s(b.image_reference);
    if (b.image_fidelity !== undefined && b.image_fidelity !== null && String(b.image_fidelity) !== "") payload.image_fidelity = Number(b.image_fidelity);
    if (b.human_fidelity !== undefined && b.human_fidelity !== null && String(b.human_fidelity) !== "") payload.human_fidelity = Number(b.human_fidelity);
    if (s(b.callback_url)) payload.callback_url = s(b.callback_url);
    if (s(b.external_task_id)) payload.external_task_id = s(b.external_task_id);

    const r = await safeFetch(`${BASE}/v1/images/generations`,{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+token,
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body: JSON.stringify(payload)
    });

    const t = await r.text();
    const j = jparse(t);

    const task_id = j?.data?.task_id || null;
    const task_status = j?.data?.task_status || null;
    const imageUrl =
      j?.data?.task_result?.images?.[0]?.url ||
      j?.data?.images?.[0]?.url ||
      j?.data?.url ||
      null;

    return res.status(r.ok?200:502).json({
      ok:r.ok,
      status:r.status,
      taskId: task_id,
      task_status,
      imageUrl,
      raw: j ?? t.slice(0,2000)
    });
  }catch(e:any){
    return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e),stack:String(e?.stack||"").slice(0,1200)});
  }
}
