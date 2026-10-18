/** ABC组合探针：真实工作台、世界采用、导演/后期顾问与特效；仅网络、媒体和3D解码用明确虚构夹具。 */
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser, bundle: string;
beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft,digitalHumanDraftSchema,digitalHumanDraftKey,prepareDigitalHumanVideo}from'./shared/digitalHumanStudio';
 import{addDigitalHumanSegment,switchDigitalHumanSegment,digitalHumanProjectSegments}from'./shared/digitalHumanProject';
 import{buildDigitalHumanAdvisorProject}from'./client/src/lib/digitalHumanAdvisor';
 import{digitalHumanProjectSegmentOutputs}from'./client/src/lib/digitalHumanProjectMedia';
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 let initial=newDigitalHumanDraft('7',id(1));
 const models=['A','B','C'].map(n=>({taskId:'test-model-'+n,assetRef:'test-original-'+n,status:'succeeded',sourceVersion:'gs://test-only/'+n+'-person.png',sourceImageUrl:'https://example.test/'+n+'.png',glbGcsUri:'gs://test-only/'+n+'.glb',updatedAt:1}));
 for(const[i,n]of ['A','B','C'].entries()){
  if(i)initial=addDigitalHumanSegment(initial,id(i+1));
  initial.script=n+'段独立台词。';initial.voiceId='test-only-voice';initial.direction=n+'原导演要求';initial.sceneDescription=n+'独立空间';
  initial.portrait={source:models[i].sourceVersion,name:n+'造型'};initial.mainModel=models[i];initial.modelHistory=models.map(m=>({assetRef:m.assetRef,model:m}));
  const aid=id(20+i);initial.audios=[{request:{billingRequestId:aid,input:initial.script,voice:initial.voiceId,speakerZh:'探针本人',speakerId:'test-only',voiceStateZh:''},source:'gs://test-only/'+n+'.wav',durationSec:8,status:'succeeded'}];initial.approvedAudioRequestId=aid;
  initial.productions=[{request:{requestId:id(40+i),input:{action:'digital_human_final',params:{audioUri:'gs://test-only/'+n+'.wav',audioRequestId:aid,clips:[{videoUri:'gs://test-only/'+n+'.mp4',startSec:0,endSec:8}],voice:{pan:0,room:'dry',volume:1},tracks:[],aspectRatio:'9:16'}}},fingerprint:'test-only',status:'succeeded',source:'gs://test-only/'+n+'-final.mp4'}];
 }
 initial=switchDigitalHumanSegment(initial,id(1));initial.project.segments=initial.project.segments.map((s,i)=>({...s,title:['A书房','B全息','C协作'][i]}));
 const f=globalThis.fixture={cloud:digitalHumanDraftSchema.parse(initial),generation:1,calls:[],streams:[],failSave:false,failAsk:false,models,worlds:['A','B','C'].map(n=>({taskId:'test-world-'+n,sceneRef:'test-scene-'+n,displayName:n+'原场景',sourceVersion:'gs://test-only/'+n+'-scene.png',status:'succeeded',model:'marble-1.1',assets:{spz500kUrl:'https://example.test/'+n+'.spz'},updatedAt:'2026-10-18T00:00:00Z'}))};
 localStorage.setItem(digitalHumanDraftKey('7'),JSON.stringify(f.cloud));
 f.rows=()=>digitalHumanProjectSegments(f.cloud).map(s=>({title:s.title,d:s.draft}));
 f.outputs=()=>digitalHumanProjectSegmentOutputs(f.cloud);
 f.consume=()=>({prompt:prepareDigitalHumanVideo(f.cloud,id(90)).prompt,context:buildDigitalHumanAdvisorProject(f.cloud).context,outputs:digitalHumanProjectSegmentOutputs(f.cloud)});
 f.seedVfxCandidate=()=>{const key='digitalHuman.vfx.v1.digital-human:'+f.cloud.id;const state=JSON.parse(f.cloud.postProdStorage[key]);const rid=id(99);state.requests[rid]={...state.draft,requestId:rid,jobId:'test-only-vfx',status:'succeeded',createdAt:1,output:{gcsUri:'gs://test-only/'+f.cloud.script[0]+'-effect.mp4',requestId:rid,sourceKey:state.draft.sourceKey,composition:state.draft.composition}};f.cloud.postProdStorage[key]=JSON.stringify(state);f.restore();};
 function App(){const[k,setK]=React.useState(0);f.restore=()=>{localStorage.setItem(digitalHumanDraftKey('7'),JSON.stringify(f.cloud));setK(v=>v+1)};return <DigitalHumanStudio key={k}/>;}createRoot(document.getElementById('root')).render(<App/>);
 `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [
      {
        name: "offline-only",
        setup(b) {
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "offline",
          }));
          b.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({
            path: "rpc",
            namespace: "offline",
          }));
          b.onResolve({ filter: /^@\/lib\/manhuaAdvisorStream$/ }, () => ({
            path: "stream",
            namespace: "offline",
          }));
          b.onResolve({ filter: /digitalHumanVideo$/ }, () => ({
            path: "media",
            namespace: "offline",
          }));
          b.onResolve(
            {
              filter:
                /\/(Manhua3dModelStudio|ManhuaWorldStudio|ManhuaPrevisStudio|ManhuaAutoRigEditor|ArtMotionStudio|DigitalHumanRenderReview)$/,
            },
            a => ({ path: a.path.split("/").at(-1)!, namespace: "media-child" })
          );
          b.onLoad({ filter: /.*/, namespace: "media-child" }, a => ({
            loader: "js",
            contents:
              "export const " +
              a.path +
              '=p=>{globalThis.fixture["' +
              a.path +
              '"]=p;return null};export default ' +
              a.path +
              ";",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, a => ({
            resolveDir: process.cwd(),
            loader: "js",
            contents:
              a.path === "auth"
                ? `export const useAuth=()=>({user:{id:7,role:'admin'}});`
                : a.path === "media"
                  ? `export const digitalHumanMediaUrl=async()=> 'https://example.test/media.svg';export const digitalHumanVideoBlock=async()=>{throw Error('禁止生产')};`
                  : a.path === "stream"
                    ? `
 export async function streamManhuaAdvisor(input,onText){const f=globalThis.fixture;f.streams.push(input);if(f.failAsk)throw Error('测试顾问断网');if(f.delayStream)await new Promise(r=>f.releaseStream=r);const answer=JSON.stringify({kind:'workflow_operation_v1',summaryZh:'仅检查当前段特效入口',action:{action:'effects',tool:'vfx',operation:'inspect'}});onText(answer);return{answer};}
 `
                    : `
 const cache={};const dataFor=n=>cache[n]??=(n==='getManhuaAdvisorQuota'?{remaining:5,price:12,exempt:false}:n==='getSubscription'?{plan:'pro'}:n==='sceneAccess'?{canGenerate:true}:n==='listMine'?globalThis.fixture.worlds:n.startsWith('list')?[]:undefined);
 async function call(g,n,input){const f=globalThis.fixture;f.calls.push({g,n,input:structuredClone(input)});
 if(n==='getDraft')return{draft:structuredClone(f.cloud),generation:String(f.generation)};
 if(n==='saveDraft'){if(f.failSave)throw Error('测试云保存失败');if(input.expectedGeneration!==String(f.generation))throw Error('测试云版本冲突');f.cloud=structuredClone(input.draft);return{generation:String(++f.generation)}}
 if(n==='getModel')return{...f.models.find(m=>m.taskId===input.taskId),updatedAt:new Date(1).toISOString()};
 if(g==='manhuaWorld'&&n==='getStatus')return f.worlds.find(w=>w.taskId===input.taskId);
 if(n==='askPlatformSkillQa'){if(f.failAsk)throw Error('测试顾问断网');const t=input.manhuaContext.digitalHumanFilm;if(!t)throw Error('探针只允许导演请求');const prefix=t.script[0];return{answer:JSON.stringify({kind:'digital-human-film',targetId:t.id,revision:t.revision,summary:prefix+'独立导演方案',bgm:'post',subtitles:'off',shots:[{startSec:0,endSec:8,dialogue:t.script,voiceMode:'onscreen',expression:prefix+'先专注再确认',performance:prefix+'克制讲述',action:prefix+'右手示意后收下',camera:prefix+'同侧中近景',lighting:'柔光照脸',atmosphere:'安静',soundEffect:prefix+'轻触声',visualEffect:prefix+'独立视觉特效',environmentSound:prefix+'室内底声'}]})};}
 throw Error('禁止非白名单接口 '+g+'.'+n);}
 const utils=new Proxy({}, {get:(_,g)=>new Proxy({}, {get:(_,n)=>({fetch:input=>call(g,n,input),invalidate:async()=>{}})})});
 export const trpc=new Proxy({}, {get:(_,g)=>g==='useUtils'?()=>utils:new Proxy({}, {get:(_,n)=>({useQuery:()=>({data:dataFor(n),refetch:async()=>({data:dataFor(n)})}),useMutation:()=>({mutateAsync:input=>call(g,n,input),isPending:false})})})});`,
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  bundle = built.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
}, 60000);
afterAll(async () => {
  await browser?.close();
});
async function boot() {
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", r => {
    void r.respond({
      status: 200,
      contentType: r.url().endsWith(".svg") ? "image/svg+xml" : "text/html",
      body: r.url().endsWith(".svg")
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'
        : '<div id="root"></div>',
    });
  });
  await page.goto("https://test.invalid");
  await page.addScriptTag({ content: bundle });
  await page
    .waitForFunction(() =>
      /云端已保存|云端稿件已恢复/.test(document.body.textContent || "")
    )
    .catch(async e => {
      console.log(
        "探针启动现场",
        errors,
        await page.evaluate(() => document.body.textContent?.slice(0, 1400))
      );
      throw e;
    });
  return { page, errors };
}
async function click(page: Page, text: string, selector = "button") {
  await page.$$eval(
    selector,
    (nodes, t) => {
      const b = nodes.find(
        e => e.textContent?.trim() === t
      ) as HTMLButtonElement;
      if (!b || b.disabled) throw Error("按钮不可用 " + t);
      b.click();
    },
    text
  );
}
async function fill(page: Page, selector: string, value: string) {
  await page.$eval(
    selector,
    (e, v) => {
      Object.getOwnPropertyDescriptor(
        e instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      )!.set!.call(e, v);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}
async function saved(page: Page) {
  await page.waitForFunction(() =>
    document.body.textContent?.includes("云端已保存")
  );
}
async function segment(page: Page, name: string) {
  await click(page, { A: "01 A书房", B: "02 B全息", C: "03 C协作" }[name]!);
  await saved(page);
  await page.waitForFunction(
    n => (globalThis as any).fixture.cloud.script.startsWith(n),
    {},
    name
  );
}

it("ABC真实模型与世界入口、完整导演顾问采用、视频消费者与刷新往返切段闭合", async () => {
  const { page, errors } = await boot();
  try {
    await click(page, "进入编辑 →");
    await saved(page);
    for (const n of ["A", "B", "C"]) {
      if (n !== "A") await segment(page, n);
      await page.evaluate(n => {
        const s = Array.from(document.querySelectorAll("select")).find(s =>
          s.textContent?.includes("选择已生成的人物造型")
        )!;
        s.value = "test-model-" + n;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }, n);
      await saved(page);
      await page.evaluate(n => {
        const s = Array.from(document.querySelectorAll("select")).find(s =>
          s.textContent?.includes("请选择已有世界")
        )!;
        s.value = "test-world-" + n;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }, n);
      await page.waitForFunction(
        n =>
          (globalThis as any).fixture.cloud.worldTaskId === "test-world-" + n,
        {},
        n
      );
      await fill(
        page,
        'textarea[aria-label="完整导演要求"]',
        n +
          "完整导演要求：" +
          "情绪眼神动作运镜声音。".repeat(550) +
          n +
          "结尾必须保留"
      );
      await saved(page);
      await click(page, "生成完整导演方案");
      await page.waitForFunction(
        n =>
          (globalThis as any).fixture.cloud.filmDirector?.plan.summary ===
          n + "独立导演方案",
        {},
        n
      );
      await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll("label")).find(l =>
          l.textContent?.includes("我已对照原声核对逐句时点")
        )!;
        (label.querySelector("input") as HTMLInputElement).click();
      });
      await click(page, "采用完整导演方案");
      await page.waitForFunction(
        () => (globalThis as any).fixture.cloud.filmDirector?.adopted
      );
      await saved(page);
      const c = await page.evaluate(() =>
        (globalThis as any).fixture.consume()
      );
      expect(c.prompt).toContain(n + "独立视觉特效");
      expect(c.prompt).toContain(n + "结尾必须保留");
      expect(JSON.stringify(c.context.digitalHumanProduction)).toContain(
        n + "同侧中近景"
      );
    }
    await page.evaluate(() => (globalThis as any).fixture.restore());
    await page.waitForFunction(() =>
      /云端已保存|云端稿件已恢复/.test(document.body.textContent || "")
    );
    await click(page, "进入编辑 →");
    await saved(page);
    for (const n of ["C", "A", "B", "A"]) {
      await segment(page, n);
      const d = await page.evaluate(() => (globalThis as any).fixture.cloud);
      expect(d.portrait.source).toBe("gs://test-only/" + n + "-person.png");
      expect(d.scene.source).toBe("gs://test-only/" + n + "-scene.png");
      expect(d.worldTaskId).toBe("test-world-" + n);
      expect(d.mainModel.assetRef).toBe("test-original-" + n);
      expect(d.filmDirector.plan.shots[0].visualEffect).toBe(
        n + "独立视觉特效"
      );
      expect(d.direction.endsWith(n + "结尾必须保留")).toBe(true);
    }
    await page.evaluate(() => ((globalThis as any).fixture.failSave = true));
    await fill(
      page,
      'textarea[aria-label="完整导演要求"]',
      "A未保存但必须保留的修改"
    );
    await page.waitForFunction(() =>
      document.body.textContent?.includes("测试云保存失败")
    );
    await click(page, "02 B全息");
    expect(
      await page.$eval(
        'textarea[aria-label="完整导演要求"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toBe("A未保存但必须保留的修改");
    expect(
      await page.evaluate(() => (globalThis as any).fixture.cloud.script)
    ).toBe("A段独立台词。");
    expect(
      await page.evaluate(() =>
        Array.from(
          new Set((globalThis as any).fixture.calls.map((c: any) => c.n))
        ).filter(
          n =>
            ![
              "getDraft",
              "saveDraft",
              "getModel",
              "getStatus",
              "askPlatformSkillQa",
            ].includes(n as string)
        )
      )
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 90000);

it("ABC真实后期特效与创作顾问入口分别保存恢复、候选采用后整片可读、保存失败不渲染", async () => {
  const { page, errors } = await boot();
  try {
    await click(page, "进入编辑 →");
    await saved(page);
    for (const n of ["A", "B", "C"]) {
      if (n !== "A") await segment(page, n);
      await click(page, "漫剧特效");
      const select = '[aria-label="漫剧特效工作台"] select';
      const source = await page.$eval(
        select,
        e => (e as HTMLSelectElement).options[1].value
      );
      await page.select(select, source);
      await page.waitForSelector('[aria-label="漫剧特效工作台"] video');
      await page.$eval('[aria-label="漫剧特效工作台"] video', e => {
        for (const [k, v] of Object.entries({
          duration: 8,
          videoWidth: 720,
          videoHeight: 1280,
        }))
          Object.defineProperty(e, k, { value: v, configurable: true });
        e.dispatchEvent(new Event("loadedmetadata"));
      });
      await page.select('[aria-label="添加特效"]', "image_overlay");
      await page.select(
        '[aria-label="第2个特效叠加图片"]',
        "gs://test-only/" + n + "-person.png"
      );
      await click(page, "保存方案");
      await saved(page);
      await click(page, "创作顾问 · 后期与特效");
      await fill(
        page,
        'textarea[placeholder="问当前剧本、人物或镜头…"]',
        "检查" + n + "段特效素材，只读不生成"
      );
      await click(page, "让顾问操作工作流");
      await page.waitForSelector('[aria-label="工作流操作方案"]');
      await page.evaluate(() => (window.confirm = () => true));
      await click(page, "确认执行这一步");
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="工作流操作方案"]')
          ?.textContent?.includes("原操作回执")
      );
      await saved(page);
      const current = await page.evaluate(
        () => (globalThis as any).fixture.cloud
      );
      expect(
        Object.values(current.postProdStorage).some(v =>
          String(v).includes(n + "-person.png")
        )
      ).toBe(true);
    }
    await page.evaluate(() => (globalThis as any).fixture.restore());
    await page.waitForFunction(() =>
      /云端已保存|云端稿件已恢复/.test(document.body.textContent || "")
    );
    await click(page, "进入编辑 →");
    await saved(page);
    for (const n of ["B", "C", "A"]) {
      await segment(page, n);
      await click(page, "漫剧特效");
      await page.waitForSelector('[aria-label="第2个特效叠加图片"]');
      expect(
        await page.$eval(
          '[aria-label="第2个特效叠加图片"]',
          e => (e as HTMLSelectElement).value
        )
      ).toBe("gs://test-only/" + n + "-person.png");
      await click(page, "创作顾问 · 后期与特效");
      await page.waitForSelector('[aria-label="工作流操作方案"]');
      expect(
        await page.$eval('[aria-label="工作流操作方案"]', e => e.textContent)
      ).toContain("原操作回执");
    }
    await page.$eval('[aria-label="漫剧特效工作台"] video', e => {
      for (const [k, v] of Object.entries({
        duration: 8,
        videoWidth: 720,
        videoHeight: 1280,
      }))
        Object.defineProperty(e, k, { value: v, configurable: true });
      e.dispatchEvent(new Event("loadedmetadata"));
    });
    await page.evaluate(() => ((globalThis as any).fixture.failSave = true));
    await click(page, "渲染特效候选");
    await page.waitForFunction(() =>
      document.body.textContent?.includes("测试云保存失败")
    );
    expect(
      await page.evaluate(() =>
        (globalThis as any).fixture.calls.filter(
          (c: any) =>
            !["getDraft", "saveDraft", "getStatus", "getModel"].includes(c.n)
        )
      )
    ).toEqual([]);
    expect(
      await page.evaluate(() => (globalThis as any).fixture.streams.length)
    ).toBe(3);
    const readsBefore = await page.evaluate(
      () =>
        (globalThis as any).fixture.calls.filter((c: any) => c.n === "getDraft")
          .length
    );
    await page.evaluate(() => {
      const f = (globalThis as any).fixture;
      f.failSave = false;
      f.seedVfxCandidate();
    });
    await page.waitForFunction(
      n =>
        (globalThis as any).fixture.calls.filter((c: any) => c.n === "getDraft")
          .length > n,
      {},
      readsBefore
    );
    await page.waitForFunction(() =>
      /云端已保存|云端稿件已恢复/.test(document.body.textContent || "")
    );
    await click(page, "进入编辑 →");
    await saved(page);
    await click(page, "漫剧特效");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        b => b.textContent === "采用此候选" && !b.disabled
      )
    );
    expect(
      await page.evaluate(() =>
        (globalThis as any).fixture
          .outputs()
          .some((r: any) => r.source === "gs://test-only/A-effect.mp4")
      )
    ).toBe(false);
    await page.$eval('[aria-label="漫剧特效工作台"] video', e => {
      for (const [k, v] of Object.entries({
        duration: 8,
        videoWidth: 720,
        videoHeight: 1280,
      }))
        Object.defineProperty(e, k, { value: v, configurable: true });
      e.dispatchEvent(new Event("loadedmetadata"));
    });
    await saved(page);
    await click(page, "采用此候选");
    await page
      .waitForFunction(() =>
        (globalThis as any).fixture
          .outputs()
          .some((r: any) => r.source === "gs://test-only/A-effect.mp4")
      )
      .catch(async e => {
        console.log(
          "采用现场",
          await page.evaluate(() => ({
            alerts: Array.from(document.querySelectorAll("[role=alert]")).map(
              e => e.textContent
            ),
            vfx: (globalThis as any).fixture.cloud.postProdStorage,
            output: (globalThis as any).fixture.outputs(),
            tail: document.body.textContent?.slice(-2500),
          }))
        );
        throw e;
      });
    await segment(page, "B");
    expect(
      await page.evaluate(() =>
        (globalThis as any).fixture
          .outputs()
          .some((r: any) => r.source === "gs://test-only/A-effect.mp4")
      )
    ).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 90000);

it("真实后期顾问切段晚回执不污染新段，回原段沿同编号恢复且无自动重试", async () => {
  const { page, errors } = await boot();
  try {
    await click(page, "进入编辑 →");
    await saved(page);
    await click(page, "创作顾问 · 后期与特效");
    await fill(
      page,
      'textarea[aria-label="向创作顾问提问"]',
      "只检查A段特效，不生成"
    );
    await page.evaluate(() => ((globalThis as any).fixture.delayStream = true));
    await click(page, "让顾问操作工作流");
    await page.waitForFunction(() =>
      Boolean((globalThis as any).fixture.releaseStream)
    );
    const rid = await page.evaluate(
      () => (globalThis as any).fixture.streams[0].requestId
    );
    await segment(page, "B");
    await page.evaluate(() => {
      const f = (globalThis as any).fixture;
      f.delayStream = false;
      f.releaseStream();
    });
    await click(page, "创作顾问 · 后期与特效");
    expect(
      await page.evaluate(() =>
        JSON.stringify((globalThis as any).fixture.cloud.postProdStorage)
      )
    ).not.toContain(rid);
    await segment(page, "A");
    await click(page, "创作顾问 · 后期与特效");
    await page.waitForFunction(() =>
      document.body.textContent?.includes("恢复原问题（沿用原请求编号）")
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.streams.length)
    ).toBe(1);
    await click(page, "恢复原问题（沿用原请求编号）");
    await page.waitForSelector('[aria-label="工作流操作方案"]');
    expect(
      await page.evaluate(() =>
        (globalThis as any).fixture.streams.map((r: any) => r.requestId)
      )
    ).toEqual([rid, rid]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 60000);
