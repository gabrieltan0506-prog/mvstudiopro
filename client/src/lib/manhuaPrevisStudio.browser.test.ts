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
      f.createStudio=createManhuaPrevisStudio;
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

async function open(strict = false, keyed = false, reviewMedia?: Buffer) {
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
  // 专业编辑回归显式打开数字表；默认收起由动作库入口探针单独验证。
  await page.click("[data-previs-advanced] > summary");
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

it("连续运镜保存终点，拆镜衔接不跳回起点且不自动提交", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const block = structuredClone(f.block);
      block.previsStudio.spec.cameras[0].endPosition = [4, -6, 3];
      f.setBlock(block);
    });
    await settle(page);
    await click(page, "拆分最后一个机位");
    await settle(page);
    const result = await page.evaluate(() => {
      const f = (window as any).fixture;
      return { cameras: f.block.previsStudio.spec.cameras, submits: f.submits.length, old: f.block.manhuaSegmentRefs.previs.url };
    });
    expect(result.cameras[0].endPosition).toEqual(result.cameras[1].position);
    expect(result.cameras[1].endPosition).toEqual([4, -6, 3]);
    expect(result.submits).toBe(0);
    expect(result.old).toBe("https://offline.invalid/old.mp4");
  } finally { await page.close(); }
});

it("收起专业参数仍可选择出场人物，保存失败不改变原人物或提交渲染", async () => {
  const page = await open();
  try {
    await page.click("[data-previs-advanced] > summary");
    await page.evaluate(() => { (window as any).fixture.rejectSave = true; });
    await page.select('[aria-label="白模出场人物1"]', "character-mo");
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.block.previsStudio.spec.actors[0].assetRef)).toBeUndefined();
    await page.evaluate(() => { (window as any).fixture.rejectSave = false; });
    await page.select('[aria-label="白模出场人物1"]', "character-mo");
    await settle(page);
    const result = await page.evaluate(() => ({
      actor: (window as any).fixture.block.previsStudio.spec.actors[0],
      submits: (window as any).fixture.submits.length,
      open: (document.querySelector('[data-previs-advanced]') as HTMLDetailsElement).open,
      reference: (window as any).fixture.block.manhuaSegmentRefs.previs.url,
    }));
    expect(result.actor.assetRef).toBe("character-mo");
    expect(result.actor.nameZh).toBe("墨屠");
    expect(result.submits).toBe(0);
    expect(result.open).toBe(false);
    expect(result.reference).toBe("https://offline.invalid/old.mp4");
  } finally { await page.close(); }
});

