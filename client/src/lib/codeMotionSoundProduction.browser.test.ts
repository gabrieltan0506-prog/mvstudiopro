import { expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { build as buildStyles } from "vite";
import tailwindcss from "@tailwindcss/vite";
import puppeteer from "puppeteer";

it("official Studio starts without audio, generates only missing speech and BGM, adopts all sources and restores the audio timeline", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Studio from './client/src/pages/CodeMotionStudio';
import{codeMotionProjectSchema}from './shared/codeMotion';
const id='11111111-1111-4111-8111-111111111111',grant='22222222-2222-4222-8222-222222222222';
const p={id,brief:{title:'测试作品',request:'树林中的小球',style:'scenes',duration:20,orientation:'landscape',images:[]},plan:{version:1,summary:'四个画面',scenes:Array.from({length:4},(_,i)=>({heading:'画面'+i,body:'',duration:5,speech:{text:'测试旁白'+i,voice:'female',emotion:['[tired][very fast]','[whispers]','[amazed]','[empathetic]'][i]},composition:{id:'scene'+i,duration:5,elements:[{id:'ball',type:'shape',shape:'ellipse'}]}}))}};
const saved=JSON.parse(localStorage.getItem('image-probe:store')||'null');
globalThis.fixture={events:JSON.parse(localStorage.getItem('image-probe:trace')||'[]'),sounds:JSON.parse(localStorage.getItem('sound-probe:sounds')||'[]'),batches:JSON.parse(localStorage.getItem('image-probe:batches')||'[]'),saved,prepared:{projectId:id,grantId:grant,generation:'3',tier:'free',fingerprint:'a'.repeat(64),credits:0,createdAt:'2026-10-10T19:00:00Z',shots:Array.from({length:4},(_,i)=>({index:i,name:'画面'+(i+1),prompt:'已保存镜头内容'+i,requestId:'33333333-3333-4333-8333-33333333333'+i,jobId:'fixed-job-'+i}))}};
if(!localStorage.getItem('yingke:draft:7')){const project=codeMotionProjectSchema.parse(p);localStorage.setItem('yingke:draft:7',JSON.stringify({project,generation:'0',savedJson:'',pending:null}));}
createRoot(document.getElementById('root')).render(<Studio/>);` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
    loader: { ".css": "empty" },
    plugins: [{ name: "fixture transport only", setup(b) {
      b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({ path: "auth", namespace: "fixture-auth" }));
      b.onLoad({ filter: /.*/, namespace: "fixture-auth" }, () => ({ loader: "js", contents: "export const useAuth=()=>({user:{id:7,role:'user'}})" }));
      b.onResolve({filter:/^@\/components\/(PlatformHtmlPptPanel|CodeMotionVideoPptx|code-motion\/CodeMotionPreview)$/},a=>({path:a.path,namespace:'fixture-unrelated'}));
      b.onLoad({filter:/.*/,namespace:'fixture-unrelated'},()=>({loader:'js',contents:"export default function Unused(){throw Error('probe does not render unrelated media')}"}));
      b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: process.cwd(), contents: `
import{useState}from'react';const f=()=>globalThis.fixture;
const record=e=>{f().events.push(e);localStorage.setItem('image-probe:trace',JSON.stringify(f().events))};
const mutation=fn=>({useMutation:()=>({mutateAsync:fn})});
const noMutation=mutation(async()=>{throw Error('unrequested generation')});
const query=fn=>({useQuery:input=>{const[,set]=useState(0);const data=typeof fn==='function'?fn(input):fn;return{data,isLoading:false,refetch:async()=>{set(v=>v+1);return{data}}}}});
export const trpc={useUtils:()=>({codeMotion:{get:{fetch:async()=>f().saved},prepare:{fetch:async()=>{throw Error('not exporting')}}},codeMotionProduction:{prepare:{fetch:async()=>({shots:[]})}}}),codeMotionProduction:{revisionQuote:query({completed:false,remaining:2,tier:"free",message:"先完成成片"}),revisionSubmit:noMutation,list:query({shots:[]}),submit:noMutation,adopt:noMutation},codeMotion:{
analyzeTiming:noMutation,quote:query({remainingFreeToday:3,credits:0,speechEnabled:true}),list:query(()=>f().saved?[{id:f().saved.project.id,title:f().saved.project.brief.title,updatedAt:'2026-10-10T19:00:00Z'}]:[]),history:query([]),status:query(null),sounds:query(()=>f().sounds),generateSound:mutation(async input=>{record({sound:input});let row=f().sounds.find(r=>r.request.requestId===input.request.requestId);if(!row){row={projectId:input.projectId,generation:input.generation,request:input.request,createdAt:'2026-10-10T19:00:00Z',status:'succeeded',canResume:false,variants:[{index:0,gcsUri:'gs://bucket/post-prod/7/audio/'+input.request.requestId+'.wav',previewUrl:'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA=',durationSec:input.request.kind==='speech'?2:40}]};f().sounds.push(row);localStorage.setItem('sound-probe:sounds',JSON.stringify(f().sounds))}return row}),adoptSound:mutation(async input=>{record({adoptSound:input});const row=f().sounds.find(r=>r.request.requestId===input.requestId);const r=row.request;return{id:r.requestId,name:r.kind==='speech'?'旁白'+r.sceneIndex:'背景音乐',gcsUri:'gs://bucket/post-prod/7/code-motion/'+input.projectId+'/audio/'+r.requestId+'/'+ 'a'.repeat(64)+'.wav',duration:r.kind==='speech'?2:40,mimeType:'audio/wav',sha256:'a'.repeat(64),bytes:100,generated:r.kind==='speech'?{requestId:r.requestId,kind:r.kind,sceneIndex:r.sceneIndex,text:r.text,voice:r.voice,emotion:r.emotion}:{requestId:r.requestId,kind:r.kind}}}),resolveAudios:query(input=>(input?.audios||[]).map(a=>({id:a.id,name:a.name,url:'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA='}))),importAudio:noMutation,resolveImages:query([]),importFile:noMutation,submit:noMutation,
save:mutation(async input=>{record('save');const generation=String(Number(f().saved?.generation||0)+1);f().saved={project:input.project,generation,updatedAt:'2026-10-10T19:00:00Z'};localStorage.setItem('image-probe:store',JSON.stringify(f().saved));return f().saved}),
imageAnalyze:mutation(async ()=>{throw Error("本夹具未调用语义模型")}),
imagePrepare:mutation(async input=>{record('prepare');f().prepared.generation=input.expectedGeneration;return f().prepared}),
imageSubmit:mutation(async input=>{record({submit:input});if(!f().batches.length)f().batches=[{...f().prepared,shots:f().prepared.shots.map((s,i)=>({...s,status:i===0?'succeeded':i===1?'failed':i===2?'queued':'not_started',canResume:i===3,previewUrl:i===0?'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="green"/></svg>'):null,error:i===1?'原任务待核对':null}))}];localStorage.setItem('image-probe:batches',JSON.stringify(f().batches));return{...f().batches[0],enqueueErrors:{}}}),
imageList:query(()=>f().batches),
imageAdopt:mutation(async input=>{record('apiAdopt');return{sceneIndex:input.index,image:{id:f().prepared.shots[input.index].requestId,name:'场景.png',gcsUri:'gs://bucket/uploads/u7/code-motion/'+ 'a'.repeat(64)+'.png'}}})},mvAnalysis:{askPlatformSkillQa:noMutation,getVideoUploadSignedUrl:noMutation}};` }));
    }}],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(7000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(e instanceof Error ? e.message : String(e)));
    await page.setRequestInterception(true);
    page.on("request", req => req.isNavigationRequest() ? void req.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : req.url().startsWith("data:") ? void req.continue() : void req.abort());
    await page.goto("http://localhost:41943/"); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const styles = await buildStyles({ configFile:false,root:path.resolve('client'),logLevel:'silent',plugins:[tailwindcss()],build:{write:false,rollupOptions:{input:path.resolve('client/src/index.css')}} });
    if(Array.isArray(styles)||!('output' in styles)) throw Error('style output missing');
    const css = styles.output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>a.type==='asset'?String(a.source):'').join('\n');
    await page.addStyleTag({content:css});
    const click = async (label: string) => {
      await page.waitForFunction(text => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === text && !b.disabled), {}, label);
      await page.evaluate(text => (Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === text) as HTMLButtonElement).click(), label);
    };
    await page.waitForFunction(()=>document.body.textContent?.includes('测试旁白3'));
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('yingke:draft:7')!).project.brief.audios||[])).toEqual([]);
    await click('生成尚未制作的旁白与配乐');
    await page.waitForFunction(()=>document.querySelectorAll('[aria-label="生成旁白和配乐"] article audio').length===5);
    expect(await page.evaluate(()=>(globalThis as any).fixture.events.filter((e:any)=>e.sound).length)).toBe(5);
    await click('生成尚未制作的旁白与配乐');
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='生成尚未制作的旁白与配乐')?.disabled);
    expect(await page.evaluate(()=>(globalThis as any).fixture.events.filter((e:any)=>e.sound).length)).toBe(5);
    for(let i=0;i<5;i++){
      await page.waitForFunction(index=>!(document.querySelectorAll('[aria-label="生成旁白和配乐"] article')[index]?.querySelector('button') as HTMLButtonElement)?.disabled,{},i);
      await page.evaluate(index=>(document.querySelectorAll('[aria-label="生成旁白和配乐"] article')[index]!.querySelector('button') as HTMLButtonElement).click(),i);
      await page.waitForFunction(count=>(globalThis as any).fixture.saved.project.brief.audios?.length===count,{},i+1);
    }
    const stored=await page.evaluate(()=>(globalThis as any).fixture.saved.project);
    expect(stored.brief.audios).toHaveLength(5);
    expect(stored.brief.audios.filter((a:any)=>a.generated.kind==='speech').map((a:any)=>a.generated.emotion)).toEqual(['[tired][very fast]','[whispers]','[amazed]','[empathetic]']);
    expect(await page.evaluate(()=>(globalThis as any).fixture.events.find((e:any)=>e.sound?.request.kind==='bgm').sound.request.direction)).toContain('15.0–20.0秒');
    expect(stored.plan.audioTimeline.filter((c:any)=>c.role==='narration').map((c:any)=>c.at)).toEqual([0,5,10,15]);
    expect(stored.plan.audioTimeline.find((c:any)=>c.role==='bgm')).toMatchObject({duration:20,volume:0.25});
    await page.reload(); await page.addScriptTag({content:bundle.outputFiles[0]!.text}); await page.addStyleTag({content:css});
    await page.waitForFunction(()=>document.querySelectorAll('[aria-label="生成旁白和配乐"] article audio').length===5);
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('yingke:draft:7')!).project);
    expect(restored.brief.audios).toEqual(stored.brief.audios); expect(restored.plan.audioTimeline).toEqual(stored.plan.audioTimeline);
    await click('生成尚未制作的旁白与配乐');
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()==='生成尚未制作的旁白与配乐')?.disabled);
    expect(await page.evaluate(()=>(globalThis as any).fixture.events.filter((e:any)=>e.sound).length)).toBe(5);
    const evidence=path.resolve('docs/evidence/code-motion-1011/sounds/emotion');await mkdir(evidence,{recursive:true});
    await writeFile(path.join(evidence,'studio-raw-trace.json'),JSON.stringify(await page.evaluate(()=>({events:(globalThis as any).fixture.events,stored:JSON.parse(localStorage.getItem('image-probe:store')!),local:JSON.parse(localStorage.getItem('yingke:draft:7')!),sounds:(globalThis as any).fixture.sounds})),null,2));
    await (await page.$('[aria-label="生成旁白和配乐"]'))!.screenshot({path:path.join(evidence,'sound-panel-restored.png')});
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60000);
