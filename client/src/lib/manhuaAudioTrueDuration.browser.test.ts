import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("工厂音轨按真实分段时长保留并显式刷新旧秒轴，不调用生成", async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React,{useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
        import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
        import {createManhuaAudioFromShots} from './shared/manhuaAudioFromShots';
        const shots=[
          {index:1,durationSec:5,cameraZh:'中景',actionZh:'阿菁背娘挪步',dialogueZh:'娘：「慢点，我喘不上来。」'},
          {index:2,durationSec:4,cameraZh:'近景',actionZh:'墨屠跛行'},
          {index:3,durationSec:4,cameraZh:'特写',actionZh:'曹三聚光',dialogueZh:'曹三：「你有钱付诊金吗？」'},
          {index:4,durationSec:4,cameraZh:'中景',actionZh:'墨屠撞摊'},
          {index:5,durationSec:4,cameraZh:'中景',actionZh:'阿菁挡在马前',dialogueZh:'阿菁：「住手！」'},
          {index:6,durationSec:4,cameraZh:'中近景',actionZh:'曹三逼近',dialogueZh:'曹三：「门都没有。」'},
        ];
        const stale=createManhuaAudioFromShots(shots,15);
        const f=globalThis.fixture={calls:[]};
        const services=new Proxy({}, {get:(_,key)=>key==='listMusic'?async()=>[]:async()=>{f.calls.push(key);throw Error('禁止生成');}});
        function App(){const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'clip-e01-g01-audio',videoModel:'seedance-2.5',prompt:'【第1段·15s】旧节点',audioStudio:stale});f.block=block;return <CanvasAudioStudioView block={block} timelineDurationSec={25} sourceShots={shots} services={services} onChange={audioStudio=>setBlock(current=>({...current,audioStudio}))}/>;}
        createRoot(document.getElementById('root')).render(<App/>);
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
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
    await page.waitForFunction(() => document.body.textContent?.includes("本段 25 秒"));
    expect(await page.evaluate(() => document.body.textContent)).toContain("当前对白秒轴仍是旧分段时长");
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find(row => row.textContent?.includes("按当前原稿刷新对白秒轴"));
      (button as HTMLButtonElement).click();
    });
    await page.waitForFunction(() => (globalThis as any).fixture.block.audioStudio.cues.some((cue: any) => cue.endSec === 25));
    expect(await page.evaluate(() => (globalThis as any).fixture.block.audioStudio.cues.map((cue: any) => [cue.id, cue.startSec, cue.endSec]))).toEqual([
      ["script-shot-1-line-1", 0, 5],
      ["script-shot-3-line-1", 9, 13],
      ["script-shot-5-line-1", 17, 21],
      ["script-shot-6-line-1", 21, 25],
    ]);
    expect(await page.evaluate(() => (globalThis as any).fixture.calls)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 120_000);

it("模型时长不足时提示换模型或重分段而不截短音轨", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile("client/src/components/canvas/CanvasAudioStudio.tsx", "utf8"));
  expect(source).toContain("系统不会静默截断");
  expect(source).toContain("请更换支持该时长的模型或重新分段");
  expect(source).not.toContain("clampManhuaClipDurationSecForVideoModel(");
});
