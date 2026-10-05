import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({ loader: { ".css": "empty" }, stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
const f=globalThis.fixture={asks:[],generations:[],selected:[],release:null};
function App(){const[automatic,setAutomatic]=useState(false);f.setAutomatic=setAutomatic;const[dock,setDock]=useState(null);f.setDock=setDock;const[target,setTarget]=useState(undefined);const[task,setTask]=useState(undefined);f.setTarget=setTarget;f.setTask=setTask;return <Panel automaticMonitoring={automatic} dockHost={dock} open userId='1' confirmedProjectVersion='world-test' worldTarget={target} worldTaskState={task} studio3d={automatic?undefined:{}} onVoiceProduction={async a=>{f.selected.push(a);const t={sceneRefId:'clinic',labelZh:'诊台',sourceRevision:'a'.repeat(64),hintZh:'树下的木诊台'};setTarget(t);return JSON.stringify({worldTarget:t,candidateReady:false})}} onClose={()=>{}} templates={[]} onRequestTrial={()=>{}} onGenerateWorld={async c=>{f.generations.push(c);await new Promise(r=>f.release=r);setTask('queued');}} project={{context:{seriesTitle:'墨菁传',episodeIndex:1,episodeTitle:'献血',stage:'assets',videoModel:'未选择',writerConfirmed:true,episodeBody:'医生在树下诊台为娘把脉。',assetSummary:'诊台已绑定',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'诊台场景'}}/>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "仅模拟服务边界", setup(b) {
    b.onResolve({filter:/\/CreativeVoicePanel$/},()=>({path:'voice',namespace:'offline'}));
    b.onLoad({filter:/^voice$/,namespace:'offline'},()=>({resolveDir:process.cwd(),loader:'js',contents:`import {useEffect} from 'react';export function CreativeVoicePanel(p){useEffect(()=>{globalThis.fixture.mounts=(globalThis.fixture.mounts||0)+1;return()=>{globalThis.fixture.unmounts=(globalThis.fixture.unmounts||0)+1}},[]);globalThis.fixture.setLive=p.onSessionActiveChange;globalThis.fixture.execute=a=>p.onProductionAction(a,new AbortController().signal);return null}` }));
    b.onResolve({ filter: /^@\/lib\/manhuaAdvisorStream$/ }, () => ({ path: "stream", namespace: "offline" }));
    b.onLoad({ filter: /^stream$/, namespace: "offline" }, () => ({ loader: "js", contents: `export async function streamManhuaAdvisor(input){globalThis.fixture.asks.push(input);if(globalThis.fixture.error)throw new Error(globalThis.fixture.error);if(!input.manhuaContext.worldTarget)return {answer:'自动检查完成',remainingFreeToday:4,paidUnitCredits:8};return {answer:JSON.stringify({kind:'world_plan_v1',sceneRefId:input.manhuaContext.worldTarget.sceneRefId,summaryZh:'诊台放在树下，留出入口通路',textPrompt:'露天药庐前的木制诊台位于大树阴影下，清晨光线从东侧照入，诊台与入口之间留出通路。'}),remainingFreeToday:4,paidUnitCredits:8};}` }));
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
    b.onLoad({ filter: /^trpc$/, namespace: "offline" }, () => ({ loader: "js", contents: `export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:8,exempt:false},refetch:async()=>({})})}}};` }));
  } }], define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" } });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
async function open(): Promise<Page> {
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41847/"); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('textarea'); return page;
}
async function confirm(page: Page) { await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('确认方案，生成3DGS'))?.click()); }
it("语音场景要求一次绑定真实目标并生成方案卡，不把选图冒称已生成3DGS",async()=>{
 const p=await open();try{
 await p.waitForFunction(()=>typeof (globalThis as any).fixture.execute==="function");
 await p.evaluate(()=>(globalThis as any).fixture.execute({action:"world",assetId:"clinic",question:"保留树下木诊台，改为月夜冷光与窗内暖灯，先给方案，不生成。"}));
 await p.waitForSelector('[aria-label="3DGS场景方案"]');
 const f=await p.evaluate(()=>(globalThis as any).fixture);
 expect(f.selected).toHaveLength(1);expect(f.asks).toHaveLength(1);expect(f.asks[0].manhuaContext.worldTarget.sceneRefId).toBe("clinic");expect(f.asks[0].rawQuestion).toContain("月夜冷光");expect(f.generations).toEqual([]);
 }finally{await p.close()}
},20000);

it("切换白模停靠容器保留语音实例和待回执操作",async()=>{
 const p=await open();try{
 await p.waitForFunction(()=>(globalThis as any).fixture.mounts===1);
 for(let n=0;n<3;n++) {
  await p.evaluate(n=>{const el=document.createElement('section');el.id='dock-'+n;document.body.append(el);(globalThis as any).fixture.setDock(el)},n);
  await p.waitForFunction(n=>document.querySelector('#dock-'+n+' textarea')!==null,{},n);
 }
 await p.evaluate(()=>(globalThis as any).fixture.setDock(null));
 await p.waitForFunction(()=>document.querySelector('#root textarea')!==null);
 expect(await p.evaluate(()=>({mounts:(globalThis as any).fixture.mounts,unmounts:(globalThis as any).fixture.unmounts||0}))).toEqual({mounts:1,unmounts:0});
 }finally{await p.close()}
},20000);

it("语音操作期间暂缓自动咨询，结束后恢复检查而非抢占制作",async()=>{
 const p=await open();try{
 await p.waitForFunction(()=>typeof (globalThis as any).fixture.setLive==='function');
 await p.evaluate(()=>{(globalThis as any).fixture.setAutomatic(true);(globalThis as any).fixture.setLive(true)});
 await new Promise(r=>setTimeout(r,8500));
 expect(await p.evaluate(()=>(globalThis as any).fixture.asks.length)).toBe(0);
 await p.evaluate(()=>(globalThis as any).fixture.setLive(false));
 await p.waitForFunction(()=>(globalThis as any).fixture.asks.length===1,{timeout:11000});
 }finally{await p.close()}
},25000);

it("顾问失败时语音收到实际错误，不能把素材登记失败说成缺音轨",async()=>{
 const p=await open();try{
 await p.waitForFunction(()=>typeof (globalThis as any).fixture.execute==="function");
 await p.evaluate(()=>(globalThis as any).fixture.error="素材尚未登记,请从画布/成片里重新选择站内素材");
 const reply=await p.evaluate(()=>(globalThis as any).fixture.execute({action:"world",assetId:"clinic",question:"月夜庭院"}));
 expect(reply).toContain("素材尚未登记");expect(reply).toContain("不要自动重试");expect(reply).not.toContain("缺音轨");
 expect(await p.evaluate(()=>(globalThis as any).fixture.asks.length)).toBe(1);
 }finally{await p.close()}
},20000);
