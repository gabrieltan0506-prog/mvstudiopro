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
      import {createCanvasAudioCue,canvasAudioCueInputKey,emptyCanvasAudioStudio} from './shared/canvasAudioStudio';
      const f=globalThis.fixture={submits:[],gets:[],lists:[],updates:[],mode:'success',getResult:null};
      f.createStudio=createManhuaPrevisStudio;
      const cue={...createCanvasAudioCue('bgm','offline-bgm'),approved:true,selectedTakeId:'offline-take',startSec:0,endSec:10};
      cue.takes=[{id:'offline-take',gcsUri:'gs://test/offline-bgm.wav',previewUrl:'',createdAt:'test',durationSec:10,inputKey:canvasAudioCueInputKey(cue)}];
      const audioStudio={...emptyCanvasAudioStudio(),cues:[cue]};
      f.old={url:'https://offline.invalid/old.mp4',gcsUri:'gs://test/old.mp4',updatedAt:'2026-09-01T00:00:00Z'};
      f.makeBlock=(scope='11111111-1111-4111-8111-111111111111')=>({id:'clip-e01-g01',audioStudio,previsStudio:{...createManhuaPrevisStudio(10,scope),audioEnabled:false},manhuaSegmentRefs:{previs:f.old}});
      f.response=(input)=>({jobId:'prv_test_job',status:'succeeded',params:input,output:{requestId:input.requestId,clipId:input.clipId,spec:input.spec,audio:input.audio,quality:input.quality,durationSec:input.spec.durationSec,gcsUri:'gs://test/unrelated-storage-folder/output.mp4',url:'https://offline.invalid/new.mp4',report:{warnings:['离线测试，不代表动作质量验收']},...(input.spec.exportLayers?{layerBundle:{gcsUri:'gs://test/layer-bundle.zip',url:'https://offline.invalid/layers.zip',format:'previs-layers-v1',bytes:1234,sha256:'a'.repeat(64)}}:{})}});
      const services={submit:async input=>{f.submits.push(structuredClone(input));if(f.mode==='defer')return new Promise(resolve=>f.resolveSubmit=resolve);if(f.mode==='unknown')throw Error('离线模拟断网');const response=f.response(input);if(globalThis.keyedFixture)f.getResult=response;return response;},get:async id=>{f.gets.push(id);return f.getResult;},list:async (...args)=>{f.lists.push(args);if(f.mode==='defer-list')return new Promise(resolve=>f.resolveList=resolve);return {items:[],nextCursor:null};}};
      function App(){const [block,setBlock]=useState(()=>globalThis.keyedFixture?{...f.makeBlock(),previsStudio:undefined}:f.makeBlock());const [characters,setCharacters]=useState([{id:'character-mo',label:'墨屠'}]);const [shots,setShots]=useState([]);const [directionShots,setDirectionShots]=useState([]);f.setDirectionShots=setDirectionShots;f.block=block;f.setBlock=setBlock;f.characters=characters;f.setCharacters=setCharacters;f.shots=shots;f.setShots=setShots;return <ManhuaPrevisStudioView key={globalThis.keyedFixture?block.id+':'+(block.previsStudio?.scopeId??'new'):undefined} block={block} characters={characters} sourceShots={shots} directionShots={directionShots} services={services} onChange={(studio,reference)=>{f.updates.push({studio:structuredClone(studio),reference});if(f.rejectSave)return false;setBlock(current=>({...current,previsStudio:studio,manhuaSegmentRefs:reference?{...current.manhuaSegmentRefs,previs:reference}:current.manhuaSegmentRefs}));return true;}}/>;}
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

