import type { VercelRequest, VercelResponse } from "@vercel/node";

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function parseBody(req:VercelRequest){
  const b:any = (req as any).body;
  if(!b) return {};
  if(typeof b === "string"){ try { return JSON.parse(b); } catch { return {}; } }
  return b;
}

async function falFetch(path:string, init:RequestInit){
  const key = s(process.env.FAL_KEY).trim();
  if(!key) throw new Error("missing_env_FAL_KEY");
  const r = await fetch(`https://queue.fal.run${path}`, {
    ...init,
    headers: {
      "Authorization": `Key ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await r.text();
  let json:any = null;
  try { json = JSON.parse(text); } catch {}
  return { ok:r.ok, status:r.status, json, text };
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const q:any = req.query || {};
    const b:any = req.method === "POST" ? parseBody(req) : {};
    const op = s(q.op || b.op).trim();

    if(op === "falVeoReferenceVideo"){
      const model = s(b.model || "fal-ai/veo3.1/reference-to-video").trim();
      const payload = {
        prompt: s(b.prompt),
        image_urls: Array.isArray(b.image_urls) ? b.image_urls : [],
        aspect_ratio: s(b.aspect_ratio || "16:9"),
        duration: s(b.duration || "8s"),
        resolution: s(b.resolution || "720p"),
        generate_audio: b.generate_audio !== false,
        safety_tolerance: s(b.safety_tolerance || "4")
      };
      const r = await falFetch(`/${model}`, { method:"POST", body: JSON.stringify(payload) });
      return res.status(r.ok ? 200 : 502).json(r.json || { ok:false, error:r.text });
    }

    if(op === "falVeoReferenceVideoStatus"){
      const model = s(q.model || b.model || "fal-ai/veo3.1/reference-to-video").trim();
      const requestId = s(q.requestId || b.requestId).trim();
      if(!requestId) return res.status(400).json({ ok:false, error:"missing_requestId" });

      const st = await falFetch(`/${model}/requests/${encodeURIComponent(requestId)}/status`, { method:"GET" });
      if(!st.ok) return res.status(502).json(st.json || { ok:false, error:st.text });

      const status = s(st.json?.status).toUpperCase();
      if(status === "COMPLETED"){
        const rr = await falFetch(`/${model}/requests/${encodeURIComponent(requestId)}`, { method:"GET" });
        return res.status(rr.ok ? 200 : 502).json(rr.json || { ok:false, error:rr.text, status });
      }

      return res.status(200).json(st.json || { status });
    }

    return res.status(400).json({ ok:false, error:"unsupported_op" });
  }catch(e:any){
    return res.status(500).json({ ok:false, error:e?.message || "workflow_model_failed" });
  }
}
