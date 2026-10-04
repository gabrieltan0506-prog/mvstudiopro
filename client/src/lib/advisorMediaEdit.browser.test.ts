import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser, code: string;
beforeAll(async()=>{
 const bundle=await build({stdin:{contents:`import React,{useRef,useState} from 'react';import{createRoot}from'react-dom/client';import{ManhuaAdvisorMediaEdit}from'./client/src/components/canvas/ManhuaAdvisorMediaEdit';
 const f=globalThis.fixture={jobs:[],applied:[],confirmations:[],allow:true,pending:false};window.confirm=t=>{f.confirmations.push(t);return f.allow};
 const source={blockId:'keyart-1',kind:'image',url:'https://test/original.png',revision:'v1',label:'第一镜',aspectRatio:'9:16'};
 function App(){const ref=useRef(null);const[epoch,setEpoch]=useState(0);const[revision,setRevision]=useState('v1');const[consulting,setConsulting]=useState(false);f.execute=op=>ref.current.execute(op);f.consult=setConsulting;f.reload=()=>setEpoch(x=>x+1);f.stale=()=>setRevision('v2');f.propose=()=>ref.current.propose({kind:'image',blockId:'keyart-1',instruction:'保留人物，背景改为月夜'});return <ManhuaAdvisorMediaEdit key={epoch} ref={ref} scopeKey='7:project-a' userId='7' consulting={consulting} workspace={{sources:[{...source,revision}],validate:plan=>{if(plan.source.revision!==revision)throw Error('原图已变化')},applyImage:(p,u)=>f.applied.push(u),editVideo:()=>''}}/>};createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic',format:'iife',platform:'browser',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'mock-jobs',setup(b){b.onResolve({filter:/advisorMediaImageJob$/},()=>({path:'job',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export async function runAdvisorImageEdit(p){const f=globalThis.fixture;f.jobs.push({variant:p.variant,previewUrl:p.previewUrl,jobId:p.jobId});if(!p.jobId)p.onJob('job-'+p.variant);if(f.failOnce){f.failOnce=false;throw Object.assign(Error('隔离明确失败'),{terminal:true})}if(f.pending)return new Promise(resolve=>f.resolve=resolve);return 'https://test/'+p.variant+'.png'}`,loader:'js'}))}}]});
 code=bundle.outputFiles[0].text;browser=await puppeteer.launch({headless:true});
},60000);
afterAll(async()=>{await browser?.close()});
async function page(){const p=await browser.newPage();p.setDefaultTimeout(6000);await p.setRequestInterception(true);p.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await p.goto('http://localhost:41849');await p.addScriptTag({content:code});await p.waitForFunction(()=>!!(globalThis as any).fixture.propose);return p;}
async function click(p:Page,t:string){await p.evaluate(t=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===t);if(!b)throw Error(t);b.click()},t)}
it('真实组件：方案不调用模型，Flare完成不自动Sunburst；取消无请求，确认只提交一次，采用单独确认',async()=>{
 const p=await page();await p.evaluate(()=>(globalThis as any).fixture.propose());await p.waitForFunction(()=>document.body.textContent?.includes('当前方案'));
 expect(await p.evaluate(()=>(globalThis as any).fixture.jobs)).toEqual([]);
 await click(p,'生成Flare预览');await p.waitForFunction(()=>!!document.querySelector('img[alt="Flare修改预览"]'));
 expect(await p.evaluate(()=>(globalThis as any).fixture.jobs)).toEqual([{variant:'flare'}]);expect(await p.evaluate(()=>(globalThis as any).fixture.applied)).toEqual([]);
 await p.evaluate(()=>(globalThis as any).fixture.allow=false);await click(p,'我确认，生成Sunburst');expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.length)).toBe(1);
 await p.evaluate(()=>(globalThis as any).fixture.allow=true);await click(p,'我确认，生成Sunburst');await p.waitForFunction(()=>!!document.querySelector('img[alt="Sunburst修改结果"]'));
 expect(await p.evaluate(()=>(globalThis as any).fixture.jobs[1])).toEqual({variant:'sunburst',previewUrl:'https://test/flare.png'});expect(await p.evaluate(()=>(globalThis as any).fixture.applied)).toEqual([]);
 await click(p,'采用Sunburst图片');expect(await p.evaluate(()=>(globalThis as any).fixture.applied)).toEqual(['https://test/sunburst.png']);await p.close();
});
it('真实组件：未决任务刷新后恢复原编号，禁止重复新单；原图变化禁止Sunburst',async()=>{
 const p=await page();await p.evaluate(()=>{const f=(globalThis as any).fixture;f.pending=true;f.propose()});await click(p,'生成Flare预览');await p.waitForFunction(()=>!!localStorage.getItem('advisor-media-edit:7:project-a')?.includes('job-flare'));
 await p.evaluate(()=>{const f=(globalThis as any).fixture;f.pending=false;f.reload()});await p.waitForFunction(()=>document.body.textContent?.includes('查询flare原任务'));
 await click(p,'生成Flare预览');expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.length)).toBe(1);
 await click(p,'查询flare原任务（不重提）');await p.waitForFunction(()=>!!document.querySelector('img[alt="Flare修改预览"]'));expect(await p.evaluate(()=>(globalThis as any).fixture.jobs[1].jobId)).toBe('job-flare');
 await p.evaluate(()=>(globalThis as any).fixture.stale());await click(p,'我确认，生成Sunburst');await p.waitForFunction(()=>document.body.textContent?.includes('原素材已变化'));expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.length)).toBe(2);await p.close();
});
it('新增预览不会沿用上一张Sunburst结果或旧确认',async()=>{
 const p=await page();await p.evaluate(()=>(globalThis as any).fixture.propose());await p.waitForFunction(()=>document.body.textContent?.includes('当前方案'));
 await click(p,'生成Flare预览');await p.waitForFunction(()=>!!document.querySelector('img[alt="Flare修改预览"]'));
 await click(p,'我确认，生成Sunburst');await p.waitForFunction(()=>!!document.querySelector('img[alt="Sunburst修改结果"]'));
 await click(p,'生成Flare预览');await p.waitForFunction(()=>!document.querySelector('img[alt="Sunburst修改结果"]'));
 expect(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('advisor-media-edit:7:project-a:history:')))).toBe(true);
 expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.map((j:any)=>j.variant))).toEqual(['flare','sunburst','flare']);
 await p.close();
});