async function open(strict = false, keyed = false, reviewMedia?: Buffer, expandTune = true) {
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
    else if (reviewMedia && request.url() === "http://localhost:41819/review.mp4") {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), reviewMedia.length - 1) : reviewMedia.length - 1;
      const body = reviewMedia.subarray(start, end + 1);
      void request.respond({
        status: range ? 206 : 200,
        contentType: "video/mp4",
        headers: { "Accept-Ranges": "bytes", "Content-Length": String(body.length), ...(range ? { "Content-Range": `bytes ${start}-${end}/${reviewMedia.length}` } : {}) },
        body,
      });
    }
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
async function markCurrentPreviewFrames(page: Page) {
  await page.waitForSelector("[data-previs-review-gate]");
  if (await page.$("details[data-previs-review-gate]:not([open])")) await page.click("[data-previs-review-gate] > summary");
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
    const total = Math.round(Number(document.querySelector<HTMLInputElement>('[aria-label="白模预览时间"]')!.max) * 24);
    let time = 0;
    Object.defineProperties(video, {
      readyState: { configurable: true, get: () => 4 },
      seeking: { configurable: true, get: () => false },
      currentTime: { configurable: true, get: () => time, set: value => { time = value; } },
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-previs-review-gate] button"))
      .find(node => node.textContent === "确认当前帧并看下一帧")!;
    for (let frame = 0; frame < total; frame++) {
      time = frame / 24;
      button.click();
    }
  });
  await settle(page);
}
async function finishCurrentPreviewAtNormalSpeed(page: Page) {
  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
    const duration = Number(document.querySelector<HTMLInputElement>('[aria-label="白模预览时间"]')!.max);
    video.currentTime = 0;
    video.playbackRate = 1;
    video.dispatchEvent(new Event("play", { bubbles: true }));
    video.currentTime = duration;
    video.dispatchEvent(new Event("ended", { bubbles: true }));
  });
  await settle(page);
}
async function confirmCurrentPreviewReview(page: Page) {
  await markCurrentPreviewFrames(page);
  await finishCurrentPreviewAtNormalSpeed(page);
  await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>("[data-previs-review-gate] input[type=checkbox]"));
    if (boxes.length !== 2) throw Error("审片确认项不完整");
    boxes.forEach(box => box.click());
  });
  await settle(page);
}

it("顾问保存真实人物动作配置后提交当前配置，候选不自动采用，采用与旧参考恢复闭合", async () => {
  const page = await open();
  try {
    // 顾问已保存的真实规格作为输入夹具，渲染/审片/采用仍走真实组件控件。
    await page.evaluate(() => { const f=(window as any).fixture;f.setBlock((block:any)=>({...block,previsStudio:{...block.previsStudio,spec:{...block.previsStudio.spec,aspect:'9:16',actors:block.previsStudio.spec.actors.map((actor:any)=>({...actor,nameZh:'墨屠',assetRef:'character-mo',actions:[{kind:'strike',startSec:0,endSec:10}]}))}}})); });
    await settle(page);
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        input: f.submits[0],
        reference: f.block.manhuaSegmentRefs.previs,
        pending: f.block.previsStudio.pending,
        saved: f.updates.find((u: any) => u.studio.pending)?.studio.pending,
        selected: f.block.previsStudio.selectedJobId,
      };
    });
    expect(actual.input.spec.aspect).toBe("9:16");
    expect(actual.input.spec.actors[0]).toMatchObject({
      nameZh: "墨屠",
      assetRef: "character-mo",
      actions: [{ kind: "strike", startSec: 0, endSec: 10 }],
    });
    expect(actual.saved).toEqual(actual.input);
    expect(actual.pending).toBeUndefined();
    expect(actual.selected).toBeUndefined();
    expect(actual.reference.gcsUri).toBe("gs://test/old.mp4");
    await confirmCurrentPreviewReview(page);
    await click(page, "采用为本段参考");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.manhuaSegmentRefs.previs.motionGuideZh
      )
    ).toContain("墨屠（character-mo）");
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.referenceHistory[0].gcsUri
      )
    ).toBe("gs://test/old.mp4");
    await click(page, "恢复旧参考 1");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri
      )
    ).toBe("gs://test/old.mp4");
    expect(
      await page.evaluate(() => (window as any).fixture.submits.length)
    ).toBe(1);
  } finally {
    await page.close();
  }
});

