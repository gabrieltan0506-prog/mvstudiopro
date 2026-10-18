/** 真实React组件与iframe配置接线验证；网络和ready回执受控，不代表生产画面质量验收。 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser, bundle: string;
const ORIGIN = "http://localhost:41807";
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {DigitalHumanSpatialStudio} from './client/src/components/DigitalHumanSpatialStudio';
    import {DigitalHumanSpatialAdvisorPanel} from './client/src/components/DigitalHumanSpatialAdvisorPanel';
    import {newDigitalHumanDraft,loadDigitalHumanDraft} from './shared/digitalHumanStudio';
    const f=globalThis.fixture={calls:[],worldCalls:[],retryCalls:[],worldStatus:"succeeded",cloud:[],failAsk:false,failCloud:false,applyCount:0,previsSubmits:[],previsGets:[]};
    const initial=newDigitalHumanDraft('7','a51d8a78-1c90-4f1d-9c1e-324e7a3f4659');
    initial.scene={source:'gs://test-only/scene.png',name:'咖啡厅'};initial.portrait={source:'gs://test-only/person.png',name:'本人'};initial.worldTaskId='world-test';
    initial.mainModel={taskId:'model-test',status:'succeeded',sourceVersion:initial.portrait.source,sourceImageUrl:'https://example.test/person.png',glbUrl:'https://example.test/person.glb',updatedAt:1};
    initial.stageAnchors=[{id:'window',labelZh:'窗边',point:[3,4],worldTaskId:initial.worldTaskId,sceneSource:initial.scene.source}];
    f.draft=initial;
    function App(){const[draft,setDraft]=React.useState(f.draft),[version,setVersion]=React.useState(0),[busy,setBusy]=React.useState(false);
      const update=p=>{f.draft=loadDigitalHumanDraft(JSON.stringify({...f.draft,...p}),'7');setDraft(f.draft);};
      f.update=update;f.clearWorld=()=>update({worldTaskId:undefined,mainModel:undefined,stageAnchors:[]});f.change=()=>update({mainStage:{x:9,y:9,yaw:0}});f.reload=()=>{f.draft=loadDigitalHumanDraft(JSON.stringify(f.draft),'7');setDraft(f.draft);setVersion(v=>v+1);};
      const store={getItem:k=>f.draft.advisorStorage[k]||null,setItem:(k,v)=>update({advisorStorage:{...f.draft.advisorStorage,[k]:v}}),removeItem:k=>{const n={...f.draft.advisorStorage};delete n[k];update({advisorStorage:n});},get length(){return Object.keys(f.draft.advisorStorage).length;},key:i=>Object.keys(f.draft.advisorStorage)[i],clear:()=>{throw Error('禁止清空')}};
      if(globalThis.parentMode)return <DigitalHumanSpatialStudio draft={draft} role="admin" disabled={busy} onChange={p=>{f.applyCount++;update(p);}} uploadFile={async()=>{throw Error('禁止上传')}} beforeSubmit={async()=>{if(f.failCloud)throw Error("云保存冲突");f.cloud.push(JSON.stringify(f.draft));}} acquireWork={()=>{setBusy(true);return()=>setBusy(false);}}/>;
      return <DigitalHumanSpatialAdvisorPanel key={version} draft={draft} getDraft={()=>f.draft} world={{spz500kUrl:'https://example.test/world.spz'}} disabled={busy} storage={store}
        beforeSubmit={async()=>{if(f.failCloud)throw Error('云保存冲突');f.cloud.push(JSON.stringify(f.draft));}}
        acquireWork={()=>{setBusy(true);return()=>setBusy(false);}} onApply={p=>{f.applyCount++;update(p);}}/>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [{ name: "offline-api", setup(b) {
      b.onResolve({filter:/\/(Manhua3dModelStudio|ManhuaPrevisStudio|ManhuaAutoRigEditor|ArtMotionStudio|DigitalHumanRenderReview)$/},a=>({path:a.path.split('/').at(-1)!,namespace:'unused'}));
      b.onLoad({filter:/.*/,namespace:'unused'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='Manhua3dModelStudio'?`import React from 'react';export function Manhua3dModelStudio(p){return <button onClick={()=>p.onRig(p.characters[0].id)}>探针打开原模型绑骨</button>}export default Manhua3dModelStudio;`:`export const ${a.path}=p=>{if(globalThis.fixture)globalThis.fixture['${a.path}']=p;return null};export default ${a.path};`}));
      b.onResolve({filter:/digitalHumanVideo$/},()=>({path:'media',namespace:'media'}));
      b.onLoad({filter:/.*/,namespace:'media'},()=>({loader:'js',contents:'export const digitalHumanMediaUrl=async()=>"https://example.test/media.png";'}));
      b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
      b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `
        const quota={remaining:5,price:12,exempt:false};
        const unused={useMutation:()=>({mutateAsync:async()=>{throw Error('禁止真实生成')}})};
        const world={taskId:'world-test',sceneRef:'scene-test',sourceVersion:'gs://test-only/scene.png',status:'succeeded',model:'marble-0.1-mini',assets:{spz500kUrl:'https://example.test/world.spz'},updatedAt:'2026-10-15T00:00:00Z'};
        const previsReceipt=input=>({jobId:'previs-offline-job',status:'succeeded',params:input,output:{requestId:input.requestId,clipId:input.clipId,spec:input.spec,quality:input.quality,audio:input.audio,durationSec:input.spec.durationSec,gcsUri:'gs://test-only/previs.mp4',url:'https://example.test/previs.mp4',report:{warnings:[]}}});
        export const trpc={manhuaPrevis:{submit:{useMutation:()=>({mutateAsync:async input=>{const f=globalThis.fixture;f.previsSubmits.push(structuredClone(input));f.previsReceipt=previsReceipt(input);return f.previsReceipt;}})}},useUtils:()=>({manhuaPrevis:{get:{fetch:async input=>{const f=globalThis.fixture;f.previsGets.push(input);return f.previsReceipt;}}},manhua3d:{get:{fetch:async()=>{throw Error('禁止建模')}}}}),manhua3d:{submit:unused,importExisting:unused},manhuaWorld:{retry:{useMutation:()=>({mutateAsync:async input=>{const f=globalThis.fixture;f.retryCalls.push(input);if(f.failRetry)throw Error('重试回执中断');return {taskId:'retried-world-test'};}})},submit:{useMutation:()=>({mutateAsync:async input=>{const f=globalThis.fixture;f.worldCalls.push({input,saved:JSON.parse(f.cloud.at(-1))});if(f.failWorld)throw Error('模拟提交结果不明');return {taskId:'new-world-test'};}})},listMine:{useQuery:()=>({data:[{...world,status:globalThis.fixture.worldStatus}],refetch:async()=>{globalThis.fixture.refetches=(globalThis.fixture.refetches||0)+1;return {data:[world]};}})},sceneAccess:{useQuery:()=>({data:{canGenerate:true}})}},mvAnalysis:{getVideoUploadSignedUrl:unused,queuePostProd:unused,getManhuaAdvisorQuota:{useQuery:()=>({data:quota,isError:false,refetch:async()=>({data:quota})})},askPlatformSkillQa:{useMutation:()=>({mutateAsync:async input=>{
          const f=globalThis.fixture;f.calls.push(input);if(f.failAsk)throw Error('网络中断');if(input.manhuaContext.previsEdit){const t=input.manhuaContext.previsEdit;const spec=JSON.parse(t.specJson);return {answer:JSON.stringify({kind:'previs_edit_v1',summaryZh:'镜头略微靠近',unsupportedZh:[],shotCoverage:[{index:1,status:'covered',actorIds:spec.actors.map(a=>a.id),reasonZh:'保留当前人物与完整时间'}],cameras:spec.cameras.map((c,i)=>i===0?{...c,lens:c.lens+1}:c)})};} const t=input.manhuaContext.digitalHumanSpatial;
          return {answer:JSON.stringify({kind:'digital_human_spatial_v1',draftId:t.draftId,sourceRevision:t.sourceRevision,summaryZh:'讲述者站到窗边，面向镜头',unresolvedZh:[],actors:[{actorId:t.actors[0].id,position:{kind:'relative',reference:'anchor',referenceId:'window',rightM:0,forwardM:0},facing:{kind:'camera'}}],camera:{kind:'single',subjectActorId:t.actors[0].id}})};
        }})}}};` }));
    } }], define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" } });
  bundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