it("米白主题覆盖真实预演表单与门户，退出漫剧模式后恢复原样式", async () => {
  const page = await open();
  try {
    await page.addStyleTag({
      content:
        '.text-white{color:rgb(255,255,255)} [data-slot="dialog-content"]{background-color:rgb(20,26,36)}',
    });
    await page.addStyleTag({
      content: await readFile(
        path.resolve("client/src/styles/manhuaCream.css"),
        "utf8"
      ),
    });
    await page.evaluate(() => {
      document
        .getElementById("root")!
        .setAttribute("data-manhua-theme", "cream");
      const portal = document.createElement("div");
      portal.dataset.slot = "dialog-content";
      portal.className = "text-white";
      portal.textContent = "人物设置";
      document.body.append(portal);
      const preview = document.createElement("section");
      preview.className = "bg-black";
      const hint = document.createElement("p");
      hint.className = "text-white/40";
      hint.textContent = "静帧 / 成片在此预览";
      hint.dataset.themePreviewHint = "";
      preview.append(hint);
      document.getElementById("root")!.append(preview);
      const overlay = document.createElement("div");
      overlay.className = "bg-black/85";
      overlay.innerHTML =
        '<p data-manhua-media-controls class="text-white/90">裁字说明</p><div data-manhua-media-controls><button class="bg-emerald-500/25 text-emerald-50">确认裁字</button></div><div class="bg-[#101417]"><p data-theme-card-text class="text-white/90">三维预览卡片</p></div>';
      document.getElementById("root")!.append(overlay);
    });
    const styled = await page.evaluate(() => ({
      page: getComputedStyle(document.getElementById("root")!).backgroundColor,
      input: getComputedStyle(document.querySelector("select")!).color,
      portal: getComputedStyle(
        document.querySelector('[data-slot="dialog-content"]')!
      ).backgroundColor,
      portalText: getComputedStyle(
        document.querySelector('[data-slot="dialog-content"]')!
      ).color,
      previewText: getComputedStyle(
        document.querySelector("[data-theme-preview-hint]")!
      ).color,
      cropHint: getComputedStyle(
        document.querySelector("p[data-manhua-media-controls]")!
      ).color,
      cropAction: getComputedStyle(
        document.querySelector("[data-manhua-media-controls] button")!
      ).color,
      nestedCard: getComputedStyle(
        document.querySelector("[data-theme-card-text]")!
      ).color,
    }));
    expect(styled).toEqual({
      page: "rgb(238, 233, 223)",
      input: "rgb(32, 50, 71)",
      portal: "rgb(247, 242, 232)",
      portalText: "rgb(32, 50, 71)",
      previewText: "rgb(233, 227, 217)",
      cropHint: "rgb(255, 250, 241)",
      cropAction: "rgb(255, 250, 241)",
      nestedCard: "rgb(32, 50, 71)",
    });
    await page.evaluate(() =>
      document.getElementById("root")!.removeAttribute("data-manhua-theme")
    );
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector('[data-slot="dialog-content"]')!
          ).backgroundColor
      )
    ).toBe("rgb(20, 26, 36)");
  } finally {
    await page.close();
  }
});

it("编辑真实角色和动作后提交当前配置，候选不自动采用，采用与旧参考恢复闭合", async () => {
  const page = await open();
  try {
    await page.select('[aria-label="角色1项目资产"]', "character-mo");
    await click(page, "添加动作");
    await page.select('[aria-label="角色1动作1"]', "strike");
    await page.select('[aria-label="白模画幅"]', "9:16");
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
      f.setBlock((block: any) => ({ ...block, previsStudio: f.createStudio(3, scope) }));
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

it("四足角色可直接添加覆盖整段的左前腿跛行动作", async () => {
  const page = await open();
  try {
    await page.select('[aria-label="角色1形体"]', "horse");
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find(
        node => node.textContent?.trim() === "添加动作"
      ) as HTMLButtonElement | undefined;
      button?.click();
    });
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.spec.actors[0].actions
      )
    ).toEqual([{ kind: "limp_front_left", startSec: 0, endSec: 10 }]);
  } finally {
    await page.close();
  }
});

it("编辑中清空名称可以保存草稿，但无效配置不能提交渲染", async () => {
  const page = await open();
  try {
    await page.focus('[aria-label="角色1名称"]');
    await page.$eval('[aria-label="角色1名称"]', element => {
      const input = element as HTMLInputElement;
      input.select();
    });
    await page.keyboard.press("Backspace");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.spec.actors[0].nameZh
      )
    ).toBe("");
    await click(page, "确认生成动作白模");
    await page.waitForSelector('[role="alert"]');
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
  } finally {
    await page.close();
  }
});

it("提交结果不明后确认原编号，绝不创建第二个请求身份", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.mode = "unknown";
    });
    await click(page, "确认生成动作白模");
    await page.waitForSelector('[role="alert"]');
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

