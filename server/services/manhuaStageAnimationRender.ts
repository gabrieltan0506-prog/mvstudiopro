/** Native owned whitebox animation + archived GS -> same deterministic browser renderer -> video.
 * No upstream generation call, user HTML, provider token in Chromium, or client supplied URLs.
 */
import {prepareStageAnimationAudio} from './manhuaStageAnimationAudio';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import puppeteer from 'puppeteer';
import {type ArtMotionJob,artMotionJobSchema} from '../../shared/artMotion';
import {buildSrcDoc,type StageSceneConfig} from '../../shared/manhuaStageRuntime';
import {marbleToStageTransform} from '../../shared/manhuaWorldStage';
import {resolveManhuaStageAnimationSource} from './manhuaStageAnimationSource';
import {validatePrevisAnimation} from './manhuaPrevisAnimation';
import {fetchPostProdSourceToFile,runMediaTool,uploadResult} from './postProduction';
import {persistArtMotionEvidence,type ArtMotionEvidenceReceipt} from './artMotionEvidenceStore';
import {boundMediaThreads,mediaRuntime} from './postProdResources';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export async function renderManhuaStageAnimation(raw:ArtMotionJob,userId:string,signal:AbortSignal,
 deps={resolveSource:resolveManhuaStageAnimationSource,persist:persistArtMotionEvidence}){
 const input=artMotionJobSchema.parse(raw),spec=input.params;
 signal.throwIfAborted();
 const root=await mkdtemp(path.join(tmpdir(),'manhua-stage-'));
 const prefix=`post-prod/${userId}/art-motion-evidence/${input.requestId}`;
 const evidence:Array<ArtMotionEvidenceReceipt & {name:string}>=[];
 let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined,server:ReturnType<typeof createServer>|undefined;
 let encoder:ReturnType<typeof spawn>|undefined,closed:Promise<void>|undefined,failedEvidence=false,framesArchived=false;
 const frames:Array<{frame:number;timeSec:number;sha256:string}>=[],errors:string[]=[];
 const preserve=async(name:string,bytes:Buffer)=>{
  await writeFile(path.join(root,name),bytes);
  try{
   const saved=await deps.persist(userId,input.requestId,`${prefix}/${name}`,bytes);
   evidence.push({name,...saved});
  }catch(error){failedEvidence=true;throw error;}
 };
 const abort=()=>{encoder?.kill('SIGKILL');void browser?.close().catch(()=>{});};
 signal.addEventListener('abort',abort,{once:true});
 try{
  await preserve('request.raw.json',Buffer.from(JSON.stringify(raw)));
  await preserve('request.normalized.json',Buffer.from(JSON.stringify(input)));
  const source=await deps.resolveSource(userId,spec,input.requestId);
  const timelineAudio=await prepareStageAnimationAudio(spec,source.input,userId,root,signal,{
   run:async(command,args,innerSignal)=>{if(command!=='ffmpeg'&&command!=='ffprobe')throw Error('不支持的音轨处理命令');return (await runMediaTool(command,args,innerSignal)).stdout;},
   archive:preserve,
  });
  await preserve('source.json',Buffer.from(JSON.stringify({previsJobId:spec.stageAnimation!.previsJobId,previsRequestId:source.input.requestId,
   scopeId:source.input.scopeId,clipId:source.input.clipId,worldTaskId:source.world.taskId,worldSourceVersion:source.world.sourceVersion,animation:source.animation,
   boundaryZh:'原白模外观与动作置于真实3DGS空间；不是视频模型成片，尚待画面验收。'})));
  const files={glb:path.join(root,'animation.glb'),frames:path.join(root,'animation.frames.json'),world:path.join(root,'scene.spz')};
  await Promise.all([fetchPostProdSourceToFile(source.glb.gcsUri,files.glb,{signal,maxBytes:64*1024*1024}),
   fetchPostProdSourceToFile(source.frames.gcsUri,files.frames,{signal,maxBytes:16*1024*1024}),
   fetchPostProdSourceToFile(source.world.assets!.spz500kGcsUri!,files.world,{signal,maxBytes:400*1024*1024})]);
  const [glb,framesBytes]=await Promise.all([readFile(files.glb),readFile(files.frames)]);
  if(sha(glb)!==source.animation.sha256 || sha(framesBytes)!==source.animation.framesSha256)throw new Error('动画工程摘要不一致');
  await preserve('animation.frames.raw.json',framesBytes);
  const framesRaw=JSON.parse(framesBytes.toString());await preserve('animation.frames.parsed.json',Buffer.from(JSON.stringify(framesRaw)));
  const timeline=validatePrevisAnimation(framesRaw,glb,source.input.spec);
  const require=createRequire(import.meta.url),threeRoot=path.dirname(path.dirname(require.resolve('three'))),sparkFile=path.join(path.dirname(require.resolve('@sparkjsdev/spark')),'spark.module.js');
  let html='';
  server=createServer(async(req,res)=>{
   try{
    const url=new URL(req.url||'/','http://localhost');
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    let file:string|undefined;
    if(url.pathname==='/scene.spz')file=files.world;
    else if(url.pathname==='/animation.glb')file=files.glb;
    else if(url.pathname==='/spark.module.js')file=sparkFile;
    else if(url.pathname.startsWith('/three/')){const rel=decodeURIComponent(url.pathname.slice(7));const candidate=path.resolve(threeRoot,rel);if(candidate.startsWith(threeRoot+path.sep)&&candidate.endsWith('.js'))file=candidate;}
    if(!file){res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(await readFile(file));
   }catch{res.statusCode=404;res.end();}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number},origin=`http://127.0.0.1:${address.port}`;
  const transform=marbleToStageTransform(source.world.assets!);
  const config:StageSceneConfig={revision:input.requestId,spzUrl:origin+'/scene.spz',characters:[],transform:{scale:transform.scale,quaternionXYZW:transform.quaternionXYZW,translationStage:transform.translationStage},
   initialCamera:{kind:'establish',labelZh:'原动作镜头',position:[0,-8,3],target:[0,0,1],lens:35}};
  html=buildSrcDoc(config,{origin,threeUrl:origin+'/three/build/three.module.js',addonsUrl:origin+'/three/examples/jsm/',sparkUrl:origin+'/spark.module.js',captureOnly:true});
  browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||undefined,env:{PATH:process.env.PATH,LANG:'C.UTF-8',TMPDIR:root},args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();await page.setViewport({width:spec.width,height:spec.height,deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.setRequestInterception(true);page.on('request',request=>{const url=request.url();if(url.startsWith(origin+'/') || url.startsWith('data:') || url.startsWith('blob:'))void request.continue();else void request.abort();});
  await page.goto(origin,{waitUntil:'networkidle0',timeout:120_000});
  await page.waitForFunction(()=>Boolean((window as any).__MANHUA_STAGE__?.ready || (window as any).__MANHUA_STAGE_ERROR__),{timeout:120_000});
  const stageError=await page.evaluate(()=>String((window as any).__MANHUA_STAGE_ERROR__||''));
  if(stageError)throw new Error('场景动画播放器未就绪：'+stageError);
  await page.evaluate(async(frames)=>{const response=await fetch('/animation.glb');if(!response.ok)throw new Error('animation_transfer_failed');await (window as any).__MANHUA_STAGE__.loadAnimation(await response.arrayBuffer(),frames);},timeline);
  const video=path.join(root,'video.mp4'),runtime=mediaRuntime.getStore();if(runtime)runtime.phase='ffmpeg';
  encoder=spawn('ffmpeg',boundMediaThreads(['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','24','-i','pipe:0','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',video]),{stdio:['pipe','ignore','pipe'],env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});
  if(runtime)runtime.childPid=encoder.pid;
  let encoderError:Error|undefined,tail='';encoder.stderr!.on('data',chunk=>{tail=(tail+chunk.toString()).slice(-8192);});encoder.stdin!.on('error',error=>{encoderError=error;});
  closed=new Promise((resolve,reject)=>{encoder!.once('error',reject);encoder!.once('close',code=>code===0?resolve():reject(new Error('场景动画编码未完成')));});closed.catch(()=>{});
  const count=Math.round(spec.duration*24);
  for(let i=0;i<count;i++){
   signal.throwIfAborted();if(encoderError)throw encoderError;
   const png=await page.evaluate(async time=>await (window as any).__MANHUA_STAGE__.renderFrame(time),i/24);
   if(typeof png!=='string'||!png.startsWith('data:image/png;base64,'))throw new Error('场景动画帧未完成');
   if(runtime)runtime.phase=`stage_frame_${i+1}_of_${count}`;
   const bytes=Buffer.from(png.split(',')[1],'base64');frames.push({frame:i+1,timeSec:i/24,sha256:sha(bytes)});
   if(!encoder.stdin!.write(bytes))await Promise.race([once(encoder.stdin!,'drain'),closed.then(()=>{throw new Error('编码进程提前退出');})]);
   if(i%24===0)console.info('[manhua-stage] frame',i,'/',count);
  }
  encoder.stdin!.end();await closed;
  await preserve('frames.json',Buffer.from(JSON.stringify({complete:true,frameCount:count,frames,errors})));framesArchived=true;
  if(errors.length)throw new Error('场景动画执行错误，未采用');
  let output=video;
  if(timelineAudio || spec.audioUri){const audio=timelineAudio??path.join(root,'audio');if(!timelineAudio)await fetchPostProdSourceToFile(spec.audioUri!,audio,{signal});output=path.join(root,'result.mp4');
   await runMediaTool('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,'-i',audio,'-filter_complex',`[1:a]atrim=duration=${spec.duration},apad,atrim=duration=${spec.duration}[a]`,'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-t',String(spec.duration),output],signal);}
  const probe=await runMediaTool('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',output],signal);
  await preserve('probe.raw.json',Buffer.from(probe.stdout));const parsed=JSON.parse(probe.stdout);await preserve('probe.parsed.json',Buffer.from(JSON.stringify(parsed)));
  const stream=parsed.streams?.find((s:any)=>s.codec_type==='video');
  if((spec.audioTimeline||spec.audioUri) && !parsed.streams?.some((s:any)=>s.codec_type==='audio'))throw new Error('场景动画配乐缺失，未采用无声结果');
  if(!stream || Number(stream.nb_read_frames)!==count || stream.width!==spec.width || stream.height!==spec.height || Math.abs(Number(parsed.format?.duration)-spec.duration)>.05)throw new Error('场景动画帧数画幅或片长不一致');
  const uploaded=await uploadResult({filePath:output,userId,kind:'manhua-stage-animation',ext:'mp4',contentType:'video/mp4',signal});
  const result={...uploaded,requestId:input.requestId,durationSec:spec.duration,width:spec.width,height:spec.height,fps:24,frameCount:count,alpha:false,stageAnimation:spec.stageAnimation,...(spec.audioTimeline?{audioTimeline:spec.audioTimeline}:{}),evidence};
  await preserve('result.json',Buffer.from(JSON.stringify(result)));return result;
 }finally{
  await preserve('execution.raw.json',Buffer.from(JSON.stringify({framesRendered:frames.length,errors,complete:framesArchived}))).catch(()=>{failedEvidence=true;});
  if(frames.length&&!framesArchived)await preserve('frames.partial.json',Buffer.from(JSON.stringify({complete:false,frames,errors}))).catch(()=>{failedEvidence=true;});
  signal.removeEventListener('abort',abort);encoder?.kill('SIGKILL');await closed?.catch(()=>{});await browser?.close().catch(()=>{});
  if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
  if(!failedEvidence)await rm(root,{recursive:true,force:true});
 }
}