async function pageFixture(parentMode = false) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", r => { if (r.url().startsWith(ORIGIN)) void r.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}); else void r.abort(); });
  await page.goto(ORIGIN); await page.evaluate(value => { (window as any).parentMode = value; }, parentMode); await page.addScriptTag({ content: bundle }); await page.waitForSelector('textarea[aria-label="场景站位要求"]');
  if(parentMode)await page.evaluate(()=>{document.querySelector('details')!.open=true;});
  return {context,page};
}
async function click(page: Page, text: string) {
  await page.evaluate(text => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent === text); if (!b || b.disabled) throw Error("按钮不可用："+text+" | "+document.body.innerText); b.click(); }, text);
}
async function propose(page: Page) {
  await page.type('textarea[aria-label="场景站位要求"]', "讲述者站到窗边面向镜头"); await click(page,"生成场景方案");
  await page.waitForFunction(() => document.body.innerText.includes("在真实场景试看（免费）"));
}
async function ready(page: Page, wrongRevision = false, missing = false, missingWorld = false) {
  await page.evaluate(({wrongRevision,missing,missingWorld}) => {
    const el=document.querySelector("[data-manhua-world-stage]")!, frame=el.querySelector("iframe")!;
    window.dispatchEvent(new MessageEvent("message",{source:frame.contentWindow,data:{source:"manhua-world-stage",revision:wrongRevision?"old":el.getAttribute("data-stage-revision"),type:"ready",loaded:missing?[]:[...(missingWorld?[]:["world"]),`dh-person-${(window as any).fixture.draft.id}`],failed:[]}}));
  },{wrongRevision,missing,missingWorld});
}
it("自然语言→真实iframe站位/机位配置→确认采用→稿件往返；未就绪不能采用", async()=>{
  const {context,page}=await pageFixture();try{
    await propose(page);await click(page,"在真实场景试看（免费）");await page.waitForSelector("[data-manhua-world-stage] iframe");
    const config=await page.$eval("iframe",el=>JSON.parse(el.srcdoc.match(/const CONFIG = (.*);/)![1]));
    expect(config.characters[0].stagePoint).toEqual([3,4]);expect(config.characters[0].yawDeg).toBe(0);expect(config.initialCamera.target).toEqual([3,4,1.5]);expect(config.lockCamera).toBe(true);
    expect(await page.evaluate(()=>(window as any).fixture.draft.mainStage)).toBeUndefined();
    const disabled=()=>page.evaluate(()=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="确认采用并保存")!.disabled);
    expect(await disabled()).toBe(true);await ready(page,true);expect(await disabled()).toBe(true);await ready(page,false,true);expect(await disabled()).toBe(true);await ready(page,false,false,true);expect(await disabled()).toBe(true);
    await ready(page);await page.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="确认采用并保存")!.disabled);
    await click(page,"确认采用并保存");await page.waitForFunction(()=>document.body.innerText.includes("场景站位与机位已保存"));
    const saved=await page.evaluate(()=>(window as any).fixture.draft);expect(saved.mainStage).toEqual({x:3,y:4,yaw:0});expect(saved.stageCamera.target).toEqual([3,4,1.5]);
    await page.evaluate(()=>(window as any).fixture.reload());expect(await page.evaluate(()=>(window as any).fixture.draft.mainStage)).toEqual(saved.mainStage);
  }finally{await context.close();}
},20000);
it("取消不改稿；场景变化使候选失效",async()=>{
  const {context,page}=await pageFixture();try{
    await propose(page);await click(page,"在真实场景试看（免费）");await page.waitForSelector("iframe");await click(page,"取消试看，保留原稿");
    expect(await page.evaluate(()=>(window as any).fixture.applyCount)).toBe(0);
    await page.evaluate(()=>(window as any).fixture.change());await click(page,"在真实场景试看（免费）");await page.waitForFunction(()=>document.body.innerText.includes("旧方案不能"));
    expect(await page.evaluate(()=>(window as any).fixture.applyCount)).toBe(0);
  }finally{await context.close();}
},20000);
it("请求断网刷新沿同编号恢复；云保存失败在采用前阻断",async()=>{
  const {context,page}=await pageFixture();try{
    await page.evaluate(()=>(window as any).fixture.failAsk=true);await page.type('textarea[aria-label="场景站位要求"]',"站到窗边");await click(page,"生成场景方案");await page.waitForFunction(()=>document.body.innerText.includes("网络中断"));
    await page.evaluate(()=>{(window as any).fixture.failAsk=false;(window as any).fixture.reload();});await click(page,"恢复原场景请求");await page.waitForFunction(()=>document.body.innerText.includes("在真实场景试看（免费）"));
    const ids=await page.evaluate(()=>(window as any).fixture.calls.map((v:any)=>v.requestId));expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
    await click(page,"在真实场景试看（免费）");await page.waitForSelector("iframe");await ready(page);await page.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="确认采用并保存")!.disabled);
    await page.evaluate(()=>(window as any).fixture.failCloud=true);await click(page,"确认采用并保存");await page.waitForFunction(()=>document.body.innerText.includes("云保存冲突"));expect(await page.evaluate(()=>(window as any).fixture.applyCount)).toBe(0);
  }finally{await context.close();}
},20000);

