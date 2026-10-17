/** 检查真实工作台的上传、采用、云保存和刷新恢复；网络层使用离线受控回执。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("完整录音进入工作台并云保存，试听批准后刷新保留，改稿使旧音轨失效", async () => {
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 globalThis.calls=[];globalThis.cloud=null;globalThis.generation=0;globalThis.uploads=0;
 function App(){const[key,setKey]=React.useState(0);globalThis.remount=()=>setKey(v=>v+1);return <DigitalHumanStudio key={key}/>;}createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",loader:{'.css':'empty'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'offline',setup(b){
 b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'trpc',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/canvasUpload$/},()=>({path:'upload',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/digitalHumanVideo$/},()=>({path:'media',namespace:'offline'}));
 b.onResolve({filter:/^\.\/DigitalHuman(?:FilmDirectorPanel|OmniPanel|PostProduction|SpatialStudio|ProductionPanel)$/},a=>({path:a.path.split('/').at(-1)!,namespace:'empty'}));
 b.onLoad({filter:/.*/,namespace:'empty'},a=>({contents:`export function ${a.path}(){return null}`,loader:'js'}));
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({loader:'js',contents:a.path==='auth'?`export const useAuth=()=>({user:{id:7,role:'user'}});`:a.path==='upload'?`export async function uploadOneCanvasAsset({file}){globalThis.uploads++;return{gcsUri:'gs://test-only/uploads/u7/full.wav'};}`:a.path==='media'?`export const digitalHumanMediaUrl=async()=> 'https://example.test/audio.wav';export const digitalHumanVideoBlock=async()=>({});`:`
 const dataFor=name=>name==='listReferenceVoices'||name==='listDesignedVoices'?[]:undefined;
 async function call(group,name,input){globalThis.calls.push({group,name,input});if(name==='getDraft')return{draft:globalThis.cloud,generation:String(globalThis.generation)};if(name==='saveDraft'){globalThis.cloud=structuredClone(input.draft);return{generation:String(++globalThis.generation)}}if(name==='inspectNarration')return{source:input.source,durationSec:65.125};if(name==='listReferenceVoices')return[];return null;}
 const utils=new Proxy({}, {get:(_,g)=>new Proxy({}, {get:(_,n)=>({fetch:input=>call(g,n,input)})})});
 export const trpc=new Proxy({}, {get:(_,g)=>g==='useUtils'?()=>utils:new Proxy({}, {get:(_,n)=>({useQuery:()=>({data:dataFor(n),refetch:async()=>({data:dataFor(n)})}),useMutation:()=>({mutateAsync:input=>call(g,n,input)})})})});` }));
 }}],logLevel:'silent'});
 const browser=await puppeteer.launch({headless:true});
 try{const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>{void r.respond({status:200,contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'});});
 await page.goto('https://example.test');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>document.body.textContent?.includes('云端已保存'));
 await page.evaluate(()=>{const ta=Array.from(document.querySelectorAll('textarea')).find(t=>t.placeholder.includes('完整文案'))!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(ta,'这是完整录音对应的文稿。');ta.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>!(document.querySelector('[aria-label="上传完整旁白"]') as HTMLInputElement)?.disabled);
 await page.evaluate(()=>{const ta=document.querySelector('[aria-label="克隆配音演法"]') as HTMLTextAreaElement;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(ta,'开场坚定，句间自然停顿');ta.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>{const input=document.querySelector('[aria-label="上传完整旁白"]') as HTMLInputElement;const dt=new DataTransfer();dt.items.add(new File(['test-only'],'本人完整.wav',{type:'audio/wav'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(()=>Boolean((globalThis as any).cloud?.audios?.[0]));
 const saved=await page.evaluate(()=>(globalThis as any).cloud);expect(saved.audios[0]).toMatchObject({origin:'recording',status:'succeeded',durationSec:65.125,creditsCost:0});expect(saved.voiceId).toBe('');expect(saved.speechInstruction).toBe('开场坚定，句间自然停顿');
 expect(await page.evaluate(()=>document.body.textContent)).toContain('当前配音');
 await page.evaluate(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.includes('我已试听，确认声音'))!;(label.querySelector('input') as HTMLInputElement).click();});
 await page.waitForFunction(()=>Boolean((globalThis as any).cloud.approvedAudioRequestId));await page.evaluate(()=>(globalThis as any).remount());await page.waitForFunction(()=>document.body.textContent?.includes('云端稿件已恢复'));
 expect(await page.$eval('[aria-label="克隆配音演法"]', e=>(e as HTMLTextAreaElement).value)).toBe('开场坚定，句间自然停顿');
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.includes('我已试听，确认声音'))?.querySelector('input')?.checked)).toBe(true);
 await page.evaluate(()=>{const ta=Array.from(document.querySelectorAll('textarea')).find(t=>t.placeholder.includes('完整文案'))!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(ta,'变更后的文稿。');ta.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>document.body.textContent?.includes('历史配音'));
 const calls=await page.evaluate(()=>(globalThis as any).calls);expect(calls.some((c:any)=>c.name==='inspectNarration')).toBe(true);expect(calls.some((c:any)=>['generateDialogue','createReferenceVoice','getDialogue'].includes(c.name))).toBe(false);expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);
