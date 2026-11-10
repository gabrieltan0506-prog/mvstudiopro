import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

/**
 * 离线夹具：挂 VideoEditPanel，trpc 全部打桩（报价按 ceil(秒/2)×30 本地假算、入队只记参数、任务状态由夹具给），
 * 页面请求一律 200 空响应，不触发任何付费调用。
 */
it("VideoEditPanel：区间与扩展提示、报价、确认后才提交、提交参数、完成后前后对比、无引擎名", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoEditPanel} from './client/src/components/canvas/VideoEditPanel';
    globalThis.React=React;globalThis.queued=[];globalThis.quotes=[];globalThis.done=[];globalThis.submitted=[];
    createRoot(document.getElementById('root')).render(
      <VideoEditPanel source='gs://test-only/post-prod/7/a.mp4' previewUrl='https://cdn.test/a.mp4' durationSec={20}
        referenceImages={[{url:'gs://test-only/bg.png',label:'场景底图'},{url:'gs://test-only/p.png',label:'人物'}]}
        debugMode={false} onDone={r=>globalThis.done.push(r)} onSubmitted={j=>globalThis.submitted.push(j)}/>);
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
      const quote={useQuery:(input,opts)=>{
        if(!opts.enabled) return {data:undefined};
        globalThis.quotes.push(input);
        const seg=Math.max(4,Math.round((input.endSec-input.startSec)*10)/10);
        const s=input.startSec, e=Math.max(input.endSec, Math.round((s+4)*10)/10);
        return {data:{sourceDurationSec:20,startSec:s,endSec:e,segmentSec:seg,expanded:seg>input.endSec-input.startSec,credits:Math.ceil(seg/2)*30,waived:false,creditsPerTwoSec:30,minSec:4,maxSec:30,confirmNotice:'提交后不可取消；失败或未通过审核将全额退回积分。'}};
      }};
      // 入队回执按服务端规则带实际区间：不足 4 秒以选段中心向两侧扩到 4 秒（报价桩是简化版，区间故意不同，以证明取的是回执）
      const tenth=n=>Math.round(n*10)/10;
      const queue={useMutation:()=>({mutateAsync:async input=>{globalThis.queued.push(input);
        let s=input.startSec,e=input.endSec;const len=tenth(e-s);
        if(len<4){s=tenth(s-(4-len)/2);e=tenth(s+4);if(s<0){s=0;e=4;}if(e>20){e=20;s=16;}}
        return {jobId:'job-ve-1',status:'queued',credits:input.expectedCredits,startSec:s,endSec:e,segmentSec:tenth(e-s),expanded:len<4};}})};
      const job={useQuery:(input,opts)=>{
        const React=globalThis.React;const [,force]=React.useState(0);
        React.useEffect(()=>{globalThis.bump=()=>force(x=>x+1);},[]);
        return {data:opts.enabled?globalThis.jobData:undefined};
      }};
      export const trpc={mvAnalysis:{quoteVideoPartialEdit:quote,queueVideoPartialEdit:queue,getPostProdJob:job}};
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
    await page.waitForSelector('[data-testid="video-edit-panel"]');
    const submitted = () => page.evaluate(() => (globalThis as any).submitted);
    const text = (label: string) => page.$eval(`[aria-label="${label}"]`, n => n.textContent || "");
    const setVal = (label: string, v: string | number, proto: "input" | "textarea" = "input") =>
      page.$eval(
        `[aria-label="${label}"]`,
        (el, v, proto) => {
          const P = proto === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(P, "value")!.set!.call(el, String(v));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        },
        v,
        proto
      );
    const button = (label: string) =>
      page.$$eval("button", (nodes, label) => {
        const b = nodes.find(n => n.textContent?.trim() === label) as HTMLButtonElement | undefined;
        return b ? { disabled: b.disabled } : null;
      }, label);
    const click = (label: string) =>
      page.$$eval("button", (nodes, label) => (nodes.find(n => n.textContent?.trim() === label) as HTMLButtonElement).click(), label);

    // 初始 0–4 秒；无描述不能提交
    expect(await text("所选区间")).toContain("0.0–4.0 秒，共 4.0 秒");
    expect(await button("提交局部修改")).toEqual({ disabled: true });

    // 不足 4 秒：提示自动扩到 4 秒（一位小数输入）
    await setVal("起点秒", 2.04);
    await setVal("终点秒", 3.5);
    await page.waitForSelector('[aria-label="区间扩展提示"]');
    // 与服务端同一规则：2.0–3.5 以中心向两侧扩到 4 秒
    expect(await text("区间扩展提示")).toContain("自动扩到 4 秒（约 0.8–4.8 秒）");
    // 区间条上画出服务端将扩展到的区间；够 4 秒后消失
    expect(await page.$eval("[data-range-expanded]", n => [n.getAttribute("data-start"), n.getAttribute("data-end")])).toEqual(["0.8", "4.8"]);
    // 价格即时显示（与服务端同一组函数：扩到 4 秒 = 60 积分），区间停稳后服务端确认
    expect(await text("报价")).toContain("本次修改 4.0 秒，需 60 积分");
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 60 积分"));

    // 双滑块：一条轨道两个原生滑杆；起点不能越过终点，终点不能越过起点（最小间隔 0.1 秒），拖动时预览跟到对应时间
    expect(await page.$$eval('[data-video-edit-range-bar] input[type="range"]', ns => ns.map(n => n.getAttribute("aria-label")))).toEqual(["起点滑杆", "终点滑杆"]);
    const num = (label: string) => page.$eval(`[aria-label="${label}"]`, n => Number((n as HTMLInputElement).value));
    const previewAt = () => page.$eval('video[aria-label="原片预览"]', v => Math.round((v as HTMLVideoElement).currentTime * 10) / 10);
    await setVal("起点滑杆", 15);
    await page.waitForFunction(() => (document.querySelector('[aria-label="起点秒"]') as HTMLInputElement).value === "3.4");
    expect(await previewAt()).toBe(3.4);
    await setVal("终点滑杆", 1);
    await page.waitForFunction(() => (document.querySelector('[aria-label="终点秒"]') as HTMLInputElement).value === "3.5");
    expect(await num("起点秒")).toBe(3.4);
    // 键盘：聚焦终点滑杆按方向键，每次 0.1 秒
    await page.focus('[aria-label="终点滑杆"]');
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => (document.querySelector('[aria-label="终点秒"]') as HTMLInputElement).value === "3.7");
    expect(await previewAt()).toBe(3.7);
    await page.focus('[aria-label="起点滑杆"]');
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => (document.querySelector('[aria-label="起点秒"]') as HTMLInputElement).value === "3.3");

    // 指针拖动：按下选最近的滑块并跟手；按住期间不向服务端报价，松手停稳后只确认最终区间一次
    const track = await page.$eval("[data-range-track]", n => {
      const r = n.getBoundingClientRect();
      const host = n.parentElement!.getBoundingClientRect();
      return { left: r.left, width: r.width, y: host.top + host.height / 2 };
    });
    const xAt = (sec: number) => track.left + (sec / 20) * track.width;
    const keyOf = (q: { startSec: number; endSec: number }) => `${q.startSec}-${q.endSec}`;
    const quotedKeys = async () => new Set((await page.evaluate(() => (globalThis as any).quotes as Array<{ startSec: number; endSec: number }>)).map(keyOf));
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("积分"));
    const before = await quotedKeys();
    await page.mouse.move(xAt(12), track.y);
    await page.mouse.down();
    await page.waitForFunction(() => (document.querySelector('[aria-label="终点秒"]') as HTMLInputElement).value === "12");
    for (const sec of [13, 14, 15, 16]) await page.mouse.move(xAt(sec), track.y);
    await page.waitForFunction(() => (document.querySelector('[aria-label="终点秒"]') as HTMLInputElement).value === "16");
    // 按住超过停稳时间也不发报价；价格照样即时显示（12.7 秒 → 210 积分）
    await page.evaluate(() => new Promise(r => setTimeout(r, 700)));
    expect(await text("报价")).toBe("本次修改 12.7 秒，需 210 积分（正在确认…）");
    expect(await quotedKeys()).toEqual(before);
    expect(await previewAt()).toBe(16);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 210 积分"));
    const added = [...(await quotedKeys())].filter(k => !before.has(k));
    expect(added).toEqual(["3.3-16"]);
    // 再点轨道左侧：离起点近，动的是起点
    await page.mouse.click(xAt(1), track.y);
    await page.waitForFunction(() => (document.querySelector('[aria-label="起点秒"]') as HTMLInputElement).value === "1");
    expect(await num("终点秒")).toBe(16);

    // 超 30 秒：报错且不报价
    await setVal("起点秒", 0);
    await setVal("终点秒", 20);
    await setVal("终点滑杆", 20);
    expect(await page.$('[aria-label="区间问题"]')).toBeNull();
    // 片长 20 秒内最大 20 秒，构造倒置区间验证报错
    await setVal("起点秒", 10);
    await setVal("终点秒", 5);
    await page.waitForSelector('[aria-label="区间问题"]');
    expect(await text("区间问题")).toContain("终点需晚于起点");
    expect(await text("报价")).toContain("调整区间后显示所需积分");

    // 正常区间 3.0–8.5（5.5 秒 → ceil(5.5/2)×30 = 90 积分）
    await setVal("起点秒", 3);
    await setVal("终点秒", 8.5);
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 90 积分"));
    expect(await page.$("[data-range-expanded]")).toBeNull();
    await setVal("修改描述", "把背景换成商店门口，人物动作不变", "textarea");

    // 试看所选片段：从起点开始，播到终点回到起点循环；再点一次停止
    const loopBtn = () => page.$$eval("button", ns => ns.filter(n => ["试看所选片段", "停止试看"].includes(n.textContent?.trim() || "")).map(n => [n.textContent?.trim(), n.getAttribute("aria-pressed")]));
    expect(await loopBtn()).toEqual([["试看所选片段", "false"]]);
    await click("试看所选片段");
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === "停止试看"));
    expect(await loopBtn()).toEqual([["停止试看", "true"]]);
    expect(await previewAt()).toBe(3);
    const jumpPreview = (sec: number) =>
      page.$eval('video[aria-label="原片预览"]', (v, sec) => {
        (v as HTMLVideoElement).currentTime = sec;
        v.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      }, sec);
    await jumpPreview(6);
    expect(await previewAt()).toBe(6);
    await jumpPreview(8.6);
    expect(await previewAt()).toBe(3);
    await jumpPreview(1);
    expect(await previewAt()).toBe(3);
    await click("停止试看");
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === "试看所选片段"));
    await jumpPreview(12);
    expect(await previewAt()).toBe(12);

    await page.click('[aria-label="参考图1：场景底图"]');
    await page.waitForFunction(() => document.querySelector('[aria-label="参考图1：场景底图"]')?.getAttribute("aria-pressed") === "true");
    expect(await text("参考图")).toContain("不含人物的场景底图");

    // 点提交：只弹确认，不入队
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === "提交局部修改" && !b.disabled));
    await click("提交局部修改");
    await page.waitForSelector('[role="dialog"]');
    const dialog = await page.$eval('[role="dialog"]', n => n.textContent || "");
    expect(dialog).toContain("将扣 90 积分");
    expect(dialog).toContain("提交后不可取消");
    expect(dialog).toContain("全额退回积分");
    expect(dialog).toContain("原片保留");
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(0);

    // 再想想：关闭，仍未入队
    await click("再想想");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(0);
    expect(await submitted()).toEqual([]);

    // 确认提交：参数按约定
    await click("提交局部修改");
    await page.waitForSelector('[role="dialog"]');
    await click("确认提交");
    await page.waitForFunction(() => (globalThis as any).queued.length === 1);
    const input = await page.evaluate(() => (globalThis as any).queued[0]);
    expect(input).toMatchObject({
      sourceUrl: "gs://test-only/post-prod/7/a.mp4",
      startSec: 3,
      endSec: 8.5,
      promptZh: "把背景换成商店门口，人物动作不变",
      referenceImageUrls: ["gs://test-only/bg.png"],
      expectedCredits: 90,
    });
    expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // 入队成功：onSubmitted 恰好一次，jobId/requestId/实际区间
    await page.waitForFunction(() => (globalThis as any).submitted.length === 1);
    expect(await submitted()).toEqual([{ jobId: "job-ve-1", requestId: input.requestId, startSec: 3, endSec: 8.5 }]);
    await page.waitForSelector('[aria-label="修改任务"]');
    expect(await text("修改任务")).toContain("处理中");
    expect(await text("修改任务")).toContain("通常约 3–5 分钟，可以离开本页，回来结果还在");
    // 已等待时长每秒走；任务编号不给普通用户看
    expect(await text("修改任务")).toMatch(/已等待 \d+ 秒/);
    await page.waitForFunction(() => /已等待 [1-9]\d* 秒/.test(document.querySelector('[aria-label="修改任务"]')?.textContent || ""), { timeout: 5000 });
    expect(await page.$eval('[data-testid="video-edit-panel"]', n => n.textContent || "")).not.toContain("job-ve-1");
    expect(await page.$('[aria-label="任务编号"]')).toBeNull();
    expect(await button("提交局部修改")).toEqual({ disabled: true });

    // 完成：新版本 + 前后对比；debug 不显示
    await page.evaluate(() => {
      (globalThis as any).jobData = {
        status: "succeeded",
        output: { gcsUri: "gs://test-only/e.mp4", url: "https://cdn.test/e.mp4", durationSec: 20, editedRange: { startSec: 3, endSec: 8.5 }, creditsCharged: 90, debug: { channel: "x" } },
      };
      (globalThis as any).bump();
    });
    await page.waitForSelector('[aria-label="修改结果"]');
    expect(await text("修改结果")).toContain("原片保留");
    expect(await page.$('[aria-label="修改任务"]')).toBeNull();
    // 进入结果：停在改动区间起点前 1 秒（3.0 − 1 = 2.0），默认看修改后
    const cmp = () =>
      page.$eval('[aria-label="修改结果"]', root => {
        const v = (label: string) => root.querySelector(`video[aria-label="${label}"]`) as HTMLVideoElement;
        const shown = (el: HTMLVideoElement) => !el.closest("figure")!.hidden;
        const b = v("修改前"), a = v("修改后");
        return { mode: root.querySelector("[data-compare-mode]")!.getAttribute("data-compare-mode"), before: [shown(b), b.currentTime, b.muted], after: [shown(a), a.currentTime, a.muted] };
      });
    expect(await cmp()).toEqual({ mode: "after", before: [false, 2, false], after: [true, 2, false] });
    // 切换修改前/后保持同一播放位置
    await page.$eval('video[aria-label="修改后"]', v => ((v as HTMLVideoElement).currentTime = 5.5));
    await click("修改前");
    await page.waitForFunction(() => document.querySelector("[data-compare-mode]")?.getAttribute("data-compare-mode") === "before");
    expect(await cmp()).toEqual({ mode: "before", before: [true, 5.5, false], after: [false, 5.5, false] });
    await page.$eval('video[aria-label="修改前"]', v => ((v as HTMLVideoElement).currentTime = 7));
    await click("修改后");
    await page.waitForFunction(() => document.querySelector("[data-compare-mode]")?.getAttribute("data-compare-mode") === "after");
    expect(await cmp()).toEqual({ mode: "after", before: [false, 7, false], after: [true, 7, false] });
    // 并排：两条同时显示、同一位置，修改前静音；一侧拖动进度另一侧跟上
    await click("并排对比");
    await page.waitForFunction(() => document.querySelector("[data-compare-mode]")?.getAttribute("data-compare-mode") === "side");
    expect(await cmp()).toEqual({ mode: "side", before: [true, 7, true], after: [true, 7, false] });
    await page.$eval('video[aria-label="修改后"]', v => {
      (v as HTMLVideoElement).currentTime = 4;
      v.dispatchEvent(new Event("seeked", { bubbles: true }));
    });
    expect(await cmp()).toEqual({ mode: "side", before: [true, 4, true], after: [true, 4, false] });
    // 并排时倍速、播完也同步：一侧改倍速另一侧跟上；切回单条时倍速沿用
    const rates = () => page.$$eval('[aria-label="修改结果"] video', vs => vs.map(v => (v as HTMLVideoElement).playbackRate));
    await page.$eval('video[aria-label="修改后"]', v => {
      (v as HTMLVideoElement).playbackRate = 0.5;
      v.dispatchEvent(new Event("ratechange", { bubbles: true }));
    });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[aria-label="修改结果"] video')).every(v => (v as HTMLVideoElement).playbackRate === 0.5));
    await page.$eval('video[aria-label="修改前"]', v => {
      (v as HTMLVideoElement).playbackRate = 1;
      v.dispatchEvent(new Event("ratechange", { bubbles: true }));
    });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[aria-label="修改结果"] video')).every(v => (v as HTMLVideoElement).playbackRate === 1));
    expect(await rates()).toEqual([1, 1]);
    // 并排入口不按屏宽隐藏（窄屏上下叠放）
    expect(await page.$$eval('[aria-label="对比方式"] button', ns => ns.map(n => n.textContent?.trim()))).toEqual(["修改前", "修改后", "并排对比"]);
    await click("修改前");
    await page.waitForFunction(() => document.querySelector("[data-compare-mode]")?.getAttribute("data-compare-mode") === "before");
    expect(await cmp()).toEqual({ mode: "before", before: [true, 4, false], after: [false, 4, false] });
    expect(await page.$('[aria-label="调试信息"]')).toBeNull();
    expect(await page.evaluate(() => (globalThis as any).done)).toEqual([
      { url: "https://cdn.test/e.mp4", gcsUri: "gs://test-only/e.mp4", durationSec: 20, editedRange: { startSec: 3, endSec: 8.5 }, jobId: "job-ve-1" },
    ]);

    // 再次提交：新 requestId
    await click("提交局部修改");
    await page.waitForSelector('[role="dialog"]');
    await click("确认提交");
    await page.waitForFunction(() => (globalThis as any).queued.length === 2);
    const ids = await page.evaluate(() => (globalThis as any).queued.map((q: any) => q.requestId));
    expect(ids[0]).not.toBe(ids[1]);
    await page.waitForFunction(() => (globalThis as any).submitted.length === 2);
    expect((await submitted())[1]).toEqual({ jobId: "job-ve-1", requestId: ids[1], startSec: 3, endSec: 8.5 });

    // 不足 4 秒：提交的是用户所选 10.0–11.0，onSubmitted 给服务端扩展后的实际区间 8.5–12.5
    await setVal("起点秒", 10);
    await setVal("终点秒", 11);
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 60 积分"));
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === "提交局部修改" && !b.disabled));
    await click("提交局部修改");
    await page.waitForSelector('[role="dialog"]');
    await click("确认提交");
    await page.waitForFunction(() => (globalThis as any).submitted.length === 3);
    const third = await page.evaluate(() => (globalThis as any).queued[2]);
    expect(third).toMatchObject({ startSec: 10, endSec: 11, expectedCredits: 60 });
    expect((await submitted())[2]).toEqual({ jobId: "job-ve-1", requestId: third.requestId, startSec: 8.5, endSec: 12.5 });
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(3);

    const all = await page.$eval('[data-testid="video-edit-panel"]', n => n.textContent || "");
    expect(all).not.toMatch(/Seedance|BytePlus|EvoLink|ffmpeg|Gemini|GPT|Veo|Kling|WaveSpeed/i);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);