it("剧本草案先预览再确认，仅改配置，撤销精确恢复旧spec与旧参考", async () => {
  const page = await open();
  try {
    await setupScript(page);
    await click(page, "从本段剧本生成动作草案");
    await settle(page);
    expect(
      await page.$eval("[data-previs-script-draft]", e => e.textContent)
    ).toContain("双人事件 1 个");
    const before = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        old: f.beforeSpec,
        current: f.block.previsStudio.spec,
        submits: f.submits,
        updates: f.updates,
      };
    });
    expect(before.current).toEqual(before.old);
    expect(before.submits).toEqual([]);
    expect(before.updates).toEqual([]);
    await toggleLabel(page, "我已审阅动作");
    await click(page, "采用动作草案");
    await settle(page);
    const adopted = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        studio: f.block.previsStudio,
        reference: f.block.manhuaSegmentRefs.previs,
        submits: f.submits,
      };
    });
    expect(adopted.studio.spec.interactions).toHaveLength(1);
    expect(adopted.studio.spec.actors.map((a: any) => a.assetRef)).toEqual([
      "qing",
      "guard",
    ]);
    expect(adopted.studio.specHistory[0].spec).toEqual(before.old);
    expect(adopted.reference.gcsUri).toBe("gs://test/old.mp4");
    expect(adopted.submits).toEqual([]);
    await click(page, "恢复上一份动作配置（不改已采用参考）");
    await settle(page);
    expect(
      await page.evaluate(() => (window as any).fixture.block.previsStudio.spec)
    ).toEqual(before.old);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri
      )
    ).toBe("gs://test/old.mp4");
  } finally {
    await page.close();
  }
});

it("草案预览后原镜改变，已勾选审阅也不能采用旧草案", async () => {
  const page = await open();
  try {
    await setupScript(page);
    await click(page, "从本段剧本生成动作草案");
    await toggleLabel(page, "我已审阅动作");
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.setShots([{ ...f.shots[0], actionZh: "阿菁静立。" }]);
    });
    await settle(page);
    expect(
      await page.$eval("[data-previs-script-draft]", e => e.textContent)
    ).toContain("原剧本或角色已变化");
    expect(
      await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            b => b.textContent === "采用动作草案"
          )?.disabled
      )
    ).toBe(true);
    expect(await page.evaluate(() => (window as any).fixture.updates)).toEqual(
      []
    );
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
  } finally {
    await page.close();
  }
});

it("草案预览后手工编辑配置，旧草案禁采用且不覆盖新朝向", async () => {
  const page = await open();
  try {
    await setupScript(page);
    await click(page, "从本段剧本生成动作草案");
    await toggleLabel(page, "我已审阅动作");
    await page.$eval(
      '[aria-label="朝向角度"]',
      e => (e.closest("details")!.open = true)
    );
    await page.focus('[aria-label="朝向角度"]');
    await page.$eval('[aria-label="朝向角度"]', e =>
      (e as HTMLInputElement).select()
    );
    await page.keyboard.type("45");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].facingDeg
      )
    ).toBe(45);
    expect(
      await page.$eval("[data-previs-script-draft]", e => e.textContent)
    ).toContain("当前动作配置已变化");
    expect(
      await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            b => b.textContent === "采用动作草案"
          )?.disabled
      )
    ).toBe(true);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.specHistory
      )
    ).toBeUndefined();
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
    await click(page, "从本段剧本生成动作草案");
    await settle(page);
    expect(
      await page.$eval("[data-previs-script-draft]", e => e.textContent)
    ).not.toContain("当前动作配置已变化");
    expect(
      await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            b => b.textContent === "采用动作草案"
          )?.disabled
      )
    ).toBe(true);
  } finally {
    await page.close();
  }
});

it("尾翼勾选与取消真实编辑，不提交渲染，不替换旧参考", async () => {
  const page = await open();
  try {
    await page.select('[aria-label="角色1形体"]', "horse");
    await page.click('[aria-label="角色1四尾黑翼"]');
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].creature
            .preset
      )
    ).toBe("four_tail_black_wings");
    await page.focus('[aria-label="显形结束"]');
    await page.$eval('[aria-label="显形结束"]', e =>
      (e as HTMLInputElement).select()
    );
    await page.keyboard.press("Backspace");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].creature
            .transformEndSec
      )
    ).toBe(0);
    await page.click('[aria-label="角色1四尾黑翼"]');
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.previsStudio.spec.actors[0].creature
      )
    ).toBeUndefined();
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri
      )
    ).toBe("gs://test/old.mp4");
  } finally {
    await page.close();
  }
});

