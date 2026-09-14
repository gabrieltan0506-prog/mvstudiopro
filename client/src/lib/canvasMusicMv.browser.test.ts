/** 独立无头浏览器离线视图，所有请求均为虚构回执，不操作用户浏览器。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CanvasMusicMvStudio} from './client/src/components/canvas/CanvasMusicMvStudio';
      import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
      const saved=JSON.parse(localStorage.getItem('offline-board')||'null');
      const initial={...defaultCanvasBlock('music',0,0),id:'music-root',prompt:'中国风叙事音乐，温暖弦乐',musicMv:{status:'idle',candidates:[],requestedDurationSec:10}};
      const f=globalThis.fixture={current:saved||[initial],calls:JSON.parse(localStorage.getItem('offline-calls')||'[]'),musicReady:true,queries:[],adds:[]};
      f.record=(kind,input)=>{f.calls.push({kind,input});localStorage.setItem('offline-calls',JSON.stringify(f.calls));};
      f.makePlan=input=>({version:1,audioId:input.audio.id,audioDurationSec:input.audio.durationSec,analysisBasis:'lyrics_and_user_description',shots:[
        {id:'shot-a',startSec:0,endSec:5,visualPrompt:'主角站在林间',cameraPrompt:'缓慢推进',lyricQuote:input.lyrics?'夜雨落在旧城墙':'',referenceIndices:[]},
        {id:'shot-b',startSec:5,endSec:10,visualPrompt:'主角转身看向远处',cameraPrompt:'轻微横移',lyricQuote:'',referenceIndices:[]}]});
      function App(){
        const [blocks,setBlocks]=useState(f.current);
        const update=next=>{f.current=next;localStorage.setItem('offline-board',JSON.stringify(next));setBlocks(next);};
        f.update=update;f.state=blocks[0].musicMv;
        const onPatch=patch=>update(f.current.map((b,i)=>i===0?{...b,...patch}:b));
        const onAdd=(added,edges)=>{f.adds.push({ids:added.map(b=>b.id),edges});update([...f.current.filter(b=>!added.some(a=>a.id===b.id)),...added]);};
        const runShot=async id=>{f.record('shot',id);update(f.current.map(b=>b.id===id?{...b,status:'done',outputUrl:'https://test.invalid/'+id+'.mp4'}:b));return true;};
        return <CanvasMusicMvStudio block={blocks[0]} blocks={blocks} onPatch={onPatch} onAdd={onAdd} runShot={runShot} getBlocks={()=>f.current}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
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
        name: "离线音乐服务",
        setup(builder) {
          builder.onResolve(
            { filter: /^@\/lib\/(trpc|omniCanvasApi|jobs)$/ },
            args => ({
              path: args.path.split("/").at(-1)!,
              namespace: "offline",
            })
          );
          builder.onLoad({ filter: /.*/, namespace: "offline" }, args => ({
            loader: "js",
            contents:
              args.path === "trpc"
                ? `
        const f=()=>globalThis.fixture;
        const utils={mvAnalysis:{
          getManhuaBgmJob:{fetch:async({jobId})=>{f().queries.push(jobId);if(f().musicError)throw new Error('missing job');return {jobId,status:f().musicReady?'succeeded':'running',titleZh:'虚构音乐',durationSec:10,missingVariants:f().missingVariants||0,variants:f().musicReady?(f().missingVariants?[0]:[0,1]).map(index=>({index,gcsUri:'gs://test-bucket/post-prod/7/candidate-'+index+'.mp3',durationSec:10,bytes:1000})):[]};}},
          listManhuaBgmJobs:{fetch:async()=>[]}},canvasMusicMv:{getPlan:{fetch:async()=>({status:localStorage.getItem('plan-query-status')||'pending_or_unconfirmed'})}}};
        export const trpc={useUtils:()=>utils,mvAnalysis:{queueManhuaBgm:{useMutation:()=>({mutateAsync:async input=>{f().record('music',input);if(f().musicError)throw f().musicError;return {jobId:'bgm_'+input.billingRequestId.replaceAll('-',''),status:'queued'};}})}},
          canvasMusicMv:{draftPlan:{useMutation:()=>({mutateAsync:async input=>{f().record('plan',input);if(f().planError)throw new Error(f().planError);return {plan:f().makePlan(input)};}})}},
          canvasMusicMvAssemble:{queue:{useMutation:()=>({mutateAsync:async input=>{f().record('assemble',input);return {jobId:'assemble-fictional'};}})}}};
      `
                : args.path === "omniCanvasApi"
                  ? `export async function resolveCanvasMaterialUrl(uri){return uri.startsWith('gs://')?'https://test.invalid/'+encodeURIComponent(uri):uri;}`
                  : `export async function pollJobUntilTerminal(jobId,opts){globalThis.fixture.record('poll',jobId);if(globalThis.fixture.assembleError)throw new Error('unknown network');const status=globalThis.fixture.assembleStatus||'succeeded';opts?.onPoll?.({status});return {status,output:{finalVideoUrl:'https://test.invalid/final.mp4'}};}`,
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

async function open() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.isNavigationRequest())
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>',
      });
    else void request.abort();
  });
  const mount = async () => {
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[role="status"]');
  };
  await page.goto("http://localhost:41812");
  await mount();
  const click = async (text: string) => {
    await page.waitForFunction(
      t =>
        Array.from(document.querySelectorAll("button")).some(
          b => b.textContent?.includes(t) && !b.disabled
        ),
      {},
      text
    );
    await page.evaluate(t => {
      const el = Array.from(document.querySelectorAll("button")).find(b =>
        b.textContent?.includes(t)
      );
      if (!el || el.disabled) throw Error("按钮不可用：" + t);
      el.click();
    }, text);
  };
  const reload = async () => {
    await page.reload();
    await mount();
  };
  return { context, page, click, reload };
}

