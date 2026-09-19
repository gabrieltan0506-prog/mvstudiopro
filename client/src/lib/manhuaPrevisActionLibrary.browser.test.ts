import { afterAll, beforeAll, expect, it as test } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
import { readFile } from "node:fs/promises";

let browser: Browser;
let bundle: string;
const it = (name: string, run: () => Promise<void>) => test(name, run, 20_000);
beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import React,{useState,StrictMode} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ManhuaPrevisStudioView} from './client/src/components/canvas/ManhuaPrevisStudio';
      import {createManhuaPrevisStudio} from './shared/manhuaPrevis';
      const f=globalThis.fixture={submits:[],gets:[],lists:[],updates:[],mode:'success',getResult:null};
      f.old={url:'https://offline.invalid/old.mp4',gcsUri:'gs://test/old.mp4',updatedAt:'2026-09-01T00:00:00Z'};
      f.makeBlock=(scope='11111111-1111-4111-8111-111111111111')=>({id:'clip-e01-g01',previsStudio:createManhuaPrevisStudio(10,scope),manhuaSegmentRefs:{previs:f.old}});
      f.response=(input)=>({jobId:'prv_test_job',status:'succeeded',params:input,output:{requestId:input.requestId,clipId:input.clipId,spec:input.spec,durationSec:input.spec.durationSec,gcsUri:'gs://test/unrelated-storage-folder/output.mp4',url:'https://offline.invalid/new.mp4',report:{warnings:['离线测试，不代表动作质量验收']},...(input.spec.exportLayers?{layerBundle:{gcsUri:'gs://test/layer-bundle.zip',url:'https://offline.invalid/layers.zip',format:'previs-layers-v1',bytes:1234,sha256:'a'.repeat(64)}}:{})}});
      const services={submit:async input=>{f.submits.push(structuredClone(input));if(f.mode==='defer')return new Promise(resolve=>f.resolveSubmit=resolve);if(f.mode==='unknown')throw Error('离线模拟断网');const response=f.response(input);if(globalThis.keyedFixture)f.getResult=response;return response;},get:async id=>{f.gets.push(id);return f.getResult;},list:async (...args)=>{f.lists.push(args);if(f.mode==='defer-list')return new Promise(resolve=>f.resolveList=resolve);return {items:[],nextCursor:null};}};
      function App(){const [block,setBlock]=useState(()=>globalThis.keyedFixture?{...f.makeBlock(),previsStudio:undefined}:f.makeBlock());const [characters,setCharacters]=useState([{id:'character-mo',label:'墨屠'}]);const [shots,setShots]=useState([]);f.block=block;f.setBlock=setBlock;f.characters=characters;f.setCharacters=setCharacters;f.shots=shots;f.setShots=setShots;return <ManhuaPrevisStudioView key={globalThis.keyedFixture?block.id+':'+(block.previsStudio?.scopeId??'new'):undefined} block={block} characters={characters} sourceShots={shots} services={services} onChange={(studio,reference)=>{f.updates.push({studio:structuredClone(studio),reference});if(f.rejectSave)return false;setBlock(current=>({...current,previsStudio:studio,manhuaSegmentRefs:reference?{...current.manhuaSegmentRefs,previs:reference}:current.manhuaSegmentRefs}));return true;}}/>;}
      createRoot(document.getElementById('root')).render(globalThis.strictFixture?<StrictMode><App/></StrictMode>:<App/>);
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
        name: "禁止接入真实服务",
        setup(builder) {
          builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "offline",
          }));
          builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: "export const trpc={};",
          }));
        },
      },
    ],
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
  });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

async function open(strict = false, keyed = false) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (
      request.isNavigationRequest() &&
      request.url() === "http://localhost:41819/"
    )
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>',
      });
    else void request.abort();
  });
  await page.goto("http://localhost:41819");
  await page.evaluate(
    ({ strict, keyed }) => {
      (window as any).strictFixture = strict;
      (window as any).keyedFixture = keyed;
    },
    { strict, keyed }
  );
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("[data-manhua-previs-studio]");
  return page;
}
async function click(page: Page, text: string) {
  await page.evaluate(label => {
    const button = Array.from(document.querySelectorAll("button")).find(
      b => b.textContent === label
    );
    if (!button || button.disabled) throw Error(`按钮不可用：${label}`);
    button.click();
  }, text);
}
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

it("动作库选择添加保存同一spec，提交仍需显式生成且不采用", async () => {
  const page=await open();
  try {
    expect(await page.$eval('[data-previs-advanced]', el => (el as HTMLDetailsElement).open)).toBe(false);
    await click(page,"俯身行礼");
    await click(page,"添加所选动作");
    await page.waitForFunction(() => (window as any).fixture.block.previsStudio.spec.actors[0].actions.length === 1);
    const saved=await page.evaluate(() => {const f=(window as any).fixture;return {spec:f.block.previsStudio.spec,submits:f.submits,reference:f.block.manhuaSegmentRefs.previs};});
    expect(saved.spec.actors[0].actions).toEqual([{kind:"bow",startSec:0,endSec:2}]);
    expect(saved.submits).toEqual([]);expect(saved.reference.gcsUri).toBe("gs://test/old.mp4");
    await click(page,"确认生成动作白模");
    await page.waitForFunction(() => (window as any).fixture.submits.length === 1);
    const actual=await page.evaluate(() => {const f=(window as any).fixture;return {spec:f.submits[0].spec,reference:f.block.manhuaSegmentRefs.previs,videos:document.querySelectorAll('[data-previs-action-library] video').length};});
    expect(actual.spec).toEqual(saved.spec);expect(actual.reference.gcsUri).toBe("gs://test/old.mp4");expect(actual.videos).toBe(0);
  } finally {await page.close();}
});
it("保存被拒不伪称添加成功，旧草稿恢复不自动改动作", async () => {
 const page=await open();try {
  await page.evaluate(() => {(window as any).fixture.rejectSave=true;});
  await click(page,"添加所选动作");
  expect(await page.$eval('[data-previs-action-library] [role=status]',e=>e.textContent)).toContain("配置未保存");
  const actual=await page.evaluate(() => {const f=(window as any).fixture;return {actions:f.block.previsStudio.spec.actors[0].actions,submits:f.submits};});
  expect(actual.actions).toEqual([]);expect(actual.submits).toEqual([]);
 }finally{await page.close();}
});
