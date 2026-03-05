import type { VercelRequest, VercelResponse } from "@vercel/node";

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0]); return String(v) }

function body(req:VercelRequest){
  if(!req.body) return {}
  if(typeof req.body==="string"){
    try{return JSON.parse(req.body)}catch{return {}}
  }
  return req.body
}

export default async function handler(req:VercelRequest,res:VercelResponse){
try{

const q=req.query||{}
const b=req.method==="POST"?body(req):{}

const op=s(q.op||b.op)

if(!op){
return res.status(400).json({ok:false,error:"missing op"})
}

const KLING_BASE=s(process.env.KLING_CN_BASE_URL||"https://api-beijing.klingai.com")
const ACCESS=s(process.env.KLING_CN_VIDEO_ACCESS_KEY)
const SECRET=s(process.env.KLING_CN_VIDEO_SECRET_KEY)

if(!ACCESS||!SECRET){
return res.status(500).json({ok:false,error:"missing kling env"})
}

if(op==="klingCreate"){

const prompt=s(b.prompt||q.prompt)
const imageUrl=s(b.imageUrl||q.imageUrl)

if(!imageUrl){
return res.status(400).json({ok:false,error:"missing_image_url"})
}

const resp=await fetch(imageUrl)
if(!resp.ok){
return res.status(400).json({ok:false,error:"image_fetch_failed"})
}

const buf=Buffer.from(await resp.arrayBuffer())
const base64=buf.toString("base64")

const r=await fetch(KLING_BASE+"/v1/videos/image2video",{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":"Bearer "+ACCESS
},
body:JSON.stringify({
image:base64,
prompt,
duration:8
})
})

const txt=await r.text()

let json:any
try{json=JSON.parse(txt)}catch{
return res.status(500).json({ok:false,error:"kling_invalid_json",raw:txt})
}

if(!json?.data?.task_id){
return res.status(500).json({ok:false,error:"no_task_id",raw:json})
}

return res.json({
ok:true,
taskId:json.data.task_id,
status:"submitted"
})
}

if(op==="klingTask"){

const taskId=s(q.taskId||b.taskId)
if(!taskId){
return res.status(400).json({ok:false,error:"missing_task_id"})
}

const r=await fetch(KLING_BASE+"/v1/videos/task?task_id="+taskId,{
headers:{
"Authorization":"Bearer "+ACCESS
}
})

const txt=await r.text()

let json:any
try{json=JSON.parse(txt)}catch{
return res.status(500).json({ok:false,error:"invalid_json",raw:txt})
}

const status=s(json?.data?.task_status)

if(status==="succeed"){
return res.json({
ok:true,
status:"succeeded",
videoUrl:json?.data?.task_result?.videos?.[0]?.url||null,
raw:json
})
}

if(status==="failed"){
return res.json({ok:false,status:"failed",raw:json})
}

return res.json({
ok:true,
status:"running",
taskId
})

}

return res.status(400).json({ok:false,error:"unknown_op"})

}catch(e:any){
return res.status(500).json({ok:false,error:"server_error",message:e?.message||String(e)})
}
}
