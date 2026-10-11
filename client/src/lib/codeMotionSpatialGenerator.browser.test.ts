import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("网页三维制作先展示输入再提交，刷新查询原批次并采用全部人物（离线接口夹具）", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{CodeMotionSpatialGenerator}from'./client/src/components/code-motion/CodeMotionSpatialGenerator';
const ids=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const project={id:'11111111-1111-4111-8111-111111111111',brief:{generationTier:'paid',images:ids.map((id,i)=>({id,name:['咖啡店','女店员','男顾客'][i],gcsUri:'gs://test/'+i+'.png'}))},plan:{scenes:[]}};
globalThis.fixture={project,prepared:[],submits:[],adopted:null};
createRoot(document.getElementById('root')).render(<CodeMotionSpatialGenerator project={project} disabled={false} available={true} save={async()=>({generation:'3'})} execute={async action=>action()} onAdopt={async value=>{globalThis.fixture.adopted=value}}/>);`,
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
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
    plugins: [
      {
        name: "只用离线三维接口回包",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            resolveDir: process.cwd(),
            contents: `
import{useState}from'react';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=';
const mutation=fn=>({useMutation:()=>({mutateAsync:fn})});const stored=()=>JSON.parse(localStorage.getItem('spatial-task')||'null');
export const trpc={codeMotionProduction:{
spatialStatus:{useQuery:()=>{const[data,setData]=useState(stored);return{data,refetch:async()=>{const value=stored();setData(value);return{data:value}}}}},
spatialPrepare:mutation(async input=>{const f=globalThis.fixture;f.prepared.push(input);const world=f.project.brief.images.find(i=>i.id===input.worldImageId),actors=input.actorImageIds.map(id=>f.project.brief.images.find(i=>i.id===id));return{world,actors,worldPrompt:input.worldPrompt,fingerprint:'a'.repeat(64),worldPreview:png,actorPreviews:actors.map(a=>({...a,url:png})),costNotice:'三维单独计费，不包含免费名额'}}),
spatialSubmit:mutation(async input=>{const f=globalThis.fixture;f.submits.push(input);const r=input.request;localStorage.setItem('spatial-task',JSON.stringify({fingerprint:input.confirmedFingerprint,worldSource:f.project.brief.images.find(i=>i.id===r.worldImageId),worldPrompt:r.worldPrompt,world:{taskId:'world-1',status:'running'},actors:r.actorImageIds.map((id,i)=>({source:f.project.brief.images.find(a=>a.id===id),task:{taskId:'actor-'+i,status:'running'}})),needsResume:false,ready:false}));return stored()}),
spatialAdopt:mutation(async()=>{const t=stored();if(!t.ready)throw Error('尚未归档');return{worldId:'world-asset',actorIds:['actor-a','actor-b'],referenceImageIds:t.actors.map(a=>a.source.id),assets:[{id:'world-asset'},{id:'actor-a'},{id:'actor-b'}],metricScaleFactor:2.25,groundPlaneOffset:-.8}})
}};`,
          }));
        },
      },
    ],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request =>
      request.url().startsWith("data:")
        ? void request.continue()
        : request.isNavigationRequest()
          ? void request.respond({
              status: 200,
              contentType: "text/html",
              body: '<div id="root"></div>',
            })
          : void request.abort()
    );
    const mount = async () => {
      await page.goto("http://localhost:41961/");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.waitForSelector('[aria-label="生成三维场景的参考图"]');
    };
    const click = async (text: string) =>
      page.evaluate(text => {
        const button = Array.from(document.querySelectorAll("button")).find(b =>
          b.textContent?.includes(text)
        );
        if (!button || button.disabled) throw Error(`按钮不可用：${text}`);
        button.click();
      }, text);
    await mount();
    await page.select(
      '[aria-label="生成三维场景的参考图"]',
      "22222222-2222-4222-8222-222222222222"
    );
    const boxes = await page.$$('input[type="checkbox"]');
    await boxes[1].click();
    await boxes[2].click();
    await page.type(
      '[aria-label="三维场景生成要求"]',
      "咖啡店靠窗座位，镜头保留门口和柜台"
    );
    await click("查看本次三维生成内容");
    await page.waitForSelector('[aria-label="三维生成前确认"]');
    expect(
      await page.$$eval('[aria-label="三维生成前确认"] img', es =>
        es.map(e => e.getAttribute("alt"))
      )
    ).toEqual(["场景参考：咖啡店", "人物参考：女店员", "人物参考：男顾客"]);
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits.length)
    ).toBe(0);
    await click("确认上述参考与费用");
    await page.waitForSelector('[aria-label="三维任务与恢复"]');
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits.length)
    ).toBe(1);
    await mount();
    await page.waitForSelector('[aria-label="三维任务与恢复"]');
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits.length)
    ).toBe(0);
    expect(
      await page.$eval(
        '[aria-label="生成三维场景的参考图"]',
        e => (e as HTMLSelectElement).disabled
      )
    ).toBe(true);
    await page.evaluate(() => {
      const task = JSON.parse(localStorage.getItem("spatial-task")!);
      task.world.status = "succeeded";
      task.actors.forEach((a: any) => (a.task.status = "succeeded"));
      task.ready = true;
      localStorage.setItem("spatial-task", JSON.stringify(task));
    });
    await click("查询原任务");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        b => b.textContent?.includes("采用三维资产") && !b.disabled
      )
    );
    await click("采用三维资产");
    await page.waitForFunction(
      () => (globalThis as any).fixture.adopted !== null
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.adopted)
    ).toMatchObject({
      actorIds: ["actor-a", "actor-b"],
      metricScaleFactor: 2.25,
      groundPlaneOffset: -0.8,
    });
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits.length)
    ).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);