/** 顾问 videoEdit：登记口 inspect/prefill 与 prefill(nonce) 只预填本面板、显示报价；提交仍须用户点确认。 */
it("VideoEditPanel：顾问预填（登记口与 prefill nonce）只预填不提交，确认后才入队", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoEditPanel} from './client/src/components/canvas/VideoEditPanel';
    globalThis.React=React;globalThis.queued=[];globalThis.quotes=[];globalThis.vctl=null;
    window.confirm=()=>{throw new Error('不应弹原生确认');};
    function App(){const[pf,setPf]=React.useState(undefined);globalThis.setPrefill=setPf;
      return <VideoEditPanel source='gs://test-only/post-prod/7/a.mp4' previewUrl='https://cdn.test/a.mp4' durationSec={40}
        referenceImages={[{url:'gs://test-only/shop.png',label:'商店门口'}]} prefill={pf} debugMode
        advisorTarget={{id:'clip-1',label:'第1段成片'}} onAdvisorVideoEditControl={c=>{globalThis.vctl=c;}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
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
      const quote={useQuery:(input,opts)=>{
        if(!opts.enabled) return {data:undefined};
        globalThis.quotes.push(input);
        const seg=Math.max(4,Math.round((input.endSec-input.startSec)*10)/10);
        const s=input.startSec, e=Math.max(input.endSec, Math.round((s+4)*10)/10);
        return {data:{sourceDurationSec:40,startSec:s,endSec:e,segmentSec:seg,expanded:seg>input.endSec-input.startSec,credits:Math.ceil(seg/2)*30,waived:false,creditsPerTwoSec:30,minSec:4,maxSec:30,confirmNotice:'提交后不可取消；失败或未通过审核将全额退回积分。'}};
      }};
      const queue={useMutation:()=>({mutateAsync:async input=>{globalThis.queued.push(input);return {jobId:'job-ve-1'};}})};
      const job={useQuery:(input,opts)=>{
        const React=globalThis.React;const [,force]=React.useState(0);
        React.useEffect(()=>{globalThis.bump=()=>force(x=>x+1);},[]);
        return {data:opts.enabled?globalThis.jobData:undefined};
      }};
      export const trpc={mvAnalysis:{quoteVideoPartialEdit:quote,queueVideoPartialEdit:queue,getPostProdJob:job}};
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
    await page.waitForFunction(() => typeof (globalThis as any).vctl === "function");
    const text = (label: string) => page.$eval(`[aria-label="${label}"]`, n => n.textContent || "");
    const val = (label: string) => page.$eval(`[aria-label="${label}"]`, n => (n as HTMLInputElement).value);
    const click = (label: string) =>
      page.$$eval("button", (nodes, label) => (nodes.find(n => n.textContent?.trim() === label) as HTMLButtonElement).click(), label);
    const ctl = (a: unknown) =>
      page.evaluate(a => (globalThis as any).vctl(a, new AbortController().signal).then((r: string) => JSON.parse(r), (e: Error) => ({ error: e.message })), a as any);

    // inspect：本片 targetId 与时长、参考图
    expect(await ctl({ action: "videoEdit", operation: "inspect" })).toMatchObject({ videos: [{ targetId: "clip-1", durationSec: 40 }], refs: [{ refAssetId: "ref1", label: "商店门口" }], minSec: 4, maxSec: 30 });
    // 越界 / 超 30 秒：拒绝且面板不变
    expect((await ctl({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec: 36, endSec: 41, promptZh: "换背景" })).error).toContain("超出视频时长");
    expect((await ctl({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec: 0, endSec: 31, promptZh: "换背景" })).error).toContain("最多 30 秒");
    expect(await val("修改描述")).toBe("");
    // prefill：填区间/描述/参考图，显示报价，未入队
    const r = await ctl({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec: 24, endSec: 30, promptZh: "背景换成商店门口，人物动作与衣着不变", refAssetId: "ref1" });
    expect(r).toMatchObject({ status: "prefilled", startSec: 24, endSec: 30 });
    expect(JSON.stringify(r)).not.toMatch(/Seedance|BytePlus|EvoLink|Gemini|GPT|Veo/i);
    await page.waitForFunction(() => (document.querySelector('[aria-label="修改描述"]') as HTMLTextAreaElement)?.value.includes("商店门口"));
    expect(await text("所选区间")).toContain("24.0–30.0 秒");
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 90 积分"));
    expect(await page.$eval('[aria-label="参考图1：商店门口"]', n => n.getAttribute("aria-pressed"))).toBe("true");
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(0);
    // 不足 4 秒：按中心扩展并说明
    const short = await ctl({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec: 26, endSec: 27, promptZh: "背景换成商店门口" });
    expect(short).toMatchObject({ startSec: 24.5, endSec: 28.5 });
    expect(short.notice).toContain("最短 4 秒");
    // 宿主 prefill nonce：覆盖当前内容（多轮）；与顾问控件同一套闸门，须等上一轮区间的报价确认完（正在确认时不覆盖）
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 60 积分"));
    await page.evaluate(() => (globalThis as any).setPrefill({ startSec: 10, endSec: 16, promptZh: "天空换成黄昏", nonce: 1 }));
    await page.waitForFunction(() => (document.querySelector('[aria-label="修改描述"]') as HTMLTextAreaElement)?.value === "天空换成黄昏");
    expect(await text("所选区间")).toContain("10.0–16.0 秒");
    expect(await page.$eval('[aria-label="参考图1：商店门口"]', n => n.getAttribute("aria-pressed"))).toBe("false");
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 90 积分"));
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(0);
    // 用户点提交 → 确认框（不可取消）→ 确认后才入队，参数为预填
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === "提交局部修改" && !b.disabled));
    await click("提交局部修改");
    await page.waitForSelector('[role="dialog"]');
    expect(await page.$eval('[role="dialog"]', n => n.textContent || "")).toContain("提交后不可取消");
    // 确认框打开时顾问不能改预填
    expect((await ctl({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec: 0, endSec: 5, promptZh: "改别处" })).error).toContain("用户正在确认");
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(0);
    await click("确认提交");
    await page.waitForFunction(() => (globalThis as any).queued.length === 1);
    expect(await page.evaluate(() => (globalThis as any).queued[0])).toMatchObject({ startSec: 10, endSec: 16, promptZh: "天空换成黄昏", expectedCredits: 90 });
    // debugMode 才显示任务编号
    await page.waitForSelector('[aria-label="任务编号"]');
    expect(await text("任务编号")).toContain("job-ve-1");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);

