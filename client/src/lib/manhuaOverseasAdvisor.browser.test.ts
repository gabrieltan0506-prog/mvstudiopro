/** 真实顾问与素材库交互；网络边界离线，验证期间不提交模型。 */
import { afterAll,beforeAll,expect,it } from 'vitest';
import {build} from 'esbuild';import puppeteer,{type Browser} from 'puppeteer';import path from 'node:path';
let browser:Browser;let bundle:string;
beforeAll(async()=>{
 const result = await build({ loader: { ".css": "empty" },stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`

 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
 import {ManhuaOverseasLibraryButton} from './client/src/components/canvas/ManhuaOverseasLibrary';
 const f=globalThis.fixture={requests:[],consumed:0};
 function App(){const[seed,setSeed]=useState(null);const[user,setUser]=useState('1');f.setUser=setUser;return <><ManhuaOverseasLibraryButton enabled onPrepareQuestion={question=>setSeed({id:crypto.randomUUID(),question,user})}/><Panel key={user} open userId={user} confirmedProjectVersion='version-test' onClose={()=>{}} questionSeed={seed?.user===user?seed:null} onQuestionSeedApplied={()=>{f.consumed++;setSeed(null);}} project={{context:{seriesTitle:'船战',episodeIndex:1,episodeTitle:'登船',stage:'outline',videoModel:'未选择',writerConfirmed:true,episodeBody:'主角登船寻找信物。',assetSummary:'',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'本集'}}/></>}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},plugins:[{name:"离线问答边界",setup(b){b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:"auth",namespace:"auth-test"}));b.onLoad({filter:/.*/,namespace:"auth-test"},()=>({loader:"js",contents:`export const useAuth=()=>({user:{id:7,role:"user"}});`}));b.onResolve({filter:/^@\/lib\/manhuaAdvisorStream$/},()=>({path:"stream",namespace:"stream-test"}));b.onLoad({filter:/.*/,namespace:"stream-test"},()=>({loader:"js",contents:`import{trpc}from'@/lib/trpc';export async function streamManhuaAdvisor(input,onText){onText('正在输出');return trpc.mvAnalysis.askPlatformSkillQa.useMutation().mutateAsync(input);}`}));b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"trpc",namespace:"offline"}));b.onLoad({filter:/.*/,namespace:"offline"},()=>({loader:"js",contents:`export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:8,exempt:false},isError:false,refetch:async()=>({})})},askPlatformSkillQa:{useMutation:()=>({isPending:false,mutateAsync:async input=>{const f=globalThis.fixture;f.requests.push(input);return {answer:'离线边界回执',remainingFreeToday:2,paidUnitCredits:1};}})}}};`}));}}],define:{"process.env.NODE_ENV":'"development"',"import.meta.env":"{}"}});
 bundle=result.outputFiles[0]!.text;browser=await puppeteer.launch({headless:true});
},30000);
afterAll(async()=>{await browser?.close();});

it("素材库进入真实顾问保留旧问题、超长不覆盖、账号切换不串稿且不自动发送",async()=>{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 await page.goto('http://localhost:41828/');await page.addScriptTag({content:bundle});
 const input='[aria-label="向创作顾问提问"]';await page.waitForSelector(input);
 const click=async(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);if(!b||b.disabled)throw Error(text);b.click();},text);
 const choose=async()=>{await click('漫剧出海');await page.waitForSelector('[aria-label="搜索漫剧出海素材"]');await page.type('[aria-label="搜索漫剧出海素材"]','博物馆夜班');await page.waitForFunction(()=>document.querySelectorAll('[aria-label="漫剧出海素材库"] article').length===1);await click('围绕这个故事准备顾问问题');};
 await page.type(input,'保留原问题：主角为何登船？');await choose();
 await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="向创作顾问提问"]')!.value.includes('overseas-film-32'));
 expect(await page.$eval(input,e=>(e as HTMLTextAreaElement).value)).toMatch(/^保留原问题：主角为何登船？\n\n请结合当前作品/);
 expect(await page.evaluate(()=>(globalThis as any).fixture.requests)).toEqual([]);
 await page.$eval(input,e=>{const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;set.call(e,'长'.repeat(1190));e.dispatchEvent(new Event('input',{bubbles:true}));});
 await choose();await page.waitForFunction(()=>(globalThis as any).fixture.consumed===2);
 expect(await page.$eval(input,e=>(e as HTMLTextAreaElement).value)).toBe('长'.repeat(1190));
 expect(await page.evaluate(()=>(globalThis as any).fixture.requests)).toEqual([]);
 await page.evaluate(()=>(globalThis as any).fixture.setUser('2'));await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="向创作顾问提问"]')!.value==='');
 await choose();await page.waitForFunction(()=>(globalThis as any).fixture.consumed===3);
 expect(await page.$eval(input,e=>(e as HTMLTextAreaElement).value)).toContain('overseas-film-32');
 expect(await page.evaluate(()=>(globalThis as any).fixture.requests)).toEqual([]);expect(errors).toEqual([]);
 await page.close();
},30000);