it("未逐帧审片及常速复核的候选不能替换旧参考", async () => {
  const page = await open();
  try {
    await click(page, "确认生成动作白模");
    await page.waitForSelector("[data-previs-review-gate]");
    await click(page, "采用为本段参考");
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri)).toBe("gs://test/old.mp4");
    expect(await page.$eval('[role="alert"]', node => node.textContent)).toContain("逐帧检查");
    await markCurrentPreviewFrames(page);
    if (await page.$("details[data-previs-review-gate]:not([open])")) await page.click("[data-previs-review-gate] > summary");
    await page.click("[data-previs-review-gate] input[type=checkbox]");
    await click(page, "采用为本段参考");
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri)).toBe("gs://test/old.mp4");
    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
      video.currentTime = 0;
      video.dispatchEvent(new Event("play", { bubbles: true }));
      video.currentTime = 5;
      video.dispatchEvent(new Event("seeking", { bubbles: true }));
      video.currentTime = 10;
      video.dispatchEvent(new Event("ended", { bubbles: true }));
    });
    await settle(page);
    expect(await page.$$eval("[data-previs-review-gate] input[type=checkbox]", nodes => (nodes[1] as HTMLInputElement).disabled)).toBe(true);
    await finishCurrentPreviewAtNormalSpeed(page);
    await page.evaluate(() => document.querySelectorAll<HTMLInputElement>("[data-previs-review-gate] input[type=checkbox]")[1]!.click());
    await settle(page);
    await click(page, "采用为本段参考");
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri)).toBe("gs://test/unrelated-storage-folder/output.mp4");
    expect(await page.evaluate(() => (window as any).fixture.submits.length)).toBe(1);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.getResult = f.response(f.submits[0]);
    });
    await click(page, "预览");
    await settle(page);
    expect(await page.$eval("[data-previs-reviewed-frames]", node => node.textContent)).toContain("0/240");
    expect(await page.$$eval("[data-previs-review-gate] input[type=checkbox]", nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual([false, false]);
  } finally { await page.close(); }
});

it("真实媒体片尾不能冒充末帧，回到末帧后可从头常速复核", async () => {
  // 现成的 3.2 秒本地素材只验证浏览器 seek/play/ended 事件；服务端帧数与时长契约另有渲染门禁。
  const media = await readFile(path.resolve("client/public/blog-assets/happyhorse-720p-3s.mp4"));
  const page = await open(false, false, media);
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const scope = f.block.previsStudio.scopeId;
      f.setBlock((block: any) => ({ ...block, previsStudio: { ...f.createStudio(3, scope), audioEnabled: false } }));
      const original = f.response;
      f.response = (input: any) => {
        const response = original(input);
        response.output.url = "http://localhost:41819/review.mp4";
        return response;
      };
    });
    await settle(page);
    await click(page, "确认生成动作白模");
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video");
      return video && video.readyState >= 2 && Math.abs(video.duration - 3.2) < 0.1;
    }, { timeout: 10_000 }).catch(async () => {
      const state = await page.evaluate(() => ({
        alert: document.querySelector('[role="alert"]')?.textContent,
        status: document.querySelector('[role="status"]')?.textContent,
        submits: (window as any).fixture.submits.length,
        history: (window as any).fixture.block.previsStudio.history.length,
        video: (() => { const v = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video"); return v ? { readyState: v.readyState, duration: v.duration, error: v.error?.code } : null; })(),
      }));
      throw new Error(`真实媒体未就绪：${JSON.stringify(state)}`);
    });
    await page.evaluate(() => {
      document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!.currentTime = 0.025;
    });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
      return !video.seeking && video.currentTime > 0.02 && video.currentTime < 0.03;
    });
    await click(page, "确认当前帧并看下一帧");
    await page.evaluate(() => {
      document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!.currentTime = 0;
    });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
      return !video.seeking && video.currentTime < 0.005;
    });
    await click(page, "确认当前帧并看下一帧");
    await settle(page);
    expect(await page.$eval("[data-previs-reviewed-frames]", node => node.textContent)).toContain("1/72");
    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
      video.currentTime = video.duration;
    });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
      return !video.seeking && video.currentTime >= video.duration - 0.01;
    }, { timeout: 10_000 }).catch(async () => {
      const state = await page.$eval("[data-manhua-previs-studio] video", node => {
        const video = node as HTMLVideoElement;
        return { currentTime: video.currentTime, duration: video.duration, seeking: video.seeking, readyState: video.readyState, networkState: video.networkState, error: video.error?.code };
      });
      throw new Error(`真实媒体定位失败：${JSON.stringify(state)}`);
    });
    await click(page, "确认当前帧并看下一帧");
    await settle(page);
    expect(await page.$eval("[data-previs-reviewed-frames]", node => node.textContent)).toContain("1/72");
    expect(await page.$eval('[role="alert"]', node => node.textContent)).toContain("已到片尾");
    await page.evaluate(() => {
      document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!.currentTime = 3 - 1 / 24;
    });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
      return !video.seeking && video.currentTime > 2.9 && video.currentTime < 3;
    });
    await click(page, "确认当前帧并看下一帧");
    await settle(page);
    expect(await page.$eval("[data-previs-reviewed-frames]", node => node.textContent)).toContain("2/72");
    await page.evaluate(() => {
      document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!.currentTime = 2.99;
    });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-manhua-previs-studio] video")!;
      return !video.seeking && video.currentTime > 2.98 && video.currentTime < 3;
    });
    await click(page, "确认当前帧并看下一帧");
    await settle(page);
    expect(await page.$eval("[data-previs-reviewed-frames]", node => node.textContent)).toContain("2/72");
    await click(page, "从头常速播放");
    await page.waitForFunction(() => {
      const checks = document.querySelectorAll<HTMLInputElement>("[data-previs-review-gate] input[type=checkbox]");
      return checks[1] && !checks[1].disabled;
    }, { timeout: 10_000 });
    expect(await page.$eval("[data-manhua-previs-studio] video", node => (node as HTMLVideoElement).ended)).toBe(true);
  } finally { await page.close(); }
});

