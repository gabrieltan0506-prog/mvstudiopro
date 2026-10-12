/** 离线真实组件验证；服务隔离，不触发模型或生产渲染。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("顾问场景工具读取真实绑定能力，五项剧情特效经原控件保存恢复且保留采用版本",async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {ManhuaPrevisStudioView} from './client/src/components/canvas/ManhuaPrevisStudio';
 import {createManhuaPrevisStudio,manhuaPrevisSpecSchema} from './shared/manhuaPrevis';
 const base=createManhuaPrevisStudio(9,'11111111-1111-4111-8111-111111111111');const first=base.spec.actors[0];
 first.assetRef='test-mother';first.riggedModel={sourceJobId:'m3d_test_mother',forwardAxis:'+X',targetHeight:1.6};
 base.spec.actors=[first,...Array.from({length:3},(_,i)=>({...structuredClone(first),id:'actor-'+(i+2),start:[i+1,0],end:[i+1,0]}))];
 const bone={type:'bone',actorId:first.id,bone:'spine',along:1,offset:[.1,0,0]};
 base.spec=manhuaPrevisSpecSchema.parse({...base.spec,storyProps:['needle1','needle2'].map(id=>({id,kind:'needle',keyframes:[{timeSec:0,anchor:{type:'world',position:[0,0,1]}},{timeSec:4,anchor:{type:'world',position:[.5,0,1]}},{timeSec:5,anchor:bone},{timeSec:9,anchor:bone}]}))});
 const old={gcsUri:'gs://offline/old.mp4',url:'https://offline.invalid/old.mp4',updatedAt:'2026-10-01T00:00:00Z'};
 const initial={id:'clip-e02-g01',previsStudio:{...base,selectedJobId:'old-job'},manhuaSegmentRefs:{previs:old}};
 globalThis.updates=[];globalThis.submits=0;globalThis.failSave=false;
 const services={submit:async()=>{globalThis.submits++;throw Error('未授权渲染')},get:async()=>null,list:async()=>({items:[],nextCursor:null})};
 const register=(_scope,_tool,control)=>{if(control)globalThis.control=control};
 function App(){const[block,setBlock]=React.useState(initial);const[epoch,setEpoch]=React.useState(0);globalThis.block=block;globalThis.reload=()=>{setBlock(JSON.parse(JSON.stringify(block)));setEpoch(epoch+1)};return <ManhuaPrevisStudioView key={epoch} effectsScopeKey='project-test' onAdvisorEffectsControl={register} block={block} characters={[]} services={services} onChange={(studio,reference)=>{if(globalThis.failSave)return false;globalThis.updates.push(studio);setBlock(previous=>({...previous,previsStudio:studio,manhuaSegmentRefs:reference?{previs:reference}:previous.manhuaSegmentRefs}));return true}}/>}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},plugins:[{name:"offline-trpc",setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"trpc",namespace:"offline"}));b.onLoad({filter:/.*/,namespace:"offline"},()=>({loader:"js",contents:"export const trpc={};"}));}}],define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,body:''}));await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>Boolean((globalThis as any).control));
  const inspect=()=>page.evaluate(async()=>JSON.parse(await (globalThis as any).control({action:'effects',tool:'scene',operation:'inspect'},new AbortController().signal)));
  let current=await inspect();expect(current.spec.actors[0].hasRiggedModel).toBe(true);expect(JSON.stringify(current)).not.toContain('m3d_test_mother');expect(current.spec.storyProps).toHaveLength(2);
  const actorId=current.spec.actors[0].id;
  const effects=[...['needle1','needle2'].flatMap((propId,i)=>[
   {id:'trail'+i,actorId,kind:'needle_trail',propId,startSec:4,endSec:5,color:'#FFD477',radius:.003,trailSec:.25},
   {id:'smoke'+i,actorId,kind:'acupoint_smoke',propId,startSec:5,endSec:6,color:'#222222',radius:.03,rise:.2,density:12,offset:[.02,0,0]},
  ]),{id:'warm',actorId,kind:'complexion',startSec:6,endSec:8,color:'#EFAE99',strength:.18}];
  const configure=async(effects:unknown[],sourceKey=current.sourceKey)=>page.evaluate(async({effects,sourceKey})=>{try{return {receipt:await (globalThis as any).control({action:'effects',tool:'scene',operation:'configure',clipId:'clip-e02-g01',sourceKey,sceneEffects:effects},new AbortController().signal)}}catch(error){return {error:String(error)}}},{effects,sourceKey});
  expect((await configure([{...effects[1],startSec:4}])).error).toContain('骨锚');expect(await page.evaluate(()=>(globalThis as any).updates.length)).toBe(0);
  await page.evaluate(()=>{(globalThis as any).failSave=true});expect((await configure(effects)).error).toContain('未保存');await page.evaluate(()=>{(globalThis as any).failSave=false});
  expect((await configure(effects)).receipt).toContain('configured');await page.waitForFunction(()=>(globalThis as any).updates.length===1);
  expect((await configure([])).error).toContain('已变化');current=await inspect();expect(current.spec.sceneEffects).toEqual(effects);
  await page.evaluate(()=>(globalThis as any).reload());await page.waitForFunction(()=>(globalThis as any).block.previsStudio.spec.sceneEffects.length===5);
  await page.click('[data-previs-scene-effects] > summary');
  expect(await page.$$('[aria-label="剧情特效针道具"]')).toHaveLength(4);expect(await page.$eval('[aria-label="气色变化强度"]',e=>(e as HTMLInputElement).value)).toBe('0.18');
  expect(await page.evaluate(()=>(globalThis as any).block.manhuaSegmentRefs.previs.gcsUri)).toBe('gs://offline/old.mp4');expect(await page.evaluate(()=>(globalThis as any).block.previsStudio.specHistory.length)).toBe(1);expect(await page.evaluate(()=>(globalThis as any).submits)).toBe(0);expect(errors).toEqual([]);
 }finally{await browser.close()}
},60000);