/**
 * 顾问预填防覆盖：确认框打开、正在报价、任务进行中时，面板登记口与宿主闸门（后期工坊/首页/营销页写法）都拒绝并回中文原因；
 * 宿主未接闸门直接改 nonce 时，面板内容与确认框也原样保留。任务结束后可再预填。
 */
it("VideoEditPanel：确认框打开/正在报价/任务进行中拒绝顾问预填，面板与确认框不变", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoEditPanel, useVideoEditPrefillGuard} from './client/src/components/canvas/VideoEditPanel';
    import {createAdvisorVideoEditControl} from './client/src/lib/advisorVideoEditControl';
    globalThis.React=React;globalThis.queued=[];globalThis.vctl=null;globalThis.hostCtl=null;globalThis.holdQuote=false;
    let n=0;
    function App(){const[pf,setPf]=React.useState(undefined);globalThis.setPrefill=setPf;
      const guard=useVideoEditPrefillGuard();
      React.useEffect(()=>{
        // 宿主自建控件（同后期工坊/首页/营销页）：清单为本片，prefill 设 nonce 打开并预填；闸门先问面板
        globalThis.hostCtl=guard.withGuard(createAdvisorVideoEditControl({
          targets:()=>[{id:'host-clip',label:'宿主成片',url:'gs://test-only/post-prod/7/a.mp4',durationSec:40}],
          open:p=>setPf({startSec:p.startSec,endSec:p.endSec,promptZh:p.promptZh,nonce:'host-'+(++n)}),
        }));
      },[guard]);
      return <VideoEditPanel source='gs://test-only/post-prod/7/a.mp4' previewUrl='https://cdn.test/a.mp4' durationSec={40}
        prefill={pf} onAdvisorPrefillGuard={guard.register}
        advisorTarget={{id:'clip-1',label:'第1段成片'}} onAdvisorVideoEditControl={c=>{globalThis.vctl=c;}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
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
      const quote={useQuery:(input,opts)=>{
        if(!opts.enabled||globalThis.holdQuote) return {data:undefined,isFetching:Boolean(opts.enabled)};
        const seg=Math.max(4,Math.round((input.endSec-input.startSec)*10)/10);
        return {data:{sourceDurationSec:40,startSec:input.startSec,endSec:Math.max(input.endSec,input.startSec+4),segmentSec:seg,expanded:false,credits:Math.ceil(seg/2)*30,waived:false,creditsPerTwoSec:30,minSec:4,maxSec:30,confirmNotice:'提交后不可取消；失败或未通过审核将全额退回积分。'}};
      }};
      const queue={useMutation:()=>({mutateAsync:async input=>{globalThis.queued.push(input);return {jobId:'job-ve-9',startSec:input.startSec,endSec:input.endSec};}})};
      const job={useQuery:(input,opts)=>{
        const React=globalThis.React;const [,force]=React.useState(0);
        React.useEffect(()=>{globalThis.bump=()=>force(x=>x+1);},[]);
        return {data:opts.enabled?globalThis.jobData:undefined};
      }};
      export const trpc={mvAnalysis:{quoteVideoPartialEdit:quote,queueVideoPartialEdit:queue,getPostProdJob:job}};
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
    await page.waitForFunction(() => typeof (globalThis as any).vctl === "function" && typeof (globalThis as any).hostCtl === "function");
    const text = (label: string) => page.$eval(`[aria-label="${label}"]`, n => n.textContent || "");
    const val = (label: string) => page.$eval(`[aria-label="${label}"]`, n => (n as HTMLInputElement).value);
    const setVal = (label: string, v: string | number) =>
      page.$eval(
        `[aria-label="${label}"]`,
        (el, v) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
          el.dispatchEvent(new Event("input", { bubbles: true }));
        },
        v
      );
    const click = (label: string) =>
      page.$$eval("button", (nodes, label) => (nodes.find(n => n.textContent?.trim() === label) as HTMLButtonElement).click(), label);
    const call = (who: "vctl" | "hostCtl", a: unknown) =>
      page.evaluate(
        (who, a) => (globalThis as any)[who](a, new AbortController().signal).then((r: string) => JSON.parse(r), (e: Error) => ({ error: e.message })),
        who,
        a as any
      );
    const ask = (targetId: string, startSec: number, endSec: number, promptZh: string) => ({ action: "videoEdit", operation: "prefill", targetId, startSec, endSec, promptZh });
    const snapshot = async () => ({ range: await text("所选区间"), prompt: await val("修改描述"), dialog: Boolean(await page.$('[role="dialog"]')) });
    /** 两条顾问路 + 宿主未接闸门的 nonce 都试一遍：顾问收到含 reason 的中文原因，面板快照不变。 */
    const expectRejected = async (reason: string) => {
      const before = await snapshot();
      expect((await call("vctl", ask("clip-1", 0, 5, "改别处"))).error).toContain(reason);
      expect((await call("hostCtl", ask("host-clip", 0, 5, "改别处"))).error).toContain(reason);
      return before;
    };

    // 空闲：宿主控件预填照常（面板已挂载，闸门放行）
    expect(await call("hostCtl", ask("host-clip", 10, 16, "天空换成黄昏"))).toMatchObject({ status: "prefilled", startSec: 10, endSec: 16 });
    await page.waitForFunction(() => (document.querySelector('[aria-label="修改描述"]') as HTMLTextAreaElement)?.value === "天空换成黄昏");
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 90 积分"));

    // 确认框打开：拒绝；宿主直接改 nonce 也不关确认框、不改内容
    await click("提交局部修改");
    await page.waitForSelector('[role="dialog"]');
    const atConfirm = await expectRejected("用户正在确认");
    expect(atConfirm).toEqual({ range: expect.stringContaining("10.0–16.0 秒"), prompt: "天空换成黄昏", dialog: true });
    await page.evaluate(() => (globalThis as any).setPrefill({ startSec: 0, endSec: 5, promptZh: "宿主未接闸门", nonce: "raw-1" }));
    await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
    expect(await snapshot()).toEqual(atConfirm);
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(0);
    await click("再想想");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

    // 正在报价（报价未回）：拒绝，用户刚改的区间不被冲掉
    await page.evaluate(() => ((globalThis as any).holdQuote = true));
    await setVal("终点秒", 17);
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 120 积分（正在确认…）"));
    const atQuote = await expectRejected("正在计算所需积分");
    expect(atQuote).toEqual({ range: expect.stringContaining("10.0–17.0 秒"), prompt: "天空换成黄昏", dialog: false });
    await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
    expect(await snapshot()).toEqual(atQuote);
    await page.evaluate(() => ((globalThis as any).holdQuote = false));
    await setVal("终点秒", 17.5);
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 120 积分"));

    // 任务进行中：拒绝；宿主直接改 nonce 也不动
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === "提交局部修改" && !b.disabled));
    await click("提交局部修改");
    await page.waitForSelector('[role="dialog"]');
    await click("确认提交");
    await page.waitForFunction(() => (globalThis as any).queued.length === 1);
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    expect(await text("修改任务")).toContain("处理中");
    const atRun = await expectRejected("任务进行中");
    expect(atRun).toEqual({ range: expect.stringContaining("10.0–17.5 秒"), prompt: "天空换成黄昏", dialog: false });
    await page.evaluate(() => (globalThis as any).setPrefill({ startSec: 0, endSec: 5, promptZh: "宿主未接闸门", nonce: "raw-2" }));
    await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
    expect(await snapshot()).toEqual(atRun);
    expect(await page.evaluate(() => (globalThis as any).queued)).toMatchObject([{ startSec: 10, endSec: 17.5, promptZh: "天空换成黄昏" }]);

    // 任务结束：可再预填（下一轮修改），仍只预填不提交
    await page.evaluate(() => {
      (globalThis as any).jobData = { status: "succeeded", output: { url: "https://cdn.test/e.mp4", editedRange: { startSec: 10, endSec: 17.5 } } };
      (globalThis as any).bump();
    });
    await page.waitForSelector('[aria-label="修改结果"]');
    expect(await call("hostCtl", ask("host-clip", 20, 26, "路灯更亮"))).toMatchObject({ status: "prefilled" });
    await page.waitForFunction(() => (document.querySelector('[aria-label="修改描述"]') as HTMLTextAreaElement)?.value === "路灯更亮");
    expect(await text("所选区间")).toContain("20.0–26.0 秒");
    expect(await page.evaluate(() => (globalThis as any).queued.length)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);

