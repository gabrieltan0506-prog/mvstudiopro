import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest,res: VercelResponse){

try{

if(req.method!=="POST"){
return res.status(405).json({ok:false,error:"Method not allowed"})
}

const body = typeof req.body==="string" ? JSON.parse(req.body) : req.body

const prompt = body.prompt || body.text || ""

if(!prompt){
return res.status(400).json({ok:false,error:"missing_prompt"})
}

const key = process.env.COMETAPI_KEY

if(!key){
return res.status(500).json({ok:false,error:"missing COMETAPI_KEY"})
}

const r = await fetch("https://api.cometapi.com/v1/images/generations",{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":"Bearer "+key
},
body:JSON.stringify({
model:"nano-banana-pro",
prompt,
size:"1280x720",
n:1
})
})

const txt = await r.text()

let json:any
try{json=JSON.parse(txt)}catch{
return res.status(500).json({ok:false,error:"invalid_json",raw:txt})
}

const url =
json?.data?.[0]?.url ||
json?.data?.[0]?.image_url ||
json?.url ||
null

return res.json({
ok:true,
provider:"cometapi",
imageUrl:url,
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
