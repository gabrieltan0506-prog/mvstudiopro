import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";

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
  const header=b64url(Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const now=Math.floor(Date.now()/1000);

  const payload=b64url(Buffer.from(JSON.stringify({
    iss,
    iat:now,
    nbf:now,
    exp:now+3600
  })));

  const unsigned=`${header}.${payload}`;

  const sig=b64url(
    crypto.createHmac("sha256", secret)
      .update(unsigned)
      .digest()
  );

  return `${unsigned}.${sig}`;
}

function tryParse(t:string){
  try{
    return JSON.parse(t);
  }catch{
    return null;
  }
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{

    const AK=s(process.env.KLING_CN_IMAGE_ACCESS_KEY);
    const SK=s(process.env.KLING_CN_IMAGE_SECRET_KEY);
    const BASE=(s(process.env.KLING_CN_BASE_URL)||"https://api-beijing.klingai.com").replace(/\/+$/,"");

    if(!AK||!SK){
      return res.status(500).json({
        ok:false,
        error:"missing_env",
        detail:"KLING_CN_IMAGE_ACCESS_KEY/SECRET_KEY"
      });
    }

    const token=jwtHS256(AK,SK);

    const op=s((req.query as any)?.op);

    if(op==="probe"){

      const resp=await fetch(`${BASE}/v1/images/generations`,{
        method:"POST",
        headers:{
          Authorization:"Bearer "+token,
          "Content-Type":"application/json",
          Accept:"application/json"
        },
        body:JSON.stringify({
          prompt:"cinematic cyberpunk city background",
          n:1,
          image_size:"1024x576"
        })
      });

      const bodyText=await resp.text();

      return res.status(200).json({
        ok:true,
        httpStatus:resp.status,
        bodyPreview:bodyText.slice(0,500)
      });
    }

    if(req.method!=="POST"){
      return res.status(405).json({
        ok:false,
        error:"Method not allowed"
      });
    }

    const bodyData=
      typeof req.body==="string"
      ? tryParse(req.body)||{}
      : req.body||{};

    const prompt=s(bodyData.prompt);
    const size=s(bodyData.image_size||"1024x576");
    const n=Number(bodyData.n||1);

    if(!prompt){
      return res.status(400).json({
        ok:false,
        error:"missing_prompt"
      });
    }

    const resp=await fetch(`${BASE}/v1/images/generations`,{
      method:"POST",
      headers:{
        Authorization:"Bearer "+token,
        "Content-Type":"application/json",
        Accept:"application/json"
      },
      body:JSON.stringify({
        prompt,
        n,
        image_size:size
      })
    });

    const respText=await resp.text();
    const respJson=tryParse(respText);

    const imageUrl=
      respJson?.data?.[0]?.url ||
      respJson?.data?.url ||
      null;

    return res.status(resp.ok?200:502).json({
      ok:resp.ok,
      status:resp.status,
      imageUrl,
      raw:respJson ?? respText.slice(0,2000)
    });

  }catch(e:any){

    return res.status(500).json({
      ok:false,
      error:"server_error",
      message:e?.message||String(e)
    });

  }
}