it('顾问仍在返回结果时可接收方案，但等待结束前不能生成',async()=>{
 const p=await page();await p.evaluate(()=>(globalThis as any).fixture.consult(true));
 await p.waitForFunction(()=>(document.querySelector('textarea') as HTMLTextAreaElement)?.disabled);
 await p.evaluate(()=>(globalThis as any).fixture.propose());
 await p.waitForFunction(()=>document.body.textContent?.includes('当前方案'));
 await click(p,'生成Flare预览');expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.length)).toBe(0);
 await p.evaluate(()=>(globalThis as any).fixture.consult(false));
 await p.waitForFunction(()=>!(document.querySelector('textarea') as HTMLTextAreaElement)?.disabled);
 await click(p,'生成Flare预览');await p.waitForFunction(()=>!!document.querySelector('img[alt="Flare修改预览"]'));
 expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.length)).toBe(1);await p.close();
});

it('语音图片执行：失败重试保留旧记录，取消不扣，Flare不自动Sunburst，采用明确确认',async()=>{
 const p=await page();try{await p.evaluate(()=>(globalThis as any).fixture.propose());await p.waitForFunction(()=>document.body.textContent?.includes('当前方案'));
 await p.evaluate(()=>{const f=(globalThis as any).fixture;f.allow=false});await p.evaluate(()=>(globalThis as any).fixture.execute('previewImage'));expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.length)).toBe(0);
 await p.evaluate(()=>{const f=(globalThis as any).fixture;f.allow=true;f.failOnce=true});let value=JSON.parse(await p.evaluate(()=>(globalThis as any).fixture.execute('previewImage')));expect(value.record.previews[0].status).toBe('failed');
 value=JSON.parse(await p.evaluate(()=>(globalThis as any).fixture.execute('previewImage')));expect(value.record.previews.map((r:any)=>r.status)).toEqual(['failed','done']);expect(value.record.result).toBeUndefined();expect(await p.evaluate(()=>(globalThis as any).fixture.jobs.length)).toBe(2);
 await p.evaluate(()=>(globalThis as any).fixture.execute('finishImage'));expect(await p.evaluate(()=>(globalThis as any).fixture.applied)).toEqual([]);
 await p.evaluate(()=>(globalThis as any).fixture.allow=false);expect(await p.evaluate(()=>(globalThis as any).fixture.execute('applyImage'))).toContain('取消');
 await p.evaluate(()=>(globalThis as any).fixture.allow=true);expect(await p.evaluate(()=>(globalThis as any).fixture.execute('applyImage'))).toContain('已采用');expect(await p.evaluate(()=>(globalThis as any).fixture.applied)).toEqual(['https://test/sunburst.png']);
 expect(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('advisor-media-edit:7:project-a:history:')))).toBe(true);
 }finally{await p.close()}
},20000);
