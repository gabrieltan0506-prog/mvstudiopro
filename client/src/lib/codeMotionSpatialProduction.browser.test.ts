import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("三维视角保存失败不得返回成功，成功采用后修改站位明确提示未保存", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import Spatial from './client/src/components/code-motion/CodeMotionSpatialProduction';
const worldId='a'.repeat(64),actorId='b'.repeat(64),imageId='33333333-3333-4333-8333-333333333333';
const frame={id:'22222222-2222-4222-8222-222222222222',sceneIndex:0,worldId,referenceImageIds:[imageId],actors:[{id:'actor',assetId:actorId,stagePoint:[0,0],heightM:1.7,yawDeg:0}],metricScaleFactor:2,groundPlaneOffset:-.8,viewLabelZh:'原视角',camera:{position:[1,1,1],target:[0,0,0],lens:50,kind:'single',labelZh:'单人'},revision:'one'};
globalThis.fixture={frame,fail:true,result:null,uploads:[],saved:0};
function App(){const[project,setProject]=useState({id:'11111111-1111-4111-8111-111111111111',brief:{generationTier:'paid',images:[{id:imageId,name:'人物身份'}]},plan:{scenes:[{heading:'咖啡店',duration:5}],spatial:{assets:[{id:worldId,kind:'spz',name:'咖啡店'},{id:actorId,kind:'glb',name:'顾客'}],frames:[frame]}}});return <Spatial project={project} disabled={false} threeDAvailable={false} save={async index=>{globalThis.fixture.referenceSceneIndex=index;return{generation:'3'}}} execute={async action=>{try{await action()}catch{}}} adopt={async()=>{}} saveSpatial={async spatial=>{if(globalThis.fixture.fail)throw Error('保存回执断线');globalThis.fixture.saved++;setProject(p=>({...p,plan:{...p.plan,spatial}}))}}/>}
createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
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
        name: "视角保存故障夹具",
        setup(b) {
          b.onResolve(
            {
              filter:
                /(@\/lib\/trpc|CodeMotionSpatialGenerator|ManhuaWorldStagePreview)$/,
            },
            args => ({ path: args.path, namespace: "fixture" })
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents: args.path.endsWith("CodeMotionSpatialGenerator")
              ? "export const CodeMotionSpatialGenerator=()=>null;"
              : args.path.endsWith("ManhuaWorldStagePreview")
                ? `import React from'react';export function ManhuaWorldStagePreview(p){return <button onClick={async()=>{const f=globalThis.fixture;try{await p.onExportStageFrame(new Blob(['frame'],{type:'image/png'}),{...f.frame,actors:f.frame.actors.map(a=>({...a,assetRef:a.assetId}))});f.result='success'}catch(e){f.result=e.message}}}>测试保存视角</button>}`
                : `
const query=data=>({useQuery:()=>({data,refetch:async()=>({data})})});const mutation=fn=>({useMutation:()=>({mutateAsync:fn})});
export const trpc={mvAnalysis:{getVideoUploadSignedUrl:mutation(async()=>({uploadUrl:'http://localhost:41964/upload',gcsUri:'gs://test/uploads/u1/frame.png',requiredHeaders:{}}))},codeMotionProduction:{importSpatialAsset:mutation(async()=>{}),importSpatialFrame:mutation(async input=>({...globalThis.fixture.frame,...input.frame,id:'44444444-4444-4444-8444-444444444444'})),importExistingVideo:mutation(async()=>{}),adoptImportedVideo:mutation(async()=>{}),importedVideos:query([]),spatialPreviews:query({assets:[{id:'a'.repeat(64),kind:'spz',name:'咖啡店',url:'https://test.invalid/world.spz'},{id:'b'.repeat(64),kind:'glb',name:'顾客',url:'https://test.invalid/actor.glb'}],frames:[]})}};`,
          }));
        },
      },
    ],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on(
      "request",
      r =>
        void r.respond({
          status: 200,
          contentType: r.isNavigationRequest() ? "text/html" : "text/plain",
          body: r.isNavigationRequest() ? '<div id="root"></div>' : "ok",
        })
    );
    await page.goto("http://localhost:41964/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('[aria-label="人物1左右（米）"]');
    await page.evaluate(() => {
      const fetch = window.fetch;
      window.fetch = (input, init) => {
        (globalThis as any).fixture.uploads.push(init?.credentials);
        return fetch(input, init);
      };
    });
    const click = async (text: string) =>
      page.evaluate(text => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === text
        );
        if (!b || b.disabled) throw Error(text);
        b.click();
      }, text);
    await click("查看三维参考并选择视角");
    await page.waitForSelector("button");
    await click("测试保存视角");
    await page.waitForFunction(
      () => (globalThis as any).fixture.result !== null
    );
    expect(await page.evaluate(() => (globalThis as any).fixture.result)).toBe(
      "保存回执断线"
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.uploads)
    ).toEqual(["include"]);
    await page.evaluate(() => {
      const f = (globalThis as any).fixture;
      f.fail = false;
      f.result = null;
    });
    await click("测试保存视角");
    await page.waitForFunction(
      () => (globalThis as any).fixture.result === "success"
    );
    expect(await page.evaluate(() => (globalThis as any).fixture.saved)).toBe(
      1
    );
    await page.$eval('[aria-label="人物1左右（米）"]', e => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(e, "2");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      document.body.textContent?.includes("尚未保存新参考帧")
    );
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);