describe("独立音乐MV真实视图（虚构任务边界）", () => {
  it("两版音乐→选版→两镜分镜→缺镜拒合成→真实铺节点与逐镜执行→最终节点回写", async () => {
    const { context, page, click, reload } = await open();
    try {
      await click("生成音乐");
      await page.waitForFunction(
        () => (window as any).fixture.state.candidates.length === 2
      );
      expect(await page.$$eval("audio", rows => rows.length)).toBe(2);
      await click("采用 虚构音乐 · 版本 2");
      await click("生成 MV 分镜");
      await page.waitForFunction(
        () => (window as any).fixture.state.plan?.shots.length === 2
      );
      await click("确认分镜并铺到画布");
      await page.waitForFunction(
        () => (window as any).fixture.state.shotBlockIds?.length === 2
      );
      await click("合成完整 MV");
      await page.waitForFunction(() =>
        document
          .querySelector('[role="alert"]')
          ?.textContent?.includes("尚未出片")
      );
      expect(
        await page.evaluate(() =>
          (window as any).fixture.calls.filter(
            (c: any) => c.kind === "assemble"
          )
        )
      ).toHaveLength(0);
      await click("生成缺失镜头");
      await page.waitForFunction(() =>
        (window as any).fixture.current
          .slice(1)
          .every((b: any) => b.status === "done")
      );
      await click("生成缺失镜头");
      await page.waitForFunction(
        () => (window as any).fixture.state.status === "planned"
      );
      expect(
        await page.evaluate(() =>
          (window as any).fixture.calls.filter((c: any) => c.kind === "shot")
        )
      ).toHaveLength(2);
      await click("合成完整 MV");
      await page.waitForFunction(
        () => (window as any).fixture.state.status === "done"
      );
      const result = await page.evaluate(() => {
        const f = (window as any).fixture;
        return {
          state: f.state,
          final: f.current.find((b: any) => b.id === f.state.finalBlockId),
          calls: f.calls,
        };
      });
      expect(result.calls.map((c: any) => c.kind)).toEqual([
        "music",
        "plan",
        "shot",
        "shot",
        "assemble",
        "poll",
      ]);
      expect(result.state.selectedCandidateId).toMatch(/:1$/);
      expect(result.final).toMatchObject({
        status: "done",
        outputUrl: "https://test.invalid/final.mp4",
      });
      expect(
        result.calls
          .filter((c: any) => c.kind === "assemble")[0]
          .input.clips.map((c: any) => c.shotId)
      ).toEqual(["shot-a", "shot-b"]);
      await reload();
      await page.waitForFunction(
        () => (window as any).fixture.state.status === "done"
      );
      expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual(
        result.calls
      );
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.update(
          f.current.map((b: any) =>
            b.id === f.state.shotBlockIds[0]
              ? {
                  ...b,
                  outputUrl: "https://test.invalid/new-selected-shot.mp4",
                }
              : b
          )
        );
      });
      await click("合成新版本");
      await page.waitForFunction(
        () => (window as any).fixture.state.status === "done"
      );
      const newer = await page.evaluate(() => {
        const f = (window as any).fixture;
        return {
          calls: f.calls.filter((c: any) => c.kind === "assemble"),
          state: f.state,
          finals: f.current.filter((b: any) => b.id.startsWith("mvfinal-")),
        };
      });
      expect(newer.calls).toHaveLength(2);
      expect(newer.calls[1].input.requestId).not.toBe(
        newer.calls[0].input.requestId
      );
      expect(newer.calls[1].input.clips[0].url).toBe(
        "https://test.invalid/new-selected-shot.mp4"
      );
      expect(newer.state.assembleHistory[0].requestId).toBe(
        newer.calls[0].input.requestId
      );
      expect(newer.finals).toHaveLength(2);
      await page.evaluate(() => {
        (window as any).fixture.assembleStatus = "failed";
      });
      await click("合成新版本");
      await page.waitForFunction(
        () => (window as any).fixture.state.assembleTerminalStatus === "failed"
      );
      await page.evaluate(() => {
        (window as any).fixture.assembleStatus = "succeeded";
      });
      await click("合成新版本");
      await page.waitForFunction(
        () => (window as any).fixture.state.status === "done"
      );
      expect(
        await page.evaluate(() =>
          (window as any).fixture.state.assembleHistory.map(
            (h: any) => h.status
          )
        )
      ).toEqual(["succeeded", "succeeded", "failed"]);
      await page.evaluate(() => {
        (window as any).fixture.assembleError = true;
      });
      await click("合成新版本");
      await page.waitForFunction(() => !!(window as any).fixture.state.error);
      expect(
        await page.$$eval("button", buttons =>
          buttons.some(b => b.textContent?.includes("合成新版本"))
        )
      ).toBe(false);
      const beforeQuery = await page.evaluate(
        () =>
          (window as any).fixture.calls.filter(
            (c: any) => c.kind === "assemble"
          ).length
      );
      await click("查询／恢复原合成");
      await page.waitForFunction(() => !!(window as any).fixture.state.error);
      expect(
        await page.evaluate(
          () =>
            (window as any).fixture.calls.filter(
              (c: any) => c.kind === "assemble"
            ).length
        )
      ).toBe(beforeQuery);
    } finally {
      await context.close();
    }
  }, 30_000);

  it("刷新恢复音乐原任务只查询，不重新提交音乐；已成功镜头不重新制作", async () => {
    const { context, page, click, reload } = await open();
    try {
      await page.evaluate(() => {
        (window as any).fixture.musicReady = false;
      });
      await click("生成音乐");
      await page.waitForFunction(
        () => (window as any).fixture.state.musicJobStatus === "running"
      );
      const jobId = await page.evaluate(
        () => (window as any).fixture.state.musicJobId
      );
      await reload();
      await page.waitForFunction(
        () => (window as any).fixture.state.candidates.length === 2
      );
      expect(
        await page.evaluate(() => (window as any).fixture.queries)
      ).toContain(jobId);
      expect(
        await page.evaluate(() =>
          (window as any).fixture.calls.filter((c: any) => c.kind === "music")
        )
      ).toHaveLength(1);
      await click("采用 虚构音乐 · 版本 1");
      await click("生成 MV 分镜");
      await page.waitForFunction(() => !!(window as any).fixture.state.plan);
      await click("确认分镜并铺到画布");
      await page.waitForFunction(
        () => (window as any).fixture.state.shotBlockIds?.length === 2
      );
      await page.evaluate(() => {
        const f = (window as any).fixture;
        const id = f.state.shotBlockIds[0];
        f.update(
          f.current.map((b: any) =>
            b.id === id
              ? {
                  ...b,
                  status: "done",
                  outputUrl: "https://test.invalid/existing.mp4",
                }
              : b
          )
        );
      });
      await reload();
      await click("生成缺失镜头");
      await page.waitForFunction(() =>
        (window as any).fixture.current
          .slice(1)
          .every((b: any) => b.status === "done")
      );
      const calls = await page.evaluate(() => (window as any).fixture.calls);
      expect(calls.filter((c: any) => c.kind === "shot")).toHaveLength(1);
      expect(calls.filter((c: any) => c.kind === "music")).toHaveLength(1);
      expect(calls.filter((c: any) => c.kind === "plan")).toHaveLength(1);
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe("音乐 MV 拒绝与参考恢复真实视图", () => {
  it("明确建单拒绝后允许重新提交；未知网络错误保留原编号", async () => {
    const { context, page, click } = await open();
    try {
      await page.evaluate(() => {
        (window as any).fixture.musicError = {
          data: { code: "PRECONDITION_FAILED" },
        };
      });
      await click("生成音乐");
      await page.waitForFunction(
        () =>
          !(window as any).fixture.state.musicRequestId &&
          (window as any).fixture.calls.some((x: any) => x.kind === "music")
      );
      expect(
        await page.evaluate(() => (window as any).fixture.state.musicJobId)
      ).toBeUndefined();
      await page.evaluate(() => {
        (window as any).fixture.musicError = { message: "network interrupted" };
      });
      await click("生成音乐");
      await page.waitForFunction(() =>
        Boolean((window as any).fixture.state.musicRequestId)
      );
      expect(
        await page.evaluate(() => (window as any).fixture.state.musicJobStatus)
      ).toBe("queued");
      expect(
        await page.evaluate(
          () =>
            Array.from(document.querySelectorAll("button")).find(b =>
              b.textContent?.includes("生成音乐")
            )?.disabled
        )
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            (window as any).fixture.calls.filter((x: any) => x.kind === "music")
              .length
        )
      ).toBe(2);
    } finally {
      await context.close();
    }
  }, 15000);
  it("云恢复保留持久参考，删除末张或显式移除正确清空", async () => {
    const { context, page, click, reload } = await open();
    try {
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.update(
          f.current.map((b: any, i: number) =>
            i === 0
              ? {
                  ...b,
                  musicMv: {
                    ...b.musicMv,
                    referenceImages: [
                      {
                        id: "portrait",
                        url: "https://test.invalid/person.png",
                        fileName: "人物",
                      },
                    ],
                  },
                }
              : b
          )
        );
      });
      await reload();
      await page.waitForFunction(
        () => (window as any).fixture.state.referenceImages?.length === 1
      );
      await click("移除全部参考图");
      await page.waitForFunction(
        () => (window as any).fixture.state.referenceImages?.length === 0
      );
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.update(
          f.current.map((b: any, i: number) =>
            i === 0
              ? {
                  ...b,
                  uploadedAssets: [
                    {
                      kind: "image",
                      id: "new-photo",
                      url: "https://test.invalid/new.png",
                      fileName: "新参考",
                    },
                  ],
                }
              : b
          )
        );
      });
      await page.waitForFunction(
        () => (window as any).fixture.state.referenceImages?.length === 1
      );
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.update(
          f.current.map((b: any, i: number) =>
            i === 0 ? { ...b, uploadedAssets: [] } : b
          )
        );
      });
      await page.waitForFunction(
        () => (window as any).fixture.state.referenceImages?.length === 0
      );
    } finally {
      await context.close();
    }
  }, 15000);
});

