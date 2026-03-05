import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { put, getDownloadUrl } from "@vercel/blob";

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function jparse(t:string){ try{return JSON.parse(t)}catch{return null} }
function body(req:VercelRequest){
  if(!req.body) return {}
  if(typeof req.body==="string") return jparse(req.body) ?? {}
  return req.body
}
function b64url(buf: Buffer){
  return buf.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function jwtHS256(iss: string, secret: string){
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8"));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({ iss, iat: now, nbf: now, exp: now + 3600 }), "utf-8"));
  const unsigned = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(unsigned).digest();
  return `${unsigned}.${b64url(sig)}`;
}
async function fetchJson(url:string, init:RequestInit){
  const r = await fetch(url, init);
  const text = await r.text();
  const json = jparse(text);
  return { ok: r.ok, status: r.status, url, json, rawText: text.slice(0,4000) };
}


async function fetchImageAsBase64(imageUrl: string): Promise<{ b64: string; mime: string; bytes: number }> {
  const resp = await fetch(imageUrl, { redirect: "follow" });
  if (!resp.ok) throw new Error(`image_fetch_failed:${resp.status}`);
  const mime = String(resp.headers.get("content-type") || "image/png");
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!buf.length) throw new Error("empty_image");
  if (buf.length > 8 * 1024 * 1024) throw new Error("image_too_large");
  return { b64: buf.toString("base64"), mime, bytes: buf.length };
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const q:any=req.query||{};
    const b:any=req.method==="POST"?body(req):{};
    const op=s(q.op||b.op).trim();
    if(!op) return res.status(400).json({ok:false,error:"missing op"});

    // ---------- upload: blobPutImage ----------
    if(op==="blobPutImage"){
      const dataUrl = s(b.dataUrl);
      const filename = s(b.filename||"ref.png") || "ref.png";
      if(!dataUrl.startsWith("data:")) return res.status(400).json({ok:false,error:"missing_data_url"});
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if(!m) return res.status(400).json({ok:false,error:"invalid_data_url"});
      const mime = m[1];
      const b64 = m[2];
      const buf = Buffer.from(b64,"base64");
      if(!buf.length) return res.status(400).json({ok:false,error:"empty_file"});
      if(buf.length>10*1024*1024) return res.status(400).json({ok:false,error:"file_too_large",detail:"max 10MB"});
      const blob = await put(`refs/${Date.now()}-${filename}`, buf, { access:"private", contentType:mime });
      const downloadUrl = await getDownloadUrl(blob.url);
      return res.status(200).json({ ok:true, imageUrl: downloadUrl, blobUrl: blob.url, blob });
    }

    // ---------- Kling (CN Beijing) ----------
    const KLING_BASE = (s(process.env.KLING_CN_BASE_URL)||"https://api-beijing.klingai.com").replace(/\/+$/,""
);
    const KLING_AK = s(process.env.KLING_CN_VIDEO_ACCESS_KEY).trim();
    const KLING_SK = s(process.env.KLING_CN_VIDEO_SECRET_KEY).trim();
    if(!KLING_AK || !KLING_SK){
      return res.status(500).json({ok:false,error:"missing_env",detail:"Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY"});
    }
    const KLING_TOKEN = jwtHS256(KLING_AK, KLING_SK);

    if(op==="klingCreate"){
      const imageUrl = s(b.imageUrl||b.image||q.imageUrl||q.image).trim();
      if(!imageUrl) return res.status(400).json({ok:false,error:"missing_image_url"});
      const img = await fetchImageAsBase64(imageUrl);

      const prompt = s(b.prompt||q.prompt||"");
      const duration = s(b.duration||"10"); // doc enum "5"/"10"
      if(duration!=="5" && duration!=="10"){
        return res.status(400).json({ok:false,error:"invalid_duration",detail:duration});
      }
      const payload = {
        model_name: s(b.model_name||"kling-v2-6"),
        image: img.b64,            // URL allowed in doc  [oai_citation:5‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
        image_tail: s(b.image_tail||""),
        prompt,
        negative_prompt: s(b.negative_prompt||""),
        duration,
        mode: s(b.mode||"pro"),
        sound: s(b.sound||"off"),
        callback_url: s(b.callback_url||""),
        external_task_id: s(b.external_task_id||"")
      };

      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video`,{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+KLING_TOKEN,      // doc says Bearer <token>  [oai_citation:6‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body: JSON.stringify(payload)
      });

      const taskId = r.json?.data?.task_id || null;
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, taskId, imageInputMode:"base64", imageBytes: (typeof img==="object" && img.bytes)? img.bytes : null, raw:r.json ?? r.rawText });
    }

    if(op==="klingTask"){
      const taskId = s(q.taskId||b.taskId||q.task_id||b.task_id).trim();
      if(!taskId) return res.status(400).json({ok:false,error:"missing_task_id"});
      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{
          "Authorization":"Bearer "+KLING_TOKEN,
          "Accept":"application/json"
        }
      });
      const taskStatus = s(r.json?.data?.task_status||"");
      const videoUrl = r.json?.data?.task_result?.videos?.[0]?.url || null; // doc  [oai_citation:7‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, taskStatus, videoUrl, raw:r.json ?? r.rawText });
    }

    // ---------- AIMusic (Suno) ----------
    const AIM_BASE = (s(process.env.AIMUSIC_BASE_URL)||"https://api.aimusicapi.ai").replace(/\/+$/,""
);
    const AIM_KEY  = s(process.env.AIMUSIC_API_KEY||process.env.AIMUSICAPI_KEY).trim();
    if(!AIM_KEY){
      return res.status(500).json({ok:false,error:"missing_env",detail:"Missing AIMUSIC_API_KEY"});
    }

    if(op==="aimusicSunoCreate"){
      const payload = {
        task_type: "create_music",
        custom_mode: false,
        mv: "sonic-v4-5",
        gpt_description_prompt: s(b.gpt_description_prompt||b.prompt||q.prompt||"")
      };
      const r = await fetchJson(`${AIM_BASE}/api/v1/sonic/create`,{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+AIM_KEY,
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body: JSON.stringify(payload)
      });
      // return full upstream json so UI can always find task_id
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw:r.json ?? r.rawText });
    }

    if(op==="aimusicSunoTask"){
      const taskId = s(q.taskId||b.taskId).trim();
      if(!taskId) return res.status(400).json({ok:false,error:"missing_task_id"});
      const r = await fetchJson(`${AIM_BASE}/api/v1/sonic/task/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{
          "Authorization":"Bearer "+AIM_KEY,
          "Accept":"application/json"
        }
      });
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw:r.json ?? r.rawText });
    }

    return res.status(400).json({ok:false,error:"unknown_op",op});
  }catch(e:any){
    return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e)});
  }
}
