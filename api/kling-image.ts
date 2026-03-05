import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0]??""); return String(v); }
function b64url(b:Buffer){
  return b.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function jwtHS256(iss:string, secret:string){
  const header=b64url(Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const now=Math.floor(Date.now()/1000);
  const payload=b64url(Buffer.from(JSON.stringify({iss,iat:now,nbf:now,exp:now+3600})));
  const unsigned=`${header}.${payload}`;
  const sig=b64url(crypto.createHmac("sha256", secret).update(unsigned).digest());
  return `${unsigned}.${sig}`;
}
function jparse(t:string){ try{return JSON.parse(t)}catch{return null} }

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const AK=s(process.env.KLING_CN_IMAGE_ACCESS_KEY).trim();
    const SK=s(process.env.KLING_CN_IMAGE_SECRET_KEY).trim();
    const BASE=(s(process.env.KLING_CN_BASE_URL)||"https://api-beijing.klingai.com").replace(/\/+$/,"");
    if(!AK||!SK) return res.status(500).json({ok:false,error:"missing_env",detail:"KLING_CN_IMAGE_ACCESS_KEY/SECRET_KEY"});

    const token=jwtHS256(AK,SK);

    const op=s((req.query as any)?.op || "");
    if(op==="probe"){
      const r=await fetch(`${BASE}/v1/images/generations`,{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+token,
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body: JSON.stringify({ prompt:"cinematic city night background, no characters", n:1, image_size:"1024x576" })
      });
      const t=await r.text();
      return res.status(200).json({ ok:true, httpStatus:r.status, bodyPreview:t.slice(0,500) });
    }

    
    // GET task polling: /api/kling-image?taskId=...
    const taskId = s((req.query as any)?.taskId || "");
    if (req.method === "GET" && taskId) {
      const r = await fetch(`${BASE}/v1/images/generations/${encodeURIComponent(taskId)}`,{
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
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, taskId, task_status, imageUrl, raw: j ?? t.slice(0,2000) });
    }

if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ok:false,error:"Method not allowed"});

    const b:any = (typeof (req as any).body==="string") ? (jparse((req as any).body)||{}) : ((req as any).body||{});
    const prompt=s(b.prompt||"");
    const image_size=s(b.image_size||b.size||"1024x576");
    const n=Number(b.n||1)||1;

    if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

    const r=await fetch(`${BASE}/v1/images/generations`,{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+token,
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body: JSON.stringify({ prompt, n, image_size })
    });

    const t=await r.text();
    const j=jparse(t);
    const imageUrl = j?.data?.[0]?.url || j?.data?.url || j?.data?.task_result?.images?.[0]?.url || null;

    return res.status(r.ok?200:502).json({
      ok:r.ok,
      status:r.status,
      endpoint:`${BASE}/v1/images/generations`,
      imageUrl,
      raw: j ?? t.slice(0,2000)
    });
  }catch(e:any){
    return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e)});
  }
}
