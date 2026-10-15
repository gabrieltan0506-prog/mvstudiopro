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
          listManhuaBgmJobs:{fetch:async()=>[]}},canvasMusicMv:{getEdit:{fetch:async input=>JSON.parse(localStorage.getItem('saved-edit-'+input.revisionId))},getPlan:{fetch:async()=>({status:localStorage.getItem('plan-query-status')||'pending_or_unconfirmed'})}}};
        export const trpc={useUtils:()=>utils,mvAnalysis:{
          getVideoUploadSignedUrl:{useMutation:()=>({mutateAsync:async()=>{throw new Error("离线夹具不上传媒体");}})},
          getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:2,price:12,exempt:false},refetch:async()=>{}})},
          askPlatformSkillQa:{useMutation:()=>({mutateAsync:async input=>{f().record('advisor',input);if(input.manhuaContext.sunoSong){const t=input.manhuaContext.sunoSong;return {answer:JSON.stringify({kind:'suno_song_v1',sourceKey:t.sourceKey,evidenceId:'11111111-1111-4111-8111-111111111111',summaryZh:'按主题创作，未听音',sections:[],uncertaintiesZh:['尚未试听'],transferableCraft:['第二段推进故事'],concepts:[0,1,2].map(i=>({id:'song-'+i,rationaleZh:'符合重逢主题',differenceZh:'原创叙述',hookZh:'明天再见',lyricMethodZh:'物件写关系',mvDirectionZh:'红围巾贯穿车站与重逢',brief:{model:'suno-v6',custom_mode:true,instrumental:false,title:'重逢'+i,style:'acoustic pop, warm piano',prompt:'[Verse] 你把车票放回口袋 [Chorus] 明天再见',negative_tags:'',duration:180,style_weight:0,weirdness_constraint:0.35}}))})};}const t=input.manhuaContext.musicMv;const p=f().makePlan(t);p.analysisBasis='native_audio';p.shots=p.shots.map(s=>({...s,kind:'generated'}));return {answer:JSON.stringify({kind:'music_mv_v1',sourceKey:t.sourceKey,evidenceId:'11111111-1111-4111-8111-111111111111',summaryZh:'听音后的测试方案',sections:[{startSec:0,endSec:10,labelZh:'主段',heardZh:'人声弦乐'}],uncertaintiesZh:['离线测试不证明听音'],concepts:[0,1,2,3].map(i=>({id:'idea-'+i,titleZh:'归途'+i,rationaleZh:'情绪推进',openingZh:'林间',peakZh:'转身',endingZh:'远望',plan:p}))})};}})},
          queueManhuaBgm:{useMutation:()=>({mutateAsync:async input=>{f().record('music',input);if(f().musicError)throw f().musicError;return {jobId:'bgm_'+input.billingRequestId.replaceAll('-',''),status:'queued'};}})}},
          canvasMusicMv:{
          listSongCraftTemplates:{useQuery:()=>({data:{cards:[{id:'lin-inner-turn',title:'林夕 · 内心转折与克制留白',contributor:'林夕',basis:'interview',highlights:['内心转折'],sources:[]}],revision:'offline'},refetch:async()=>{}})},
          listCreativeLibrary:{useQuery:()=>({data:[],refetch:async()=>{}})},
          saveCreativeLibrary:{useMutation:()=>({mutateAsync:async()=>({})})},
          queueSongCover:{useMutation:()=>({mutateAsync:async()=>({jobId:'cover-offline',status:'queued'})})},
          saveEdit:{useMutation:()=>({mutateAsync:async input=>{f().record('saveEdit',input);const receipt={...input,sha256:'test-hash',createdAt:'2026-10-15T21:00:00+08:00'};localStorage.setItem('saved-edit-'+input.revisionId,JSON.stringify(receipt));return receipt;}})},
          adoptConcept:{useMutation:()=>({mutateAsync:async input=>{f().record('adopt',input);const a=f().state.advisor;const c=a.proposal.concepts.find(c=>c.id===input.conceptId);return {requestId:input.requestId,plan:c.plan,input:{requestId:input.requestId,audio:a.target.audio,lyrics:a.target.lyrics,creativePrompt:a.target.creativePrompt,referenceSummaries:a.target.referenceSummaries,advisorEvidenceId:input.evidenceId}};}})},
          draftPlan:{useMutation:()=>({mutateAsync:async input=>{f().record('plan',input);if(f().planError)throw new Error(f().planError);return {plan:f().makePlan(input)};}})}},
          canvasMusicMvAssemble:{queue:{useMutation:()=>({mutateAsync:async input=>{f().record('assemble',input);return {jobId:'assemble-fictional'};}})}}};
      `
                : args.path === "omniCanvasApi"
                  ? `export async function resolveCanvasMaterialUrl(uri){return uri.startsWith('gs://')?'https://test.invalid/'+encodeURIComponent(uri):uri;}`
                  : `export async function getJob(){return {status:"running"};} export async function pollJobUntilTerminal(jobId,opts){globalThis.fixture.record('poll',jobId);if(globalThis.fixture.assembleError)throw new Error('unknown network');const status=globalThis.fixture.assembleStatus||'succeeded';opts?.onPoll?.({status});return {status,output:{finalVideoUrl:'https://test.invalid/final.mp4'}};}`,
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
        Array.from(document.querySelectorAll('[role="alert"]')).some(el =>
          el.textContent?.includes("尚未出片")
        )
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

it("MV顾问四方案采用与刷新恢复，不触发视频生成", async () => {
  const { context, page, click, reload } = await open();
  try {
    await click("生成音乐");
    await page.waitForFunction(
      () => (window as any).fixture.state.candidates.length === 2
    );
    await click("采用 虚构音乐 · 版本 1");
    await click("听歌并构思MV");
    await page.waitForFunction(
      () => (window as any).fixture.state.advisor?.status === "succeeded"
    );
    expect(
      await page.$$eval(
        '[aria-label="MV创作顾问"] article',
        rows => rows.length
      )
    ).toBe(4);
    await click("采用并铺到自由画布");
    await page.waitForFunction(() => (window as any).fixture.adds.length === 1);
    const before = await page.evaluate(() => ({
      calls: (window as any).fixture.calls,
      ids: (window as any).fixture.state.shotBlockIds,
    }));
    expect(before.ids).toHaveLength(2);
    expect(before.calls.filter((c: any) => c.kind === "advisor")).toHaveLength(
      1
    );
    expect(before.calls.filter((c: any) => c.kind === "shot")).toHaveLength(0);
    await reload();
    expect(
      await page.evaluate(() => (window as any).fixture.state.shotBlockIds)
    ).toEqual(before.ids);
    expect(
      await page.evaluate(
        () => (window as any).fixture.state.advisor.proposal.concepts.length
      )
    ).toBe(4);
  } finally {
    await context.close();
  }
}, 30000);

describe("歌曲创作与可保存剪辑新入口", () => {
  it("主题创作→采用歌词/风格/MV方向→刷新恢复，不自动生成歌曲", async () => {
    const { context, page, click, reload } = await open();
    try {
      await page.evaluate(() => {
        const d = Array.from(document.querySelectorAll("details")).find(e =>
          e.querySelector("summary")?.textContent?.includes("创意生成库")
        );
        if (d) d.open = true;
      });
      await page.click('[aria-label="选择林夕 · 内心转折与克制留白"]');
      await page.type(
        '[aria-label="新歌创作要求"]',
        "毕业后在车站重逢，克制但温暖"
      );
      await click("按主题创作新歌方案");
      await page.waitForFunction(
        () => !!(window as any).fixture.state.songAdvisor?.proposal
      );
      await click("采用到Suno创作表单");
      await page.waitForFunction(
        () => (window as any).fixture.state.songTitle === "重逢0"
      );
      await reload();
      const saved = await page.evaluate(() => {
        const f = (window as any).fixture;
        return { state: f.state, prompt: f.current[0].prompt, calls: f.calls };
      });
      expect(saved.state.lyrics).toContain("车票");
      expect(saved.prompt).toContain("warm piano");
      expect(saved.state.creativePrompt).toContain("红围巾");
      expect(saved.state.songStyleWeight).toBe(0);
      expect(saved.state.songCraftIds).toEqual(["lin-inner-turn"]);
      expect(saved.calls.filter((c: any) => c.kind === "music")).toHaveLength(
        0
      );
      expect(
        saved.calls.find((c: any) => c.kind === "advisor").input.manhuaContext
          .sunoSong.audio
      ).toBeUndefined();
    } finally {
      await context.close();
    }
  }, 30000);
  it("拖拽排序→手动裁点→保存→刷新恢复→恢复旧版，保留原节点", async () => {
    const { context, page, click, reload } = await open();
    try {
      await click("生成音乐");
      await page.waitForFunction(
        () => (window as any).fixture.state.candidates.length === 2
      );
      await click("采用 虚构音乐 · 版本 1");
      await click("生成 MV 分镜");
      await page.waitForFunction(() => !!(window as any).fixture.state.plan);
      await click("确认分镜并铺到画布");
      await page.waitForSelector('[aria-label="MV时间轴剪辑"]');
      await click("保存剪辑版本");
      await page.waitForFunction(
        () => !!(window as any).fixture.state.timelineEdits?.[0]?.saved
      );
      const original = await page.evaluate(() =>
        (window as any).fixture.state.timelineEdits[0].draft.clips.map(
          (c: any) => c.id
        )
      );
      await page.evaluate(() => {
        const clips = Array.from(
          document.querySelectorAll('[data-testid^="mv-clip-"]')
        );
        const dt = new DataTransfer();
        clips[0].dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, dataTransfer: dt })
        );
        clips[1].dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: dt })
        );
      });
      await page.waitForFunction(
        id =>
          (window as any).fixture.state.timelineEdits[0].draft.clips[0].id !==
          id,
        {},
        original[0]
      );
      await page.click('[data-testid^="mv-clip-"]');
      await page.addStyleTag({
        content:
          "[role=slider]{display:inline-block;width:8px;height:64px;touch-action:none;}",
      });
      const handle = await page.$(
        '[data-testid^="mv-clip-"] [aria-label$="出点拖柄"]'
      );
      const bounds = await handle!.boundingBox();
      await page.mouse.move(bounds!.x + 4, bounds!.y + 20);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + 28, bounds!.y + 20);
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          (window as any).fixture.state.timelineEdits[0].draft.clips[0]
            .durationFrames === 180
      );
      await page.$eval('[aria-label="源入点"]', (el: any) => {
        el.value = "1";
        el.focus();
        el.blur();
      });
      await page.waitForFunction(
        () =>
          (window as any).fixture.state.timelineEdits[0].draft.clips[0]
            .sourceInFrame === 30
      );
      await click("保存剪辑版本");
      await page.waitForFunction(
        () =>
          (window as any).fixture.state.timelineEdits[0].versions.length === 2
      );
      await reload();
      const state = await page.evaluate(() => ({
        edit: (window as any).fixture.state.timelineEdits[0],
        nodes: (window as any).fixture.current.length,
      }));
      expect(state.edit.draft.clips[0].id).toBe(original[1]);
      expect(state.edit.draft.clips[0].sourceInFrame).toBe(30);
      expect(state.nodes).toBe(3);
      expect(await page.$('[aria-label="源入点"]')).not.toBeNull();
      await page.evaluate(() => {
        const d = Array.from(document.querySelectorAll("details")).find(e =>
          e.querySelector("summary")?.textContent?.includes("保存的版本")
        );
        if (d) d.open = true;
      });
      await click("恢复 2026-10-15");
      await page.waitForFunction(
        id =>
          (window as any).fixture.state.timelineEdits[0].draft.clips[0].id ===
          id,
        {},
        original[0]
      );
      expect(
        await page.evaluate(
          () => (window as any).fixture.state.timelineEdits[0].versions.length
        )
      ).toBe(2);
    } finally {
      await context.close();
    }
  }, 30000);
});
