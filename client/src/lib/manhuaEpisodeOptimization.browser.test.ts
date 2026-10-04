import {afterAll,beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import puppeteer,{type Browser} from 'puppeteer';
import path from 'node:path';
let browser:Browser,bundle:string;
beforeAll(async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import Workspace from './client/src/components/canvas/ManhuaEpisodeOptimization';
const f=globalThis.fixture={calls:[],applied:[],recommendations:[],left:3,history:[],listeners:[],confirmations:[]};
const body='沈昀把信件压在账册下，借灯光核对来人的腰牌。他没有抢答，先询问封门的缘由，再把名单递到桌沿，让对方自己看见。';
f.episodes=[1,2,3].map(index=>({index,title:'文书库'+index,body:body+index,endHook:'明晚相见，后日追责。'}));
f.templates=['mt_bf6e','mt_4737','mt_1b5b'].map((publicId,i)=>({publicId,nameZh:'模板'+i,methodBrief:{title:['灯影下的试探','悬刃下的从容','烟火气中的同盟'][i],highlights:[['冷暖光对照','空间站位压迫'],['环境声留白','危险中从容动作'],['轻松反差','日常物件推动关系']][i]}}));
f.plans=f.templates.map(t=>({publicId:t.publicId,reason:'依当前文书库场景注入'+t.methodBrief.highlights[0],changes:t.methodBrief.highlights,preserve:'原人物动机与时间因果'}));
window.confirm=m=>{f.confirmations.push(m);return true;};
function App(){const[focus,setFocus]=useState(1),[plans,setPlans]=useState([]),[model,setModel]=useState('glm');f.setModel=setModel;return <><main id='left'/><aside><Workspace userId='7' projectId='20000000-0000-4000-8000-000000000001' focusEpisode={focus} episodes={f.episodes} model={model} comparisonHost={document.getElementById('left')} onFocusEpisode={setFocus} onApplyCandidates={c=>{f.applied.push(c);return true;}} templates={f.templates} plans={plans} asking={false} onRecommend={e=>{f.recommendations.push(e);setPlans(f.plans);}}/></aside></>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},plugins:[{name:'mock-boundaries',setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'mock',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({resolveDir:process.cwd(),loader:'js',contents:`import{useState,useEffect}from'react';function query(value){const[,tick]=useState(0);useEffect(()=>{const listener=()=>tick(x=>x+1);globalThis.fixture.listeners.push(listener);return()=>{globalThis.fixture.listeners=globalThis.fixture.listeners.filter(x=>x!==listener);};},[]);return {data:value(),refetch:async()=>{globalThis.fixture.listeners.forEach(l=>l());return {data:value()};}};}export const trpc={mvAnalysis:{manhuaEpisodeOptimizationQuota:{useQuery:()=>query(()=>({trialsLeftToday:globalThis.fixture.left}))},manhuaEpisodeOptimizationHistory:{useQuery:()=>query(()=>globalThis.fixture.history)},optimizeManhuaEpisodes:{useMutation:()=>({isPending:false,mutateAsync:async input=>{const f=globalThis.fixture;f.calls.push(input);if(input.mode==='trial')f.left--;return {requestId:input.requestId,projectId:input.projectId,mode:input.mode,model:input.model,creditsCost:input.confirmedCredits,templates:input.templates.map(t=>({publicId:t.publicId,nameZh:f.templates.find(c=>c.publicId===t.publicId).nameZh})),candidates:input.episodes.map(e=>({episodeIndex:e.index,originalBody:e.body,originalEndHook:e.endHook,rewrittenBody:e.body+'窗外暖光穿过烟雨，照亮桌上信件。',endHook:e.endHook+'门外有人敲门。',changes:['将灯光和调度落实到整集']}))};}})}}};`}));}}],define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{}'}});bundle=built.outputFiles[0].text;browser=await puppeteer.launch({headless:true});
},30000);
afterAll(async()=>{await browser?.close();});
it('真实UI选集→三模板试写→特色组合→左侧编辑与套用→刷新取回临时编辑',async()=>{
 const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41829/');await page.addScriptTag({content:bundle});
 const click=async(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);if(!b)throw Error(text);b.click();},text);
 const check=async(text:string)=>page.evaluate(text=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent?.includes(text));const c=label?.querySelector('input');if(!c)throw Error(text);c.click();},text);
 await page.waitForFunction(()=>document.body.textContent?.includes('作品共 3 集'));await check('第2集 ·');await click('为所选剧集推荐3—5个模板');await page.waitForFunction(()=>document.body.textContent?.includes('灯影下的试探'));
 expect(await page.evaluate(()=>(globalThis as any).fixture.recommendations[0].map((e:any)=>e.index))).toEqual([1,2]);
 for(let n=0;n<3;n++){await page.evaluate(n=>{const buttons=Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='试写一集 · 免费');buttons[n].click();},n);await page.waitForFunction(n=>(globalThis as any).fixture.calls.length===n+1,{},n);await page.waitForFunction(n=>document.body.textContent?.includes('今日剩余 '+(2-n)+' / 3'),{},n);}
 expect(await page.evaluate(()=>(globalThis as any).fixture.calls.every((c:any)=>c.episodes.length===1&&c.templates.length===1&&c.confirmedCredits===0))).toBe(true);
 await page.waitForSelector('#left [aria-label="整集模板试写对比"]');expect(await page.evaluate(()=>(globalThis as any).fixture.applied.length)).toBe(0);
 for(const text of ['冷暖光对照','环境声留白','日常物件推动关系'])await check(text);
 await click('按所选特色优化2集 · 12积分');await page.waitForSelector('[aria-label="组合优化整集正文"]');
 const payload=await page.evaluate(()=>(globalThis as any).fixture.calls[3]);expect(payload.templates.map((t:any)=>t.features)).toEqual([['brief:0:冷暖光对照'],['brief:0:环境声留白'],['brief:1:日常物件推动关系']]);expect(payload.confirmedCredits).toBe(12);expect(await page.evaluate(()=>(globalThis as any).fixture.confirmations[0])).toContain('共12积分');expect(await page.evaluate(()=>(globalThis as any).fixture.applied.length)).toBe(0);
 await page.$eval('[aria-label="组合优化整集正文"]',e=>{const t=e as HTMLTextAreaElement;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(t,t.value+'补上衣袖沾湿的细节。');t.dispatchEvent(new Event('input',{bubbles:true}));});await click('套用本批2集');
 expect(await page.evaluate(()=>(globalThis as any).fixture.applied[0].length)).toBe(2);expect(await page.evaluate(()=>(globalThis as any).fixture.applied[0][0].rewrittenBody)).toContain('补上衣袖沾湿的细节');
 await page.$eval('[aria-label="组合优化整集正文"]',e=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(e,'尚在编辑');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.reload();await page.addScriptTag({content:bundle});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.startsWith('组合优化 · 第1集')));await page.evaluate(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.startsWith('组合优化 · 第1集'))!.click();});
 expect(await page.$eval('[aria-label="组合优化整集正文"]',e=>(e as HTMLTextAreaElement).value)).toBe('尚在编辑');expect(await page.evaluate(()=>(globalThis as any).fixture.calls.length)).toBe(0);
 await page.close();
},20000);
it('刷新遇到原请求失败只取回状态，明确点击才继续原请求，不自动再次生成',async()=>{
 const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41830/');
 const pending={requestId:'10000000-0000-4000-8000-000000000003',projectId:'20000000-0000-4000-8000-000000000001',model:'glm',mode:'optimize',episodes:[1,2].map(index=>({index,title:'文书库'+index,body:'沈昀把信件压在账册下，借灯光核对来人的腰牌。他没有抢答，先询问封门的缘由，再把名单递到桌沿，让对方自己看见。'+index,endHook:'明晚相见，后日追责。'})),templates:[{publicId:'mt_bf6e',features:['brief:0:冷暖光对照']}],confirmedCredits:12};
 await page.evaluate(p=>localStorage.setItem('mvs:episode-optimization:7:20000000-0000-4000-8000-000000000001',JSON.stringify({selected:[1,2],features:{},results:[],pending:p})),pending);await page.addScriptTag({content:bundle});await page.waitForSelector('[aria-label="选集与模板组合优化"]');
 await page.evaluate(p=>{const f=(globalThis as any).fixture;f.history=[{requestId:p.requestId,status:'failed',phase:'failed',error:'第二集连接中断',candidates:[],completedEpisodes:1,result:null}];f.listeners.forEach((l:any)=>l());},pending);
 await page.waitForFunction(()=>document.body.textContent?.includes('仅继续未完成集'));expect(await page.evaluate(()=>(globalThis as any).fixture.calls.length)).toBe(0);
 await page.evaluate(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='仅继续未完成集')!.click();});await page.waitForSelector('[aria-label="组合优化整集正文"]');
 expect(await page.evaluate(()=>(globalThis as any).fixture.calls)).toEqual([{...pending,resume:true}]);expect(await page.evaluate(()=>(globalThis as any).fixture.applied.length)).toBe(0);await page.close();
},20000);
it('UI换模型会发新试写而非冒用旧稿，刷新保留模型身份与共享次数',async()=>{
 const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41831/');await page.addScriptTag({content:bundle});await page.waitForSelector('[aria-label="选集与模板组合优化"]');
 await page.evaluate(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='为所选剧集推荐3—5个模板')!.click();});await page.waitForFunction(()=>document.body.textContent?.includes('灯影下的试探'));
 const trial=()=>page.evaluate(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='试写一集 · 免费')!.click();});await trial();await page.waitForFunction(()=>document.body.textContent?.includes('今日剩余 2 / 3'));
 await page.evaluate(()=>(globalThis as any).fixture.setModel('deepseek'));await trial();await page.waitForFunction(()=>document.body.textContent?.includes('今日剩余 1 / 3'));
 expect(await page.evaluate(()=>(globalThis as any).fixture.calls.map((r:any)=>r.model))).toEqual(['glm','deepseek']);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mvs:episode-optimization:7:20000000-0000-4000-8000-000000000001')!).results.map((r:any)=>r.model))).toEqual(['glm','deepseek']);
 await page.reload();await page.addScriptTag({content:bundle});await page.waitForFunction(()=>document.body.textContent?.includes('DeepSeek'));expect(await page.evaluate(()=>(globalThis as any).fixture.calls.length)).toBe(0);await page.close();
},20000);
