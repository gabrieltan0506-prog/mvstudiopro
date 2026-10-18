/** 真实段落/整片组件和存储桥接；仅网络、媒体解码边界使用虚构数据。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("两个数字人后期入口均能保存图片特效、恢复方案，保存失败不渲染，采用后整片读取", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {DigitalHumanPostProduction} from './client/src/components/DigitalHumanPostProduction';
    import {DigitalHumanProjectPanel} from './client/src/components/DigitalHumanProjectPanel';
    import {newDigitalHumanDraft} from './shared/digitalHumanStudio';
    import {ensureDigitalHumanProject} from './shared/digitalHumanProject';
    import {digitalHumanProjectSegmentOutputs} from './client/src/lib/digitalHumanProjectMedia';
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    let initial=ensureDigitalHumanProject(newDigitalHumanDraft('7',id(1)));
    initial.portrait={source:'gs://test-only/person.png',name:'本人原图'};
    initial.productions=[{request:{requestId:id(88),input:{action:'digital_human_final',params:{audioUri:'gs://test-only/voice',audioRequestId:id(89),clips:[{videoUri:'gs://test-only/clip',startSec:0,endSec:5}],voice:{pan:0,room:'dry',volume:1},tracks:[],aspectRatio:'9:16'}}},fingerprint:'test-only',status:'succeeded',source:'gs://test-only/final.mp4'}];
    initial.project.segments[0].selectedSource='gs://test-only/final.mp4';
    globalThis.saved=initial;globalThis.calls=[];globalThis.barriers=0;globalThis.failSave=false;
    function App(){const[draft,setDraft]=React.useState(initial),[mode,setMode]=React.useState('segment'),[version,setVersion]=React.useState(0);
      const save=fn=>{globalThis.saved=fn(globalThis.saved);setDraft(globalThis.saved);};
      globalThis.mode=m=>{setMode(m);setVersion(v=>v+1)};globalThis.remount=()=>setVersion(v=>v+1);
      globalThis.outputs=()=>digitalHumanProjectSegmentOutputs(globalThis.saved);
      globalThis.seedCandidate=()=>save(d=>{const key='digitalHuman.vfx.v1.digital-human:'+d.id;const state=JSON.parse(d.postProdStorage[key]);const rid=id(99);state.requests[rid]={...state.draft,requestId:rid,jobId:'vfx-done',status:'succeeded',createdAt:1,output:{gcsUri:'gs://test-only/effect.mp4',requestId:rid,sourceKey:state.draft.sourceKey,composition:state.draft.composition}};return {...d,postProdStorage:{...d.postProdStorage,[key]:JSON.stringify(state)}}});
      const beforeSubmit=async()=>{globalThis.barriers++;if(globalThis.failSave)throw new Error('云保存冲突');};
      return mode==='segment'?<DigitalHumanPostProduction key={version} draft={draft} save={save} disabled={false} userRole='admin' beforeSubmit={beforeSubmit} acquireWork={()=>()=>{}}/>:<DigitalHumanProjectPanel key={version} draft={draft} save={save} view='output' setView={()=>{}} select={async()=>{}} add={async()=>{}} disabled={false} role='admin' beforeSubmit={beforeSubmit} acquireWork={()=>()=>{}}/>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `,
    },
    bundle: true,
    write: false,
    loader: { ".css": "empty" },
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    plugins: [
      {
        name: "offline-network",
        setup(b) {
          b.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({
            path: "trpc",
            namespace: "offline",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: `
        const query={data:undefined,isLoading:false,isFetching:false,error:null};
        const mutation={isPending:false,mutateAsync:async input=>{globalThis.calls.push(input);return {jobId:'offline-job',status:'queued'};}};
        const utils=new Proxy({}, {get:()=>new Proxy({}, {get:()=>({invalidate:async()=>{},fetch:async()=>null})})});
        const leaf=new Proxy({}, {get:(_,key)=>key==='useQuery'?()=>query:key==='useMutation'?()=>mutation:()=>{}});
        export const trpc=new Proxy({}, {get:(_,key)=>key==='useUtils'?()=>utils:new Proxy({}, {get:()=>leaf})});
      `,
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r =>
      r.respond({ status: 200, contentType: "application/json", body: "[]" })
    );
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = (text: string) =>
      page.$$eval(
        "button",
        (nodes, text) => {
          const node = nodes.find(n => n.textContent?.trim() === text) as
            | HTMLButtonElement
            | undefined;
          if (!node) throw new Error(`未找到${text}`);
          node.click();
        },
        text
      );
    const metadata = () =>
      page.$eval('[aria-label="漫剧特效工作台"] video', n => {
        Object.defineProperty(n, "duration", { value: 10, configurable: true });
        Object.defineProperty(n, "videoWidth", {
          value: 720,
          configurable: true,
        });
        Object.defineProperty(n, "videoHeight", {
          value: 1280,
          configurable: true,
        });
        n.dispatchEvent(new Event("loadedmetadata"));
      });
    await page.waitForSelector('[aria-label="漫剧特效工作台"]');
    for (const mode of ["segment", "project"]) {
      if (mode === "project") {
        await page.evaluate(() => (globalThis as any).mode("project"));
        await page.waitForSelector('[aria-label="段落 1成片版本"]');
      }
      await click("漫剧特效");
      const source = await page.$eval(
        '[aria-label="漫剧特效工作台"] select',
        n => (n as HTMLSelectElement).options[1].value
      );
      await page.select('[aria-label="漫剧特效工作台"] select', source);
      await page.waitForSelector('[aria-label="漫剧特效工作台"] video');
      await page.select('[aria-label="添加特效"]', "image_overlay");
      await page.select(
        '[aria-label="第2个特效叠加图片"]',
        "gs://test-only/person.png"
      );
      await metadata();
      await click("保存方案");
      await page.waitForFunction(
        m => {
          const d = (globalThis as any).saved,
            data =
              m === "segment" ? d.postProdStorage : d.project.postProdStorage;
          return Object.values(data).some((v: any) =>
            v.includes("image_overlay")
          );
        },
        {},
        mode
      );
      await page.waitForFunction(
        () =>
          !Array.from(document.querySelectorAll("button")).find(
            b => b.textContent === "保存方案"
          )?.disabled
      );
      await page.evaluate(() => (globalThis as any).remount());
      await page.waitForSelector('[aria-label="第2个特效叠加图片"]');
      expect(
        await page.$eval(
          '[aria-label="第2个特效叠加图片"]',
          n => (n as HTMLSelectElement).value
        )
      ).toBe("gs://test-only/person.png");
      await metadata();
      await page.evaluate(() => {
        (globalThis as any).failSave = true;
      });
      await click("渲染特效候选");
      await page.waitForFunction(() =>
        document.body.textContent?.includes("云保存冲突")
      );
      expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(
        0
      );
      await page.evaluate(() => {
        (globalThis as any).failSave = false;
      });
      if (mode === "segment") {
        await page.evaluate(() => (globalThis as any).seedCandidate());
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll("button")).some(
            b => b.textContent === "采用此候选" && !b.disabled
          )
        );
        expect(
          await page.evaluate(() =>
            (globalThis as any)
              .outputs()
              .some((c: any) => c.source.endsWith("effect.mp4"))
          )
        ).toBe(false);
        await click("采用此候选");
        await page.waitForFunction(() =>
          (globalThis as any)
            .outputs()
            .some((c: any) => c.source.endsWith("effect.mp4"))
        );
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 90_000);
