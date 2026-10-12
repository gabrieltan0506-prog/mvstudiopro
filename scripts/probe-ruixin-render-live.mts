/** Real generated-media isolated render. It does not impersonate an authenticated account or router. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { codeMotionProjectSchema, compileCodeMotion } from "../shared/codeMotion";
import { codeMotionPlanElementSchema } from "../shared/codeMotionComposition";
import { renderArtMotion } from "../server/services/artMotionRender";
import { uploadBufferToGcs } from "../server/services/gcs";
import { fetchPostProdSourceToFile, runMediaTool } from "../server/services/postProduction";
import type { CodeMotionAudio } from "../shared/codeMotionAudio";
const root="/tmp/ruixin-probe-1011", out=path.join(root,"render");
if(process.env.FLY_MACHINE_ID!=="7812595b294778")throw Error("Existing authorized rig only");
process.chdir(root);
await mkdir(out,{recursive:true});
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function json(file:string){return JSON.parse(await readFile(file,"utf8"));}
let phase="waiting_real_video";
const heartbeat=setInterval(()=>{void writeFile(path.join(out,"heartbeat.json"),JSON.stringify({pid:process.pid,phase,at:new Date().toISOString()}));},10000);
await writeFile(path.join(out,"pid"),String(process.pid));
try {
 for(const tier of ["free","paid"]){
  const dir=path.join(out,tier);await mkdir(dir,{recursive:true});
  const files=[...Array.from({length:6},(_,i)=>path.join(root,"images",`${tier}-${i}.result.json`)),...[2,3].map(i=>path.join(root,"videos",tier,`scene-${i}`,"completed.json"))];
  while(true){try{await Promise.all(files.map(f=>readFile(f)));break;}catch{phase=`waiting_${tier}_real_media`;await new Promise(r=>setTimeout(r,3000));}}
  phase=`assembling_${tier}`;
  const project=codeMotionProjectSchema.parse(await json(path.join(root,`${tier}.normalized.project.json`)));
  const plan=project.plan!;
  const audio=await json(path.join(root,"audio",`${tier}.audio-timeline.json`)) as CodeMotionAudio;
  const review=await json(path.join(root,`${tier}.requests.review.json`)) as {qwen:{sceneIndex:number;requestId:string}[]};
  for(const source of audio.sources){
   const index=Number(source.name.match(/speech-(\d+)/)?.[1]);
   if(Number.isFinite(index)){const speech=plan.scenes[index].speech!;source.generated={requestId:review.qwen.find(r=>r.sceneIndex===index)!.requestId,kind:"speech",sceneIndex:index,...speech};}
  }
  project.brief.audios=audio.sources;plan.audioTimeline=audio.audioTimeline;
  for(let i=0;i<6;i++){
   const result=await json(files[i]), id=randomUUID();project.brief.images.push({id,name:`${tier} scene ${i+1}`,gcsUri:result.gcsUri});
   const scene=plan.scenes[i].composition!;
   scene.elements.unshift(codeMotionPlanElementSchema.parse({id:`real-image-${i}`,type:"image",imageId:id,width:1,height:1,fit:"cover",layer:-100,transform:{x:.5,y:.5},keyframes:[{at:0,scale:1},{at:5,scale:1.05}]}));
  }
  const videos=await Promise.all(files.slice(6).map(json));
  for(const video of videos){
   const original=path.join(root,"videos",tier,`scene-${video.sceneIndex}`,"output.mp4"),adopted=path.join(dir,`scene-${video.sceneIndex}.adopted.mp4`);
   await runMediaTool("ffmpeg",["-y","-v","error","-i",original,"-map","0:v:0","-an","-vf","fps=30","-frames:v","150","-c:v","libx264","-preset","fast","-crf","18",adopted],AbortSignal.timeout(180000));
   const bytes=await readFile(adopted),sha256=hash(bytes);
   const archived=await uploadBufferToGcs({objectName:`post-prod/isolated-ruixin-1011/render/${tier}-scene-${video.sceneIndex}-${sha256}.mp4`,buffer:bytes,contentType:"video/mp4"});
   const probe=await runMediaTool("ffprobe",["-v","error","-show_streams","-show_format","-of","json",adopted],AbortSignal.timeout(30000));
   const parsed=JSON.parse(probe.stdout),stream=parsed.streams.find((s:{codec_type:string})=>s.codec_type==="video");
   if(Number(stream?.nb_frames)!==150||Number(stream?.duration)!==5||parsed.streams.some((s:{codec_type:string})=>s.codec_type==="audio"))throw Error("Adopted video must have exact 150 frames and no native audio");
   await writeFile(path.join(dir,`scene-${video.sceneIndex}.adoption.json`),JSON.stringify({original:video,method:"ffmpeg first 5 seconds -> 150 frames at 30 fps; native audio removed; original retained",adopted:{gcsUri:archived.gcsUri,sha256,duration:5,probe:parsed}},null,2));
   Object.assign(video,{gcsUri:archived.gcsUri,sha256,duration:5});
  }
  plan.codeVideo={version:1,assets:videos.map(v=>({id:`generated-${v.sceneIndex}`,videoUri:v.gcsUri,sha256:v.sha256,durationSec:Math.min(5,v.duration)})),clips:videos.map(v=>({assetId:`generated-${v.sceneIndex}`,at:v.sceneIndex*5,duration:5,sourceStartSec:0,fit:"cover"}))};
  const normalized=codeMotionProjectSchema.parse(project),spec=compileCodeMotion(normalized.brief,normalized.plan);
  await writeFile(path.join(dir,"project.generated.json"),JSON.stringify(normalized,null,2));
  await writeFile(path.join(dir,"compile.official.json"),JSON.stringify(spec,null,2));
  // The real mixed WAV was made by buildCodeMotionAudioMixArgs from all original Qwen/Suno tracks.
  // An isolated scope has no account ownership DB records; use the existing audioUri renderer input explicitly.
  const mixed=await readFile(path.join(root,"audio",`${tier}.mixed.wav`));
  const saved=await uploadBufferToGcs({objectName:`post-prod/isolated-ruixin-1011/render/${tier}-mixed-${hash(mixed)}.wav`,buffer:mixed,contentType:"audio/wav"});
  const {codeAudio:_audio,...renderSpec}=spec;
  const request={action:"art_motion",scopeKey:`code-motion:${project.id}`,requestId:randomUUID(),params:{...renderSpec,audioUri:saved.gcsUri}};
  await writeFile(path.join(dir,"render.request.json"),JSON.stringify(request,null,2));
  await writeFile(path.join(dir,"boundary.json"),JSON.stringify({classification:"actual generated images/video/Qwen/Suno; official strict compile and official renderer; isolated runtime, not authenticated router or online acceptance",audioBoundary:"official audio mix helper generated real 30s mix; renderer audioUri used because isolated probe has no account ownership records",noAdditionalProviderCalls:true}));
  phase=`rendering_${tier}`;
  const result=await renderArtMotion(request,"isolated-ruixin-1011",AbortSignal.timeout(20*60*1000));
  await writeFile(path.join(dir,"result.json"),JSON.stringify(result,null,2));
  await fetchPostProdSourceToFile(result.gcsUri,path.join(dir,"output.mp4"),{signal:AbortSignal.timeout(120000)});
 }
 phase="finished";
}catch(error){phase="failed";await writeFile(path.join(out,"error.json"),JSON.stringify({error:String(error),at:new Date().toISOString()}));throw error;}
finally{clearInterval(heartbeat);await writeFile(path.join(out,"heartbeat.json"),JSON.stringify({pid:process.pid,phase,at:new Date().toISOString()}));}
