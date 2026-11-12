/**
 * 小说页多线路审稿对比（离线浏览器夹具，传输层全 mock、不联网）：
 * 刷新后按回执续上进行中的线路；开始对比并发只审稿；「只用这条线路的意见改稿」走现有改稿流程。测试数据全部虚构。
 */
import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { novelMockTransport, showNovelStep } from "./novelWorkspace.browser.fixture";

const CHAPTER = Array.from({ length: 40 }, (_, i) => `测试第${"甲乙丙丁戊己庚辛壬癸"[i % 10]}${"子丑寅卯辰巳午未申酉戌亥"[i % 12]}句沈昭推开库房门`).join("。") + "。";
const P1 = "aaaaaaaa-1111-4111-8111-111111111111";
const P2 = "bbbbbbbb-2222-4222-8222-222222222222";
const sentences = CHAPTER.split("。").filter(Boolean);
const restoredOutcome = JSON.stringify({
  chapterIndex: 1,
  original: CHAPTER,
  review: {
    scores: { 紧凑度: 3, 逻辑: 3, 精彩度: 3, 反转: 3, 情绪高潮: 3, 冲突: 3, 伏笔: 3 },
    issues: [0, 10, 20].map(k => ({ dimension: "冲突", quote: sentences[k], problem: "续上的问题" + k, fix: "续上的改法" + k })),
    keep: [],
    verdict: "续上的结论",
  },
  models: { review: "z-ai/glm-5.3-flashx" },
});

it("刷新后续上进行中的对比；开始对比并发只审稿；只用一条线路的意见改稿走现有流程；重开仍在", async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{NovelAdaptationWorkspace}from'./client/src/pages/NovelAdaptation';import{emptyNovelWorkspace}from'./client/src/lib/novelWorkspace';import{readNovelWorkspaceDb,saveNovelWorkspaceDb}from'./client/src/lib/novelWorkspaceDb';
window.confirm=()=>true;
globalThis.receipts[${JSON.stringify(P1)}]={status:'succeeded',result:{model:'z-ai/glm-5.3-flashx',requestId:${JSON.stringify(P1)},stage:'revise',text:${JSON.stringify(restoredOutcome)},templateIds:[],inputSha256:'a'.repeat(64),resultSha256:'b'.repeat(64)}};
globalThis.receipts[${JSON.stringify(P2)}]={status:'failed'};
(async()=>{const loaded=await readNovelWorkspaceDb('1');if(loaded.raw===null){const at='2026-11-12T00:00:00.000Z';const draft={...emptyNovelWorkspace(),topic:'对比测试作品',direction:'测试方向',episodeCount:1,outline:'第1集：测试\\n剧情：测试',outlineApproved:'第1集：测试\\n剧情：测试',chapters:[${JSON.stringify(CHAPTER)}],
reviewCompares:[{index:0,compareId:'old',createdAt:at,original:${JSON.stringify(CHAPTER)},lanes:[{lane:'glm',requestId:${JSON.stringify(P1)},status:'pending',submittedAt:at},{lane:'deepseek',requestId:${JSON.stringify(P2)},status:'pending',submittedAt:at}]}]};
await saveNovelWorkspaceDb('1',loaded.raw,draft)}createRoot(document.getElementById('root')).render(<NovelAdaptationWorkspace userId='1'/>);})();`,
    },
    bundle: true,
    write: false,
    outdir: "review-compare-page-test",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    external: ["pdfjs-dist", "tesseract.js"],
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
    plugins: [
      {
        name: "boundary",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "mock" }));
          b.onResolve({ filter: /useAuth$/ }, () => ({ path: "auth", namespace: "mock" }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              a.path === "trpc"
                ? novelMockTransport
                : `export const useAuth=()=>({user:{id:1,role:'admin'},loading:false});`,
          }));
        },
      },
    ],
  });
  const code = built.outputFiles.find(f => f.path.endsWith(".js"))!.text;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const p = await browser.newPage();
    p.setDefaultTimeout(12000);
    const errors: string[] = [];
    p.on("pageerror", e => errors.push(String(e)));
    await p.setRequestInterception(true);
    p.on("request", r =>
      r.isNavigationRequest()
        ? void r.respond({ status: 200, contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' })
        : void r.abort()
    );
    await p.goto("http://localhost:41852/");
    await p.addScriptTag({ content: code });
    await showNovelStep(p, "novel");
    // 回执续上：线路一完成、线路二失败可重试，不重新提交
    await p.waitForFunction(() => document.body.textContent!.includes("续上的结论"));
    await p.waitForFunction(() => document.body.textContent!.includes("线路二：这条线路审稿未完成"));
    expect(await p.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    const saved = await p.evaluate(() => (globalThis as any).readDraft());
    expect(saved.reviewCompares[0].lanes.map((l: any) => l.status)).toEqual(["succeeded", "failed"]);
    // 开始新的对比：默认线路一、二，各发一次只审稿请求
    const clickText = (t: string) =>
      p.evaluate(t => {
        const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === t && !b.disabled);
        if (!b) throw new Error("unavailable " + t);
        b.click();
      }, t);
    await clickText("多线路审稿对比");
    await p.waitForSelector('[aria-label="对比线路三"]');
    expect(await p.evaluate(() => document.body.textContent)).toContain("合计参考价 10 积分");
    await clickText("开始对比");
    await p.waitForFunction(() => document.querySelectorAll('[data-lane-status="succeeded"]').length === 2 && !document.body.textContent!.includes("续上的结论"));
    const calls = await p.evaluate(() => (globalThis as any).calls);
    expect(calls).toHaveLength(2);
    expect(calls.map((c: any) => [c.stage, c.reviseMode, c.reviewModelPreference])).toEqual([
      ["revise", "review_only", "glm"],
      ["revise", "review_only", "deepseek"],
    ]);
    expect(calls[0].requestId).not.toBe(calls[1].requestId);
    expect(await p.$$eval("[data-divergent]", els => els.map(e => e.textContent))).toEqual(["逻辑分歧大24"]);
    expect(await p.$$eval("[data-shared-cluster]", els => els.length)).toBe(1);
    // 只用线路一的意见改稿：走现有改稿请求（不带 reviseMode，带综合意见与来源）
    await p.click('[aria-label="只用线路一的意见改稿"]');
    await p.waitForFunction(() => document.body.textContent!.includes("审稿：只用线路一的意见"));
    const revise = (await p.evaluate(() => (globalThis as any).calls))[2];
    expect(revise.reviseMode).toBeUndefined();
    expect(revise.reviewModelPreference).toBeUndefined();
    expect(revise.reviewOverride.sources).toEqual([{ requestId: calls[0].requestId, lane: "glm" }]);
    expect(revise.reviewOverride.issues).toHaveLength(3);
    expect(await p.evaluate(() => document.body.textContent)).toContain("采用最终修改版");
    const text = await p.evaluate(() => document.body.textContent || "");
    expect(text).not.toMatch(/侵权|抄袭|洗稿|触线|查重|相似度/);
    // 重开：对比与改稿结果都在
    await p.reload();
    await p.addScriptTag({ content: code });
    await showNovelStep(p, "novel");
    await p.waitForFunction(() => document.querySelectorAll('[data-lane-status="succeeded"]').length === 2);
    expect(await p.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 120000);
