import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

/**
 * useCanvasVideoTools 真实挂载（离线夹具）：trpc 全部打桩（后期任务状态由夹具给、入队只记参数），页面请求一律 200 空响应，不触发任何付费调用。
 * 验证抽成 hook 后的接线：挂载即接管块上的在途任务（刷新恢复）→ 完成加新版本且原片保留 / 失败清追踪；
 * 「提交中」先记、回执到后补全；顾问 videoEdit 登记口挂载登记、卸载注销。
 */
it("useCanvasVideoTools：挂载接管在途任务、完成加新版本、失败清追踪、提交中补全、顾问登记随挂载/卸载", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useCanvasVideoTools, canvasBlockHasVideoTools} from './client/src/components/canvas/useCanvasVideoTools';
    import {buildVideoToolJob} from './client/src/lib/videoToolJobs';
    const original='https://storage.googleapis.com/mv-bucket/canvas/7/clip-original.mp4?X-Goog-Signature=first';
    const video=(id,jobs)=>({id,kind:'video',x:0,y:0,width:320,height:240,prompt:'',status:'done',videoModel:'seedance-2.5',outputUrl:original,outputUrls:[original],videoToolJobs:jobs});
    const job=(kind,jobId)=>buildVideoToolJob({kind,jobId,requestId:'44444444-4444-4444-8444-444444444444',sourceUrl:original});
    globalThis.store={blocks:[video('clip-ok',[job('grade','grade-job-ok')]),video('clip-bad',[job('grade','grade-job-bad')]),video('clip-idle',undefined)]};
    globalThis.registered=[];globalThis.fetched=[];globalThis.byRequest=[];globalThis.hasTools=canvasBlockHasVideoTools(globalThis.store.blocks[0]);
    function Host(){
      const [blocks,setBlocks]=React.useState(globalThis.store.blocks);
      const blocksRef=React.useRef(blocks);blocksRef.current=blocks;globalThis.store.blocks=blocks;
      const onBlocksChangeRef=React.useRef(setBlocks);
      const register=React.useCallback(c=>{globalThis.registered.push(c===null?null:typeof c);},[]);
      const tools=useCanvasVideoTools({blocks,blocksRef,onBlocksChangeRef,onAdvisorVideoEditControl:register,blockLabel:b=>'节点'+b.id});
      globalThis.tools=tools;
      return <div data-testid='host' data-edit-open={tools.editPanelBlockId||''}/>;
    }
    const root=createRoot(document.getElementById('root'));root.render(<Host/>);globalThis.unmount=()=>root.unmount();
  `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [
      {
        name: "offline",
        setup(b) {
          b.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({ path: "trpc", namespace: "offline" }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: `
      const notFound=()=>Object.assign(new Error('not found'),{data:{code:'NOT_FOUND'}});
      const jobs={'grade-job-ok':{status:'succeeded',output:{url:'https://storage.googleapis.com/mv-bucket/post-prod/7/graded.mp4?X-Goog-Signature=g1'}},'grade-job-bad':{status:'failed',error:'调色失败'}};
      const utils={mvAnalysis:{
        getPostProdJob:{fetch:async({jobId})=>{globalThis.fetched.push(jobId);return jobs[jobId]||{status:'running'};}},
        findVideoPartialEditJob:{fetch:async({requestId})=>{globalThis.byRequest.push(requestId);throw notFound();}},
      }};
      export const trpc={useUtils:()=>utils,mvAnalysis:{queuePostProd:{useMutation:()=>({mutateAsync:async()=>({jobId:'never'})})},
        quoteVideoPartialEdit:{useQuery:()=>({data:undefined})},queueVideoPartialEdit:{useMutation:()=>({mutateAsync:async()=>({})})},getPostProdJob:{useQuery:()=>({data:undefined})}}};
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
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r => r.respond({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('[data-testid="host"]');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = (id: string) => page.evaluate(id => (globalThis as any).store.blocks.find((b: any) => b.id === id), id);
    expect(await page.evaluate(() => (globalThis as any).hasTools)).toBe(true);

    // 挂载即登记顾问 videoEdit 控件
    expect(await page.evaluate(() => (globalThis as any).registered)).toEqual(["function"]);

    // 挂载即接管块上的在途调色：成功 → 新版本在前、原片保留、追踪清掉；失败 → 只清追踪，成片不动
    await page.waitForFunction(() => {
      const bs = (globalThis as any).store.blocks;
      return !bs[0].videoToolJobs && !bs[1].videoToolJobs;
    });
    const ok = await block("clip-ok");
    expect(ok.outputUrl).toContain("/post-prod/7/graded.mp4");
    expect(ok.outputUrls).toHaveLength(2);
    expect(ok.outputUrls[1]).toContain("/canvas/7/clip-original.mp4");
    const bad = await block("clip-bad");
    expect(bad.outputUrl).toContain("/canvas/7/clip-original.mp4");
    expect(bad.outputUrls).toHaveLength(1);
    expect(await page.evaluate(() => [...new Set((globalThis as any).fetched)].sort())).toEqual(["grade-job-bad", "grade-job-ok"]);

    // 局部修改「提交中」先记到块上；面板回执到后补全为已入队（同一 requestId 不重复）
    const REQ = "66666666-6666-4666-8666-666666666666";
    const EDIT_JOB = `vpe_${"b".repeat(48)}`;
    await page.evaluate(
      (REQ, src) => (globalThis as any).tools.trackVideoEditSubmitting("clip-idle", src, { requestId: REQ, startSec: 2, endSec: 8, phase: "sending" }),
      REQ,
      (await block("clip-idle")).outputUrl
    );
    await page.waitForFunction(() => (globalThis as any).store.blocks[2].videoToolJobs?.length === 1);
    expect((await block("clip-idle")).videoToolJobs[0]).toMatchObject({ kind: "edit", requestId: REQ, range: { startSec: 2, endSec: 8 } });
    expect((await block("clip-idle")).videoToolJobs[0].jobId).toBeFalsy();
    await page.evaluate(
      (REQ, EDIT_JOB) => {
        const g = globalThis as any;
        const src = g.store.blocks[2].outputUrl;
        // 与 FreeformCanvas 的 onSubmitted 同一写法
        g.tools.trackVideoToolJob("clip-idle", { kind: "edit", jobId: EDIT_JOB, requestId: REQ, startedAt: new Date().toISOString(), sourceUrl: src, range: { startSec: 2, endSec: 8 } });
      },
      REQ,
      EDIT_JOB
    );
    await page.waitForFunction(EDIT_JOB => (globalThis as any).store.blocks[2].videoToolJobs?.some((j: any) => j.jobId === EDIT_JOB), {}, EDIT_JOB);
    expect((await block("clip-idle")).videoToolJobs).toHaveLength(1);

    // 面板 onDone：新版本加入、原片保留、追踪清掉
    await page.evaluate(EDIT_JOB => {
      const g = globalThis as any;
      g.tools.applyVideoEditForBlock("clip-idle", g.store.blocks[2].outputUrl, { jobId: EDIT_JOB, url: "https://storage.googleapis.com/mv-bucket/post-prod/7/vpe-out.mp4?X-Goog-Signature=e1" });
    }, EDIT_JOB);
    await page.waitForFunction(() => !(globalThis as any).store.blocks[2].videoToolJobs);
    const idle = await block("clip-idle");
    expect(idle.outputUrl).toContain("/post-prod/7/vpe-out.mp4");
    expect(idle.outputUrls).toHaveLength(2);

    // 卸载即注销顾问控件
    await page.evaluate(() => (globalThis as any).unmount());
    expect(await page.evaluate(() => (globalThis as any).registered)).toEqual(["function", null]);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