it("已有模型表单先取消再应用，无自动提交且停用后保留来源模型", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.setCharacters([
        { id: "character-mo", label: "墨屠", model: { taskId: "m3d_test" } },
      ]);
    });
    await settle(page);
    await page.select('[aria-label="角色1项目资产"]', "character-mo");
    await click(page, "角色准备");
    await settle(page);
    expect(await page.$eval("body", e => e.textContent)).toContain(
      "模型原始姿态和接地仍需检查"
    );
    expect(await page.$eval("body", e => e.textContent)).toContain(
      "复杂材质可能无法预演"
    );
    await toggleLabel(page, "启用当前角色的已有带骨模型");
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].riggedModel
      )
    ).toBeUndefined();
    await click(page, "取消编辑");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].riggedModel
      )
    ).toBeUndefined();
    await toggleLabel(page, "启用当前角色的已有带骨模型");
    await click(page, "保存角色配置");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].riggedModel
      )
    ).toMatchObject({ sourceJobId: "m3d_test", targetHeight: 1.7 });
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
    await toggleLabel(page, "启用当前角色的已有带骨模型");
    await click(page, "保存角色配置");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].riggedModel
      )
    ).toBeUndefined();
    expect(
      await page.evaluate(
        () => (window as any).fixture.characters[0].model.taskId
      )
    ).toBe("m3d_test");
    expect(
      await page.evaluate(
        () => (window as any).fixture.block.manhuaSegmentRefs.previs.gcsUri
      )
    ).toBe("gs://test/old.mp4");
  } finally {
    await page.close();
  }
});

it("角色配置保存被拒时不显示已保存且保留原状态", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.setCharacters([
        { id: "character-mo", label: "墨屠", model: { taskId: "m3d_test" } },
      ]);
    });
    await settle(page);
    await page.select('[aria-label="角色1项目资产"]', "character-mo");
    await click(page, "角色准备");
    await toggleLabel(page, "启用当前角色的已有带骨模型");
    await page.evaluate(() => {
      (window as any).fixture.rejectSave = true;
    });
    await click(page, "保存角色配置");
    await settle(page);
    expect(
      await page.$eval("[data-previs-role-editor]", e => e.textContent)
    ).toContain("配置未保存");
    expect(
      await page.$eval("[data-previs-role-editor]", e => e.textContent)
    ).not.toContain("角色配置已保存到本段");
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].riggedModel
      )
    ).toBeUndefined();
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
  } finally {
    await page.close();
  }
});

it("日常表演修改保留旧坐标与专业参数，移动注视选项不可选", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.setCharacters([
        { id: "character-mo", label: "墨屠", model: { taskId: "m3d_test" } },
      ]);
      const b = f.makeBlock();
      const a = b.previsStudio.spec.actors[0];
      a.assetRef = "character-mo";
      a.riggedModel = {
        sourceJobId: "m3d_test",
        forwardAxis: "+Y",
        targetHeight: 1.8,
        boneMap: { head: "Head" },
        performance: {
          controller: {
            eyeBones: { left: "EyeL", right: "EyeR" },
            expressions: {
              calm: { Calm: 1 },
              tense: { Tense: 1 },
              surprised: { Surprise: 1 },
            },
          },
          cues: [
            {
              startSec: 0,
              endSec: 2,
              gazeTarget: [7, 8, 9],
              headYawDeg: 12,
              headPitchDeg: -3,
              breathAmplitude: 0.02,
              breathHz: 0.3,
              expression: "tense",
              intensity: 0.6,
            },
          ],
        },
      };
      b.previsStudio.spec.actors.push({
        ...a,
        id: "moving",
        nameZh: "移动对手",
        assetRef: undefined,
        riggedModel: undefined,
        start: [0, 0],
        end: [4, 0],
        moveStartSec: 0,
        moveEndSec: 4,
      });
      f.setBlock(b);
    });
    await settle(page);
    expect(
      await page.$eval(
        "[data-rig-professional]",
        e => (e as HTMLDetailsElement).open
      )
    ).toBe(false);
    expect(
      await page.$eval(
        '[aria-label="表演1看向谁"]',
        e => (e as HTMLSelectElement).value
      )
    ).toBe("saved");
    expect(
      await page.$eval(
        '[aria-label="表演1看向谁"] option[value="actor:moving"]',
        e => (e as HTMLOptionElement).disabled
      )
    ).toBe(true);
    const old = await page.evaluate(
      () =>
        (window as any).fixture.block.previsStudio.spec.actors[0].riggedModel
    );
    await page.select('[aria-label="表演1表情"]', "surprised");
    await click(page, "应用本段表演");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.spec.actors[0].riggedModel
      )
    ).toEqual({
      ...old,
      performance: {
        ...old.performance,
        cues: [{ ...old.performance.cues[0], expression: "surprised" }],
      },
    });
    expect(await page.evaluate(() => (window as any).fixture.submits)).toEqual(
      []
    );
  } finally {
    await page.close();
  }
});

