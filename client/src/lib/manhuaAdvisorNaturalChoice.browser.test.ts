import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("自然语言推荐和混搭在正式组件保存选择；不展示编号，不自动改稿，刷新恢复", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
const f=globalThis.fixture={calls:[],optimized:[],saved:[]};
f.cards=['mt_a123','mt_b456','mt_c789','mt_d012'].map((publicId,i)=>({publicId,nameZh:'可读思路'+(i+1),methodBrief:{title:['先留一个疑问','让处境越来越难','两人说话更有来回','结尾留下期待'][i],highlights:['开头先藏住答案','让人物回应对方']},featureZh:'起承转合',introZh:''}));
f.plans=f.cards.map(c=>({publicId:c.publicId,reason:'适合当前人物寻找线索',changes:['在开头放一条线索','用对话逐步揭开'],preserve:'原人物与事件'}));
f.choice={kind:'template-choice',explanation:'开头借第一个思路留下疑问，对话借第三个思路让人物互相回应。还没有改稿。',choices:[{publicId:'mt_a123',features:['brief:0:开头先藏住答案']},{publicId:'mt_c789',features:['brief:1:让人物回应对方']}]};
function App(){const[episodes,setEpisodes]=useState(()=>JSON.parse(localStorage.getItem('test-episodes')||'null')||[{index:1,title:'找信',body:'她登船寻找信件，与守卫互相试探。',endHook:''}]);return <Panel open userId='7' projectId='20000000-0000-4000-8000-000000000001' confirmedProjectVersion='natural-choice' onClose={()=>{}} templates={f.cards} onRequestTrial={()=>{}} onTemplateReferences={(index,body,plans)=>{if(episodes[0].body!==body)return false;const next=episodes.map(e=>e.index===index?{...e,templateReferences:plans}:e);localStorage.setItem('test-episodes',JSON.stringify(next));f.saved.push(plans);setEpisodes(next);return true;}} episodeWorkspace={{episodes,model:'glm',comparisonHost:null,onFocusEpisode:()=>{},onApplyCandidates:()=>{throw Error('不应自动采用')}}} project={{context:{seriesTitle:'找信',episodeIndex:1,episodeTitle:'找信',stage:'outline',videoModel:'未选择',writerConfirmed:true,episodeBody:episodes[0].body,assetSummary:'',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'本集'}}/>}createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" }, plugins: [{name:"离线服务边界",setup(b){b.onResolve({filter:/^sonner$/},()=>({path:"toast",namespace:"toast-test"}));b.onLoad({filter:/.*/,namespace:"toast-test"},()=>({loader:"js",contents:`export const toast={error:(...v)=>console.error("TOAST",JSON.stringify(v)),success:()=>{},info:()=>{}};`}));b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:"auth",namespace:"auth-test"}));b.onLoad({filter:/.*/,namespace:"auth-test"},()=>({loader:"js",contents:`export const useAuth=()=>({user:{id:7,role:"user"}});`}));
    b.onResolve({filter:/^@\/lib\/manhuaAdvisorStream$/},()=>({path:"stream",namespace:"fixture"}));
    b.onLoad({filter:/^stream$/,namespace:"fixture"},()=>({loader:"js",contents:`export async function streamManhuaAdvisor(input){const f=globalThis.fixture;f.calls.push(input);return {answer:JSON.stringify(input.manhuaContext.templateRecommendation?{kind:'template-plans',plans:f.plans}:f.choice),remainingFreeToday:3};}`}));
    b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"trpc",namespace:"fixture"}));
    b.onLoad({filter:/^trpc$/,namespace:"fixture"},()=>({loader:"js",contents:`export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:8,exempt:false},refetch:async()=>({})})},askPlatformSkillQa:{useMutation:()=>({isPending:false})},manhuaEpisodeOptimizationQuota:{useQuery:()=>({data:{trialsLeftToday:3}})},manhuaEpisodeOptimizationHistory:{useQuery:()=>({data:[],refetch:async()=>({})})},optimizeManhuaEpisodes:{useMutation:()=>({isPending:false,mutateAsync:async x=>{globalThis.fixture.optimized.push(x);throw Error('不应自动生成')}})}}};`}));
  }}] });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(7000); page.on("pageerror", error => console.error("PAGEERROR", error)); page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
    await page.setRequestInterception(true); page.on("request", r => r.isNavigationRequest() ? void r.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}) : void r.abort());
    await page.goto("http://localhost:41933/"); await page.addScriptTag({content:bundle.outputFiles[0].text});
    const ask = async (text: string) => {await page.waitForSelector('[aria-label="向创作顾问提问"]');await page.type('[aria-label="向创作顾问提问"]',text);await page.focus('[aria-label="向创作顾问提问"]');await page.keyboard.press("Enter");};
    await ask("请给我推荐一种思路，再看看其他三种模板亮点");
    await page.waitForFunction(()=>(globalThis as any).fixture.saved.length===1).catch(async error => { console.error(await page.evaluate(()=>({text:document.body.innerText,calls:(globalThis as any).fixture.calls}))); throw error; });
    expect(await page.$$eval('[aria-label="选集与模板组合优化"] h4',els=>els.map(e=>e.textContent))).toHaveLength(4);
    await ask("我想要第一个的开头，再结合第三个的人物回应");
    await page.waitForFunction(()=>(globalThis as any).fixture.saved.length===2);
    await page.waitForSelector('[aria-label="已选模板特色"]');
    const chosen = await page.$eval('[aria-label="已选模板特色"]',e=>e.textContent);
    expect(chosen).toContain("开头先藏住答案");expect(chosen).toContain("让人物回应对方");
    expect(await page.evaluate(()=>document.body.innerText)).not.toMatch(/mt_a123|mt_c789|template-choice/);
    expect(await page.evaluate(()=>(globalThis as any).fixture.optimized)).toEqual([]);
    const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem("test-episodes")!).at(0).templateReferences);
    expect(saved.filter((p:any)=>p.selected).map((p:any)=>p.publicId)).toEqual(["mt_a123","mt_c789"]);
    await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('[aria-label="已选模板特色"]');
    expect(await page.$eval('[aria-label="已选模板特色"]',e=>e.textContent)).toContain("让人物回应对方");
    expect(await page.evaluate(()=>(globalThis as any).fixture.calls)).toEqual([]);
  } finally { await browser.close(); }
},30_000);
