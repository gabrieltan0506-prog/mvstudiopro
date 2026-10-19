/** 真实工作台与保存编排；付费子面板和RPC使用离线替身，不代表线上验收。 */
import { it, expect } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
it('真实工作台切段后原回调仅写原段，云稿恢复保持全部段落', async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft,digitalHumanDraftKey,digitalHumanDraftSchema}from'./shared/digitalHumanStudio';
 globalThis.cloud=digitalHumanDraftSchema.parse(newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000001'));globalThis.cloud.script='旧稿第一段';globalThis.generation=1;globalThis.callbacks={};globalThis.writes=[];
 localStorage.setItem(digitalHumanDraftKey('7'),JSON.stringify(globalThis.cloud));
 function App(){const[k,setK]=React.useState(0);globalThis.restore=()=>setK(k=>k+1);return <DigitalHumanStudio key={k}/>}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'offline-services',setup(b){
 b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'offline'}));
 b.onResolve({filter:/(?:^@\/lib\/trpc$|\/trpc$)/},()=>({path:'rpc',namespace:'offline'}));
 b.onResolve({filter:/\/DigitalHuman(?:SpatialStudio|Recorder|OmniPanel|PostProduction|ProductionPanel|FilmDirectorPanel|KeyframeAdvicePanel|KeyframeGenerationPanel|KeyframePanel|PublicationPanel)$/},args=>({path:args.path.split('/').pop()!,namespace:'panel'}));
 b.onResolve({filter:/\/PostProdWorkshopCard$/},()=>({path:'PostProdWorkshopCard',namespace:'panel'}));
 b.onLoad({filter:/.*/,namespace:'panel'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';export function ${args.path}(p){if(p.draft&&p.save)globalThis.callbacks[p.draft.id]=p.save;return null}export default ${args.path};`}));
 b.onLoad({filter:/.*/,namespace:'offline'},args=>({loader:'js',contents:args.path==='auth'?`export const useAuth=()=>({user:{id:7,role:'user'}})`:`
 const query={data:[],refetch:async()=>({data:[]})};
 const utils={digitalHuman:{getDraft:{fetch:async()=>({draft:structuredClone(globalThis.cloud),generation:String(globalThis.generation)})}}};
 export const trpc=new Proxy({}, {get:(_,key)=>key==='useUtils'?()=>utils:new Proxy({}, {get:(_,method)=>({useQuery:()=>query,useMutation:()=>({mutateAsync:async input=>{if(method!=='saveDraft')throw Error('禁止生产调用 '+method);if(input.expectedGeneration!==String(globalThis.generation))throw Error('云版本冲突');globalThis.cloud=structuredClone(input.draft);globalThis.writes.push(input);return{generation:String(++globalThis.generation)};}})})})});` }));
 }}],logLevel:'silent'});
 const browser=await puppeteer.launch({headless:true});
 try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(10000);
 await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('https://test.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const click=(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text);if(!b||b.disabled)throw Error('按钮不可用 '+text);b.click()},text);
 await page.waitForFunction(()=>document.body.textContent?.includes('云端稿件已恢复')).catch(async e=>{console.log('工作台现场',errors,await page.evaluate(()=>document.body.textContent?.slice(0,1200)));throw e;});
 await click('＋ 新增段落');await page.waitForFunction(()=>(globalThis as any).cloud.project?.segments.length===2&&document.body.textContent?.includes('云端已保存'));
 await page.$eval('textarea[maxlength="4000"]',e=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(e,'第二段独立正文');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>(globalThis as any).cloud.script==='第二段独立正文');
 await page.evaluate(()=>(globalThis as any).callbacks['00000000-0000-4000-8000-000000000001']((d:any)=>({...d,direction:'第一段迟到的导演答复'})));
 await page.waitForFunction(()=>(globalThis as any).cloud.project.segments[0].draft.direction==='第一段迟到的导演答复');
 expect(await page.evaluate(()=>(globalThis as any).cloud.script)).toBe('第二段独立正文');
 await page.evaluate(()=>(globalThis as any).restore());await page.waitForFunction(()=>document.body.textContent?.includes('云端稿件已恢复'));
 await click('进入编辑 →');await page.waitForFunction(()=>(globalThis as any).cloud.id==='00000000-0000-4000-8000-000000000001');
 expect(await page.$eval('textarea[maxlength="4000"]',e=>(e as HTMLTextAreaElement).value)).toBe('旧稿第一段');
 expect(await page.evaluate(()=>(globalThis as any).cloud.direction)).toBe('第一段迟到的导演答复');
 expect(await page.evaluate(()=>(globalThis as any).cloud.project.segments[1].draft.script)).toBe('第二段独立正文');
 await click('4生成视频');
 await page.waitForSelector('[aria-label="Cinema导演工作台"]',{visible:true});
 await page.$$eval('[aria-label="Cinema导演工作台"] summary',nodes=>(nodes.find(n=>n.textContent?.startsWith('色彩')) as HTMLElement).click());
 await page.select('[aria-label="Cinema色彩"]','暖金');
 await click('采用到完整导演要求');
 await page.waitForFunction(()=>(globalThis as any).cloud.cinema?.palette==='暖金'&&(globalThis as any).cloud.direction.includes('色彩：暖金'));
 await page.evaluate(()=>(globalThis as any).restore());
 await page.waitForFunction(()=>document.body.textContent?.includes('云端稿件已恢复'));
 await click('进入编辑 →');await click('4生成视频');
 expect(await page.$eval('[aria-label="Cinema色彩"]',n=>(n as HTMLSelectElement).value)).toBe('暖金');
 expect(await page.evaluate(()=>(globalThis as any).cloud.direction)).toContain('第一段迟到的导演答复');
 expect(await page.$eval('[aria-label="Cinema导演工作台"] .dh-cinema-status',n=>n.textContent)).toBe('已采用');
 expect(errors).toEqual([]);
 }finally{await browser.close()}
},60000);