it("真实数字人父组件采用后，场景消费者收到同一人物位置与机位", async()=>{
  const {context,page}=await pageFixture(true);try{
    await propose(page);await click(page,"在真实场景试看（免费）");await page.waitForSelector("iframe");await ready(page);
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="确认采用并保存")!.disabled);
    await click(page,"确认采用并保存");await page.waitForFunction(()=>document.body.innerText.includes("场景站位与机位已保存"));
    await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('查看场景'));if(!b)throw Error('缺场景入口');b.click();});
    await page.waitForSelector('[data-manhua-world-preview] iframe');
    const config=await page.$eval('[data-manhua-world-preview] iframe',el=>JSON.parse((el as HTMLIFrameElement).srcdoc.match(/const CONFIG = (.*);/)![1]));
    expect(config.characters[0].stagePoint).toEqual([3,4]);expect(config.initialCamera.target).toEqual([3,4,1.5]);
    await ready(page);await page.type('input[aria-label="场景地点名称"]','吧台旁');
    await click(page,'在画面中标记地点');
    const point=async(revision:string|null)=>page.evaluate(rev=>{const el=document.querySelector('[data-manhua-world-stage]')!,frame=el.querySelector('iframe')!;window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{source:'manhua-world-stage',revision:rev??el.getAttribute('data-stage-revision'),type:'ground_point',point:[5,6]}}));},revision);
    await point('old');expect(await page.evaluate(()=>document.body.innerText.includes('确认「吧台旁」地点'))).toBe(false);
    await point(null);await page.waitForFunction(()=>document.body.innerText.includes('确认「吧台旁」地点'));await click(page,'确认「吧台旁」地点');
    await page.waitForFunction(()=>(window as any).fixture.draft.stageAnchors.length===2);
    expect(await page.evaluate(()=>(window as any).fixture.draft.stageAnchors[1])).toMatchObject({labelZh:'吧台旁',point:[5,6],worldTaskId:'world-test'});
  }finally{await context.close();}
},20000);


