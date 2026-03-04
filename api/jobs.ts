import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

function asString(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0]??""); return String(v); }
function safeJsonParse(s:string){ try{return JSON.parse(s);}catch{return null;} }

function getBody(req:VercelRequest){
  const b:any=req.body;
  if(!b) return {};
  if(typeof b==="string") return safeJsonParse(b)||{};
  return b;
}

function normalizeVideoProvider(p:string){
  const v=p.toLowerCase();
  if(v.includes("fast")||v.includes("rapid")) return "rapid";
  return "pro";
}

function normalizeOperationName(name:string){
  const m=name.match(/operations\/([^/?\s]+)/);
  if(!m?.[1]) return "";
  return m[1];
}

async function parseResp(resp:Response){
  const text=await resp.text();
  const raw=safeJsonParse(text);
  return {raw,rawText:text.slice(0,4000)};
}

async function getVertexAccessToken():Promise<string>{
  const raw=asString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON).trim();
  if(!raw) throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const sa=safeJsonParse(raw);

  const header=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT"})).toString("base64url");
  const now=Math.floor(Date.now()/1000);

  const payload=Buffer.from(JSON.stringify({
    iss:sa.client_email,
    scope:"https://www.googleapis.com/auth/cloud-platform",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,
    exp:now+3600
  })).toString("base64url");

  const unsigned=`${header}.${payload}`;

  const sign=crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();

  const signature=sign.sign(sa.private_key).toString("base64url");
  const assertion=`${unsigned}.${signature}`;

  const r=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const j=await r.json();
  if(!j.access_token) throw new Error("Vertex token failed");

  return j.access_token;
}

async function thirdPartyRapidFallback(input:any){
  const endpoint=asString(process.env.THIRDPARTY_VIDEO_FALLBACK_URL);
  if(!endpoint) return {ok:false};

  try{
    const r=await fetch(endpoint,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(input)
    });

    const text=await r.text();
    const raw=safeJsonParse(text);

    if(!r.ok) return {ok:false,error:raw||text};

    return {ok:true,data:raw||text};

  }catch(e:any){
    return {ok:false,error:e.message};
  }
}

export default async function handler(req:VercelRequest,res:VercelResponse){

try{

if(req.method!=="POST"&&req.method!=="GET"){
  return res.status(405).json({ok:false,error:"Method not allowed"});
}

const q:any=req.query||{};
const b:any=req.method==="POST"?getBody(req):{};

const type=asString(b.type||q.type);
const provider=asString(b.provider||q.provider);
const taskId=asString(b.taskId||q.taskId);
const prompt=asString(b.prompt||q.prompt);

const projectId=asString(process.env.VERTEX_PROJECT_ID).trim();
if(!projectId){
  return res.status(500).json({ok:false,error:"missing_env"});
}

const token=await getVertexAccessToken();

/* ---------------- IMAGE ---------------- */

if(type==="image"){

if(!prompt) return res.status(400).json({ok:false,error:"missing_prompt"});

const isPro=provider==="nano-banana-pro";

const model=isPro
 ? (process.env.VERTEX_IMAGE_MODEL_PRO||"gemini-3-pro-image-preview")
 : (process.env.VERTEX_IMAGE_MODEL_FLASH||"gemini-3.1-flash-image-preview");

const location=isPro
 ? (process.env.VERTEX_IMAGE_LOCATION_PRO||"global")
 : (process.env.VERTEX_IMAGE_LOCATION_FLASH||"global");

const baseUrl=location==="global"
 ? "https://aiplatform.googleapis.com"
 : `https://${location}-aiplatform.googleapis.com`;

const url=`${baseUrl}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

const upstream=await fetch(url,{
method:"POST",
headers:{
Authorization:`Bearer ${token}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
contents:[{role:"user",parts:[{text:prompt}]}],
generationConfig:{
responseModalities:["IMAGE"]
}
})
});

const {raw,rawText}=await parseResp(upstream);

if(!upstream.ok){
return res.status(500).json({
ok:false,
error:"image_generation_failed",
detail:{model,location,raw,rawText}
});
}

const parts=raw?.candidates?.[0]?.content?.parts||[];

let base64img=null;

for(const p of parts){
 if(p?.inlineData?.data){
   base64img=p.inlineData.data;
   break;
 }
}

if(!base64img){
 return res.status(500).json({ok:false,error:"no_image"});
}

return res.status(200).json({
ok:true,
model,
location,
imageUrl:`data:image/png;base64,${base64img}`
});

}

/* ---------------- VIDEO ---------------- */

if(type==="video"){

const mode=normalizeVideoProvider(provider);

const model=mode==="rapid"
 ? (process.env.VERTEX_VEO_MODEL_RAPID||"veo-3.1-fast-generate-001")
 : (process.env.VERTEX_VEO_MODEL_PRO||"veo-3.1-generate-001");

const location=mode==="rapid"
 ? (process.env.VERTEX_VIDEO_LOCATION_RAPID||"us-central1")
 : (process.env.VERTEX_VIDEO_LOCATION_PRO||"global");

const baseUrl=location==="global"
 ? "https://aiplatform.googleapis.com"
 : `https://${location}-aiplatform.googleapis.com`;

/* ---- STATUS ---- */

if(taskId){

const id=normalizeOperationName(taskId);

const statusUrl=`${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/${id}`;

const r=await fetch(statusUrl,{
headers:{Authorization:`Bearer ${token}`}
});

const j=await r.json();

return res.status(200).json({
ok:true,
status:j?.done?"succeeded":"running",
raw:j
});
}

/* ---- CREATE ---- */

const imageUrl=asString(b.imageUrl||q.imageUrl);
if(!imageUrl) return res.status(400).json({ok:false,error:"missing_image_url"});

const imgResp=await fetch(imageUrl);

const imageBuffer=Buffer.from(await imgResp.arrayBuffer());
const imageB64=imageBuffer.toString("base64");

const createUrl=`${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

const resp=await fetch(createUrl,{
method:"POST",
headers:{
Authorization:`Bearer ${token}`,
"Content-Type":"application/json"
},
body:JSON.stringify({
instances:[
{
prompt,
image:{
bytesBase64Encoded:imageB64,
mimeType:"image/png"
}
}
],
parameters:{
aspectRatio:asString(b.aspectRatio||"16:9"),
resolution:asString(b.resolution||"720p"),
durationSeconds:8,
generateAudio:false
}
})
});

const {raw,rawText}=await parseResp(resp);

if(!resp.ok){

if(mode==="rapid"){

const fb=await thirdPartyRapidFallback({prompt,imageUrl});

if(fb.ok){
 return res.status(200).json({ok:true,fallback:true,raw:fb.data});
}

}

return res.status(500).json({
ok:false,
error:"video_create_failed",
model,
location,
detail:{raw,rawText}
});

}

const op=normalizeOperationName(raw?.name||"");

return res.status(200).json({
ok:true,
taskId:op,
model,
location,
status:"running"
});

}

return res.status(400).json({ok:false,error:"unsupported_type"});

}catch(e:any){
return res.status(500).json({
ok:false,
error:"server_error",
message:e?.message||String(e)
});
}

}
