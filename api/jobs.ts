import type { VercelRequest, VercelResponse } from "@vercel/node";

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0] ?? ""); return String(v) }
function jparse(t:string){ try{return JSON.parse(t)}catch{return null} }
function body(req:VercelRequest){
  if(!req.body) return {}
  if(typeof req.body==="string") return jparse(req.body) ?? {}
  return req.body
}
async function fetchJson(url:string, init:RequestInit){
  const r = await fetch(url, init);
  const text = await r.text();
  const json = jparse(text);
  return { ok: r.ok, status: r.status, url, json, rawText: text.slice(0,4000) };
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const q:any=req.query||{};
    const b:any=req.method==="POST"?body(req):{};
    const op=s(q.op||b.op).trim();
    if(!op) return res.status(400).json({ok:false,error:"missing op"});

    const BASE=(s(process.env.KLING_CN_BASE_URL)||"https://api-beijing.klingai.com").replace(/\/+$/,"");
    const TOKEN=s(process.env.KLING_CN_VIDEO_TOKEN).trim();
    if(!TOKEN) return res.status(500).json({ok:false,error:"missing_env",detail:"Missing KLING_CN_VIDEO_TOKEN"});

    if(op==="klingCreate"){
      const imageUrl=s(b.imageUrl||b.image||q.imageUrl||q.image).trim();
      if(!imageUrl) return res.status(400).json({ok:false,error:"missing_image_url"});

      const payload={
        model_name: s(b.model_name||"kling-v2-6"),
        image: imageUrl,                              // 文档示例支持 URL  [oai_citation:5‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
        image_tail: s(b.image_tail||""),
        prompt: s(b.prompt||q.prompt||""),
        negative_prompt: s(b.negative_prompt||""),
        duration: s(b.duration||"10"),               // 只能 "5"/"10"  [oai_citation:6‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
        mode: s(b.mode||"pro"),
        sound: s(b.sound||"off"),
        callback_url: s(b.callback_url||""),
        external_task_id: s(b.external_task_id||""),
      };
      if(payload.duration!=="5" && payload.duration!=="10"){
        return res.status(400).json({ok:false,error:"invalid_duration",detail:payload.duration});
      }

      const r=await fetchJson(BASE+"/v1/videos/image2video",{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+TOKEN,            // 文档：Bearer <token>  [oai_citation:7‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body:JSON.stringify(payload)
      });

      const taskId = r.json?.data?.task_id || null;  // 文档返回 data.task_id  [oai_citation:8‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, taskId, raw:r.json ?? r.rawText });
    }

    if(op==="klingTask"){
      const taskId=s(q.taskId||b.taskId||q.task_id||b.task_id).trim();
      if(!taskId) return res.status(400).json({ok:false,error:"missing_task_id"});

      // 文档：GET /v1/videos/image2video/{task_id}  [oai_citation:9‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
      const r=await fetchJson(BASE+"/v1/videos/image2video/"+encodeURIComponent(taskId),{
        method:"GET",
        headers:{
          "Authorization":"Bearer "+TOKEN,
          "Accept":"application/json"
        }
      });

      const taskStatus = s(r.json?.data?.task_status || "");
      const videoUrl = r.json?.data?.task_result?.videos?.[0]?.url || null; // 文档：task_result.videos[0].url  [oai_citation:10‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, taskStatus, videoUrl, raw:r.json ?? r.rawText });
    }

    return res.status(400).json({ok:false,error:"unknown_op",op});
  }catch(e:any){
    return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e)});
  }
}
