import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest,res: VercelResponse){

try{

if(req.method!=="POST"){
return res.status(405).json({ok:false,error:"Method not allowed"})
}

const body = typeof req.body==="string" ? JSON.parse(req.body) : req.body

const prompt = body.prompt || ""

if(!prompt){
return res.status(400).json({ok:false,error:"missing_prompt"})
}

const key = process.env.FAL_KEY

if(!key){
return res.status(500).json({ok:false,error:"missing FAL_KEY"})
}

const r = await fetch("https://fal.run/fal-ai/nano-banana",{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":"Key "+key
},
body:JSON.stringify({
prompt,
image_size:"landscape_16_9"
})
})

const txt = await r.text()

let json:any
try{json=JSON.parse(txt)}catch{
return res.status(500).json({ok:false,error:"invalid_json",raw:txt})
}

const imageUrl =
json?.images?.[0]?.url ||
json?.image?.url ||
null

return res.json({
ok:true,
provider:"fal",
imageUrl,
raw:json
})

}catch(e:any){

return res.status(500).json({
ok:false,
error:"server_error",
message:e?.message||String(e)
})

}

}
