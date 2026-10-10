import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import sharp from "sharp";
import { z } from "zod";
import type { ManhuaVfxJob, ManhuaVfxEffect } from "../../shared/manhuaVfx";
import { assertValidGlb2 } from "../../shared/glbValidation";
import { marbleToStageTransform } from "../../shared/manhuaWorldStage";
import { readVfxEnvironment } from "./manhuaVfxEnvironment";
import { fetchPostProdSourceToFile } from "./postProduction";
import { buildVfxStagePage } from "./manhuaVfxStagePage";
import { mediaRuntime } from "./postProdResources";

const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const quat = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const cameraSchema = z.object({ position: vec3, quaternionXYZW: quat, vfovRad: z.number().finite().gt(0).lt(Math.PI),
  clipStart: z.number().finite().positive(), clipEnd: z.number().finite().positive() }).strict();
const timelineSchema = z.object({ version: z.literal(1), complete: z.literal(true), fps: z.number().finite().min(12).max(60),
  width: z.number().int().positive(), height: z.number().int().positive(), coordinateSystem: z.literal("stage-z-up-meters"),
  objectIds: z.array(z.string().min(1)).min(2).max(2048), fragmentIds: z.array(z.string().min(1)).min(1).max(1024),
  frames: z.array(z.object({ frame: z.number().int().positive(), timeSec: z.number().finite(), active: z.boolean(), camera: cameraSchema,
    visibleObjectIds: z.array(z.string()), fragmentOpacity: z.record(z.string(), z.number().finite().min(0).max(1)) }).strict()).min(2).max(1800),
}).strict();
export type VfxStageTimeline = z.infer<typeof timelineSchema>;
const matrix = z.array(z.array(z.number().finite()).length(4)).length(4);
const sourceProof = z.object({ nativeStageExport: z.object({ complete: z.literal(true), glbSha256: z.string(), framesSha256: z.string() }),
  frames: z.array(z.object({ frame: z.number(), timeSec: z.number(), effects: z.array(z.object({ active: z.boolean(),
    cameraMatrixWorld: matrix, cameraVfovRad: z.number().finite().positive(), cameraClip: z.tuple([z.number(), z.number()]) })).length(1) })) }).passthrough();

/** 导出相机必须与原完整三维求值一致，不能用固定相机替代后仍称同一机位。 */
export function validateVfxStageTimeline(raw: unknown, proofRaw: unknown, meta: { width: number; height: number; fps: number; durationSec: number }) {
  const timeline = timelineSchema.parse(raw), proof = sourceProof.parse(proofRaw), count = Math.ceil(meta.durationSec * meta.fps);
  const ids = new Set(timeline.objectIds), fragments = new Set(timeline.fragmentIds);
  if (timeline.width !== meta.width || timeline.height !== meta.height || timeline.fps !== meta.fps || timeline.frames.length !== count || proof.frames.length !== count ||
    ids.size !== timeline.objectIds.length || fragments.size !== timeline.fragmentIds.length || fragments.size >= ids.size || Array.from(fragments).some(id => !ids.has(id)))
    throw new Error("正式场景动画帧数、画幅或角色/碎片身份不完整");
  timeline.frames.forEach((row, index) => {
    const original = proof.frames[index], camera = row.camera, m = original.effects[0].cameraMatrixWorld;
    const [x, y, z, w] = camera.quaternionXYZW;
    const rotation = [[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w], [2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w], [2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]];
    if (row.frame !== index + 1 || original.frame !== row.frame || Math.abs(row.timeSec-index/meta.fps) > 1e-7 || Math.abs(original.timeSec-row.timeSec)>1e-7 ||
      row.active !== original.effects[0].active || Math.abs(camera.vfovRad-original.effects[0].cameraVfovRad)>1e-7 || camera.clipStart >= camera.clipEnd || camera.clipStart !== original.effects[0].cameraClip[0] || camera.clipEnd !== original.effects[0].cameraClip[1] ||
      Math.abs(Math.hypot(x,y,z,w)-1)>1e-5 || camera.position.some((v, i) => Math.abs(v-m[i][3])>1e-4) || rotation.some((values,i)=>values.some((v,j)=>Math.abs(v-m[i][j])>1e-4)) ||
      new Set(row.visibleObjectIds).size !== row.visibleObjectIds.length || row.visibleObjectIds.some(id=>!ids.has(id)) || (!row.active && row.visibleObjectIds.length>0) ||
      JSON.stringify(Object.keys(row.fragmentOpacity).sort()) !== JSON.stringify(Array.from(fragments).sort()))
      throw new Error("正式场景动画逐帧机位、可见性或碎片透明度与原场景不一致");
  });
  return timeline;
}

