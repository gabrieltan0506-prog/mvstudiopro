/** Authorized, bounded four-call provider probe. Uses production builders, submit and polling.
 * All receipts stay in the private execution directory; this does not deploy or impersonate UI acceptance. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { submitEvolinkSeedanceVideo, pollEvolinkVideoTaskOnce, buildEvolinkSeedanceRequest, type EvolinkSeedanceRunInput } from "../server/services/evolinkSeedanceVideo";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "../server/services/gcs";
import { planInkGeneratedShot } from "../shared/inkVideoProductionPolicy";
import { z } from "zod";

const root=path.resolve(process.argv[2] || "");
if(!process.argv.includes("--authorized-four-calls-no-retry")) throw Error("Explicit bounded authorization flag required");
const inputSchema=z.object({tier:z.enum(["free","paid"]),sceneIndex:z.union([z.literal(2),z.literal(3)]),prompt:z.string().min(20),images:z.array(z.object({gcsUri:z.string().regex(/^gs:\/\//),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(6),audio:z.object({gcsUri:z.string().regex(/^gs:\/\//),sha256:z.string().regex(/^[a-f0-9]{64}$/),duration:z.literal(5)})}).strict();
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function exists(file:string){try{return await readFile(file,"utf8");}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
async function one(tier:"free"|"paid",sceneIndex:2|3){
 const dir=path.join(root,"videos",tier,`scene-${sceneIndex}`);await mkdir(dir,{recursive:true});
 const save=async(name:string,value:unknown)=>writeFile(path.join(dir,name),JSON.stringify(value,null,2));
 if(await exists(path.join(dir,"completed.json")))return;
 const inputFile=path.join(root,`${tier}.scene-${sceneIndex}.video-input.json`);
 let raw:string|null=null;
 while(!(raw=await exists(inputFile))){await save("heartbeat.json",{at:new Date().toISOString(),stage:"waiting_for_real_image_and_mixed_audio"});await new Promise(r=>setTimeout(r,3000));}
 const v=inputSchema.parse(JSON.parse(raw));if(v.tier!==tier||v.sceneIndex!==sceneIndex)throw Error("Wrong approved shot input");
 // Verify actual reference bytes against the immutable producer receipts before any purchase.
 const refs=[...v.images,v.audio];
 for(const ref of refs){const res=await fetch(signGsUriV4ReadUrl(ref.gcsUri,3600),{signal:AbortSignal.timeout(60000),redirect:"error"});if(!res.ok)throw Error(`Reference read failed ${res.status}`);const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>64*1024*1024||hash(bytes)!==ref.sha256)throw Error("Reference bytes mismatch");}
 const policy=planInkGeneratedShot({tier,duration:5,imageCount:v.images.length,videoCount:0,audioCount:1});
 const input:EvolinkSeedanceRunInput={prompt:v.prompt,imageUrls:v.images.map(i=>signGsUriV4ReadUrl(i.gcsUri,3600)),audioUrls:[signGsUriV4ReadUrl(v.audio.gcsUri,3600)],videoUrls:[],version:policy.version,quality:policy.resolution,mode:policy.mode,duration:5,aspectRatio:"9:16",generateAudio:true,contentFilter:false,persistSubmitReceipt:async receipt=>{await save("submit.raw.json",receipt);}};
 await save("request.review.json",{...buildEvolinkSeedanceRequest(input),authorization:"User approved two versions, two five-second model shots each; no cap required, no resubmission",inputReferences:refs});
 let handle=await exists(path.join(dir,"submitted.json"));
 if(!handle){
  // A lost outcome cannot purchase again, including on process restart.
  await writeFile(path.join(dir,"submission-started.json"),JSON.stringify({at:new Date().toISOString(),tier,sceneIndex}),{flag:"wx"});
  const submitted=await submitEvolinkSeedanceVideo(input);await save("submitted.json",submitted);handle=JSON.stringify(submitted);
 }
 const submitted=JSON.parse(handle);let source=submitted.immediateSourceUrl;
 while(!source){const snap=await pollEvolinkVideoTaskOnce(submitted.evolinkTaskId,`瑞芯咖啡 ${tier} ${sceneIndex}`,async r=>{await save("terminal.raw.json",r);});await save("heartbeat.json",{at:new Date().toISOString(),taskId:submitted.evolinkTaskId,...snap});if(snap.state==="completed")source=snap.sourceUrl;else if(snap.state==="failed")throw Error(snap.error);else await new Promise(r=>setTimeout(r,5000));}
 const res=await fetch(source,{signal:AbortSignal.timeout(120000)});if(!res.ok)throw Error(`Output download ${res.status}`);const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>100*1024*1024)throw Error("Output exceeds bounded probe size");const file=path.join(dir,"output.mp4");await writeFile(file,bytes);
 const probe=JSON.parse(execFileSync("ffprobe",["-v","error","-show_format","-show_streams","-of","json",file],{encoding:"utf8"}));await save("ffprobe.json",probe);
 const duration=Number(probe.format?.duration);if(!Number.isFinite(duration)||duration<4.95||duration>5.15)throw Error("Output duration differs from approved five seconds");
 const archived=await uploadBufferToGcs({objectName:`code-motion-probe/ruixin-1011/${tier}/video-${sceneIndex}-${hash(bytes)}.mp4`,buffer:bytes,contentType:"video/mp4"});
 await save("completed.json",{tier,sceneIndex,at:sceneIndex*5,duration,sha256:hash(bytes),bytes:bytes.length,gcsUri:archived.gcsUri,taskId:submitted.evolinkTaskId,model:submitted.model,inputReferences:refs});
}
await mkdir(root,{recursive:true});
const result=await Promise.allSettled((["free","paid"] as const).flatMap(tier=>([2,3] as const).map(scene=>one(tier,scene))));
await writeFile(path.join(root,"videos-summary.json"),JSON.stringify(result.map((r,i)=>({index:i,status:r.status,...(r.status==="rejected"?{error:r.reason instanceof Error?r.reason.message:String(r.reason)}:{})})),null,2));
if(result.some(r=>r.status==="rejected"))process.exitCode=1;