it("持剑配置通过真实控件提交，采用时保留剑刃时序和旧参考", async () => {
  const page = await open();
  await page.evaluate(() => {
    const f = (window as any).fixture;
    const block = f.makeBlock();
    const a = block.previsStudio.spec.actors[0];
    a.actions = [];
    a.start = [-0.7, 0];
    a.end = [-0.7, 0];
    a.facingDeg = 0;
    block.previsStudio.spec.actors.push({
      ...structuredClone(a),
      id: "actor-2",
      nameZh: "角色2",
      start: [0.7, 0],
      end: [0.7, 0],
      facingDeg: 180,
    });
    f.setBlock(block);
  });
  await page.waitForSelector('[aria-label="角色2持械"]');
  await page.select('[aria-label="角色1持械"]', "practice_sword");
  await page.select('[aria-label="角色2持械"]', "practice_sword");
  await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .find(b => b.textContent?.trim() === "添加双人互动")!
      .click()
  );
  await page.select('[aria-label="互动1反应"]', "sword_guard");
  await click(page, "确认生成动作白模");
  await page.waitForFunction(
    () => (window as any).fixture.submits.length === 1
  );
  const submitted = await page.evaluate(
    () => (window as any).fixture.submits[0].spec
  );
  expect(submitted.actors.map((a: any) => a.weapon)).toEqual([
    "practice_sword",
    "practice_sword",
  ]);
  expect(submitted.interactions[0].kind).toBe("sword_guard");
  await page.waitForFunction(
    () => (window as any).fixture.block.previsStudio.history.length === 1
  );
  await confirmCurrentPreviewReview(page);
  await click(page, "采用为本段参考");
  await settle(page);
  expect(
    await page.evaluate(
      () => (window as any).fixture.block.manhuaSegmentRefs.previs.motionGuideZh
    )
  ).toContain("剑刃交叉格挡");
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
  await page.close();
});

