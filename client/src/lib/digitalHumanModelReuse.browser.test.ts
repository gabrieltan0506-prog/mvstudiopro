/** 真实工作台与保存编排；付费子面板和RPC使用离线替身，不代表线上验收。 */
import { it, expect } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
it('真实采用入口复用ABC原模型，保存恢复不串段，查询失败不覆盖且零生产调用', async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft,digitalHumanDraftKey,digitalHumanDraftSchema}from'./shared/digitalHumanStudio';
 globalThis.cloud=digitalHumanDraftSchema.parse(newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000001'));globalThis.cloud.script='A台词';globalThis.reads=[];globalThis.mutations=[];globalThis.failModel=false;globalThis.models=Object.fromEntries(['A','B','C'].map(n=>['test-'+n,{taskId:'test-'+n,assetRef:'test-original-person',status:'succeeded',sourceVersion:'gs://test-only/'+n+'.png',sourceImageUrl:'https://example.invalid/'+n+'.png',glbGcsUri:'gs://test-only/'+n+'.glb',updatedAt:new Date(1000).toISOString()}]));globalThis.cloud.modelHistory=Object.values(globalThis.models).map(m=>({assetRef:'dh-person-'+globalThis.cloud.id,model:{...m,updatedAt:1000}}));globalThis.generation=1;globalThis.callbacks={};globalThis.writes=[];
 globalThis.cloud=digitalHumanDraftSchema.parse(globalThis.cloud);localStorage.setItem(digitalHumanDraftKey('7'),JSON.stringify(globalThis.cloud));
 function App(){const[k,setK]=React.useState(0);globalThis.restore=()=>setK(k=>k+1);return <DigitalHumanStudio key={k}/>}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'offline-services',setup(b){
 b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'offline'}));
 b.onResolve({filter:/(?:^@\/lib\/trpc$|\/trpc$)/},()=>({path:'rpc',namespace:'offline'}));
 b.onResolve({filter:/\/DigitalHuman(?:SpatialStudio|Recorder|OmniPanel|PostProduction|ProductionPanel|FilmDirectorPanel|KeyframeAdvicePanel|KeyframeGenerationPanel|KeyframePanel|PublicationPanel)$/},args=>({path:args.path.split('/').pop()!,namespace:'panel'}));
 b.onResolve({filter:/\/PostProdWorkshopCard$/},()=>({path:'PostProdWorkshopCard',namespace:'panel'}));
 b.onLoad({filter:/.*/,namespace:'panel'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';export function ${args.path}(p){if(p.draft&&p.save)globalThis.callbacks[p.draft.id]=p.save;return null}export default ${args.path};`}));
 b.onLoad({filter:/.*/,namespace:'offline'},args=>({loader:'js',contents:args.path==='auth'?`export const useAuth=()=>({user:{id:7,role:'user'}})`:`
 const query={data:[],refetch:async()=>({data:[]})};
 const utils={digitalHuman:{getModel:{fetch:async({taskId})=>{globalThis.reads.push(taskId);if(globalThis.failModel)throw Error('原模型读取失败');return globalThis.models[taskId];}},getDraft:{fetch:async()=>({draft:structuredClone(globalThis.cloud),generation:String(globalThis.generation)})}}};
 export const trpc=new Proxy({}, {get:(_,key)=>key==='useUtils'?()=>utils:new Proxy({}, {get:(_,method)=>({useQuery:()=>query,useMutation:()=>({mutateAsync:async input=>{globalThis.mutations.push(method);if(method!=='saveDraft')throw Error('禁止生产调用 '+method);if(input.expectedGeneration!==String(globalThis.generation))throw Error('云版本冲突');globalThis.cloud=structuredClone(input.draft);globalThis.writes.push(input);return{generation:String(++globalThis.generation)};}})})})});` }));
 }}],logLevel:'silent'});
 const browser=await puppeteer.launch({headless:true});
 try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(10000);
 await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('https://test.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const click=(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text);if(!b||b.disabled)throw Error('按钮不可用 '+text);b.click()},text);
 await page.waitForFunction(()=>document.body.textContent?.includes('云端稿件已恢复')).catch(async e=>{console.log('工作台现场',errors,await page.evaluate(()=>document.body.textContent?.slice(0,1200)));throw e;});
 const adopt=async(name:string)=>{await page.evaluate(name=>{const select=Array.from(document.querySelectorAll('select')).find(e=>e.textContent?.includes('选择已生成的人物造型'))!;select.value='test-'+name;select.dispatchEvent(new Event('change',{bubbles:true}));},name);};
 await click('进入编辑 →');
 await page.waitForFunction(()=>document.body.textContent?.includes('云端已保存'));
 for(const name of ['A','B','C']){
   if(name!=='A'){await click('＋ 新增段落');await page.waitForFunction(()=>document.body.textContent?.includes('云端已保存')&&!document.body.textContent?.includes('正在保存并切换'));}
   await adopt(name);await page.waitForFunction(n=>(globalThis as any).cloud.mainModel?.taskId==='test-'+n&&document.body.textContent?.includes('云端已保存'),{},name);
   await page.$eval('textarea[maxlength="4000"]',(e,n)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(e,n+'台词');e.dispatchEvent(new Event('input',{bubbles:true}));},name);
   await page.waitForFunction(n=>(globalThis as any).cloud.script===n+'台词',{},name);
 }
 const before=await page.evaluate(()=>JSON.stringify((globalThis as any).cloud));
 await page.evaluate(()=>(globalThis as any).failModel=true);await adopt('A');
 await page.waitForFunction(()=>document.body.textContent?.includes('原模型读取失败'));
 expect(await page.evaluate(()=>JSON.stringify((globalThis as any).cloud))).toBe(before);
 await page.evaluate(()=>(globalThis as any).restore());await page.waitForFunction(()=>document.body.textContent?.includes('云端稿件已恢复'));
 const rows=await page.evaluate(()=>{const d=(globalThis as any).cloud;return d.project.segments.map((s:any)=>{const v=s.id===d.id?d:s.draft;return [v.mainModel.taskId,v.portrait.source,v.script,v.mainModel.assetRef]})});
 expect(rows).toEqual(['A','B','C'].map(n=>['test-'+n,'gs://test-only/'+n+'.png',n+'台词','test-original-person']));
 expect(await page.evaluate(()=>(globalThis as any).reads)).toEqual(['test-A','test-B','test-C','test-A']);
 expect(await page.evaluate(()=>Array.from(new Set((globalThis as any).mutations)))).toEqual(['saveDraft']);
 expect(errors).toEqual([]);
 }finally{await browser.close()}
},60000);
