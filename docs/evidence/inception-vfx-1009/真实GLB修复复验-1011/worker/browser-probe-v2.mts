import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import puppeteer from 'puppeteer';
import {SpzWriter} from '@sparkjsdev/spark';
import sharp from 'sharp';
import {buildVfxStagePage} from './manhuaVfxStagePage';
const dir=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const threeRoot=path.dirname(path.dirname(require.resolve('three')));
const sparkFile=path.join(path.dirname(require.resolve('@sparkjsdev/spark')),'spark.module.js');
const writer=new SpzWriter({numSplats:9,shDegree:0});
for(let i=0;i<9;i++){const x=i%3-1,z=Math.floor(i/3)-1;writer.setCenter(i,x*.8,0,z*.8);writer.setScale(i,.4,.02,.4);writer.setQuat(i,0,0,0,1);writer.setAlpha(i,.95);writer.setRgb(i,.14+.1*(x+1),.3,.45+.08*(z+1));}
await writeFile(path.join(dir,'world.spz'),await writer.finalize());
let html='';
let heldFragmentPositions:string|undefined;
const errors:string[]=[],consoleLogs:string[]=[],receipts:any[]=[],poseChecks:any[]=[];
const files=new Map([['/world.spz','world.spz'],['/animation.glb','world-animation.glb'],['/frames.json','world-animation.frames.json'],['/collider.glb','collider.glb']]);
const server=createServer(async(req,res)=>{try{const url=new URL(req.url||'/','http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}let file=url.pathname==='/spark.module.js'?sparkFile:files.has(url.pathname)?path.join(dir,files.get(url.pathname)!):undefined;if(url.pathname.startsWith('/three/')){const candidate=path.resolve(threeRoot,decodeURIComponent(url.pathname.slice(7)));if(candidate.startsWith(threeRoot+path.sep)&&candidate.endsWith('.js'))file=candidate;}if(!file){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(await readFile(file));}catch(e){res.statusCode=500;res.end(String(e));}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
html=buildVfxStagePage({origin,width:192,height:192,fps:24,transform:{scale:1,quaternionXYZW:[Math.SQRT1_2,0,0,Math.SQRT1_2],translationStage:[0,0,0]},light:{samples:16,exposure:0,keyEnergy:1000,fillRatio:.35}});
// 仅增加只读探针接口。实际加载、动画时钟、姿态更新、相机、光照和渲染函数全部使用生产页面原文。
const marker='window.__VFX_STAGE__={ready:true,';if(html.split(marker).length!==2)throw Error('无法唯一定位生产页面探针注入点');
html=html.replace(marker,marker+`inspect(){return {animations:gltf.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),meshes:meshes.map(o=>({id:o.userData.vfxOwner,skinned:!!o.isSkinnedMesh,positions:Array.from({length:o.geometry.attributes.position.count},(_,i)=>o.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(o.matrixWorld).toArray())}))}},`);
await writeFile(path.join(dir,'page-instrumented.html'),html);
const expected=JSON.parse(await readFile(path.join(dir,'expected-world-vertices.json'),'utf8'));
const timeline=JSON.parse(await readFile(path.join(dir,'world-animation.frames.json'),'utf8'));
await mkdir(path.join(dir,'frames'),{recursive:true});
let browser:any;
try{
 browser=await puppeteer.launch({headless:true,protocolTimeout:0,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/usr/bin/chromium',env:{PATH:process.env.PATH,LANG:'C.UTF-8',TMPDIR:dir},args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage();await page.setViewport({width:192,height:192,deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{consoleLogs.push(m.type()+': '+m.text());if(m.text().startsWith('VFX_STAGE_PROGRESS'))console.log(m.text());});
 page.on('requestfailed',r=>errors.push('REQUEST_FAILED '+r.url()+' '+r.failure()?.errorText));
 await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(origin+'/')||r.url().startsWith('blob:')||r.url().startsWith('data:'))void r.continue();else{errors.push('EXTERNAL_REQUEST_BLOCKED');void r.abort();}});
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>Boolean((window as any).__VFX_STAGE__?.ready||(window as any).__VFX_STAGE_ERROR__),{timeout:120000});
 const problem=await page.evaluate(()=>String((window as any).__VFX_STAGE_ERROR__||''));if(problem)throw Error(problem);
 for(let i=0;i<48;i++){
  const value=await page.evaluate(async i=>{const api=(window as any).__VFX_STAGE__;const rendered=await api.frame(i);return{rendered,pose:api.inspect()}},i);
  const {png,...receipt}=value.rendered;const bytes=Buffer.from(png.slice('data:image/png;base64,'.length),'base64');
  await writeFile(path.join(dir,'frames',`frame-${String(i+1).padStart(6,'0')}.png`),bytes);
  const stats=await sharp(bytes).stats();if(!stats.channels.some(c=>c.stdev>1))throw Error('输出帧像素恒定');
  const row=timeline.frames[i];if(receipt.frame!==i+1||Math.abs(receipt.timeSec-i/24)>1e-7||receipt.position.some((v:number,k:number)=>Math.abs(v-row.camera.position[k])>1e-5)||receipt.quaternion.some((v:number,k:number)=>Math.abs(v-row.camera.quaternionXYZW[k])>1e-5)||Math.abs(receipt.vfovRad-row.camera.vfovRad)>1e-7)throw Error('消费者相机/时间改变');
  if(receipt.samples!==16||JSON.stringify(receipt.visibleObjectIds)!==JSON.stringify([...row.visibleObjectIds].sort())||receipt.gaussianCount!==9||receipt.dynamicReflectionMaps!==2||receipt.shadowMapSize!==2048)throw Error('真实SPZ/反射/阴影消费者未执行');
  let maxError=0;const comparisons=[];
  for(const [id,points] of Object.entries(expected[i].meshes) as [string,number[][]][]){const actual=value.pose.meshes.filter((m:any)=>m.id===id).flatMap((m:any)=>m.positions);if(!actual.length)throw Error('缺少物件'+id);for(const point of points){const error=Math.min(...actual.map((q:number[])=>Math.hypot(...q.map((v,k)=>v-point[k]))));maxError=Math.max(maxError,error);}for(const point of actual){maxError=Math.max(maxError,Math.min(...points.map(q=>Math.hypot(...q.map((v,k)=>v-point[k]))))); }comparisons.push({id,blenderVertices:points.length,threeVertices:actual.length});}
  if(value.pose.meshes.filter((m:any)=>m.skinned).length!==1)throw Error('实际带骨网格缺失');
  if(maxError>1e-4)throw Error(`第${i+1}帧导出/浏览器顶点误差${maxError}`);
  const fragmentPositions=JSON.stringify(value.pose.meshes.filter((m:any)=>m.id==='TEST_ONLY_fragment').map((m:any)=>m.positions));
  if(i/24>=.8){if(heldFragmentPositions&&heldFragmentPositions!==fragmentPositions)throw Error('定格后碎片世界顶点发生变化');heldFragmentPositions=fragmentPositions;}
  receipts.push({...receipt,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});poseChecks.push({frame:i+1,maxVertexError:maxError,comparisons,animations:value.pose.animations,skinnedMeshes:value.pose.meshes.filter((m:any)=>m.skinned).length});
  await writeFile(path.join(dir,'progress.json'),JSON.stringify({complete:false,receipts,poseChecks,errors}));console.log('REAL_STAGE_FRAME_PASS '+(i+1));
 }
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile(path.join(dir,'runtime-result.json'),JSON.stringify({complete:true,frames:48,receipts,poseChecks,errors,consoleLogs},null,2));
 console.log('REAL_PRODUCTION_THREE_SPARK_PASS 48 frames');
}catch(e){await writeFile(path.join(dir,'runtime-failure.json'),JSON.stringify({error:String(e),receipts,poseChecks,errors,consoleLogs},null,2));throw e;}
finally{await browser?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