it("多人出水节奏真实编辑、提交、采用保留同一轨道与旧参考", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const spec = f.block.previsStudio.spec;
      f.setBlock({
        ...f.block,
        previsStudio: {
          ...f.block.previsStudio,
          spec: {
            ...spec,
            durationSec: 5,
            actors: [-4, 0, 4].map((x, i) => ({
              ...spec.actors[0],
              id: "water-" + i,
              nameZh: "角色" + i,
              start: [x, 0],
              end: [x, 0],
              moveEndSec: 5,
            })),
            cameras: [
              {
                startSec: 0,
                endSec: 5,
                position: [0, -22, 8],
                target: [0, 0, 1.8],
                lens: 35,
              },
            ],
          },
        },
      });
    });
    await settle(page);
    await page.select('[aria-label="出水节奏"]', "simultaneous");
    await settle(page);
    expect(
      await page.evaluate(() =>
        (
          window as any
        ).fixture.block.previsStudio.spec.waterEmergence.events.map(
          (e: any) => e.crossSec
        )
      )
    ).toEqual([1, 1, 1]);
    await page.select('[aria-label="出水节奏"]', "staggered");
    await settle(page);
    expect(
      await page.evaluate(() =>
        (
          window as any
        ).fixture.block.previsStudio.spec.waterEmergence.events.map(
          (e: any) => e.crossSec
        )
      )
    ).toEqual([1, 1.25, 1.5]);
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("legend"));
      const group = labels.find(e =>
        e.textContent?.includes("角色1")
      )?.parentElement;
      const remove = Array.from(group?.querySelectorAll("button") ?? []).find(
        b => b.textContent?.trim() === "移除角色"
      );
      if (!remove) throw Error("未找到中间角色移除按钮");
      remove.click();
    });
    await settle(page);
    await click(page, "添加角色");
    await settle(page);
    expect(
      await page.evaluate(() =>
        (
          window as any
        ).fixture.block.previsStudio.spec.waterEmergence.events.map(
          (e: any) => e.crossSec
        )
      )
    ).toEqual([1, 1.5, 1.75]);
    // 新增角色仍沿用原站位编辑；为本地出水验收设为分离位置。
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const b = f.block;
      const s = b.previsStudio.spec;
      s.actors[2] = { ...s.actors[2], start: [0, 0], end: [0, 0] };
      f.setBlock({ ...b, previsStudio: { ...b.previsStudio, spec: { ...s } } });
    });
    await settle(page);
    await click(page, "确认生成动作白模");
    await settle(page);
    const submitted = await page.evaluate(
      () => (window as any).fixture.submits
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0].spec.waterEmergence.mode).toBe("staggered");
    await confirmCurrentPreviewReview(page);
    await click(page, "采用为本段参考");
    await settle(page);
    const result = await page.evaluate(() => {
      const f = (window as any).fixture;
      return {
        studio: f.block.previsStudio,
        reference: f.block.manhuaSegmentRefs.previs,
      };
    });
    expect(result.studio.history[0].spec.waterEmergence).toEqual(
      submitted[0].spec.waterEmergence
    );
    expect(result.studio.referenceHistory[0].gcsUri).toBe("gs://test/old.mp4");
    expect(result.reference.motionGuideZh).toContain("破水");
  } finally {
    await page.close();
  }
});

it("分段站位与转身通过控件编辑，提交采用保留全部节点", async () => {
  const page = await open();
  try {
    await page.click('[aria-label="角色1分段运动轨"]');
    await settle(page);
    await click(page, "添加路线节点");
    await settle(page);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[aria-label="路线1节点3朝向"]'
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(el, "90");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(page);
    const route = await page.evaluate(
      () =>
        (window as any).fixture.block.previsStudio.spec.actors[0].motionRoute
    );
    expect(route).toHaveLength(3);
    expect(route[2].facingDeg).toBe(90);
    await click(page, "确认生成动作白模");
    await settle(page);
    expect(
      await page.evaluate(
        () => (window as any).fixture.submits[0].spec.actors[0].motionRoute
      )
    ).toEqual(route);
    await confirmCurrentPreviewReview(page);
    await click(page, "采用为本段参考");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.manhuaSegmentRefs.previs.motionGuideZh
      )
    ).toContain("90");
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.previsStudio.referenceHistory[0].gcsUri
      )
    ).toBe("gs://test/old.mp4");
  } finally {
    await page.close();
  }
});

