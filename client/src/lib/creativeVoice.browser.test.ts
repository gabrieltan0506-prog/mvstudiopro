import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser, voiceBundle: string, parentBundle: string;
const fixture = `const f=globalThis.fixture={calls:[],results:[],nav:[],messages:[],sockets:[],closed:0};window.confirm=()=>true;
class Socket{static OPEN=1;readyState=1;bufferedAmount=0;constructor(){f.sockets.push(this);setTimeout(()=>this.onopen?.(),0);}send(raw){f.messages.push(JSON.parse(raw));if(JSON.parse(raw).type==='start')setTimeout(()=>this.emit({type:'status',text:'ready',ready:true}),0);}close(){f.closed++;this.readyState=3;}emit(value){this.onmessage?.({data:JSON.stringify(value)});}}window.WebSocket=Socket;
window.AudioContext=class{currentTime=0;resume(){return Promise.resolve();}close(){return Promise.resolve();}};`;
async function bundle(contents: string, parent = false) {
  const result = await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},jsx:'automatic',bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',loader:{'.css':'empty'},alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"development"','import.meta.env':'{}'},plugins:[{name:'boundaries',setup(b){
    b.onResolve({filter:/useAuth$/},()=>({path:'auth',namespace:'mock'}));
    b.onResolve({filter:/longJobsFlyOrigin$/},()=>({path:'origin',namespace:'mock'}));
    if(parent){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'trpc',namespace:'mock'}));b.onResolve({filter:/manhuaAdvisorStream$/},()=>({path:'stream',namespace:'mock'}));b.onResolve({filter:/\.\/CreativeVoicePanel$/},()=>({path:'voice',namespace:'mock'}));}
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'tsx',resolveDir:process.cwd(),contents: args.path==='auth'?`export const useAuth=()=>({user:{id:7,role:'admin'}});`:args.path==='origin'?`export const withLongJobsFlyDirect=p=>p;export const flyHealthProbeOriginForUrl=()=>null;`:args.path==='trpc'?`export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:0,price:12,exempt:false},refetch:async()=>({})})}}};`:args.path==='stream'?`export async function streamManhuaAdvisor(input){globalThis.fixture.calls.push(input);if(!input.confirmPaid)throw Error('PAYMENT_REQUIRED 扣除12积分');return {answer:'灯光与人物站位优化完成',remainingFreeToday:0,paidUnitCredits:12,creditsCharged:12,paidThisTurn:true};}`:`export function CreativeVoicePanel(props){globalThis.fixture.ask=()=>props.onAskAdvisor('请分析这一集的灯光',new AbortController().signal).then(x=>globalThis.fixture.results.push(x));return <div>语音桥测试</div>;}` }));
  }}]});return result.outputFiles[0].text;
}
beforeAll(async()=>{
 voiceBundle=await bundle(`import{useState}from'react';import{createRoot}from'react-dom/client';import{CreativeVoicePanel}from'./client/src/components/canvas/CreativeVoicePanel';${fixture}
 function App(){const[scope,setScope]=useState('project-a');f.switch=()=>setScope('project-b');return <CreativeVoicePanel scopeKey={scope} context='已有3DGS医馆' targets={[{episode:2,label:'第二集'},{episode:2,shot:3,label:'第三镜'}]} onNavigate={t=>{f.nav.push(t);return '已定位';}} onUse={t=>f.results.push(t)} onAskAdvisor={q=>{f.calls.push(q);return new Promise(resolve=>f.resolve=resolve);}}/>}createRoot(document.getElementById('root')).render(<App/>);`);
 parentBundle=await bundle(`import{createRoot}from'react-dom/client';import Panel from'./client/src/components/canvas/ManhuaCreativeAdvisorPanel';${fixture}
 createRoot(document.getElementById('root')).render(<Panel open userId='7' projectId='6f9619ff-8b86-4d01-b42d-00cf4fc964ff' confirmedProjectVersion='test' onClose={()=>{}} templates={[]} onRequestTrial={()=>{}} project={{context:{seriesTitle:'测试作品',episodeIndex:1,episodeTitle:'入局',stage:'storyboard',videoModel:'未选择',writerConfirmed:true,episodeBody:'两人在医馆走廊对峙。',assetSummary:'已有医馆3DGS',shotSummary:'先全景后近景',blockers:[]},issues:[],contextNotes:[],selectionLabel:'镜1'}}/>);`,true);
 browser=await puppeteer.launch({headless:true});
},60000);
afterAll(async()=>{await browser?.close();});
async function pageWith(code:string){const page=await browser.newPage();page.setDefaultTimeout(6000);await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41849/');await page.addScriptTag({content:code});return page;}
async function click(page:Page,text:string){await page.evaluate(t=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes(t));if(!b)throw Error(t);b.click();},text);}
it('真实语音面板：工具去重、结果回传、本机备注恢复、定位、作品切换断线',async()=>{
 const page=await pageWith(voiceBundle);await click(page,'打开');await click(page,'开始讨论');await page.waitForFunction(()=>document.body.textContent?.includes('ready'));
 await page.evaluate(()=>{const f=(globalThis as any).fixture;const msg={type:'tool',id:'ask1',question:'分析灯光'};f.sockets[0].emit(msg);f.sockets[0].emit(msg);});
 expect(await page.evaluate(()=>(globalThis as any).fixture.calls)).toEqual(['分析灯光']);
 expect(await page.evaluate(()=>(globalThis as any).fixture.messages.filter((m:any)=>m.type==='toolResult'))).toEqual([]);
 await page.evaluate(()=>(globalThis as any).fixture.resolve('使用暖光衬托人物'));await page.waitForFunction(()=>(globalThis as any).fixture.messages.some((m:any)=>m.id==='ask1'));
 await page.evaluate(()=>(globalThis as any).fixture.sockets[0].emit({type:'workflow',id:'note1',action:{action:'note',episode:2,shot:3,text:'角色被门框遮挡，调整站位'}}));
 await page.waitForFunction(()=>document.body.textContent?.includes('角色被门框遮挡'));await click(page,'定位');
 expect(await page.evaluate(()=>(globalThis as any).fixture.nav)).toEqual([{episode:2,shot:3,label:'第三镜'}]);
 const raw=await page.evaluate(()=>localStorage.getItem('creative-voice-notes:project-a:review'));expect(JSON.parse(raw!)[0]).toMatchObject({episode:2,shot:3,text:'角色被门框遮挡，调整站位'});
 await page.evaluate(()=>(globalThis as any).fixture.switch());await page.waitForFunction(()=>(globalThis as any).fixture.closed>0);
 expect(await page.evaluate(()=>document.querySelector('[aria-label="看片修改清单"]')?.textContent)).not.toContain('角色被门框遮挡');
 expect(await page.evaluate(()=>localStorage.getItem('creative-voice-notes:project-b:review'))).toBeNull();
 await page.close();
});
it('真实顾问组件：付费确认前语音Promise不结束；原ID确认一次并回送答案',async()=>{
 const page=await pageWith(parentBundle);await page.waitForFunction(()=>!!(globalThis as any).fixture.ask);await page.evaluate(()=>{void(globalThis as any).fixture.ask();});
 await page.waitForFunction(()=>document.body.textContent?.includes('确认支付 12 积分并继续'));
 expect(await page.evaluate(()=>(globalThis as any).fixture.results)).toEqual([]);
 await click(page,'确认支付 12 积分并继续');await page.waitForFunction(()=>(globalThis as any).fixture.results.length===1);
 const f=await page.evaluate(()=>(globalThis as any).fixture);expect(f.results).toEqual(['灯光与人物站位优化完成']);expect(f.calls).toHaveLength(2);expect(f.calls[0].requestId).toBe(f.calls[1].requestId);expect(f.calls[1]).toMatchObject({confirmPaid:true,confirmedCredits:12});
 await page.close();
},20000);
it('静态参考图单独标记；影片播放器仅定位，不向Live发送影片画面或音轨',async()=>{
 const page=await pageWith(voiceBundle);await click(page,'打开');await click(page,'开始讨论');await page.waitForFunction(()=>document.body.textContent?.includes('ready'));
 await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.getContext('2d')!.fillRect(0,0,160,90);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));
  const dt=new DataTransfer();dt.items.add(new File([blob],'分镜.png',{type:'image/png'}));
  const input=document.querySelector('[aria-label="分享分镜参考图"]') as HTMLInputElement;input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.waitForFunction(()=>(globalThis as any).fixture.messages.some((m:any)=>m.type==='frame'&&m.still));
 expect(await page.evaluate(()=>(globalThis as any).fixture.messages.find((m:any)=>m.still))).toMatchObject({source:'分镜.png',still:true,atSec:0});
 await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.getContext('2d')!.fillRect(0,0,160,90);
  const video=document.createElement('video');video.muted=true;video.srcObject=canvas.captureStream(1);document.body.append(video);await video.play();(globalThis as any).fixture.video=video;
 });
 await click(page,'读取本页播放器');
 expect(await page.$eval('[aria-label="定位的播放器"]',e=>e.textContent)).toContain('播放器1');
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='分享画面'))).toBe(false);
 expect(await page.evaluate(()=>document.body.textContent)).toContain('不向 Live 传送影片画面或音轨');
 expect(await page.evaluate(()=>(globalThis as any).fixture.messages.filter((m:any)=>(m.type==='frame'&&!m.still)||m.type==='videoAudio'))).toEqual([]);
 await click(page,'结束语音');const before=await page.evaluate(()=>(globalThis as any).fixture.messages.length);
 await new Promise(r=>setTimeout(r,1200));expect(await page.evaluate(()=>(globalThis as any).fixture.messages.length)).toBe(before);
 await page.close();
},20000);