it("提交结果不明后确认原编号，绝不创建第二个请求身份", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "unknown";
    });
    await click(page, "确认生成动作白模");
    await page.waitForSelector('[role="alert"]');
    expect(await page.$eval("[data-previs-recovery]", el => el.textContent)).toContain("提交或查询结果未确认");
    await click(page, "查询原编号");
    await page.waitForFunction(() => (window as any).fixture.gets.length > 0);
    expect(await page.evaluate(() => (window as any).fixture.submits.length)).toBe(1);
    await click(page, "确认原请求（不新建编号）");
    await page.waitForFunction(
      () => (window as any).fixture.submits.length === 2
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        calls: f.submits,
        pending: f.block.previsStudio.pending,
        gets: f.gets,
      };
    });
    expect(actual.calls[1]).toEqual(actual.calls[0]);
    expect(actual.pending).toEqual(actual.calls[0]);
    expect(actual.gets).toContain(actual.pending.requestId);
  } finally {
    await page.close();
  }
});

it("渲染明确失败显示原因与配置入口，保留旧参考且不留待确认编号", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.response = (input: any) => ({
        jobId: "prv_failed_job", status: "failed", params: input,
        output: null, error: "人物站位超出可渲染范围",
      });
    });
    await click(page, "确认生成动作白模");
    await page.waitForFunction(() => Boolean(document.querySelector("[data-previs-recovery]")));
    const actual = await page.evaluate(() => ({
      message: document.querySelector("[data-previs-recovery]")?.textContent,
      pending: (window as any).fixture.block.previsStudio.pending,
      old: (window as any).fixture.block.manhuaSegmentRefs.previs.url,
      submits: (window as any).fixture.submits.length,
    }));
    expect(actual.message).toContain("本次渲染失败");
    expect(actual.message).toContain("人物站位超出可渲染范围");
    expect(actual.message).toContain("检查人物与配置");
    expect(actual.pending).toBeUndefined();
    expect(actual.old).toBe("https://offline.invalid/old.mp4");
    expect(actual.submits).toBe(1);
  } finally { await page.close(); }
});

it("恢复草稿中的在途编号只查询原单，成功后保留候选且不自动提交", async () => {
  const page = await open(true);
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const pending = {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: f.block.previsStudio.scopeId,
        clipId: f.block.id,
        spec: f.block.previsStudio.spec,
      };
      f.getResult = f.response(pending);
      f.setBlock({
        ...f.block,
        previsStudio: { ...f.block.previsStudio, pending },
      });
    });
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        gets: f.gets,
        submits: f.submits,
        pending: f.block.previsStudio.pending,
        reference: f.block.manhuaSegmentRefs.previs.gcsUri,
        take: f.block.previsStudio.history[0],
      };
    });
    expect(actual.gets).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(actual.submits).toEqual([]);
    expect(actual.pending).toBeUndefined();
    expect(actual.reference).toBe("gs://test/old.mp4");
    expect(actual.take.requestId).toBe(actual.gets[0]);
  } finally {
    await page.close();
  }
});

