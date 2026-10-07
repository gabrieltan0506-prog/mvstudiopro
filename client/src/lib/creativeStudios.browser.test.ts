/** Real React components with offline service/storage doubles; never presented as production acceptance. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { mkdir } from "node:fs/promises";
async function fixture(kind: "art" | "image", layout = false) {
  const source = `
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CreativeStudioCanvasLayout} from './client/src/components/canvas/CreativeStudioCanvasLayout';
 import {ArtMotionStudio} from './client/src/components/canvas/ArtMotionStudio';
 import {ImageWorldStudio} from './client/src/components/canvas/ImageWorldStudio';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
 import {defaultArtMotionSpec} from './shared/artMotion';
 window.confirm=()=>true;window.calls=[];window.failModel=false;window.adopted=[];window.errors=[];
 const plan={scene:'暖光木桌',ambience:'室内',objects:[{id:'left',name:'左杯',description:'白瓷杯',position:'左边',selected:true},{id:'right',name:'右杯',description:'黑陶杯',position:'右边',selected:true}]};
 const original={...defaultCanvasBlock('image',0,0),id:'source',prompt:'原始图片',outputUrl:'https://offline.invalid/original.png'};
 const state={...defaultCanvasBlock('text',0,0),id:'root',prompt:'拆景',imageWorld:{version:1,sourceBlockId:'source',sourceUrl:original.outputUrl,plan,objectBlockIds:{},models:{},generations:{},pending:{}}};
 function App(){const [blocks,setBlocks]=useState(${kind === "art" ? "[]" : "[original,state]"});window.blocks=blocks;window.replaceBlocks=(next)=>{window.blocks=next;setBlocks(next)};window.changeSource=()=>setBlocks(bs=>bs.map(b=>b.id==='source'?{...b,outputUrl:'https://offline.invalid/new.png'}:b));
 const save=async(updates,asset)=>{for(const u of updates){const old=window.blocks.find(b=>b.id===u.next.id);if(u.expected===null?!!old:JSON.stringify(old)!==JSON.stringify(u.expected))throw new Error('stale');}const map=new Map(updates.map(u=>[u.next.id,u.next]));let next=[...window.blocks.map(b=>map.get(b.id)||b),...updates.filter(u=>!u.expected).map(u=>u.next)];if(window.replaceChildOnModelSave&&updates.some(u=>u.next.imageWorld?.pending?.left))next=next.map(b=>b.id===next.find(x=>x.id==='root').imageWorld.objectBlockIds.left?{...b,outputUrl:'https://offline.invalid/changed-child.png'}:b);window.blocks=next;setBlocks(next);if(asset)window.adopted.push(asset);};
 return ${kind === "art" ? `<ArtMotionStudio scopeKey="offline" blocks={blocks} onCreate={async()=>{const id='art-node';const next={...defaultCanvasBlock('video',0,0),id,artMotion:{version:1,spec:defaultArtMotionSpec(),history:[]}};window.blocks=[next];setBlocks([next]);return id}} onSave={async(id,state,expected,adopt)=>{const old=window.blocks.find(b=>b.id===id);if(JSON.stringify(old.artMotion)!==JSON.stringify(expected))throw new Error('stale');const next={...old,artMotion:state,...(adopt?{outputUrl:adopt.url}:{})};window.blocks=[next];setBlocks([next]);if(adopt)window.adopted.push(adopt)}}/>` : `<ImageWorldStudio scopeKey="offline" blocks={blocks} enabled={true} onSave={save} onAudioChange={(id,audioStudio)=>{const next=window.blocks.map(b=>b.id===id?{...b,audioStudio}:b);window.blocks=next;setBlocks(next);return true}} onRun={async(block,url,onTask,assert)=>{assert();window.calls.push({kind:block.kind,prompt:block.prompt,url});await onTask('image-task');return {outputUrl:'https://offline.invalid/extracted.png',outputUrls:['https://offline.invalid/extracted.png']}}}/>`};}
 createRoot(document.getElementById('root')).render(${layout ? '<CreativeStudioCanvasLayout tools={<App/>}><div data-offline-canvas className="absolute inset-0 bg-neutral-800 text-white">画布操作区域</div></CreativeStudioCanvasLayout>' : "<App/>"});
 `;
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [
      {
        name: "offline-transport",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/(trpc|jobs)$/ }, a => ({
            path: a.path,
            namespace: "offline",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, a => ({
            loader: "js",
            contents: a.path.endsWith("jobs")
              ? `export const getJob=async()=>({status:'succeeded',output:{imageUrl:'https://offline.invalid/extracted.png'}});`
              : `const task={taskId:'3d-task',assetRef:'unused',status:'succeeded',sourceVersion:'https://offline.invalid/extracted.png',sourceImageUrl:'https://offline.invalid/extracted.png',glbGcsUri:'gs://offline/model.glb',updatedAt:new Date().toISOString()};const mutation={useMutation:()=>({mutateAsync:async()=>{throw new Error("Unexpected paid call")}})};export const trpc={canvasAudio:{generateDialogue:mutation,speedDialogueTake:mutation,createReferenceVoice:mutation},useUtils:()=>({canvasAudio:{listReferenceVoices:{fetch:async()=>[]}},mvAnalysis:{listManhuaBgmJobs:{fetch:async()=>[]},getPostProdJob:{fetch:async()=>({scopeKey:'offline',action:'art_motion',requestId:window.request.requestId,status:'succeeded',output:{url:'https://offline.invalid/render.mp4',gcsUri:'gs://offline/render.mp4'}})}},manhua3d:{getStatus:{fetch:async()=>task}},manhuaWorld:{getStatus:{fetch:async()=>task}}}),mvAnalysis:{draftManhuaBgmBrief:mutation,queueManhuaBgm:mutation,getVideoUploadSignedUrl:mutation,queuePostProd:{useMutation:()=>({mutateAsync:async input=>{window.calls.push(input);window.request=input;return {jobId:'art-task',status:'queued'}}})}},imageWorld:{object:{useMutation:()=>({mutateAsync:async input=>{window.calls.push({modelInput:input});if(window.failModel)throw new Error('network unknown');return {...task,assetRef:input.assetRef,sourceVersion:input.sourceUri}}})},world:{useMutation:()=>({mutateAsync:async()=>task})}}};`,
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setViewport({ width: 1300, height: 1500 });
  await page.setRequestInterception(true);
  page.on("request", r => void r.respond({ status: 200, body: "" }));
  await page.goto("http://localhost/");
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.waitForSelector("section");
  const click = async (label: string) => {
    await page.evaluate(label => {
      const b = Array.from(document.querySelectorAll("button")).find(
        b => b.textContent === label
      );
      if (!b || b.disabled) throw new Error(`Unavailable ${label}`);
      b.click();
    }, label);
    await new Promise(r => setTimeout(r, 80));
  };
  return { browser, page, errors, click };
}
it("art controls save, submit one immutable intent, query and adopt a candidate", async () => {
  const f = await fixture("art");
  try {
    await f.click("打开工作台");
    await f.click("新建单支影片");
    await f.click("生成影片");
    await f.click("生成影片");
    expect(await f.page.evaluate(() => (window as any).calls.length)).toBe(1);
    await f.click("更新任务与候选");
    await f.click("采用到画布");
    expect(await f.page.evaluate(() => (window as any).adopted[0].gcsUri)).toBe(
      "gs://offline/render.mp4"
    );
    expect(
      await f.page.evaluate(
        () => (window as any).blocks[0].artMotion.request.jobId
      )
    ).toBe("art-task");
    expect(f.errors).toEqual([]);
    await mkdir("/tmp/creative-studio-ui-1007", { recursive: true });
    await f.page.screenshot({
      path: "/tmp/creative-studio-ui-1007/art.png",
      fullPage: true,
    });
  } finally {
    await f.browser.close();
  }
}, 120000);
it("image decomposition keeps independent instance prompts and binds model adoption to the current source", async () => {
  const f = await fixture("image");
  try {
    await f.click("打开工作台");
    await f.click("提取物件图");
    const produced = await f.page.evaluate(() => (window as any).calls[0]);
    expect(produced.prompt).toContain("左杯");
    expect(produced.prompt).not.toContain("右杯");
    expect(produced.url).toBe("https://offline.invalid/original.png");
    await f.click("建立物件模型");
    await f.click("查询三维候选");
    await f.click("采用物件");
    expect(await f.page.evaluate(() => (window as any).adopted[0].role)).toBe(
      "prop"
    );
    await f.page.evaluate(() => (window as any).changeSource());
    await f.page.waitForSelector('[role="alert"]');
    expect(
      await f.page.$$eval("button", bs =>
        bs.filter(b => b.textContent === "建立物件模型").every(b => b.disabled)
      )
    ).toBe(true);
    expect(f.errors).toEqual([]);
    await mkdir("/tmp/creative-studio-ui-1007", { recursive: true });
    await f.page.screenshot({
      path: "/tmp/creative-studio-ui-1007/image.png",
      fullPage: true,
    });
  } finally {
    await f.browser.close();
  }
}, 120000);

it("unknown model submission freezes the exact source and reuses it after a reconnect", async () => {
  const f = await fixture("image");
  try {
    await f.click("打开工作台");
    await f.click("提取物件图");
    await f.page.evaluate(() => {
      (window as any).failModel = true;
    });
    await f.click("建立物件模型");
    expect(
      await f.page.evaluate(
        () =>
          !!(window as any).blocks.find((b: any) => b.id === "root").imageWorld
            .pending.left
      )
    ).toBe(true);
    await f.page.evaluate(() => {
      (window as any).failModel = false;
    });
    await f.click("续查原三维提交");
    const calls = await f.page.evaluate(() =>
      (window as any).calls.filter((c: any) => c.modelInput)
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].modelInput).toEqual(calls[0].modelInput);
    expect(
      await f.page.evaluate(
        () =>
          !!(window as any).blocks.find((b: any) => b.id === "root").imageWorld
            .models.left.taskId
      )
    ).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.browser.close();
  }
}, 120000);
it("pending or failed child reference images never become 3D inputs", async () => {
  const f = await fixture("image");
  try {
    await f.click("打开工作台");
    for (const status of ["idle", "running", "error"]) {
      await f.page.evaluate(status => {
        const w = window as any,
          source = w.blocks.find((b: any) => b.id === "source"),
          root = w.blocks.find((b: any) => b.id === "root");
        w.replaceBlocks([
          source,
          {
            ...root,
            imageWorld: {
              ...root.imageWorld,
              objectBlockIds: { left: "unfinished" },
            },
          },
          {
            ...source,
            id: "unfinished",
            status,
            outputUrl: undefined,
            outputUrls: [],
            refImageUrl: source.outputUrl,
          },
        ]);
      }, status);
      await f.click("建立物件模型");
    }
    expect(
      await f.page.evaluate(
        () => (window as any).calls.filter((x: any) => x.modelInput).length
      )
    ).toBe(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.browser.close();
  }
}, 120000);
it("real CSS parent layout retains a scrollable editor and a usable canvas", async () => {
  const { build: viteBuild } = await import("vite"),
    { default: tailwind } = await import("@tailwindcss/vite");
  const built = await viteBuild({
    configFile: false,
    root: process.cwd(),
    plugins: [tailwind()],
    logLevel: "error",
    build: {
      write: false,
      cssMinify: false,
      rollupOptions: { input: "client/src/index.css" },
    },
  });
  const outputs = Array.isArray(built) ? built : [built];
  const css = outputs
    .flatMap(x => ("output" in x ? x.output : []))
    .filter(x => x.type === "asset" && x.fileName.endsWith(".css"))
    .map(x => String((x as any).source))
    .join("\n");
  expect(css.length).toBeGreaterThan(1000);
  const f = await fixture("art", true);
  try {
    await f.page.setViewport({ width: 390, height: 844 });
    await f.page.addStyleTag({ content: css });
    await f.click("打开工作台");
    await f.click("新建单支影片");
    const metrics = await f.page.evaluate(() => {
      const tools = document.querySelector(
          "[data-creative-studio-tools]"
        ) as HTMLElement,
        canvas = document.querySelector(
          "[data-creative-studio-canvas]"
        ) as HTMLElement;
      tools.scrollTop = tools.scrollHeight;
      return {
        scroll: tools.scrollTop,
        toolsHeight: tools.clientHeight,
        canvasHeight: canvas.clientHeight,
        bottom: tools.getBoundingClientRect().bottom,
        top: canvas.getBoundingClientRect().top,
      };
    });
    expect(metrics.scroll).toBeGreaterThan(0);
    expect(metrics.toolsHeight).toBeLessThanOrEqual(380);
    expect(metrics.canvasHeight).toBeGreaterThan(450);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.top + 1);
    expect(f.errors).toEqual([]);
    await f.page.screenshot({
      path: "/tmp/creative-studio-ui-1007/parent-real-css.png",
    });
  } finally {
    await f.browser.close();
  }
}, 120000);
it("changing the paid child during cloud confirmation blocks the 3D request", async () => {
  const f = await fixture("image");
  try {
    await f.click("打开工作台");
    await f.click("提取物件图");
    await f.page.evaluate(
      () => ((window as any).replaceChildOnModelSave = true)
    );
    await f.click("建立物件模型");
    expect(
      await f.page.evaluate(() =>
        (window as any).calls.some((x: any) => x.modelInput)
      )
    ).toBe(false);
    expect(
      await f.page.evaluate(
        () =>
          (window as any).blocks.find((b: any) => b.id === "root").imageWorld
            .pending.left.sourceUri
      )
    ).toBe("https://offline.invalid/extracted.png");
    expect(f.errors).toEqual([]);
  } finally {
    await f.browser.close();
  }
}, 120000);
it("environment audio opens the real existing editor with a saved SFX cue without purchasing", async () => {
  const f = await fixture("image");
  try {
    await f.click("打开工作台");
    await f.click("打开环境音编辑");
    const saved = await f.page.evaluate(() => {
      const w = window as any,
        root = w.blocks.find((b: any) => b.id === "root"),
        audio = w.blocks.find(
          (b: any) => b.id === root.imageWorld.audioBlockId
        );
      return { cue: audio.audioStudio.cues[0], count: w.calls.length };
    });
    expect(saved.cue.kind).toBe("sfx");
    expect(saved.cue.shotZh).toBe("室内");
    expect(saved.cue.approved).toBe(false);
    expect(saved.count).toBe(0);
    expect(
      await f.page.evaluate(() =>
        document.body.textContent?.includes("导入真实环境音")
      )
    ).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.browser.close();
  }
}, 120000);
