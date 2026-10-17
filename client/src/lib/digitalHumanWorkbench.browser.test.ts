/** 真实工作台阶段与草稿恢复；所有网络均为离线夹具，不代表线上验收。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import { build as buildStyles } from "vite";
import tailwindcss from "@tailwindcss/vite";
import puppeteer from "puppeteer";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";

it("四阶段保留台词和导演输入，刷新恢复，桌面与手机无横向溢出", async () => {
 const bundle = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft}from'./shared/digitalHumanStudio';
 const cloud=JSON.parse(sessionStorage.getItem('test-cloud')||'null')||newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000007');
 cloud.portrait={source:'gs://test-only/person.png',name:'讲述者'};cloud.scene={source:'gs://test-only/scene.png',name:'演示场景'};
 globalThis.fixture={cloud,generation:1,calls:[]};
 createRoot(document.getElementById('root')).render(<DigitalHumanStudio/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",loader:{'.css':'empty'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'offline',setup(b){
 b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'trpc',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/canvasUpload$/},()=>({path:'upload',namespace:'offline'}));
 b.onResolve({filter:/digitalHumanVideo$/},()=>({path:'media',namespace:'offline'}));
 b.onResolve({filter:/\/(Manhua3dModelStudio|ManhuaAutoRigEditor|ArtMotionStudio)$/},a=>({path:a.path.split('/').at(-1)!,namespace:'unused'}));
 b.onLoad({filter:/.*/,namespace:'unused'},a=>({loader:'js',contents:'export const '+a.path+'=()=>null;export default '+a.path+';'}));
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({resolveDir:process.cwd(),loader:'js',contents:a.path==='auth'?`export const useAuth=()=>({user:{id:7,role:'admin'}});`:a.path==='upload'?`export async function uploadOneCanvasAsset(){throw Error('本测试禁止上传')}`:a.path==='media'?`export const digitalHumanMediaUrl=async source=> 'https://example.test/'+(source.includes('person')?'person':'scene')+'.svg';export const digitalHumanVideoBlock=async()=>{throw Error('本测试禁止生成')};`:`
 const dataCache={};const dataFor=name=>dataCache[name]??=(name==='getManhuaAdvisorQuota'?{remaining:5,price:12,exempt:false}:name==='getSubscription'?{plan:'pro'}:name==='sceneAccess'?{canGenerate:true}:name.startsWith('list')?[]:undefined);
 async function call(group,name,input){const f=globalThis.fixture;f.calls.push({group,name,input});if(name==='getDraft')return{draft:f.cloud,generation:String(f.generation)};if(name==='saveDraft'){f.cloud=structuredClone(input.draft);sessionStorage.setItem('test-cloud',JSON.stringify(f.cloud));return{generation:String(++f.generation)}}throw Error('本测试未授权接口：'+group+'.'+name);}
 const utils=new Proxy({}, {get:(_,g)=>new Proxy({}, {get:(_,n)=>({fetch:input=>call(g,n,input)})})});
 export const trpc=new Proxy({}, {get:(_,g)=>g==='useUtils'?()=>utils:new Proxy({}, {get:(_,n)=>({useQuery:()=>({data:dataFor(n),refetch:async()=>({data:dataFor(n)})}),useMutation:()=>({mutateAsync:input=>call(g,n,input)})})})});` }));
 }}],logLevel:'silent'});
 const styleBuild=await buildStyles({configFile:false,plugins:[tailwindcss()],logLevel:'silent',build:{write:false,rollupOptions:{input:path.resolve('client/src/index.css')}}});
 const outputs=Array.isArray(styleBuild)?styleBuild.flatMap(r=>r.output):'output' in styleBuild?styleBuild.output:[];
 const globalCss=outputs.flatMap(o=>o.type==='asset'&&o.fileName.endsWith('.css')?[String(o.source)]:[]).join('\n');
 expect(globalCss.length).toBeGreaterThan(1000);
 const css=globalCss+'\n'+await readFile('client/src/components/DigitalHumanStudio.css','utf8');
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request',r=>{if(r.url()==='https://example.test/')void r.respond({status:200,contentType:'text/html',body:'<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});else if(r.url().endsWith('.svg'))void r.respond({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#394649"/><text x="32" y="120" fill="white">OFFLINE FIXTURE</text></svg>'});else void r.abort();});
  const boot=async()=>{await page.goto('https://example.test');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>/云端已保存|云端稿件已恢复/.test(document.body.textContent||''));};
  await page.setViewport({width:1440,height:1000});await boot();
  const stage=async(index:number)=>{await page.click('.dh-workflow-nav button:nth-child('+index+')');await page.waitForFunction(index=>{const selectors=['#dh-assets','.dh-director-assistant','#dh-preview','#dh-production'];return document.activeElement===document.querySelector(selectors[index-1]);},{},index);};
  await page.type('textarea[placeholder^="写下完整文案"]','这是切换阶段后必须保留的完整台词。');
  await page.waitForFunction(()=>(globalThis as any).fixture.cloud.script.includes('完整台词'),{timeout:3000});
  await stage(2);await page.click('.dh-film-settings > summary');await page.$eval('textarea[aria-label="完整导演要求"]',e=>(e as HTMLTextAreaElement).select());await page.type('textarea[aria-label="完整导演要求"]','镜头缓缓推近，人物指向资料。');
  await page.type('textarea[aria-label="数字人导演要求"]','保留未提交的导演问题');
  expect(await page.$eval('#dh-direction',e=>getComputedStyle(e).display)).not.toBe('none');
  await page.click('.dh-film-settings > summary');await stage(3);
  expect(await page.$eval('textarea[aria-label="数字人导演要求"]',e=>(e as HTMLTextAreaElement).value)).toBe('保留未提交的导演问题');
  expect(await page.$eval('#dh-preview',e=>e.getBoundingClientRect().height)).toBeGreaterThan(100);
  const out=process.env.DH_WORKBENCH_SCREENSHOT_DIR;
  if(out){await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'desktop-preview.png'),fullPage:true});}
  await stage(4);
  expect(await page.$eval('#dh-production',e=>getComputedStyle(e).display)).not.toBe('none');
  expect(await page.$eval('#dh-direction',e=>getComputedStyle(e).display)).toBe('none');
  await stage(1);
  expect(await page.$eval('textarea[placeholder^="写下完整文案"]',e=>(e as HTMLTextAreaElement).value)).toContain('完整台词');
  await boot();await stage(2);
  expect(await page.$eval('textarea[aria-label="完整导演要求"]',e=>(e as HTMLTextAreaElement).value)).toBe('镜头缓缓推近，人物指向资料。');
  expect(await page.$eval('textarea[placeholder^="写下完整文案"]',e=>(e as HTMLTextAreaElement).value)).toContain('完整台词');
  for(const width of [1440,390]){await page.setViewport({width,height:1000});for(const index of [1,2,3,4]){await stage(index);const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:Array.from(document.querySelectorAll('body *')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1}).slice(0,8).map(e=>e.tagName+'.'+e.className)}));expect(overflow,JSON.stringify({width,index,overflow})).toMatchObject({width,scroll:width});}if(out){await stage(3);await page.screenshot({path:path.join(out,width===390?'mobile-preview.png':'desktop-restored.png'),fullPage:true});}}
  expect(await page.evaluate(()=>(globalThis as any).fixture.calls.filter((c:any)=>!['getDraft','saveDraft'].includes(c.name)))).toEqual([]);
  expect(errors).toEqual([]);
 } finally {await browser.close();}
},60_000);