/** 报价带回服务端实测片长后，选区上限改用它（覆盖浏览器读到的时长），终点不会再选到报价必败的最后 0.1 秒。 */
it("VideoEditPanel：报价返回后用服务端片长作选区上限", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoEditPanel} from './client/src/components/canvas/VideoEditPanel';
    globalThis.React=React;globalThis.quotes=[];
    createRoot(document.getElementById('root')).render(
      <VideoEditPanel source='gs://test-only/post-prod/7/a.mp4' previewUrl='https://cdn.test/a.mp4' durationSec={10.18}/>);
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
      // 服务端实测（ffprobe）10.0 秒，比浏览器读到的 10.18 秒短
      const quote={useQuery:(input,opts)=>{
        if(!opts.enabled) return {data:undefined};
        globalThis.quotes.push(input);
        const seg=Math.max(4,Math.round((input.endSec-input.startSec)*10)/10);
        return {data:{sourceDurationSec:10,startSec:input.startSec,endSec:input.endSec,segmentSec:seg,expanded:false,credits:Math.ceil(seg/2)*30,waived:false,creditsPerTwoSec:30,minSec:4,maxSec:30,confirmNotice:'提交后不可取消；失败或未通过审核将全额退回积分。'}};
      }};
      const queue={useMutation:()=>({mutateAsync:async()=>({jobId:'never'})})};
      const job={useQuery:()=>({data:undefined})};
      export const trpc={mvAnalysis:{quoteVideoPartialEdit:quote,queueVideoPartialEdit:queue,getPostProdJob:job}};
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
    await page.waitForSelector('[data-testid="video-edit-panel"]');
    // 首个报价（默认 0–4 秒）带回 10.0 秒：上限从浏览器的 10.1 改为 10.0
    await page.waitForFunction(() => document.querySelector("legend")?.textContent?.includes("原片 10.0 秒"));
    for (const label of ["终点滑杆", "终点秒", "起点滑杆", "起点秒"])
      expect(await page.$eval(`[aria-label="${label}"]`, n => n.getAttribute("max"))).toBe("10");
    await page.$eval('[aria-label="起点秒"]', el => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "6");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.$eval('[aria-label="终点秒"]', el => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "10.1");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('[aria-label="报价"]')?.textContent?.endsWith("需 60 积分"));
    expect(await page.$eval('[aria-label="终点秒"]', n => (n as HTMLInputElement).value)).toBe("10");
    expect(await page.$eval('[aria-label="所选区间"]', n => n.textContent || "")).toContain("6.0–10.0 秒");
    expect(await page.$('[aria-label="区间问题"]')).toBeNull();
    const quotes = await page.evaluate(() => (globalThis as any).quotes as Array<{ endSec: number }>);
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every(q => q.endSec <= 10)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
