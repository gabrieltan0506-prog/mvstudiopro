/** 原稿变更后的真实工作台显示；只拦网络，不替换状态函数。 */
import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

it("自定义当前段资产摘要保留身份、缺图并定位唯一节点", async () => {
 const dir=process.env.MANHUA_ASSET_SUMMARY_EVIDENCE_DIR || path.join(tmpdir(),"mvs-asset-summary-probe");
 mkdirSync(dir,{recursive:true});
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {TooltipProvider} from './client/src/components/ui/tooltip';
  import Workbench from './client/src/components/ManhuaScriptWorkbench';
  import {spawnManhuaDramaStudio,expandManhuaShotKeyartsAfterReverse,ensureManhuaFragmentClips} from './client/src/lib/canvasDramaStudio';
  import {recordManhuaKeyartLookOutput} from './shared/manhuaKeyartLookState';
  const source='| 镜号 | 秒位 | 景别运镜 | 画面 | 对白 |\\n| --- | --- | --- | --- | --- |\\n| 1 | 0-5 | 近景固定 | 阿菁抬手护住墨菁 | 娘：「慢点。」 |\\n| 2 | 5-10 | 全景固定 | 墨菁守住门口 | 无 |';
  const spawned=spawnManhuaDramaStudio({topic:'阿菁与墨菁',episodeIndex:1,videoModel:'seedance-2.5'});
  const reverse=spawned.blocks.find(b=>b.id.startsWith('reverse-'));
  const expanded=expandManhuaShotKeyartsAfterReverse(spawned.blocks.map(b=>b.id===reverse.id?{...b,status:'done',outputText:source}:b),spawned.edges,reverse.id);
  const ensured=ensureManhuaFragmentClips(expanded.blocks,expanded.edges,1,{videoModel:'seedance-2.5'});
  const record=(b,url)=>({...b,status:'done',imageMode:'edit',refImageUrl:'https://offline.invalid/character.png',outputUrl:url,outputUrls:[...(b.outputUrls||[]),url],manhuaKeyartLookState:recordManhuaKeyartLookOutput(b,url),manhuaKeyartSourceState:recordManhuaKeyartLookOutput({manhuaKeyartLookState:b.manhuaKeyartSourceState},url)});
  const initial=ensured.blocks.map(b=>b.id.startsWith('keyart-')?record(b,'https://offline.invalid/'+b.id+'.png'):b);
  const refs=[{id:'custom-a',role:'character',url:'https://offline.invalid/character.png',source:'upload',labelZh:'阿菁',seedLibraryId:'wa_char_aqing',claimedAnchorIds:['wa_char_aqing'],refDuty:'identity',primaryBindings:[{anchorId:'wa_char_aqing',duty:'identity'}]},{id:'custom-scene',role:'scene',url:'https://offline.invalid/courtyard.png',source:'upload',labelZh:'庭院',seedLibraryId:'wa_scene_yard',claimedAnchorIds:['wa_scene_yard']}];
  refs.push({id:'custom-mother',role:'character',url:'https://offline.invalid/mother.png',source:'upload',labelZh:'娘',seedLibraryId:'wa_char_mother',claimedAnchorIds:['wa_char_mother'],refDuty:'identity',primaryBindings:[{anchorId:'wa_char_mother',duty:'identity'}]});
  const canon={characters:[{id:'wa_char_mother',role:'character',nameZh:'娘',lookZh:'',promptZh:'娘'},{id:'wa_char_aqing',role:'character',nameZh:'阿菁',lookZh:''}],locations:[{id:'wa_scene_yard',role:'scene',nameZh:'庭院',lookZh:'',promptZh:'庭院'}],props:[],episodeMainSceneId:{1:'wa_scene_yard'}};
  const graph=initial.map(b=>b.id.startsWith('clip-')?{...b,prompt:b.prompt+'\\n【资产·Image对照】\\n@角色1|id=custom-a|label=阿菁|kind=角色\\n@角色2|id=deleted-reference|label=旧引用缺图|kind=角色\\n@场景1|id=custom-scene|label=庭院|kind=场景'}:b);
  graph.push({...initial[0],kind:'image',id:'charsheet-wa_char_aqing',outputUrl:refs[0].url,prompt:'阿菁定妆'});
  const f=globalThis.fixture={focus:[],wall:0};
  function App(){const [shown,setShown]=useState(graph);const [liveRefs,setLiveRefs]=useState(refs);const [legacy,setLegacy]=useState(false);f.imageUrl=url=>{setLiveRefs(refs.map((r,i)=>i===0?{...r,url}:r));setShown(graph.map(b=>b.id==='charsheet-wa_char_aqing'?{...b,outputUrl:url}:b));};f.duplicate=()=>setShown([...graph,{...graph[graph.length-1],id:'charsheet-second-version'}]);f.wrongVersion=()=>setShown(graph.map(b=>b.id==='charsheet-wa_char_aqing'?{...b,outputUrl:'https://offline.invalid/another-version.png'}:b));f.legacy=()=>setLegacy(true);return <TooltipProvider><Workbench blocks={shown} videoModel='seedance-2.5' topic='阿菁在庭院' episodeCount={1} focusEpisode={1} onFocusEpisode={()=>{}} characterIds={[]} propIds={[]} outlineConfirmed={true} workflowPhase='storyboard' compactUi={false} customAssetRefs={legacy?[]:liveRefs} assetCanon={legacy?undefined:canon} onFocusBlock={id=>f.focus.push(id)} onOpenAssetWall={()=>f.wall++}/></TooltipProvider>;}
  createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},loader:{".png":"dataurl",".svg":"dataurl",".jpg":"dataurl",".css":"text"},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"__VITE_ENV__"},banner:{js:'var __VITE_ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};'},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e instanceof Error ? e.stack || e.message : String(e)));
 try {
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith('data:')?r.continue():r.url().endsWith('.png')&&!r.url().includes('failed')?r.respond({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDVkAAAAASUVORK5CYII=','base64')}):r.respond({status:404,body:''}));
  await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');
  const cssDir=process.env.MANHUA_ASSET_SUMMARY_CSS_DIR;
  if(cssDir)for(const file of readdirSync(cssDir).filter(file=>/^(index|OmniCanvas)-.*\.css$/.test(file)))await page.addStyleTag({content:readFileSync(path.join(cssDir,file),'utf8')});
  await page.evaluate(built.outputFiles[0].text);
  const selector='[data-manhua-current-asset-summary]';
  await page.waitForSelector(selector,{timeout:10000}).catch(async e=>{writeFileSync(path.join(dir,'mount-failure.txt'),JSON.stringify({errors,text:await page.evaluate(()=>document.body.innerText)},null,2));throw e;});
  const text=await page.$eval(selector,e=>e.textContent||'');
  if(cssDir){
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-manhua-current-asset-summary] img')).every(image=>(image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth>0));
    const layouts=[];
    for(const width of [1280,390]){
      await page.setViewport({width,height:900});
      await page.$eval(selector,e=>e.scrollIntoView({block:'start',inline:'nearest'}));
      const layout=await page.evaluate(selector=>{const element=document.querySelector(selector)!;const rect=element.getBoundingClientRect();return {viewport:window.innerWidth,documentWidth:document.documentElement.scrollWidth,summaryWidth:rect.width,summaryScrollWidth:element.scrollWidth,visible:rect.width>0&&rect.height>0};},selector);
      layouts.push(layout);
      await page.screenshot({path:path.join(dir,`summary-${width}.png`),fullPage:false});
    }
    writeFileSync(path.join(dir,'layout.json'),JSON.stringify(layouts,null,2));
    expect(layouts.every(row=>row.visible && row.summaryScrollWidth<=row.summaryWidth+1 && row.documentWidth<=row.viewport)).toBe(true);
  }

  expect(text).toContain('阿菁');expect(text).toContain('庭院');
  expect(text).toContain('角色参考 · 本段计划 2');
  expect(await page.$eval('[data-manhua-current-asset="custom-mother"]',e=>e.getAttribute('data-asset-planned'))).toBe('true');
  expect(await page.$eval('[data-manhua-current-asset="custom-a"]',e=>e.getAttribute('data-asset-planned'))).toBe('true');
  expect(text).toContain('已编排引用');expect(text).not.toContain('角色 · 上场 0/0');
  expect(await page.$eval('[data-manhua-current-asset="deleted-reference"]',e=>e.getAttribute('data-asset-image'))).toBe('missing');
  await page.$eval('[data-manhua-current-asset="custom-a"]',(e:any)=>e.click());
  expect(await page.evaluate(()=>(window as any).fixture.focus)).toEqual(['charsheet-wa_char_aqing']);
  await page.$eval('[data-manhua-current-asset="deleted-reference"]',(e:any)=>e.click());
  expect(await page.evaluate(()=>(window as any).fixture.wall)).toBe(1);
  await page.evaluate(()=>(window as any).fixture.duplicate());
  await page.waitForFunction(()=>Boolean((window as any).fixture.duplicate));
  await page.$eval('[data-manhua-current-asset="custom-a"]',(e:any)=>e.click());
  expect(await page.evaluate(()=>(window as any).fixture.focus)).toEqual(['charsheet-wa_char_aqing']);
  expect(await page.evaluate(()=>(window as any).fixture.wall)).toBe(2);
  await page.evaluate(()=>(window as any).fixture.wrongVersion());
  await page.$eval('[data-manhua-current-asset="custom-a"]',(e:any)=>e.click());
  expect(await page.evaluate(()=>(window as any).fixture.focus)).toEqual(['charsheet-wa_char_aqing']);
  expect(await page.evaluate(()=>(window as any).fixture.wall)).toBe(3);
  await page.evaluate(()=>(window as any).fixture.imageUrl('https://offline.invalid/failed.png'));
  await page.waitForSelector('[data-manhua-current-asset="custom-a"][data-asset-image="failed"]');
  expect(await page.$eval('[data-manhua-current-asset="custom-a"]',e=>e.textContent)).toContain('参考图加载失败');
  await page.evaluate(()=>(window as any).fixture.imageUrl('https://offline.invalid/recovered.png'));
  await page.waitForFunction(()=>{const image=document.querySelector('[data-manhua-current-asset="custom-a"] img') as HTMLImageElement|null;return Boolean(image?.complete && image.naturalWidth>0);});
  expect(await page.$eval('[data-manhua-current-asset="custom-a"]',e=>e.getAttribute('data-asset-image'))).toBe('loaded');
  await page.evaluate(()=>(window as any).fixture.legacy());
  await page.waitForFunction(()=>!document.querySelector('[data-manhua-current-asset-summary]'));
  expect(await page.evaluate(()=>document.body.textContent)).toContain('角色 · 上场');
  expect(errors).toEqual([]);
  writeFileSync(path.join(dir,'result.json'),JSON.stringify({text,errors},null,2));
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
