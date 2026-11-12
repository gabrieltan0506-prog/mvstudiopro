/** 多线路审稿对比组件（离线浏览器夹具）：打分表、分歧标记、共同 / 独有分区、勾选与两个改稿动作、重试回调。测试数据全部虚构。 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
import { REVISE_ORIGINAL } from "@shared/novelRevise.fixture";

const scores = (n: number, logic: number) => ({ 紧凑度: n, 逻辑: logic, 精彩度: n, 反转: n, 情绪高潮: n, 冲突: n, 伏笔: n });
const laneOutcome = (review: object, model: string) =>
  JSON.stringify({ chapterIndex: 3, original: REVISE_ORIGINAL, review, models: { review: model } });
const ENTRY = {
  index: 2,
  compareId: "cmp-1",
  createdAt: "2026-11-12T00:00:00.000Z",
  original: REVISE_ORIGINAL,
  lanes: [
    {
      lane: "glm",
      requestId: "11111111-1111-4111-8111-111111111111",
      status: "succeeded",
      submittedAt: "2026-11-12T00:00:00.000Z",
      outcome: laneOutcome(
        {
          scores: scores(3, 2),
          issues: [
            { dimension: "逻辑", quote: "钥匙在御史台", problem: "钥匙下落来源不明", fix: "补一句消息来源" },
            { dimension: "紧凑度", quote: "她起身去户部库房", problem: "同一动作重复", fix: "合并为一场" },
            { dimension: "伏笔", quote: "背面刻着一个户字", problem: "玉佩没有推进", fix: "库房前用上玉佩" },
          ],
          keep: ["摔账册的开场"],
          verdict: "线路一结论：先补信息来源",
        },
        "z-ai/glm-5.3-flashx"
      ),
    },
    {
      lane: "deepseek",
      requestId: "22222222-2222-4222-8222-222222222222",
      status: "succeeded",
      submittedAt: "2026-11-12T00:00:00.000Z",
      outcome: laneOutcome(
        {
          scores: scores(3, 4),
          issues: [
            { dimension: "逻辑", quote: "库房卯时换了锁", problem: "换锁时间与进库冲突", fix: "改成夜里换锁" },
            { dimension: "冲突", quote: "侍郎把账册摔在她脚边", problem: "对手动机单薄", fix: "给侍郎一个私心" },
            { dimension: "反转", quote: "沈家满门流放", problem: "威胁没有落地", fix: "让流放先落到一人身上" },
            { dimension: "情绪高潮", quote: "原文里并没有这一句", problem: "高潮不够", fix: "加强", located: false },
          ],
          keep: [],
          verdict: "线路二结论：先解决换锁冲突",
        },
        "deepseek/deepseek-v4.1-flash"
      ),
    },
    {
      lane: "carbon",
      requestId: "33333333-3333-4333-8333-333333333333",
      status: "failed",
      submittedAt: "2026-11-12T00:00:00.000Z",
      failure: "这条线路审稿未完成，记录已保留；可单独重试，其他线路不受影响。",
    },
  ],
};

let browser: Browser, code: string;
beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{NovelReviewComparePanel,NovelReviewCompareStart}from'./client/src/components/canvas/NovelReviewCompare';
const f=globalThis.fx={revise:[],retry:[],started:0,lanes:null};
function App(){const[text,setText]=useState(${JSON.stringify(REVISE_ORIGINAL)});const[lanes,setLanes]=useState(['glm','deepseek']);f.setText=setText;f.lanes=lanes;
return <div><NovelReviewCompareStart chapterIndex={3} selected={lanes} credits={lanes.reduce((s,l)=>s+(l==='carbon'?35:5),0)} disabled={false} minLanes={2} onChange={setLanes} onStart={()=>f.started++} onCancel={()=>{}}/>
<NovelReviewComparePanel entry={${JSON.stringify(ENTRY)}} currentText={text} disabled={false} rewriteLabel="线路二" onRetry={l=>f.retry.push(l)} onRevise={(o,a)=>f.revise.push({o,a})}/></div>}
createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    outdir: "review-compare-test",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  code = result.outputFiles.find(f => f.path.endsWith(".js"))!.text;
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
}, 120000);
afterAll(async () => {
  await browser?.close();
});
async function open(): Promise<Page> {
  const p = await browser.newPage();
  p.setDefaultTimeout(6000);
  await p.setRequestInterception(true);
  p.on("request", r =>
    r.isNavigationRequest()
      ? void r.respond({ status: 200, contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' })
      : void r.abort()
  );
  await p.goto("http://localhost:41851/");
  await p.addScriptTag({ content: code });
  await p.waitForSelector('[aria-label="各线路打分"]');
  return p;
}
const clickText = (p: Page, text: string) =>
  p.evaluate(t => {
    const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === t);
    if (!b) throw new Error("missing " + t);
    b.click();
  }, text);
const tick = (p: Page, label: string) => p.click(`[aria-label="${label}"]`);
const fx = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify((globalThis as any).fx)));

it("打分表、分歧标记、结论行；共同 / 独有分区与默认勾选；前台无模型名与成本", async () => {
  const p = await open();
  const rows = await p.$$eval('[aria-label="各线路打分"] tbody tr', trs => trs.map(tr => tr.textContent));
  expect(rows).toHaveLength(8);
  expect(await p.$$eval("[data-divergent]", els => els.map(e => e.textContent))).toEqual(["逻辑分歧大24—"]);
  expect(rows[7]).toContain("线路一结论");
  expect(rows[7]).toContain("线路二结论");
  const shared = await p.$$eval("[data-shared-cluster]", els => els.map(e => e.textContent));
  expect(shared).toHaveLength(1);
  expect(shared[0]).toContain("线路一、线路二都指出");
  expect(shared[0]).toContain("钥匙下落来源不明");
  expect(shared[0]).toContain("改成夜里换锁");
  expect(await p.$eval('[aria-label="采用线路一第1条意见"]', e => (e as HTMLInputElement).checked)).toBe(true);
  expect(await p.$eval('[aria-label="采用线路二第1条意见"]', e => (e as HTMLInputElement).checked)).toBe(true);
  expect(await p.$eval('[aria-label="采用线路一第2条意见"]', e => (e as HTMLInputElement).checked)).toBe(false);
  const unlocated = await p.$eval('[aria-label="采用线路二第4条意见"]', e => [(e as HTMLInputElement).disabled, e.closest("label")!.textContent]);
  expect(unlocated[0]).toBe(true);
  expect(unlocated[1]).toContain("未能定位原文");
  expect(await p.$eval('[data-unique-lane="deepseek"]', e => e.textContent)).toContain("线路二（3 条）");
  const progress = await p.$eval('[aria-label="各线路进度"]', e => e.textContent);
  expect(progress).toContain("线路三：这条线路审稿未完成");
  const body = await p.evaluate(() => document.body.textContent || "");
  expect(body).not.toMatch(/glm|deepseek|gemini|carbon|\$|侵权|抄袭|洗稿|触线|查重|相似度/i);
  expect(body).toContain("合计参考价 10 积分");
  expect(body).toContain("更深、更慢，约需数分钟");
  // 默认只勾了合并后的一处：不足 3 处，不能改稿
  const reviseButton = () =>
    p.evaluate(() => Array.from(document.querySelectorAll("button")).find(b => b.textContent === "按所选意见改稿")!.disabled);
  expect(await reviseButton()).toBe(true);
  expect(body).toContain("至少选 3 处意见");
  await p.close();
});

it("勾选后「按所选意见改稿」回调综合意见；「只用这条线路」与「重试」回调；正文改过即不可改稿", async () => {
  const p = await open();
  await tick(p, "采用线路一第2条意见");
  await tick(p, "采用线路二第2条意见");
  await clickText(p, "按所选意见改稿");
  let state = await fx(p);
  expect(state.revise).toHaveLength(1);
  const { o, a } = state.revise[0];
  expect(a).toEqual({ kind: "selected" });
  expect(o.issues).toHaveLength(3);
  // 合并的一处（含经「逻辑↔伏笔」相邻并入的线路一第 3 条）：各线路的问题与改法都带上
  const merged = o.issues.find((i: any) => i.quote === "钥匙在御史台");
  expect(merged.problem).toBe("线路一：钥匙下落来源不明；线路一：玉佩没有推进；线路二：换锁时间与进库冲突");
  expect(merged.fix).toContain("线路二：改成夜里换锁");
  expect(o.sources.map((s: any) => s.lane)).toEqual(["glm", "deepseek"]);
  expect(o.scores.逻辑).toBe(2);
  await p.click('[aria-label="只用线路二的意见改稿"]');
  state = await fx(p);
  expect(state.revise[1].a).toEqual({ kind: "lane", lane: "deepseek" });
  expect(state.revise[1].o.issues).toHaveLength(3);
  expect(state.revise[1].o.sources).toEqual([{ requestId: "22222222-2222-4222-8222-222222222222", lane: "deepseek" }]);
  await clickText(p, "重试线路三");
  expect((await fx(p)).retry).toEqual(["carbon"]);
  // 开始对比：少于两条线路不可开始；勾上线路三后参考价合计更新
  await tick(p, "对比线路二");
  expect(
    await p.evaluate(() => Array.from(document.querySelectorAll("button")).find(b => b.textContent === "开始对比")!.disabled)
  ).toBe(true);
  await tick(p, "对比线路三");
  expect(await p.evaluate(() => document.body.textContent)).toContain("合计参考价 40 积分");
  await clickText(p, "开始对比");
  expect((await fx(p)).started).toBe(1);
  // 正文改过：意见对不上原文，改稿按钮全部不可用
  await p.evaluate(() => (globalThis as any).fx.setText("改过的正文"));
  await p.waitForFunction(() => document.body.textContent!.includes("本集正文在对比后有修改"));
  expect(
    await p.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter(b => /改稿/.test(b.textContent || ""))
        .every(b => b.disabled)
    )
  ).toBe(true);
  await p.close();
});