it("爆点烟雾与分层开关进入提交，原单查询产物可下载层包", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture,
        b = f.block,
        s = b.previsStudio.spec;
      f.setBlock({
        ...b,
        previsStudio: {
          ...b.previsStudio,
          spec: {
            ...s,
            durationSec: 4,
            actors: s.actors.map((a: any) => ({ ...a, moveEndSec: 4 })),
            cameras: s.cameras.map((c: any) => ({ ...c, endSec: 4 })),
          },
        },
      });
    });
    await settle(page);
    await click(page, "添加特效事件");
    await click(page, "添加特效事件");
    await settle(page);
    await page.select('[aria-label="特效2类型"]', "smoke");
    await page.click('[aria-label="输出合成辅助层"]');
    await settle(page);
    await click(page, "确认生成动作白模");
    await settle(page);
    const spec = await page.evaluate(
      () => (window as any).fixture.submits[0].spec
    );
    expect(spec.effects.map((e: any) => e.kind)).toEqual([
      "explosion",
      "smoke",
    ]);
    expect(spec.exportLayers).toBe(true);
    const link = await page.$eval('a[download="遮罩与深度层包.zip"]', a =>
      a.getAttribute("href")
    );
    expect(link).toBe("https://offline.invalid/layers.zip");
    await confirmCurrentPreviewReview(page);
    await click(page, "采用为本段参考");
    await settle(page);
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.block.manhuaSegmentRefs.previs.motionGuideZh
      )
    ).toContain("爆点闪光");
  } finally {
    await page.close();
  }
});

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


it("布局拖动保存真实角色端点，不自动提交渲染", async () => {
  const page = await open();
  try {
    await page.click("[data-previs-layout-editor] > summary");
    const before = await page.evaluate(() => (window as any).fixture.block.previsStudio.spec.actors[0].start);
    const actor = await page.$("[data-layout-actor] circle");
    await actor!.scrollIntoView();
    const box = await actor!.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 20, box!.y + box!.height / 2, {steps:4});
    await page.mouse.up();
    await settle(page);
    const after = await page.evaluate(() => ({start:(window as any).fixture.block.previsStudio.spec.actors[0].start, count:(window as any).fixture.submits.length}));
    expect(after.start[0]).toBeGreaterThan(before[0]);
    expect(after.count).toBe(0);
  } finally { await page.close(); }
});

it("快慢节奏保存到真实渲染请求且可恢复常速", async () => {
  const page=await open();
  try {
    await click(page,"应用快慢节奏");
    await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.timeMap.spans[1].rate)).toBe(.5);
    expect(await page.evaluate(()=>(window as any).fixture.submits.length)).toBe(0);
    await click(page,"确认生成动作白模");
    await page.waitForSelector("[data-previs-preview-controls]");
    expect(await page.evaluate(()=>(window as any).fixture.submits[0].spec.timeMap.spans[1].rate)).toBe(.5);
    await click(page,"恢复常速");
    await settle(page);
    expect(await page.evaluate(()=>(window as any).fixture.block.previsStudio.spec.timeMap)).toBeUndefined();
    expect(await page.evaluate(()=>(window as any).fixture.submits.length)).toBe(1);
    expect(await page.$("[data-previs-preview-stale]")).not.toBeNull();
  } finally { await page.close(); }
});

it("快慢节奏恢复已保存区间与自定义速率，不自动生成", async () => {
  const page=await open();
  try {
    await page.evaluate(()=>{ const f=(window as any).fixture; f.setBlock((b:any)=>({...b,previsStudio:{...b.previsStudio,spec:{...b.previsStudio.spec,timeMap:{sourceDurationSec:b.previsStudio.spec.durationSec,spans:[{sourceStartSec:0,sourceEndSec:1,rate:1},{sourceStartSec:1,sourceEndSec:2,rate:.4},{sourceStartSec:2,sourceEndSec:b.previsStudio.spec.durationSec,rate:1}]}}}})); });
    await settle(page);
    expect(await page.$eval('[aria-label="慢动作起点"]',e=>(e as HTMLInputElement).value)).toBe('1');
    expect(await page.$eval('[aria-label="慢动作终点"]',e=>(e as HTMLInputElement).value)).toBe('2');
    expect(await page.$eval('[aria-label="重点动作速度"]',e=>(e as HTMLSelectElement).value)).toBe('0.4');
    expect(await page.evaluate(()=>(window as any).fixture.submits.length)).toBe(0);
  }finally{await page.close();}
});

