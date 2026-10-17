/** 检查真实工作台的上传、采用、云保存和刷新恢复；网络层使用离线受控回执。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("录音克隆异步完成后更新真实声线列表并替换旧选择、云保存", async () => {
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft}from'./shared/digitalHumanStudio';globalThis.calls=[];globalThis.cloud=newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000007');globalThis.cloud.voiceId='old-voice';globalThis.cloud.script='本人新录音的测试文稿';globalThis.generation=0;globalThis.uploads=0;globalThis.cloneRequest=null;
 function App(){const[key,setKey]=React.useState(0);globalThis.remount=()=>setKey(v=>v+1);return <DigitalHumanStudio key={key}/>;}createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",loader:{'.css':'empty'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'offline',setup(b){
 b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'trpc',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/canvasUpload$/},()=>({path:'upload',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/digitalHumanVideo$/},()=>({path:'media',namespace:'offline'}));
 b.onResolve({filter:/^\.\/DigitalHuman(?:FilmDirectorPanel|OmniPanel|PostProduction|SpatialStudio|ProductionPanel)$/},a=>({path:a.path.split('/').at(-1)!,namespace:'empty'}));
 b.onLoad({filter:/.*/,namespace:'empty'},a=>({contents:`export function ${a.path}(){return null}`,loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({resolveDir:process.cwd(),loader:'js',contents:a.path==='auth'?`export const useAuth=()=>({user:{id:7,role:'user'}});`:a.path==='upload'?`export async function uploadOneCanvasAsset({file}){globalThis.uploads++;return{gcsUri:'gs://test-only/uploads/u7/full.wav'};}`:a.path==='media'?`export const digitalHumanMediaUrl=async()=> 'https://example.test/audio.wav';export const digitalHumanVideoBlock=async()=>({});`:`
 import React from 'react';const dataFor=name=>name==='listReferenceVoices'?[...(globalThis.cloneRequest?[{requestId:globalThis.cloneRequest.requestId,labelZh:'我的声音',status:'ready',voiceId:'new-own-voice'}]:[]),{requestId:'old-request',labelZh:'旧声音',status:'ready',voiceId:'old-voice'}]:name==='listDesignedVoices'?[]:undefined;
 async function call(group,name,input){globalThis.calls.push({group,name,input});if(name==='getDraft')return{draft:globalThis.cloud,generation:String(globalThis.generation)};if(name==='saveDraft'){globalThis.cloud=structuredClone(input.draft);return{generation:String(++globalThis.generation)}}if(name==='inspectNarration')return{source:input.source,durationSec:65.125};if(name==='createReferenceVoice'){globalThis.cloneRequest=input;return{requestId:input.requestId,status:'processing',labelZh:input.labelZh};}if(name==='listReferenceVoices')return dataFor(name);return null;}
 const utils=new Proxy({}, {get:(_,g)=>new Proxy({}, {get:(_,n)=>({fetch:input=>call(g,n,input)})})});
 export const trpc=new Proxy({}, {get:(_,g)=>g==='useUtils'?()=>utils:new Proxy({}, {get:(_,n)=>({useQuery:()=>{const[data,setData]=React.useState(()=>dataFor(n));return{data,refetch:async()=>{const next=dataFor(n);setData(next);return{data:next};}}},useMutation:()=>({mutateAsync:input=>call(g,n,input)})})})});` }));
 }}],logLevel:'silent'});
 const browser=await puppeteer.launch({headless:true});
 try{const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>{void r.respond({status:200,contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'});});
 await page.goto('https://example.test');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>/云端已保存|云端稿件已恢复/.test(document.body.textContent||''));
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('select')).find(s=>s.value==='old-voice')?.value)).toBe('old-voice');
 await page.evaluate(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.includes('我拥有这段录音'))!;(label.querySelector('input') as HTMLInputElement).click();});
 await page.evaluate(()=>{
 const frames=48000*4,b=new ArrayBuffer(44+frames*2),v=new DataView(b);const text=(o:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};text(0,'RIFF');v.setUint32(4,b.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,frames*2,true);for(let i=0;i<frames;i++)v.setInt16(44+i*2,Math.sin(i/48000*440*2*Math.PI)*10000,true);
 const input=document.querySelector('[aria-label="上传声音参考"]') as HTMLInputElement;const dt=new DataTransfer();dt.items.add(new File([b],'本人样本.wav',{type:'audio/wav'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.waitForFunction(()=>Boolean((globalThis as any).cloud?.cloneRequest),{timeout:5000}).catch(async e=>{throw new Error(String(e)+JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,calls:(globalThis as any).calls}))))});
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('生成配音并试听'))?.disabled)).toBe(true);
 await page.waitForFunction(()=>(globalThis as any).cloud?.voiceId==='new-own-voice',{timeout:25_000});
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('select')).find(s=>s.value==='new-own-voice')?.selectedOptions[0]?.text)).toBe('我的声音');
 expect(await page.evaluate(()=>(globalThis as any).cloud.cloneRequest)).toBeUndefined();
 expect(await page.evaluate(()=>document.body.innerText)).toContain('本人新声线已建立并选中');
 const calls=await page.evaluate(()=>(globalThis as any).calls);expect(calls.filter((c:any)=>c.name==='createReferenceVoice')).toHaveLength(1);expect(calls.some((c:any)=>c.name==='generateDialogue')).toBe(false);expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);