it("历史预览以保存的 requestId 续签，不从 jobId 或对象路径猜编号", async () => {
  const page = await open();
  try {
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    await page.evaluate(() => {
      (window as any).fixture.gets = [];
    });
    await click(page, "预览");
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return { gets: f.gets, requestId: f.submits[0].requestId };
    });
    expect(actual.gets).toEqual([actual.requestId]);
  } finally {
    await page.close();
  }
});

it("StrictMode 的 effect 重挂后仍能消费真实组件的生成回执", async () => {
  const page = await open(true);
  try {
    await click(page, "确认生成动作白模");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.history.length
      )
    ).toBe(1);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.pending
      )
    ).toBeUndefined();
  } finally {
    await page.close();
  }
});

it("历史查询期间切换 scope，旧分页响应不能写入新项目", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "defer-list";
    });
    await click(page, "恢复本段历史");
    await page.waitForFunction(() =>
      Boolean((window as any).fixture.resolveList)
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.oldResponse = f.response({
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: f.block.previsStudio.scopeId,
        clipId: f.block.id,
        spec: f.block.previsStudio.spec,
      });
      f.setBlock(f.makeBlock("33333333-3333-4333-8333-333333333333"));
    });
    await settle(page);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.resolveList({ items: [f.oldResponse], nextCursor: null });
    });
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.history
      )
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.scopeId
      )
    ).toBe("33333333-3333-4333-8333-333333333333");
    expect(await page.$("video")).toBeNull();
  } finally {
    await page.close();
  }
});

it("草稿保存失败时不能提交渲染，采用保存失败时不得替换旧参考", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.rejectSave = true;
    });
    await click(page, "确认生成动作白模");
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.pending
      )
    ).toBeUndefined();
    await page.evaluate(() => {
      (window as any).fixture.rejectSave = false;
    });
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio.history.length === 1
    );
    await page.evaluate(() => {
      (window as any).fixture.rejectSave = true;
    });
    await confirmCurrentPreviewReview(page);
    await click(page, "采用为本段参考");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri
      )
    ).toBe("gs://test/old.mp4");
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.selectedJobId
      )
    ).toBeUndefined();
    expect(
      await page.$eval('[role="status"]', el => el.textContent)
    ).not.toContain("已采用");
  } finally {
    await page.close();
  }
});

it("首次保存使父级 key 从 new 变为 scope 重挂后，原单终态仍由查询恢复", async () => {
  const page = await open(true, true);
  try {
    expect(
      await page.evaluate(() => (window as any).fixture.block.previsStudio)
    ).toBeUndefined();
    await page.evaluate(() => {const f=(window as any).fixture;f.setBlock((block:any)=>({...block,previsStudio:f.createStudio(10)}));});
    await settle(page);
    await click(page, "确认生成动作白模");
    await page.waitForFunction(
      () => (window as any).fixture.block.previsStudio?.history.length === 1
    );
    const actual = await page.evaluate(() => {
      const f = (window as any).fixture;
      return { submits: f.submits, gets: f.gets, studio: f.block.previsStudio };
    });
    expect(actual.submits).toHaveLength(1);
    expect(actual.gets).toContain(actual.submits[0].requestId);
    expect(actual.studio.history[0].requestId).toBe(
      actual.submits[0].requestId
    );
    expect(actual.studio.pending).toBeUndefined();
  } finally {
    await page.close();
  }
});

it("提交期间切换 scope，旧生成回执不能成为新项目候选", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "defer";
    });
    await click(page, "确认生成动作白模");
    await page.waitForFunction(() =>
      Boolean((window as any).fixture.resolveSubmit)
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.setBlock(f.makeBlock("33333333-3333-4333-8333-333333333333"));
    });
    await settle(page);
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.resolveSubmit(f.response(f.submits[0]));
    });
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.history
      )
    ).toEqual([]);
    expect(await page.$("video")).toBeNull();
  } finally {
    await page.close();
  }
});