it("缺失候选提示持久显示，不隐式重发补单", async () => {
  const { context, page, click, reload } = await open();
  try {
    await page.evaluate(() => {
      (window as any).fixture.missingVariants = 1;
    });
    await click("生成音乐");
    await page.waitForFunction(
      () => (window as any).fixture.state.missingVariants === 1
    );
    expect(await page.$eval("body", e => e.textContent)).toContain(
      "不自动补单"
    );
    await reload();
    await page.waitForFunction(
      () => (window as any).fixture.state.missingVariants === 1
    );
    expect(
      await page.evaluate(
        () =>
          (window as any).fixture.calls.filter((x: any) => x.kind === "music")
            .length
      )
    ).toBe(1);
  } finally {
    await context.close();
  }
}, 15000);

it("分镜网络未知不允许新轮，服务器确认失败后保留原输入并显式开始新轮", async () => {
  const { context, page, click, reload } = await open();
  try {
    await click("生成音乐");
    await page.waitForFunction(
      () => (window as any).fixture.state.candidates.length === 2
    );
    await click("采用 虚构音乐 · 版本 1");
    await page.evaluate(() => {
      (window as any).fixture.planError = "unknown network";
    });
    await click("生成 MV 分镜");
    await page.waitForFunction(() => !!(window as any).fixture.state.error);
    expect(
      await page.$$eval("button", buttons =>
        buttons.some(b => b.textContent?.includes("原请求已失败"))
      )
    ).toBe(false);
    const original = await page.evaluate(
      () => (window as any).fixture.state.planRequestId
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.update(
        f.current.map((b: any, index: number) =>
          index === 0 ? { ...b, prompt: "外层或云同步改成新创意" } : b
        )
      );
    });
    await page.waitForFunction(
      () =>
        (window as any).fixture.current[0].prompt === "外层或云同步改成新创意"
    );
    expect(
      await page.evaluate(() => (window as any).fixture.state.planRequestId)
    ).toBe(original);
    expect(
      await page.evaluate(
        () => (window as any).fixture.state.planInput.creativePrompt
      )
    ).toBe("中国风叙事音乐，温暖弦乐");
    await reload();
    expect(
      await page.$$eval("button", buttons =>
        buttons.some(b => b.textContent?.includes("原请求已失败"))
      )
    ).toBe(false);
    await page.evaluate(() =>
      localStorage.setItem("plan-query-status", "failed")
    );
    await reload();
    await click("原请求已失败，准备新一轮分镜");
    expect(
      await page.evaluate(
        () => (window as any).fixture.state.planHistory[0].requestId
      )
    ).toBe(original);
    await page.evaluate(() => localStorage.removeItem("plan-query-status"));
    await click("生成 MV 分镜");
    await page.waitForFunction(() => !!(window as any).fixture.state.plan);
    expect(
      await page.evaluate(() => (window as any).fixture.state.planRequestId)
    ).not.toBe(original);
  } finally {
    await context.close();
  }
}, 30_000);