/** 网站封存的SPZ + 当前确定性GLB；固定本机页面没有上游凭证和外网权限。 */
export async function renderVfxStageEnvironment(dir: string, input: ManhuaVfxJob, effect: ManhuaVfxEffect, userId: string,
  meta: { width: number; height: number; fps: number; durationSec: number }, signal: AbortSignal) {
  if (!effect.world?.environment || !effect.world.render || effect.world.render.exportLayers) throw new Error("正式场景渲染配置不完整");
  signal.throwIfAborted();
  const proofBytes = await readFile(path.join(dir, "manifest.json")), proof = JSON.parse(proofBytes.toString()), parsed = sourceProof.parse(proof);
  const modelPath = path.join(dir,"world-animation.glb"), framesPath = path.join(dir,"world-animation.frames.json");
  const [modelInfo, frameInfo] = await Promise.all([stat(modelPath),stat(framesPath)]);
  if (modelInfo.size < 20 || modelInfo.size > 64*1024**2 || frameInfo.size<=0 || frameInfo.size>16*1024**2) throw new Error("正式场景动画文件为空或超限");
  const [modelBytes, frameBytes] = await Promise.all([readFile(modelPath),readFile(framesPath)]);
  assertValidGlb2(modelBytes);
  if (sha(modelBytes)!==parsed.nativeStageExport.glbSha256 || sha(frameBytes)!==parsed.nativeStageExport.framesSha256) throw new Error("正式场景动画导出摘要不一致");
  const timeline = validateVfxStageTimeline(JSON.parse(frameBytes.toString()), proof, meta);
  const environment = await readVfxEnvironment(userId,input,effect.id);
  await writeFile(path.join(dir,"environment-source.json"),JSON.stringify(environment),{flag:"wx"});
  const worldPath=path.join(dir,"world.spz"),colliderPath=path.join(dir,"collider.glb");
  await Promise.all([fetchPostProdSourceToFile(environment.assets.spz500kGcsUri,worldPath,{signal,maxBytes:400*1024**2}),
    fetchPostProdSourceToFile(environment.assets.colliderGlbGcsUri,colliderPath,{signal,maxBytes:64*1024**2})]);
  assertValidGlb2(await readFile(colliderPath));
  const require=createRequire(import.meta.url),threeRoot=path.dirname(path.dirname(require.resolve("three"))),sparkFile=path.join(path.dirname(require.resolve("@sparkjsdev/spark")),"spark.module.js");
  const whitelist=new Map([["/world.spz",worldPath],["/animation.glb",modelPath],["/frames.json",framesPath],["/collider.glb",colliderPath],["/spark.module.js",sparkFile]]);
  let html="",browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined,lastProgress=Date.now(),stall:Error|undefined;
  const errors:string[]=[],receipts:unknown[]=[];
  const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url||"/","http://localhost");if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end(html);return;}
    let file=whitelist.get(url.pathname);
    if(url.pathname.startsWith("/three/")){const candidate=path.resolve(threeRoot,decodeURIComponent(url.pathname.slice(7)));if(candidate.startsWith(threeRoot+path.sep)&&candidate.endsWith(".js"))file=candidate;}
    if(!file){res.statusCode=404;res.end();return;}
    res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":"application/octet-stream");res.end(await readFile(file));
  }catch{res.statusCode=404;res.end();}});
  const abort=()=>{void browser?.close().catch(()=>{});};signal.addEventListener("abort",abort,{once:true});
  const runtime=mediaRuntime.getStore();
  const heartbeat=setInterval(()=>{if(Date.now()-lastProgress>600_000){stall=new Error("正式场景渲染连续10分钟没有进度心跳，原任务保留");abort();}},5_000);
  try {
    await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`,transform=marbleToStageTransform(environment.assets);
    html=buildVfxStagePage({origin,...meta,transform:{scale:transform.scale,quaternionXYZW:transform.quaternionXYZW,translationStage:transform.translationStage},light:effect.world.render});
    browser=await puppeteer.launch({headless:true,protocolTimeout:0,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||undefined,
      env:{PATH:process.env.PATH,LANG:"C.UTF-8",TMPDIR:dir},args:["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
    const page=await browser.newPage();await page.setViewport({width:meta.width,height:meta.height,deviceScaleFactor:1});
    page.on("pageerror",error=>{errors.push(String(error));abort();});
    page.on("console",message=>{if(message.text().startsWith("VFX_STAGE_PROGRESS ")){lastProgress=Date.now();if(runtime)runtime.phase=message.text().slice(0,160);}});
    await page.setRequestInterception(true);page.on("request",request=>{const url=request.url();if(url.startsWith(origin+"/")||url.startsWith("blob:")||url.startsWith("data:"))void request.continue();else{errors.push("渲染页面拒绝外部网络请求");void request.abort();}});
    await page.goto(origin,{waitUntil:"domcontentloaded",timeout:120_000});
    await page.waitForFunction(()=>Boolean((window as any).__VFX_STAGE__?.ready||(window as any).__VFX_STAGE_ERROR__),{timeout:0});
    const problem=await page.evaluate(()=>String((window as any).__VFX_STAGE_ERROR__||""));if(problem)throw new Error(problem);
    const empty=await sharp({create:{width:meta.width,height:meta.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
    proof.files=[];proof.renderedBytes=0;
    for(let index=0;index<timeline.frames.length;index++){
      signal.throwIfAborted();if(stall)throw stall;
      const row=timeline.frames[index];let bytes=empty;
      if(row.active){
        const actual=await page.evaluate(async i=>await (window as any).__VFX_STAGE__.frame(i),index);
        const receipt=z.object({png:z.string().startsWith("data:image/png;base64,"),frame:z.number(),timeSec:z.number(),position:vec3,quaternion:quat,vfovRad:z.number(),
          visibleObjectIds:z.array(z.string()),samples:z.number(),gaussianCount:z.number().int().positive().max(500000),vertices:z.number().int().positive().max(2000000),
          colliderVertices:z.number().int().positive().max(2000000),dynamicReflectionMaps:z.literal(2),shadowMapSize:z.literal(2048)}).parse(actual);
        if(receipt.frame!==index+1||Math.abs(receipt.timeSec-row.timeSec)>1e-7||receipt.samples!==effect.world.render.samples||
          receipt.position.some((v,i)=>Math.abs(v-row.camera.position[i])>1e-5)||receipt.quaternion.some((v,i)=>Math.abs(v-row.camera.quaternionXYZW[i])>1e-5)||
          Math.abs(receipt.vfovRad-row.camera.vfovRad)>1e-7||JSON.stringify(receipt.visibleObjectIds)!==JSON.stringify([...row.visibleObjectIds].sort()))
          throw new Error("正式3DGS消费者没有执行原相机或完整人物/碎片可见性");
        bytes=Buffer.from(receipt.png.slice("data:image/png;base64,".length),"base64");
        const {png,...evidence}=receipt;receipts.push(evidence);
      }
      const name=`frame-${String(index+1).padStart(6,"0")}.png`;
      if(!bytes.length||bytes.length>32*1024**2||(proof.renderedBytes+=bytes.length)>2*1024**3)throw new Error("正式场景画面为空或超过预算");
      await writeFile(path.join(dir,name),bytes,{flag:"wx"});proof.files.push({frame:index+1,path:name,bytes:bytes.length,sha256:sha(bytes)});
      lastProgress=Date.now();if(runtime)runtime.phase=`vfx_stage_frame_${index+1}_of_${timeline.frames.length}`;
      await writeFile(path.join(dir,"stage-frames.raw.json"),JSON.stringify({complete:false,receipts,errors}));
    }
    if(errors.length)throw new Error("正式场景渲染出现执行或网络错误");
    proof.stage={engine:"three-spark-same-camera-v1",worldTaskId:environment.taskId,worldSourceVersion:environment.sourceVersion,
      glbSha256:sha(modelBytes),framesSha256:sha(frameBytes),samples:effect.world.render.samples,activeFrames:receipts.length,
      dynamicReflectionMaps:2,shadowGeometry:"owned-world-collider",complete:true};
    proof.complete=true;await writeFile(path.join(dir,"manifest.json"),JSON.stringify(proof));
    await writeFile(path.join(dir,"stage-frames.raw.json"),JSON.stringify({complete:true,receipts,errors}));
  }catch(error){await writeFile(path.join(dir,"stage-frames.raw.json"),JSON.stringify({complete:false,receipts,errors,error:String(stall??error)}));throw stall??error;}
  finally{clearInterval(heartbeat);signal.removeEventListener("abort",abort);await browser?.close().catch(()=>{});server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
