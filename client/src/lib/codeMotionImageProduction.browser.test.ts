import { expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { build as buildStyles } from "vite";
import tailwindcss from "@tailwindcss/vite";
import puppeteer from "puppeteer";

it("official Studio image flow shows reviewed content, submits once, adopts, saves and restores after reload", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Studio from './client/src/pages/CodeMotionStudio';
import{codeMotionProjectSchema}from './shared/codeMotion';
const id='11111111-1111-4111-8111-111111111111',grant='22222222-2222-4222-8222-222222222222';
const p={id,brief:{title:'测试作品',request:'树林中的小球',style:'scenes',duration:20,orientation:'landscape',images:[]},plan:{version:1,summary:'四个画面',scenes:Array.from({length:4},(_,i)=>({heading:'画面'+i,body:'',duration:5,composition:{id:'scene'+i,duration:5,elements:[{id:'ball',type:'shape',shape:'ellipse'}]}}))}};
const saved=JSON.parse(localStorage.getItem('image-probe:store')||'null');
globalThis.fixture={events:JSON.parse(localStorage.getItem('image-probe:trace')||'[]'),batches:JSON.parse(localStorage.getItem('image-probe:batches')||'[]'),saved,prepared:{projectId:id,grantId:grant,generation:'3',tier:'free',fingerprint:'a'.repeat(64),credits:0,createdAt:'2026-10-10T19:00:00Z',shots:Array.from({length:4},(_,i)=>({index:i,name:'画面'+(i+1),prompt:'已保存镜头内容'+i,requestId:'33333333-3333-4333-8333-33333333333'+i,jobId:'fixed-job-'+i}))}};
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
analyzeTiming:noMutation,quote:query({remainingFreeToday:3,credits:0,speechEnabled:true}),list:query(()=>f().saved?[{id:f().saved.project.id,title:f().saved.project.brief.title,updatedAt:'2026-10-10T19:00:00Z'}]:[]),history:query([]),status:query(null),sounds:query([]),generateSound:noMutation,adoptSound:noMutation,resolveAudios:query([]),importAudio:noMutation,resolveImages:query([]),importFile:noMutation,submit:noMutation,
save:mutation(async input=>{record('save');const generation=String(Number(f().saved?.generation||0)+1);f().saved={project:input.project,generation,updatedAt:'2026-10-10T19:00:00Z'};localStorage.setItem('image-probe:store',JSON.stringify(f().saved));return f().saved}),
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
    await click("保存并查看场景图内容");
    await page.waitForFunction(() => document.body.textContent?.includes("已保存镜头内容3"));
    expect(await page.evaluate(() => (globalThis as any).fixture.events)).toEqual(["save", "prepare"]);
    await click("生成这组场景图（0 积分）");
    await page.waitForFunction(() => document.body.textContent?.includes("原任务待核对"));
    await click("采用到本镜");
    await page.waitForFunction(() => (globalThis as any).fixture.saved.project.brief.images.length === 1);
    expect(await page.evaluate(() => (globalThis as any).fixture.saved.project.plan.scenes[0].composition.elements.map((e: any) => e.id))).toEqual(["ink-generated-image-0", "ball"]);
    await click("继续原批次尚未开始的图片");
    const submissions = await page.evaluate(() => (globalThis as any).fixture.events.filter((e: any) => e.submit));
    expect(submissions).toHaveLength(2); expect(submissions[1]).toEqual(submissions[0]);
    await page.reload(); await page.addScriptTag({content:bundle.outputFiles[0]!.text}); await page.addStyleTag({content:css});
    await page.waitForFunction(()=>document.body.textContent?.includes('已采用 · 重新采用'));
    const restored = await page.evaluate(()=>JSON.parse(localStorage.getItem('yingke:draft:7')!).project);
    expect(restored.brief.images).toHaveLength(1);
    expect(restored.plan.scenes[0].composition.elements.map((e:any)=>e.id)).toEqual(['ink-generated-image-0','ball']);
    const evidence = path.resolve('docs/evidence/code-motion-1011/images'); await mkdir(evidence,{recursive:true});
    await writeFile(path.join(evidence,'studio-raw-trace.json'),JSON.stringify(await page.evaluate(()=>({events:(globalThis as any).fixture.events,stored:JSON.parse(localStorage.getItem('image-probe:store')!),local:JSON.parse(localStorage.getItem('yingke:draft:7')!),batches:(globalThis as any).fixture.batches})),null,2));
    await page.screenshot({path:path.join(evidence,'studio-restored.png'),fullPage:true});
    await (await page.$('[aria-label="制作场景图"]'))!.screenshot({path:path.join(evidence,'image-panel-restored.png')});
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60000);