it("空机位草稿保留站位编辑并提示补机位", async()=>{
 const page=await open();try{
 await page.evaluate(()=>{const f=(window as any).fixture;f.setBlock((b:any)=>({...b,previsStudio:{...b.previsStudio,spec:{...b.previsStudio.spec,cameras:[]}}}));});
 await settle(page);
 expect(await page.$eval('[data-previs-layout-preview]',e=>e.textContent)).toContain('尚未配置机位');
 expect(await page.$('[data-layout-actor]')).not.toBeNull();
 expect(await page.evaluate(()=>(window as any).fixture.submits.length)).toBe(0);
 }finally{await page.close();}
});

it("背负关系保存跟随路线，保存失败保留原稿，删除乘员清除关系且不生成", async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const f = (window as any).fixture;
      const block = structuredClone(f.block);
      const first = block.previsStudio.spec.actors[0];
      block.previsStudio.spec.actors = [first, { ...structuredClone(first), id: "carried-person", nameZh: "乘员", start: [1, 1], end: [2, 1] }];
      f.setBlock(block);
      f.rejectSave = true;
    });
    await settle(page);
    const pair = await page.evaluate(() => {
      const actors = (window as any).fixture.block.previsStudio.spec.actors;
      return JSON.stringify([actors[0].id, actors[1].id]);
    });
    await page.select('[aria-label="背负人物关系"]', pair);
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.block.previsStudio.spec.piggyback)).toBeUndefined();
    await page.evaluate(() => { (window as any).fixture.rejectSave = false; });
    await page.select('[aria-label="背负人物关系"]', pair);
    await settle(page);
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).fixture.block.previsStudio)));
    expect(saved.spec.piggyback.passengerId).toBe("carried-person");
    expect(saved.spec.actors[1].start).toEqual(saved.spec.actors[0].start);
    expect(saved.spec.actors[1].end).toEqual(saved.spec.actors[0].end);
    expect(saved.spec.actors[1].actions).toEqual([{ kind: "idle", startSec: 0, endSec: 10 }]);
    await page.click('[aria-label="中途滑落并托住"]');
    await settle(page);
    const withSlip = await page.evaluate(() => (window as any).fixture.block.previsStudio.spec.piggyback.slipCatch);
    expect(withSlip).toEqual({ slipStartSec: 1, catchSec: 1.6, recoverEndSec: 2.4, dropMeters: .12 });
    expect(await page.$('[aria-label="重新托住秒"]')).not.toBeNull();
    await page.click('[aria-label="中途滑落并托住"]');
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.block.previsStudio.spec.piggyback.slipCatch)).toBeUndefined();
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button")).filter(b => b.textContent?.trim() === "移除角色");
      buttons[1].click();
    });
    await settle(page);
    const result = await page.evaluate(() => ({
      pair: (window as any).fixture.block.previsStudio.spec.piggyback,
      submits: (window as any).fixture.submits.length,
      old: (window as any).fixture.block.manhuaSegmentRefs.previs.url,
    }));
    expect(result.pair).toBeUndefined();
    expect(result.submits).toBe(0);
    expect(result.old).toBe("https://offline.invalid/old.mp4");
  } finally { await page.close(); }
});

it("新增在场区间只在剩余时间足一帧时显示，并产生正时长", async () => {
  const page = await open();
  try {
    await click(page, "设置在场区间");
    await settle(page);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === "新增在场区间"))).toBe(false);
    const end = '[aria-label="角色1在场1结束秒"]';
    await page.click(end, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type("5");
    await settle(page);
    await click(page, "新增在场区间");
    await settle(page);
    expect(await page.evaluate(() => (window as any).fixture.block.previsStudio.spec.actors[0].visibleRanges)).toEqual([
      { startSec: 0, endSec: 5 }, { startSec: 5, endSec: 6 },
    ]);
    expect(await page.evaluate(() => (window as any).fixture.submits.length)).toBe(0);
  } finally { await page.close(); }
});
