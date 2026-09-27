import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("音轨里修改后的台词可直接进入付费确认，不再被分镜原稿阻挡", async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import React,{useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
        import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
        import {createManhuaAudioFromShots} from './shared/manhuaAudioFromShots';
        const shots=[{index:1,durationSec:5,cameraZh:'近景',actionZh:'背娘疾走',dialogueZh:'娘：「阿菁，慢点。」'}];
        const original=createManhuaAudioFromShots(shots,5);
        const f=globalThis.fixture={calls:[]};
        const services=new Proxy({}, {get:(_,key)=>key==='listMusic'||key==='listReferenceVoices'?async()=>[]:async()=>{f.calls.push(key);throw Error('禁止生成');}});
        function App(){const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'clip-e01-g01-audio',videoModel:'seedance-2.5',prompt:'第1段',audioStudio:{...original,cues:original.cues.map(cue=>({...cue,textZh:'[cough][gasp]阿菁，走慢一點啊，要不我氣喘不上來。',voice:'test-voice'}))}});f.block=block;return <CanvasAudioStudioView block={block} timelineDurationSec={5} sourceShots={shots} services={services} onChange={audioStudio=>setBlock(current=>({...current,audioStudio}))}/>;}
        createRoot(document.getElementById('root')).render(<App/>);
      `,
    }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request => void request.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: built.outputFiles[0]!.text });
    await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="生成第1句配音"]')));
    await page.evaluate(() => (document.querySelector('button[aria-label="生成第1句配音"]') as HTMLButtonElement).click());
    await page.waitForFunction(() => document.body.textContent?.includes("确认生成"));
    expect(await page.evaluate(() => document.body.textContent)).not.toContain("按当前原稿刷新对白");
    expect(await page.evaluate(() => (globalThis as any).fixture.calls)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 120_000);

it("模型时长不足时提示换模型或重分段而不截短音轨", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile("client/src/components/canvas/CanvasAudioStudio.tsx", "utf8"));
  expect(source).toContain("系统不会静默截断");
  expect(source).toContain("请调整生成方式或重新分段");
  expect(source).not.toContain("clampManhuaClipDurationSecForVideoModel(");
});