async function setupScript(page: Page) {
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.beforeSpec = structuredClone(f.block.previsStudio.spec);
    f.setCharacters([
      { id: "qing", label: "阿菁", tag: "@人物1" },
      { id: "guard", label: "家丁", tag: "@人物2" },
    ]);
    f.setShots([
      {
        index: 7,
        durationSec: 4,
        actionZh: "阿菁一拳击中家丁，家丁受击后仰。",
      },
    ]);
  });
  await page.waitForSelector("[data-previs-script-draft]");
}
async function toggleLabel(page: Page, text: string) {
  await page.evaluate(text => {
    const label = Array.from(document.querySelectorAll("label")).find(el =>
      el.textContent?.includes(text)
    );
    const input = label?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    if (!input || input.disabled) throw Error("复选框不可用：" + text);
    input.click();
  }, text);
  await settle(page);
}

it("缺失层包的成功回执不可采用且保留原任务编号", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture,
        b = f.block,
        s = b.previsStudio.spec;
      const response = f.response;
      f.response = (input: any) => {
        const r = response(input);
        delete r.output.layerBundle;
        return r;
      };
      f.setBlock({
        ...b,
        previsStudio: {
          ...b.previsStudio,
          spec: {
            ...s,
            exportLayers: true,
            durationSec: 4,
            actors: s.actors.map((a: any) => ({ ...a, moveEndSec: 4 })),
            cameras: s.cameras.map((c: any) => ({ ...c, endSec: 4 })),
          },
        },
      });
    });
    await settle(page);
    await click(page, "确认生成动作白模");
    await settle(page);
    const current = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        submits: f.submits,
        gets: f.gets,
        studio: f.block.previsStudio,
        ref: f.block.manhuaSegmentRefs.previs,
      };
    });
    expect(current.submits).toHaveLength(1);
    expect(current.studio.pending.requestId).toBe(current.submits[0].requestId);
    expect(current.studio.history).toHaveLength(0);
    expect(current.ref.url).toBe("https://offline.invalid/old.mp4");
    expect(await page.$eval('[role="alert"]', e => e.textContent)).toContain(
      "不要重复生成"
    );
    expect(
      await page.$$eval(
        "button",
        bs => bs.filter(b => b.textContent === "采用为本段参考").length
      )
    ).toBe(0);
    expect(
      current.gets.every((id: string) => id === current.submits[0].requestId)
    ).toBe(true);
  } finally {
    await page.close();
  }
});

it("历史恢复过滤缺层成功行，不加入可采用候选或自动提交", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "defer-list";
    });
    await click(page, "恢复本段历史");
    await settle(page);
    await page.evaluate(() => {
      const f = (window as any).fixture,
        s = structuredClone(f.block.previsStudio.spec);
      s.exportLayers = true;
      s.durationSec = 4;
      s.actors.forEach((a: any) => (a.moveEndSec = 4));
      s.cameras.forEach((c: any) => (c.endSec = 4));
      const input = {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: f.block.previsStudio.scopeId,
        clipId: f.block.id,
        spec: s,
      };
      const response = f.response(input);
      delete response.output.layerBundle;
      f.resolveList({ items: [response], nextCursor: null });
    });
    await settle(page);
    expect(
      await page.evaluate(() => {
        const f = (window as any).fixture;
        return {
          n: f.block.previsStudio.history.length,
          submits: f.submits.length,
          url: f.block.manhuaSegmentRefs.previs.url,
        };
      })
    ).toEqual({ n: 0, submits: 0, url: "https://offline.invalid/old.mp4" });
  } finally {
    await page.close();
  }
});

