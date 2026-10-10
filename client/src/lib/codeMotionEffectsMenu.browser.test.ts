/** Real workbench components; offline state only. No renderer, media, or model requests. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { CODE_MOTION_EFFECTS } from "../../../shared/codeMotionEffects";

let browser: Browser, bundle: string;
let server: Server, origin: string;
const evidence: unknown[] = [];
const evidenceDir = path.resolve(
  "docs/evidence/code-motion-1011/effects-workbench"
);
beforeAll(async () => {
  server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<div id="root"></div>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Effects from'./client/src/components/code-motion/CodeMotionEffects';
import{ArtMotionStudio}from'./client/src/components/canvas/ArtMotionStudio';
import{codeMotionProjectSchema,compileCodeMotion}from'./shared/codeMotion';
import{defaultArtMotionSpec}from'./shared/artMotion';
const images=[1,2,3].map(i=>({id:'22222222-2222-4222-8222-'+String(i).padStart(12,'0'),name:'素材'+i,gcsUri:'gs://fixture/owned/photo'+i+'.png'}));
const initial=codeMotionProjectSchema.parse({id:'11111111-1111-4111-8111-111111111111',brief:{title:'配方采用',request:'保留我的内容',style:'scenes',duration:20,generationTier:'free',orientation:'landscape',images},plan:{version:1,summary:'四镜',scenes:Array.from({length:4},(_,i)=>({heading:'原标题'+i,body:'原说明'+i,duration:5,composition:{id:'s'+i,duration:5,elements:[{id:'title',type:'text',text:'原标题'+i},...images.map((a,k)=>({id:'photo'+k,type:'image',imageId:a.id,width:.2,height:.5,transform:{x:.2+k*.3,y:.5}}))]}})),codeVideo:{version:1,assets:[{id:'original',videoUri:'gs://fixture/owned/original.mp4',sha256:'a'.repeat(64),durationSec:5}],clips:[{assetId:'original',at:15,duration:5}]}}});
window.calls=[];window.writes=0;
function App(){const[p,setP]=useState(()=>JSON.parse(localStorage.getItem('effects-project')||'null')||initial);const[disabled,setDisabled]=useState(false);const[access,setAccess]=useState(true);window.project=p;window.replaceProject=setP;window.setDisabled=setDisabled;window.setAccess=setAccess;window.compile=()=>compileCodeMotion(p.brief,p.plan);const[blocks]=useState([{id:'kept-block',artMotion:{version:1,spec:{...defaultArtMotionSpec(),title:'保留的动画方案'},history:[]}}]);window.blocks=blocks;
return location.pathname==='/art'?<ArtMotionStudio scopeKey='offline-effects' blocks={blocks} onCreate={async()=>{window.calls.push('create');return 'unexpected'}} onSave={async()=>{window.calls.push('save')}}/>:<Effects project={p} disabled={disabled} paidAvailable={true} threeDAvailable={access} onChange={next=>{window.writes++;localStorage.setItem('effects-project',JSON.stringify(next));setP(next)}}/>;}
createRoot(document.getElementById('root')).render(<App/>);`,
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
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [
      {
        name: "no-network-transport",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/(trpc|omniCanvasApi)$/ }, a => ({
            path: a.path,
            namespace: "offline-effects",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline-effects" }, a => ({
            loader: "js",
            contents: a.path.endsWith("trpc")
              ? `export const trpc={useUtils:()=>({}),mvAnalysis:{queuePostProd:{useMutation:()=>({mutateAsync:async()=>{window.calls.push('queue');throw Error('Unexpected generation')}})}}};`
              : `export const resolveCanvasMaterialUrl=async()=>{window.calls.push('media');throw Error('Unexpected media fetch')};`,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, "menu-results.json"),
    JSON.stringify(evidence, null, 2)
  );
});
async function open(route = "/effects") {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on(
    "request",
    request =>
      void (request.isNavigationRequest()
        ? request.respond({
            status: 200,
            contentType: "text/html",
            body: '<div id="root"></div>',
          })
        : request.abort())
  );
  await page.goto(origin + route);
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("section");
  return { page, errors };
}
const menu = '[aria-label="选择特效与能力"]';
const apply = 'section[aria-label="特效与生成能力"] button';

it("recipe descriptions lead to real edits, preserve original video, and restore the saved result", async () => {
  const { page, errors } = await open();
  try {
    expect(
      await page.$$eval("optgroup", nodes => nodes.map(n => n.label))
    ).toEqual(["图片与信息编排", "镜头转场", "画面装饰", "独立付费工作台"]);
    expect(
      await page.$eval('[aria-label="效果采用范围"]', n => n.textContent)
    ).toContain("3 个代码镜头");
    const original = await page.evaluate(() =>
      JSON.stringify((window as any).project.plan.scenes[3])
    );
    for (const id of [
      "columnAnnotations",
      "paperStack",
      "imageReveal",
      "pointMorph3d",
    ]) {
      const item = CODE_MOTION_EFFECTS.find(item => item.id === id);
      expect(item).toBeDefined();
      const writes = await page.evaluate(() => (window as any).writes);
      await page.select(menu, id);
      expect(
        await page.$eval("#ink-effect-description", n => n.textContent)
      ).toContain(item!.description);
      expect(
        await page.$eval("#ink-effect-description", n => n.textContent)
      ).toContain(item!.useCase);
      expect(await page.evaluate(() => (window as any).writes)).toBe(writes);
      const before = await page.evaluate(() =>
        JSON.stringify((window as any).project.plan)
      );
      await page.click(apply);
      await page.waitForFunction(
        n => (window as any).writes === n + 1,
        {},
        writes
      );
      const result = await page.evaluate(() => ({
        project: (window as any).project,
        compiled: (window as any).compile(),
        calls: (window as any).calls,
      }));
      expect(JSON.stringify(result.project.plan)).not.toBe(before);
      expect(JSON.stringify(result.project.plan.scenes[3])).toBe(original);
      expect(result.project.plan.scenes.map((s: any) => s.heading)).toEqual([
        "原标题0",
        "原标题1",
        "原标题2",
        "原标题3",
      ]);
      expect(result.compiled.composition.scenes).toHaveLength(4);
      expect(result.calls).toEqual([]);
      evidence.push({
        id,
        description: item!.description,
        useCase: item!.useCase,
        editedScenes: 3,
        compiled: result.compiled.composition,
      });
    }
    const saved = await page.evaluate(() =>
      JSON.stringify((window as any).project)
    );
    await page.reload();
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector(menu);
    expect(
      await page.evaluate(() => JSON.stringify((window as any).project))
    ).toBe(saved);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 60000);

it("free procedural effects stay available while paid asset options and busy edits are guarded", async () => {
  const { page, errors } = await open();
  try {
    expect(
      await page.$$eval(
        'option[value="model3d"],option[value="splat3d"]',
        nodes => nodes.every(n => (n as HTMLOptionElement).disabled)
      )
    ).toBe(true);
    expect(
      await page.$eval(
        'option[value="pointMorph3d"]',
        n => (n as HTMLOptionElement).disabled
      )
    ).toBe(false);
    await page.select('[aria-label="生成方案"]', "paid");
    await page.select(menu, "model3d");
    expect(
      await page.$eval("#ink-effect-description", n => n.textContent)
    ).toContain("尚不支持直接导入");
    await page.select('[aria-label="生成方案"]', "free");
    expect(await page.$eval(menu, n => (n as HTMLSelectElement).value)).toBe(
      "fade"
    );
    await page.evaluate(() => (window as any).setDisabled(true));
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            'select[aria-label="选择特效与能力"]'
          ) as HTMLSelectElement
        ).disabled
    );
    expect(
      await page.$eval(apply, n => (n as HTMLButtonElement).disabled)
    ).toBe(true);
    await page.evaluate(() => {
      (window as any).setDisabled(false);
      const p = structuredClone((window as any).project);
      p.plan.codeVideo.clips = Array.from({ length: 4 }, (_, i) => ({
        assetId: "original",
        at: i * 5,
        duration: 5,
      }));
      (window as any).replaceProject(p);
    });
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="效果采用范围"]')
        ?.textContent?.includes("没有可采用")
    );
    expect(
      await page.$eval(apply, n => (n as HTMLButtonElement).disabled)
    ).toBe(true);
    expect(errors).toEqual([]);
    evidence.push({
      freeProceduralSelectable: true,
      paidAssetsDisabledForFree: true,
      busyDisabled: true,
      allVideoDisabled: true,
    });
  } finally {
    await page.close();
  }
}, 60000);

it("art workbench opens the existing INK route separately without importing or mutating a block", async () => {
  const { page, errors } = await open("/art");
  try {
    const before = await page.evaluate(() =>
      JSON.stringify((window as any).blocks)
    );
    const link = await page.$eval('a[href="/yingke"]', n => ({
      text: n.textContent,
      target: n.getAttribute("target"),
      rel: n.getAttribute("rel"),
    }));
    expect(link.text).toContain("图片／音讯代码特效");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(await page.$eval("section", n => n.textContent)).toContain(
      "不会自动导入映客"
    );
    const popupReady = new Promise<import("puppeteer").Page>(resolve =>
      page.once("popup", popup => {
        if (popup) resolve(popup);
      })
    );
    await page.click('a[href="/yingke"]');
    const popup = await popupReady;
    expect(popup.url()).toBe(origin + "/yingke");
    expect(
      await page.evaluate(() => JSON.stringify((window as any).blocks))
    ).toBe(before);
    expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
    expect(page.url()).toBe(origin + "/art");
    await popup.close();
    expect(errors).toEqual([]);
    evidence.push({
      artNavigation: link,
      currentBlockPreserved: true,
      autoImport: false,
      generationCalls: 0,
    });
  } finally {
    await page.close();
  }
}, 60000);
