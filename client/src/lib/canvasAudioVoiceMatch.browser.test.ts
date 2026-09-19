import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
      import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
      import {emptyCanvasAudioStudio,createCanvasAudioCue,canvasAudioCueInputKey} from './shared/canvasAudioStudio';
      const f=globalThis.fixture={calls:[],queries:[],musicQueries:[],history:{},posts:[],postQueries:[],postResult:null,masterEntries:[],dropSettle:false,state:null,result:null};
      const services={
        generateDialogue:async input=>{f.calls.push(input);return {jobId:'test-job',status:'succeeded',result:{gcsUri:'gs://test-bucket/generated/test.mp3',audioUrl:'https://audio.test/test.mp3',bytes:12000,voiceGate:{durationSeconds:2.25}}};},
        getDialogue:async input=>{f.queries.push(input);return f.result;},
        draftMusic:async()=>({brief:{model:'suno-v6',custom_mode:true,instrumental:true,style:'恢宏',prompt:'展翼时释放气势',title:'守护',duration:30,negative_tags:'',style_weight:0.5,weirdness_constraint:0.5}}),
        generateMusic:async input=>{f.calls.push(input);return {jobId:'bgm-test',status:'queued'};},
        getMusic:async input=>{f.musicQueries.push(input.jobId);return f.history[input.jobId]||{jobId:input.jobId,status:'running',variants:[],titleZh:'守护',durationSec:30};},
        listMusic:async()=>[],
        queuePost:async input=>{f.posts.push(input);return {jobId:'post-'+f.posts.length,status:'queued'};},
        getPost:async input=>{f.postQueries.push(input.jobId);return f.postResult;},
      };
      function App(){
        const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'audio-test',videoModel:'seedance-2.5',prompt:'目标时长：30秒。阿菁先护住受伤的墨屠。墨屠变身，展翼保护阿菁。',audioStudio:emptyCanvasAudioStudio()});
        const [visible,setVisible]=useState(true);
        const [withMasterCb,setWithMasterCb]=useState(false);
        f.state=block.audioStudio;f.block=block;f.configure=audioStudio=>setBlock(b=>({...b,audioStudio}));f.show=setVisible;f.short=()=>setBlock(b=>({...b,prompt:'目标时长：5秒'}));
        f.setMasterCb=setWithMasterCb;f.setMaster=entry=>setBlock(b=>({...b,manhuaSegmentRefs:{...(b.manhuaSegmentRefs||{}),master:entry}}));
        const onMasterTrackReady=withMasterCb?entry=>{f.masterEntries.push(entry);f.setMaster(entry);}:undefined;
        f.longCues=()=>{const cues=Array.from({length:6},(_,i)=>{const cue={...createCanvasAudioCue('dialogue','long-'+i),speakerZh:'角色',voice:'longanlufeng',textZh:'长台词'.repeat(1000),shotZh:'镜头',startSec:i*4,endSec:i*4+3,approved:true,selectedTakeId:'take-'+i};cue.takes=[{id:'take-'+i,gcsUri:'gs://test-bucket/post-prod/7/'+i+'.wav',previewUrl:'https://audio.test/'+i+'.wav',durationSec:2,createdAt:'2026-09-08',inputKey:canvasAudioCueInputKey(cue)}];return cue;});setBlock(b=>({...b,audioStudio:{...b.audioStudio,cues}}));};
        f.addBgm=()=>{const cue=createCanvasAudioCue('bgm','bgm-a');cue.shotZh='变身展翼';cue.startSec=13;cue.endSec=21;cue.source={gcsUri:'gs://test-bucket/generated/source.mp3',previewUrl:'https://audio.test/source.mp3',durationSec:27.77,labelZh:'27秒原曲'};cue.sourceStartSec=13;cue.sourceEndSec=21;setBlock(b=>({...b,audioStudio:{...b.audioStudio,cues:[...b.audioStudio.cues,cue]}}));};
        const onChange=audioStudio=>setBlock(b=>f.dropSettle&&audioStudio.pendingOperations.length<b.audioStudio.pendingOperations.length?b:({...b,audioStudio}));
        return visible&&<CanvasAudioStudioView block={block} services={services} onChange={onChange} onMasterTrackReady={onMasterTrackReady}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    plugins: [
      {
        name: "离线请求边界",
        setup(builder) {
          builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "offline-trpc",
            namespace: "offline",
          }));
          builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            contents: "export const trpc = {};",
            loader: "js",
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 180_000);
afterAll(async () => {
  await browser?.close();
});

