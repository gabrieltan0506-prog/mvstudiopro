/** 检查真实工作台的上传、采用、云保存和刷新恢复；网络层使用离线受控回执。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("场景首次上传保留预写描述，换图清旧描述，云端恢复不串场", async () => {
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft}from'./shared/digitalHumanStudio';globalThis.calls=[];globalThis.cloud=newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000007');globalThis.cloud.sceneDescription='首次预写空间要求';globalThis.cloud.script='本人新录音的测试文稿';globalThis.generation=0;globalThis.uploads=0;globalThis.cloneRequest=null;
 function App(){const[key,setKey]=React.useState(0);globalThis.remount=()=>setKey(v=>v+1);return <DigitalHumanStudio key={key}/>;}createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",loader:{'.css':'empty'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'offline',setup(b){
 b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'trpc',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/canvasUpload$/},()=>({path:'upload',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/digitalHumanVideo$/},()=>({path:'media',namespace:'offline'}));
 b.onResolve({filter:/^\.\/DigitalHuman(?:FilmDirectorPanel|OmniPanel|PostProduction|SpatialStudio|ProductionPanel)$/},a=>({path:a.path.split('/').at(-1)!,namespace:'empty'}));
 b.onLoad({filter:/.*/,namespace:'empty'},a=>({contents:`export function ${a.path}(){return null}`,loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({resolveDir:process.cwd(),loader:'js',contents:a.path==='auth'?`export const useAuth=()=>({user:{id:7,role:'user'}});`:a.path==='upload'?`export async function uploadOneCanvasAsset({file}){globalThis.uploads++;return{gcsUri:'gs://test-only/uploads/u7/scene-'+globalThis.uploads+'.png'};}`:a.path==='media'?`export const digitalHumanMediaUrl=async()=> 'https://example.test/audio.wav';export const digitalHumanVideoBlock=async()=>({});`:`
 import React from 'react';const dataFor=name=>name==='listReferenceVoices'?[...(globalThis.cloneRequest?[{requestId:globalThis.cloneRequest.requestId,labelZh:'我的声音',status:'ready',voiceId:'new-own-voice'}]:[]),{requestId:'old-request',labelZh:'旧声音',status:'ready',voiceId:'old-voice'}]:name==='listDesignedVoices'?[]:undefined;
 async function call(group,name,input){globalThis.calls.push({group,name,input});if(name==='getDraft')return{draft:globalThis.cloud,generation:String(globalThis.generation)};if(name==='saveDraft'){globalThis.cloud=structuredClone(input.draft);return{generation:String(++globalThis.generation)}}if(name==='inspectNarration')return{source:input.source,durationSec:65.125};if(name==='createReferenceVoice'){globalThis.cloneRequest=input;return{requestId:input.requestId,status:'processing',labelZh:input.labelZh};}if(name==='listReferenceVoices')return dataFor(name);return null;}
 const utils=new Proxy({}, {get:(_,g)=>new Proxy({}, {get:(_,n)=>({fetch:input=>call(g,n,input)})})});
 export const trpc=new Proxy({}, {get:(_,g)=>g==='useUtils'?()=>utils:new Proxy({}, {get:(_,n)=>({useQuery:()=>{const[data,setData]=React.useState(()=>dataFor(n));return{data,refetch:async()=>{const next=dataFor(n);setData(next);return{data:next};}}},useMutation:()=>({mutateAsync:input=>call(g,n,input)})})})});` }));
 }}],logLevel:'silent'});
 const browser=await puppeteer.launch({headless:true});
 try{const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>{void r.respond({status:200,contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'});});
 await page.goto('https://example.test');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>/云端已保存|云端稿件已恢复/.test(document.body.textContent||''));
 const upload=async()=>page.evaluate(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.trim()==='场景参考图')!;const input=label.querySelector('input')!;const dt=new DataTransfer();dt.items.add(new File(['image-test'],'scene.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
 await upload();await page.waitForFunction(()=>(globalThis as any).cloud.scene?.source.endsWith('scene-1.png'));
 expect(await page.evaluate(()=>(globalThis as any).cloud.sceneDescription)).toBe('首次预写空间要求');
 await page.waitForFunction(()=>!document.querySelector<HTMLFieldSetElement>('fieldset')?.disabled);
 await upload();await page.waitForFunction(()=>(globalThis as any).cloud.scene?.source.endsWith('scene-2.png'));
 expect(await page.evaluate(()=>(globalThis as any).cloud.sceneDescription)).toBe('');
 await page.evaluate(()=>(globalThis as any).remount());await page.waitForFunction(()=>/云端已保存|云端稿件已恢复/.test(document.body.textContent||''));
 expect(await page.evaluate(()=>(globalThis as any).cloud.sceneDescription)).toBe('');expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);
