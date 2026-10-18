/** 真实工作台阶段与草稿恢复；所有网络均为离线夹具，不代表线上验收。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("云稿切换失败后可原页重试，成功清除旧报错且正文保全", async () => {
 const bundle = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft}from'./shared/digitalHumanStudio';
 const cloud=JSON.parse(sessionStorage.getItem('test-cloud')||'null')||newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000007');
 cloud.script='原稿不应丢失';
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
 async function call(group,name,input){const f=globalThis.fixture;f.calls.push({group,name,input});if(name==='getDraft')return{draft:f.cloud,generation:String(f.generation)};if(name==='saveDraft'){f.cloud=structuredClone(input.draft);sessionStorage.setItem('test-cloud',JSON.stringify(f.cloud));return{generation:String(++f.generation)}}if(name==='createBackup')return{id:'1792341192212-0123456789abcdef0123456789abcdef'};if(name==='advanceBackup')return f.failBackup?{status:'pending',error:'隔离模拟备份错误'}:{status:'complete'};throw Error('本测试未授权接口：'+group+'.'+name);}
 const utils=new Proxy({}, {get:(_,g)=>new Proxy({}, {get:(_,n)=>({fetch:input=>call(g,n,input)})})});
 export const trpc=new Proxy({}, {get:(_,g)=>g==='useUtils'?()=>utils:new Proxy({}, {get:(_,n)=>({useQuery:()=>({data:dataFor(n),refetch:async()=>({data:dataFor(n)})}),useMutation:()=>({mutateAsync:input=>call(g,n,input)})})})});` }));
 }}],logLevel:'silent'});
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();
  page.on('dialog',d=>void d.accept());
  await page.setRequestInterception(true);
  page.on('request',r=>{if(r.url()==='https://example.test/')void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'});else void r.abort();});
  await page.goto('https://example.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>/云端已保存|云端稿件已恢复/.test(document.body.textContent||''));
  const click=async(text:string)=>page.$$eval('button',(buttons,text)=>{const b=buttons.find(b=>b.textContent===text);if(!b)throw Error('找不到按钮'+text);b.click();},text);
  await click('分段制作');await page.click('.dh-save-menu > summary');
  for(const label of ['读取云端版本','明确保存本机版本']) {
   await page.evaluate(()=>{(globalThis as any).fixture.failBackup=true;});
   await click(label);await page.waitForFunction(()=>document.body.textContent?.includes('隔离模拟备份错误'));
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='读取云端版本').every(b=>!b.disabled));
   await page.evaluate(()=>{(globalThis as any).fixture.failBackup=false;});
   await click(label);
   await page.waitForFunction(()=>!document.body.textContent?.includes('隔离模拟备份错误')&&Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='读取云端版本').every(b=>!b.disabled));
   expect(await page.evaluate(()=>(globalThis as any).fixture.cloud.script)).toBe('原稿不应丢失');
   // 成功回填会重建详情节点，保持下一按钮可操作。
   await page.$eval('.dh-save-menu',e=>{(e as HTMLDetailsElement).open=true;});
  }
  expect(await page.evaluate(()=>(globalThis as any).fixture.calls.some((c:any)=>/generate|queue|start/.test(c.name)))).toBe(false);
 } finally {await browser.close();}
},60_000);