it("无世界的数字人场景可从真实表单提交，云端先保存请求，回执绑定原图", async () => {
  const { context, page } = await pageFixture(true);
  const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
  try {
    await page.evaluate(() => { (window as any).fixture.clearWorld(); window.confirm = () => true; });
    await page.waitForSelector('textarea[aria-label="3DGS生成要求"]');
    await page.type('textarea[aria-label="3DGS生成要求"]', "保留左侧窗户与书桌，空场景");
    expect(await page.$eval('fieldset', e => e.textContent)).toContain("1580");
    await click(page, "生成当前场景3DGS");
    await page.waitForFunction(() => (window as any).fixture.draft.worldTaskId === "new-world-test");
    const result = await page.evaluate(() => ({ calls: (window as any).fixture.worldCalls, draft: (window as any).fixture.draft }));
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].input).toMatchObject({ sourceVersion: "gs://test-only/scene.png", sourceImageGcsUri: "gs://test-only/scene.png", model: "marble-1.1", prompt: { type: "image", isPano: false, textPrompt: "保留左侧窗户与书桌，空场景" } });
    expect(result.calls[0].saved.worldRequest).toMatchObject({ sourceVersion: "gs://test-only/scene.png", model: "marble-1.1" });
    expect(result.draft.worldRequest).toBeUndefined();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("结果不明保留原场景请求，再点生成不会重复提交", async () => {
  const { context, page } = await pageFixture(true);
  try {
    await page.evaluate(() => { const f=(window as any).fixture;f.clearWorld();f.failWorld=true;window.confirm=()=>true; });
    await page.waitForSelector('textarea[aria-label="3DGS生成要求"]');
    await click(page, "生成当前场景3DGS");
    await page.waitForFunction(() => document.body.innerText.includes("模拟提交结果不明"));
    await click(page, "生成当前场景3DGS");
    await page.waitForFunction(() => document.body.innerText.includes("原场景建模请求待核对"));
    const result=await page.evaluate(()=>({calls:(window as any).fixture.worldCalls.length,pending:!!(window as any).fixture.draft.worldRequest}));
    expect(result).toEqual({calls:1,pending:true});
  } finally { await context.close(); }
});

it("自然语言首问自动保存25秒白模并发送真实上下文；改时长保留旧稿且无坐标表单", async () => {
  const { context, page } = await pageFixture(true);
  try {
    const setDuration = async (value: string) => page.evaluate(value => {
      const input=document.querySelector<HTMLInputElement>('input[aria-label="白模目标时长"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }, value);
    await setDuration("25");
    await page.type('textarea[aria-label="数字人导演要求"]',"左手保持面板，右手整理资料，镜头缓缓推近");
    await click(page,"生成导演方案");
    await page.waitForFunction(()=>(window as any).fixture.draft.previsStudio?.spec.durationSec===25);
    await setDuration("20");
    await click(page,"更新当前预演方案（保留旧稿）");
    const result=await page.evaluate(()=>(window as any).fixture.draft.previsStudio);
    expect(result.spec.durationSec).toBe(20);
    expect(result.specHistory.at(-1).spec.durationSec).toBe(25);
    expect(result.history).toEqual([]);
    expect(await page.evaluate(() => document.body.textContent?.includes("高级微调"))).toBe(false);
    const sent=await page.evaluate(() => (window as any).fixture.calls.find((c:any) => c.manhuaContext.previsEdit));
    expect(JSON.parse(sent.manhuaContext.previsEdit.specJson).durationSec).toBe(25);
    expect(JSON.parse(sent.manhuaContext.previsEdit.specJson).actors[0].id).toContain("dh-person-");
  } finally { await context.close(); }
});

// 离线组件回执仅验证接线及恢复保护，不代表线上生成验收。
it("失败世界使用原sceneRef重试，未知回执仍沿同原任务重试并保存", async()=>{
  const {context,page}=await pageFixture(true);try{
    await page.evaluate(()=>{const f=(window as any).fixture;f.worldStatus="failed";f.update({mainModel:undefined});f.failRetry=true;window.confirm=()=>true;});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="重试原任务（费用另行确认）"&&!b.disabled));
    await click(page,"重试原任务（费用另行确认）");
    await page.waitForFunction(()=>document.body.innerText.includes("重试回执中断"));
    expect(await page.evaluate(()=>(window as any).fixture.draft.worldTaskId)).toBe("world-test");
    await page.evaluate(()=>(window as any).fixture.failRetry=false);
    await click(page,"重试原任务（费用另行确认）");
    await page.waitForFunction(()=>(window as any).fixture.draft.worldTaskId==="retried-world-test");
    const f=await page.evaluate(()=>({calls:(window as any).fixture.retryCalls,cloud:JSON.parse((window as any).fixture.cloud.at(-1))}));
    expect(f.calls).toEqual([{taskId:"world-test"},{taskId:"world-test"}]);expect(f.cloud.worldTaskId).toBe("retried-world-test");
  }finally{await context.close();}
});
it("失败重试前云保存失败不会提交新任务",async()=>{
  const {context,page}=await pageFixture(true);try{
    await page.evaluate(()=>{const f=(window as any).fixture;f.worldStatus="failed";f.update({mainModel:undefined});f.failCloud=true;window.confirm=()=>true;});
    await click(page,"重试原任务（费用另行确认）");
    await page.waitForFunction(()=>document.body.innerText.includes("云保存冲突"));
    expect(await page.evaluate(()=>(window as any).fixture.retryCalls)).toEqual([]);
  }finally{await context.close();}
});
it("终态世界停止周期恢复；运行世界继续查询",async()=>{
  const {context,page}=await pageFixture(true);try{
    await page.evaluate(()=>{const f=(window as any).fixture;f.update({mainModel:undefined});f.refetches=0;});
    await new Promise(resolve=>setTimeout(resolve,15500));
    expect(await page.evaluate(()=>(window as any).fixture.refetches)).toBe(0);
    await page.evaluate(()=>{const f=(window as any).fixture;f.worldStatus="running";f.update({mainModel:undefined});});
    await page.waitForFunction(()=>(window as any).fixture.refetches>0,{timeout:17000});
  }finally{await context.close();}
},40000);


it("导演方案试看进入中央播放器，采用保存真实回执并保留刷新恢复身份", async () => {
  const {context,page}=await pageFixture(true);
  try {
    await page.type('textarea[aria-label="数字人导演要求"]', '保持人物站位，镜头略微靠近');
    await click(page, '生成导演方案');
    await page.waitForSelector('[data-advisor-previs-launch] button');
    await click(page, '生成白模视频试看');
    await page.waitForSelector('.dh-previs-main video[aria-label="顾问独立白模试看"]');
    const before=await page.evaluate(() => {const f=(window as any).fixture;return {submits:f.previsSubmits.length,studio:f.draft.previsStudio,previs:f.draft.previs};});
    expect(before.submits).toBe(1);expect(before.previs).toBeUndefined();expect(before.studio.history).toHaveLength(0);
    await page.evaluate(() => document.querySelector('video[aria-label="顾问独立白模试看"]')!.dispatchEvent(new Event('play')));
    await page.click('section[aria-label="白模调度修改对比"] input[type="checkbox"]');
    await click(page,'应用这版到工作流');
    await page.waitForFunction(() => (window as any).fixture.draft.previsStudio.history.length===1);
    const adopted=await page.evaluate(() => {const f=(window as any).fixture;return {history:f.draft.previsStudio.history,previs:f.draft.previs,lens:f.draft.previsStudio.spec.cameras[0].lens,stageLens:f.draft.stageCamera.lens,cloud:JSON.parse(f.cloud.at(-1)),gets:f.previsGets,request:f.previsSubmits[0].requestId};});
    expect(adopted.history[0].requestId).toBe(adopted.request);expect(adopted.stageLens).toBe(adopted.lens);
    expect(adopted.cloud.previsStudio.history).toEqual(adopted.history);expect(adopted.previs).toBeUndefined();
    expect(adopted.gets.some((v:any)=>v.requestId===adopted.request)).toBe(true);
    await page.evaluate(() => (window as any).fixture.reload());
    expect(await page.evaluate(() => (window as any).fixture.previsSubmits.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).fixture.draft.previsStudio.history[0].requestId)).toBe(adopted.request);
  } finally {await context.close();}
},20000);


it("跨段复用保留原模型资产编号，绑骨和预演消费者同源", async()=>{
  const {context,page}=await pageFixture(true);
  try {
    await page.evaluate(()=>{const f=(window as any).fixture;f.update({mainModel:{...f.draft.mainModel,assetRef:"original-person-A"}});});
    await click(page,"探针打开原模型绑骨");
    await page.waitForFunction(()=>Boolean((window as any).fixture.ManhuaAutoRigEditor));
    expect(await page.evaluate(()=>(window as any).fixture.ManhuaAutoRigEditor.assetRef)).toBe("original-person-A");
    const adopted=await page.evaluate(()=>{const f=(window as any).fixture;return f.ManhuaAutoRigEditor.onApply({...f.draft.mainModel,assetRef:"original-person-A",taskId:"rigged-original",updatedAt:new Date(2000).toISOString()},"model-test")});
    expect(adopted).toBe(true);
    await page.type('textarea[aria-label="数字人导演要求"]',"站稳后自然转头");await click(page,"生成导演方案");
    await page.waitForFunction(()=>Boolean((window as any).fixture.ManhuaPrevisStudio));
    expect(await page.evaluate(()=>(window as any).fixture.ManhuaPrevisStudio.characters[0].model)).toEqual({taskId:"rigged-original",assetRef:"original-person-A"});
    await page.evaluate(()=>(window as any).fixture.reload());
    expect(await page.evaluate(()=>(window as any).fixture.draft.mainModel.assetRef)).toBe("original-person-A");
  } finally {await context.close();}
});