async function open() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.isNavigationRequest())
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>',
      });
    else void request.abort();
  });
  await page.goto("http://localhost:41811");
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('section[aria-label="逐句配音、配乐与事件音效"]');
  const click = async (text: string) =>
    page.evaluate(t => {
      const el = Array.from(document.querySelectorAll("button")).find(el =>
        el.textContent?.includes(t)
      );
      if (!el) throw Error("找不到按钮 " + t);
      el.click();
    }, text);
  const fill = async (label: string, value: string) => {
    const selector = `[aria-label="${label}"]`;
    await page.click(selector, { clickCount: 3 });
    await page.type(selector, value);
  };
  return { context, page, click, fill };
}

it("建议应用后真实当前音轨生成消费新voice；另一句保持原样且候选不自动采用",async()=>{
 const {context,page,click,fill}=await open();
 try{
  await click("添加一句对白");await fill("1 镜头与动作","阿菁抬头");await fill("1 镜头与动作","阿菁抬头");await fill("1 说话角色","阿菁");await fill("1 本句台词","别怕。");
  await click("添加一句对白");await fill("2 镜头与动作","家丁转头");await fill("2 说话角色","家丁");await fill("2 本句台词","站住。");
  const second=await page.evaluate(()=>(window as any).fixture.state.cues[1].id);
  expect(await page.$eval('[aria-label="当前音轨"]', el => (el as HTMLSelectElement).value)).toBe(second);
  await page.evaluate(()=>{const d=Array.from(document.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent?.includes('声线匹配建议'));if(d)d.open=true;});
  await page.select('[aria-label="匹配性别"]','男');await page.select('[aria-label="匹配年龄"]','senior');
  expect(await page.evaluate(()=>document.body.textContent)).toContain('尚未试听验证');
  const before=await page.evaluate(()=>(window as any).fixture.state.cues.map((c:any)=>c.voice));
  await click('应用建议音色');
  const after=await page.evaluate(()=>(window as any).fixture.state.cues.map((c:any)=>c.voice));expect(after[0]).toBe(before[0]);expect(after[1]).not.toBe(before[1]);
  expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).filter(b=>b.textContent?.includes('生成本句')).length)).toBe(1);
  await click('生成本句');expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(0);await click('确认生成');
  await page.waitForFunction(()=>(window as any).fixture.state.cues[1].takes.length===1);
  const result=await page.evaluate(()=>({calls:(window as any).fixture.calls,cues:(window as any).fixture.state.cues}));
  expect(result.calls).toHaveLength(1);expect(result.calls[0].voice).toBe(after[1]);expect(result.calls[0].speakerZh).toBe('家丁');expect(result.cues[0].takes).toHaveLength(0);expect(result.cues[1].approved).toBe(false);
  await page.evaluate(()=>{const f=(window as any).fixture;f.configure({...f.state,cues:f.state.cues.map((c:any,i:number)=>i===1?{...c,approved:true,selectedTakeId:c.takes[0].id}:c)});});
  await page.select('[aria-label="匹配性别"]','女');
  await click('应用建议音色');
  const changed=await page.evaluate(()=>(window as any).fixture.state.cues[1]);
  expect(changed.approved).toBe(false);expect(changed.takes).toEqual(result.cues[1].takes);expect(changed.voice).not.toBe(result.calls[0].voice);

 }finally{await context.close();}
},30000);

it("新增第二句自动选中；显式切回第一句只生成第一句", async () => {
 const {context,page,click,fill}=await open();
 try {
  await click("添加一句对白");
  await fill("1 镜头与动作","阿菁抬头");await fill("1 说话角色","阿菁");await fill("1 本句台词","别怕。");
  await click("添加一句对白");
  const ids=await page.evaluate(()=>(window as any).fixture.state.cues.map((c:any)=>c.id));
  expect(await page.$eval('[aria-label="当前音轨"]',el=>(el as HTMLSelectElement).value)).toBe(ids[1]);
  await page.select('[aria-label="当前音轨"]',ids[0]);
  await click("生成本句");await page.waitForSelector('[role="dialog"]');await click("确认生成");
  await page.waitForFunction(()=>(window as any).fixture.state.cues[0].takes.length===1);
  const result=await page.evaluate(()=>({calls:(window as any).fixture.calls,cues:(window as any).fixture.state.cues}));
  expect(result.calls).toHaveLength(1);expect(result.calls[0].speakerZh).toBe("阿菁");expect(result.cues[1].takes).toHaveLength(0);
 } finally {await context.close();}
},30000);
