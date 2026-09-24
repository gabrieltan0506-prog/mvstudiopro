/** 原稿变更后的真实工作台显示；只拦网络，不替换状态函数。 */
import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

it("原稿变更显示stale并保留旧图，新原稿回执恢复ready", async () => {
 const dir=process.env.MANHUA_KEYART_DISPLAY_EVIDENCE_DIR || path.join(tmpdir(),"mvs-keyart-display-probe");
 mkdirSync(dir,{recursive:true});
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {TooltipProvider} from './client/src/components/ui/tooltip';
  import Workbench from './client/src/components/ManhuaScriptWorkbench';
  import {spawnManhuaDramaStudio,expandManhuaShotKeyartsAfterReverse,ensureManhuaFragmentClips} from './client/src/lib/canvasDramaStudio';
  import {recordManhuaKeyartLookOutput} from './shared/manhuaKeyartLookState';
  const source='1. 近景：阿菁抬手护住墨菁。\\n2. 全景：墨菁守住门口。';
  const spawned=spawnManhuaDramaStudio({topic:'阿菁与墨菁',episodeIndex:1,videoModel:'seedance-2.5'});
  const reverse=spawned.blocks.find(b=>b.id.startsWith('reverse-'));
  const expanded=expandManhuaShotKeyartsAfterReverse(spawned.blocks.map(b=>b.id===reverse.id?{...b,status:'done',outputText:source}:b),spawned.edges,reverse.id);
  const ensured=ensureManhuaFragmentClips(expanded.blocks,expanded.edges,1,{videoModel:'seedance-2.5'});
  const record=(b,url)=>({...b,status:'done',imageMode:'edit',refImageUrl:'https://offline.invalid/character.png',outputUrl:url,outputUrls:[...(b.outputUrls||[]),url],manhuaKeyartLookState:recordManhuaKeyartLookOutput(b,url),manhuaKeyartSourceState:recordManhuaKeyartLookOutput({manhuaKeyartLookState:b.manhuaKeyartSourceState},url)});
  const initial=ensured.blocks.map(b=>b.id.startsWith('keyart-')?record(b,'https://offline.invalid/'+b.id+'.png'):b);
  const firstKeyartId=initial.find(b=>b.id.startsWith('keyart-')).id;
  const f=globalThis.fixture={};
  function App(){const [blocks,setBlocks]=useState(initial);f.blocks=blocks;
   f.changeSource=()=>setBlocks(current=>ensureManhuaFragmentClips(current.map(b=>b.id===reverse.id?{...b,outputText:source.replace('抬手护住','转身拉住')}:b),ensured.edges,1,{videoModel:'seedance-2.5'}).blocks);
   f.recordNew=()=>setBlocks(current=>current.map(b=>b.id.startsWith('keyart-')?record(b,'https://offline.invalid/new-'+b.id+'.png'):b));
   f.resetFirstToReference=()=>setBlocks(current=>current.map(b=>b.id===firstKeyartId?{...b,status:'idle',outputUrl:'',outputUrls:[]}:b));
   f.setFirstReferenceStatus=(status)=>setBlocks(current=>current.map(b=>b.id===firstKeyartId?{...b,status}:b));
   return <TooltipProvider><Workbench blocks={blocks} videoModel='seedance-2.5' topic='阿菁与墨菁' episodeCount={1} focusEpisode={1} onFocusEpisode={()=>{}} characterIds={[]} propIds={[]} outlineConfirmed={true} workflowPhase='storyboard' compactUi={false}/></TooltipProvider>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},loader:{".png":"dataurl",".svg":"dataurl",".jpg":"dataurl",".css":"text"},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"__VITE_ENV__"},banner:{js:'var __VITE_ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};'},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 try {
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith('data:')?r.continue():r.respond({status:200,body:''}));
  await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');await page.evaluate(built.outputFiles[0].text);
  const selector='[data-manhua-shot="1"][data-manhua-keyart-status]';
  await page.waitForSelector(selector,{timeout:30000}).catch(async e=>{writeFileSync(path.join(dir,'mount-failure.txt'),JSON.stringify({errors,text:await page.evaluate(()=>document.body.innerText)},null,2));throw e;});
  const read=()=>page.evaluate(selector=>({state:document.querySelector(selector)?.getAttribute('data-manhua-keyart-status'),url:document.querySelector(selector)?.getAttribute('data-manhua-keyart-url'),right:document.querySelector('[data-manhua-shot-params-status]')?.textContent,blocks:(window as any).fixture.blocks}),selector);
  const before=await read();expect(before.state).toBe('ready');
  await page.evaluate(()=>(window as any).fixture.changeSource());await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('data-manhua-keyart-status')==='stale',{},selector);
  const stale=await read();expect(stale.right).toContain('已变更');expect(stale.url).toBe(before.url);
  const original=before.blocks.find((b:any)=>b.outputUrl===before.url);expect(stale.blocks.find((b:any)=>b.id===original.id).outputUrls).toEqual(original.outputUrls);
  await page.screenshot({path:path.join(dir,'stale.png'),fullPage:false});
  await page.evaluate(()=>(window as any).fixture.recordNew());await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('data-manhua-keyart-status')==='ready',{},selector);
  const restored=await read();expect(restored.right).toContain('已锁图');expect(restored.url).not.toBe(before.url);expect(restored.blocks.find((b:any)=>b.id===original.id).outputUrls).toContain(before.url);expect(errors).toEqual([]);
  const readyBeforeReference=await page.$eval('[data-manhua-filmstrip]',el=>Number(el.getAttribute('data-manhua-keyart-ready')));
  await page.evaluate(()=>(window as any).fixture.resetFirstToReference());
  await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('data-manhua-keyart-status')==='idle',{},selector);
  const referenceOnly=await page.evaluate(()=>({ready:Number(document.querySelector('[data-manhua-filmstrip]')?.getAttribute('data-manhua-keyart-ready')),reference:document.querySelector('[data-manhua-column="preview"]')?.getAttribute('data-manhua-preview-reference'),card:document.querySelector('[data-manhua-shot="1"]')?.textContent,preview:document.querySelector('[data-manhua-column="preview"]')?.textContent}));
  expect(referenceOnly.ready).toBe(readyBeforeReference-1);
  expect(referenceOnly.reference).toBe('true');
  expect(referenceOnly.card).toContain('垫图参考 · 待生成');
  expect(referenceOnly.preview).toContain('垫图参考 · 尚未生成');
  await page.evaluate(()=>(window as any).fixture.setFirstReferenceStatus('running'));
  await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('data-manhua-keyart-status')==='running',{},selector);
  expect(await page.$eval('[data-manhua-shot="1"]',el=>el.textContent)).toContain('出图中 · 参考保留');
  await page.evaluate(()=>(window as any).fixture.setFirstReferenceStatus('error'));
  await page.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('data-manhua-keyart-status')==='error',{},selector);
  expect(await page.$eval('[data-manhua-shot="1"]',el=>el.textContent)).toContain('出图失败 · 参考保留');
  expect(errors).toEqual([]);
  writeFileSync(path.join(dir,'result.json'),JSON.stringify({before,stale,restored,referenceOnly,errors},null,2));
 } finally {
  const owned=browser.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed=await Promise.race([browser.close().then(()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);
  if(timer)clearTimeout(timer);
  if(!closed){
   if(!owned)throw new Error("夹具独立进程句柄缺失，禁止查找用户浏览器");
   const exited=new Promise<void>((resolve,reject)=>{if(owned.exitCode!==null||owned.signalCode!==null)return resolve();const deadline=setTimeout(()=>reject(new Error("夹具进程未退出")),5000);owned.once('exit',()=>{clearTimeout(deadline);resolve();});});
   owned.kill('SIGKILL');browser.disconnect();await exited;
  }
 }
},180000);
