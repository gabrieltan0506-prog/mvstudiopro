import {beforeAll,expect,it} from 'vitest';
import {build as viteBuild} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
import {existsSync} from 'node:fs';
let productionCss = '';
beforeAll(async()=>{
 const cssBuild=await viteBuild({configFile:false,plugins:[tailwindcss()],build:{write:false,rollupOptions:{input:path.resolve('client/src/index.css')}}});
 const outputs=Array.isArray(cssBuild)?cssBuild.flatMap(x=>x.output):'output' in cssBuild?cssBuild.output:[];
 productionCss=outputs.filter(o=>o.type==='asset'&&o.fileName.endsWith('.css')).map(o=>o.type==='asset'?String(o.source):'').join('\n');
 if(!productionCss)throw Error('实际样式未编译');
});
it.each(['prepare','ask','current'])('语音比较稿 %s：模板真实绑定、浮窗恢复与差异高亮、确认后采用',async(mode)=>{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
const f=globalThis.fixture={requests:[],writes:[],backups:[]};const original='场次 E1-S1：沈昀在文书库醒来，纸上的官印映着窗外的天光。他听到周慎走近，忙将文书压在手底，努力稳住呼吸。';const revised=original.replace('窗外的天光','将熄的烛火')+'天光落在纸页上，架间保持阴影，周慎停在门口，看清他收纸的动作。';f.revised=revised;
function App(){const[body,setBody]=useState(original);const[focus,setFocus]=useState(${mode === "current" ? 1 : 2});f.body=body;f.setBody=setBody;return <Panel open userId='1' confirmedProjectVersion='voice-rewrite-test' onClose={()=>{}} templates={[{publicId:'mt_a123',nameZh:'冲突前置 A123'}]} selectedTemplate={{publicId:'mt_a123',nameZh:'冲突前置 A123'}} onRequestTrial={()=>{}} previsIssue='未打开白模' worldTarget={{assetId:'old-world-target'}} studio3d={{directionCardId:'old-direction'}} episodeWorkspace={${mode === "current"} ? undefined : {episodes:[{index:1,title:'文书库',body,endHook:'门后有人'},{index:2,title:'第二集',body:'第二集保持不变'}],model:'glm',onFocusEpisode:setFocus,onApplyCandidates:()=>{}}} onApplyRewrite={c=>{if(c.originalBody!==body)return false;f.backups.push(body);localStorage.setItem('test-saved-body',c.rewrittenBody);setBody(c.rewrittenBody);f.writes.push(c);return true;}} project={{context:{seriesTitle:'隔离长安先知簿',episodeIndex:focus,episodeTitle:focus===1?'文书库':'第二集',stage:'outline',videoModel:'未选择',writerConfirmed:true,episodeBody:focus===1?body:'第二集保持不变',assetSummary:'',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'第二集'}}/>}createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'empty','.woff':'dataurl','.woff2':'dataurl'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},plugins:[{name:'explicit-service-boundaries',setup(b){b.onResolve({filter:/\.\/CreativeVoicePanel$/},()=>({path:'voice',namespace:'fixture'}));b.onResolve({filter:/^@\/lib\/manhuaAdvisorStream$/},()=>({path:'stream',namespace:'fixture'}));b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'trpc',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='voice'?`export function CreativeVoicePanel(p){globalThis.fixture.production=p.onProductionAction;globalThis.fixture.ask=p.onAskAdvisor;return <div>隔离语音入口</div>}`:a.path==='trpc'?`export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:12,exempt:false},refetch:async()=>({})})}}};`:`export async function streamManhuaAdvisor(input){const f=globalThis.fixture;f.requests.push(input);return {answer:JSON.stringify({kind:'template-rewrite',body:f.revised,endHook:'门后有人',changes:['天光与架间阴影形成反差']}),remainingFreeToday:4,paidUnitCredits:12,creditsCharged:0,paidThisTurn:false};}` }));}}]});
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),args:['--no-sandbox']});
 try {const page=await browser.newPage();await page.setViewport({width:1440,height:1000});page.setDefaultTimeout(6000);page.on('pageerror',e=>console.error('browser error',e instanceof Error ? e.message : String(e)));await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41839/');await page.addStyleTag({content:productionCss});await page.addScriptTag({content:result.outputFiles[0].text});await page.waitForFunction(()=>!!(globalThis as any).fixture?.production);
 const receipt=await page.evaluate(mode=>{const f=(globalThis as any).fixture;const question='用模板给第一集写一篇与原文不同的比较稿，先不要覆盖原稿。';return mode==='ask'?f.ask(question,new AbortController().signal):f.production({action:'prepareEpisode',episode:1,question},new AbortController().signal);},mode);expect(JSON.parse(receipt).status).toBe('candidate_ready');
 const req=await page.evaluate(()=>(globalThis as any).fixture.requests[0]);expect(req.rawQuestion).toMatch(/^【模板改写建议】/);expect(req.rawQuestion).toContain('模板编号 A123');expect(req.manhuaContext.episodeIndex).toBe(1);expect(req.manhuaContext.episodeBody).toContain('沈昀');expect(req.manhuaContext.worldTarget).toBeUndefined();expect(req.manhuaContext.previsEdit).toBeUndefined();expect(req.manhuaContext.studio3d).toBeUndefined();expect(await page.evaluate(()=>(globalThis as any).fixture.writes.length)).toBe(0);
 await page.waitForSelector('[role="dialog"][aria-label="改写原稿对比"]');
 expect(await page.$('[role="dialog"] mark[aria-label="原稿删改"]')).not.toBeNull();expect(await page.$('[role="dialog"] mark[aria-label="改稿新增"]')).not.toBeNull();
 await page.waitForFunction(()=>{const r=document.querySelector('[role="dialog"]')!.getBoundingClientRect();return r.width>1000&&r.x>=0&&r.y>=0&&r.bottom<=innerHeight;});
 expect(await page.$eval('[role="dialog"]',e=>getComputedStyle(e).zIndex)).toBe('111');
 expect(await page.$$eval('[role="dialog"] mark',els=>new Set(els.map(e=>getComputedStyle(e).backgroundColor)).size)).toBeGreaterThan(0);
 if(process.env.COMPARISON_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.COMPARISON_SCREENSHOT_DIR,`comparison-${mode}-desktop.png`)});
 await page.setViewport({width:390,height:844});
 await page.waitForFunction(()=>{const r=document.querySelector('[role="dialog"]')!.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
 if(process.env.COMPARISON_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.COMPARISON_SCREENSHOT_DIR,`comparison-${mode}-mobile.png`)});
 await page.setViewport({width:1440,height:1000});
 const click=async(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);if(!b)throw Error(text);b.click();},text);
 await click('关闭对照');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 expect(await page.evaluate(()=>(globalThis as any).fixture.writes.length)).toBe(0);
 await click('打开原稿 / 新稿对照');await page.waitForSelector('[role="dialog"]');
 await page.$eval('[aria-label="优化后整集正文"]',e=>{const t=e as HTMLTextAreaElement;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(t,t.value+'周慎将手收进袖口。');t.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('mark')).some(e=>e.textContent?.includes('周慎将手收进袖口')));
 await page.reload();await page.addStyleTag({content:productionCss});await page.addScriptTag({content:result.outputFiles[0].text});await page.waitForSelector('[role="dialog"]');
 expect(await page.$eval('[aria-label="优化后整集正文"]',e=>(e as HTMLTextAreaElement).value)).toContain('周慎将手收进袖口');
 expect(await page.evaluate(()=>(globalThis as any).fixture.requests.length)).toBe(0);
 // 刷新后的工作区仍在第二集，先验证不能覆盖其它集，再回到目标集。
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='可以，填入本集')?.disabled)).toBe(mode !== 'current');
 await page.evaluate(()=>{window.confirm=()=>false;});expect(await page.evaluate(()=>(globalThis as any).fixture.production({action:'applyEpisode',episode:1},new AbortController().signal))).toContain('取消');expect(await page.evaluate(()=>(globalThis as any).fixture.writes.length)).toBe(0);
 await page.evaluate(()=>{window.confirm=()=>true;});expect(await page.evaluate(()=>(globalThis as any).fixture.production({action:'applyEpisode',episode:1},new AbortController().signal))).toContain('已写回');expect(await page.evaluate(()=>localStorage.getItem('test-saved-body'))).toContain('天光落在纸页上');expect(await page.evaluate(()=>(globalThis as any).fixture.backups.length)).toBe(1);
 }finally{await browser.close();}
},60000);