it("重载的分层历史须查询同一原单确认层包后才能采用", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture,
        b = f.block,
        s = structuredClone(b.previsStudio.spec);
      s.exportLayers = true;
      s.durationSec = 4;
      s.actors.forEach((a: any) => (a.moveEndSec = 4));
      s.cameras.forEach((c: any) => (c.endSec = 4));
      f.setBlock({
        ...b,
        previsStudio: {
          ...b.previsStudio,
          history: [
            {
              jobId: "prv_saved",
              requestId: "22222222-2222-4222-8222-222222222222",
              gcsUri: "gs://test/preview.mp4",
              url: "https://offline.invalid/saved.mp4",
              durationSec: 4,
              createdAt: "2026-09-13",
              spec: s,
            },
          ],
        },
      });
    });
    await settle(page);
    await click(page, "采用为本段参考");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.url
      )
    ).toBe("https://offline.invalid/old.mp4");
    expect(await page.$eval('[role="alert"]', e => e.textContent)).toContain(
      "预览"
    );
    expect(
      await page.evaluate(() => (window as any).fixture.submits.length)
    ).toBe(0);
  } finally {
    await page.close();
  }
});


it("白模修改后提示旧预览并保留原片，不自动重渲染", async () => {
  const page = await open();
  try {
    await click(page, "确认生成动作白模");
    await page.waitForSelector("[data-previs-preview-controls]");
    expect(await page.$("[data-previs-preview-stale]")).toBeNull();
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.setBlock((b: any) => ({...b, previsStudio: {...b.previsStudio,
        spec: {...b.previsStudio.spec, cameras: b.previsStudio.spec.cameras.map((c: any, i: number) => i ? c : {...c, lens: c.lens + 1})}}}));
    });
    await page.waitForSelector("[data-previs-preview-stale]");
    expect(await page.evaluate(() => (window as any).fixture.submits.length)).toBe(1);
    expect(await page.$eval("video", e => e.getAttribute("src"))).toBe("https://offline.invalid/new.mp4");
  } finally { await page.close(); }
});


it("打开已应用的顾问独立历史即载入最近渲染，播放器先于配置且不会自动采用或重提", async () => {
  const page = await open(false, true, undefined, false);
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const b = f.makeBlock('33333333-3333-4333-8333-333333333333');
      const studio = b.previsStudio;
      const input = {scopeId: '66666666-6666-4666-8666-666666666666', clipId:b.id, requestId:'44444444-4444-4444-8444-444444444444',spec:studio.spec};
      f.getResult = f.response(input);
      studio.history = [
        {jobId:'old-job', requestId:'55555555-5555-4555-8555-555555555555', gcsUri:'gs://test/old-preview.mp4',url:'https://offline.invalid/old-preview.mp4', durationSec:10, createdAt:'2026-09-28T01:00:00Z', spec:studio.spec},
        {jobId:f.getResult.jobId, requestId:input.requestId, gcsUri:f.getResult.output.gcsUri,url:f.getResult.output.url,durationSec:10,createdAt:'2026-09-29T01:00:00Z',spec:studio.spec},
      ];
      f.setBlock(b);
    });
    await page.waitForSelector('[data-previs-player] video');
    const result = await page.evaluate(() => {
      const f = (window as any).fixture;
      const player = document.querySelector('[data-previs-player]')!;
      const cast = document.querySelector('[data-previs-cast]')!;
      return {gets:f.gets,submits:f.submits.length,adopted:f.block.previsStudio.selectedJobId ?? null,reference:f.block.manhuaSegmentRefs.previs.url,playerFirst:Boolean(player.compareDocumentPosition(cast) & Node.DOCUMENT_POSITION_FOLLOWING)};
    });
    expect(result).toEqual({gets:['44444444-4444-4444-8444-444444444444'],submits:0,adopted:null,reference:'https://offline.invalid/old.mp4',playerFirst:true});
  } finally { await page.close(); }
});

it("顾问入口替代所有坐标表单，打开现有配置不生成或替换参考", async () => {
 const page=await open();try {expect(await page.$('[data-previs-tune]')).toBeNull();expect(await page.$('input[type=number]')).toBeNull();expect(await page.$('[data-previs-layout-preview]')).toBeNull();expect(await page.evaluate(()=>(window as any).fixture.submits)).toEqual([]);expect(await page.evaluate(()=>(window as any).fixture.block.manhuaSegmentRefs.previs.url)).toBe('https://offline.invalid/old.mp4');}finally{await page.close();}
});
