import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

/** 离线夹具：直接挂 VideoGradePanel（受控），trpc 全部打桩、请求一律 200 空响应，不触发任何付费调用。 */
it("VideoGradePanel：受控渲染与变更；AI 调色建议仅有 gs:// 成片时出现；接点检查只读展示", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {VideoGradePanel} from './client/src/components/canvas/VideoGradePanel';
    globalThis.changes=[];globalThis.calls=[];
    const junction={jobId:'job-9',title:'单片调色',output:{gradeSegmentCheck:{check:{pass:true,junctions:[{index:0,junctionSec:4,pass:true,delta:{YAVG:1,UAVG:0,VAVG:0,SATAVG:0.5}}]}}}};
    function App(){
      const[grade,setGrade]=React.useState({all:{lutId:'basic_warm'}});
      const[gs,setGs]=React.useState(undefined);
      const[frozen,setFrozen]=React.useState(false);
      globalThis.setGs=setGs;globalThis.freeze=()=>setFrozen(true);
      return <VideoGradePanel value={grade} outputSec={8.5} adviceVideoGsUri={gs} adviceAspect='16:9' junctionResults={[junction]}
        onChange={next=>{globalThis.changes.push(next===undefined?null:next);if(!frozen)setGrade(next);}}/>;
    }
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
      const mutation={isPending:false,data:undefined,mutate:()=>{},mutateAsync:async input=>{globalThis.calls.push(input);throw new Error('离线夹具不应调用');}};
      const leaf=new Proxy({}, {get:(_,key)=>key==='useMutation'?()=>mutation:()=>({data:undefined})});
      export const trpc=new Proxy({}, {get:()=>new Proxy({}, {get:()=>leaf})});
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
    await page.waitForSelector('[aria-label="调色预设"]');
    const changes = () => page.evaluate(() => (globalThis as any).changes);
    const setNum = (label: string, v: number) =>
      page.$eval(`[aria-label="${label}"]`, (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, v);

    // 受控渲染：值来自 value；20 个预设分组；无 gs:// 不显示调色建议
    expect(await page.$eval('[aria-label="调色预设"]', n => (n as HTMLSelectElement).value)).toBe("basic_warm");
    expect(await page.$$eval('[aria-label="调色预设"] option[value]:not([value=""])', n => n.length)).toBe(20);
    for (const label of ["饱和度", "色温", "对比度", "添加调色分段", "段间过渡秒数", "自动修正接点"]) expect(await page.$(`[aria-label="${label}"]`)).not.toBeNull();
    expect(await page.$('[data-testid="montage-grade-advice"]')).toBeNull();
    expect(await page.$eval('[aria-label="分段调色"]', n => n.textContent)).toContain("成片约8.5秒");

    // 变更：onChange 回传整份新草稿（中性键删除）
    await page.select('[aria-label="调色预设"]', "neo_noir_subtle");
    await setNum("饱和度", 0.6);
    await page.waitForFunction(() => (globalThis as any).changes.length === 2);
    expect(await changes()).toEqual([{ all: { lutId: "neo_noir_subtle" } }, { all: { lutId: "neo_noir_subtle", saturation: 0.6 } }]);
    await setNum("饱和度", 1);
    await page.waitForFunction(() => (globalThis as any).changes.length === 3);
    expect((await changes())[2]).toEqual({ all: { lutId: "neo_noir_subtle" } });

    // 分段：按成片秒一分为二；校验提示；渐变与接点修正
    await page.click('[aria-label="添加调色分段"]');
    await page.waitForSelector('[aria-label="第2段调色预设"]');
    expect((await changes()).at(-1).segments).toEqual([{ startSec: 0, endSec: 4.3 }, { startSec: 4.3, endSec: 8.5 }]);
    await setNum("第2段结束秒", 8);
    await page.waitForSelector('[aria-label="分段校验"]');
    expect(await page.$eval('[aria-label="分段校验"]', n => n.textContent)).toContain("末段须到成片结尾8.5秒");
    await setNum("第2段结束秒", 8.5);
    await page.waitForFunction(() => !document.querySelector('[aria-label="分段校验"]'));
    await setNum("段间过渡秒数", 0.4);
    await page.click('[aria-label="自动修正接点"]');
    await page.waitForFunction(() => (globalThis as any).changes.at(-1)?.autoMatchJunctions === true);
    expect((await changes()).at(-1)).toEqual({
      all: { lutId: "neo_noir_subtle" },
      segments: [{ startSec: 0, endSec: 4.3 }, { startSec: 4.3, endSec: 8.5 }],
      crossfadeSec: 0.4,
      autoMatchJunctions: true,
    });

    // 还原 → undefined
    await page.$$eval("button", nodes => (nodes.find(n => n.textContent?.trim() === "还原原片色彩") as HTMLButtonElement).click());
    await page.waitForFunction(() => (globalThis as any).changes.at(-1) === null);
    expect(await page.$('[aria-label="第1段调色预设"]')).toBeNull();
    expect(await page.$eval('[aria-label="调色预设"]', n => (n as HTMLSelectElement).value)).toBe("");

    // 真受控：父组件不接受变更时界面保持 value
    await page.evaluate(() => (globalThis as any).freeze());
    await page.select('[aria-label="调色预设"]', "basic_cool");
    await page.waitForFunction(() => (globalThis as any).changes.at(-1)?.all?.lutId === "basic_cool");
    expect(await page.$eval('[aria-label="调色预设"]', n => (n as HTMLSelectElement).value)).toBe("");

    // 有 gs:// 成片才出现 AI 调色建议（中性文案）；非 gs:// 不出现
    await page.evaluate(() => (globalThis as any).setGs("https://cdn.test/out.mp4"));
    expect(await page.$('[data-testid="montage-grade-advice"]')).toBeNull();
    await page.evaluate(() => (globalThis as any).setGs("gs://test-only/out.mp4"));
    await page.waitForSelector('[data-testid="montage-grade-advice"]');
    const adviceText = await page.$eval('[data-testid="montage-grade-advice"]', n => n.textContent);
    expect(adviceText).toContain("AI 调色建议");
    expect(adviceText).not.toMatch(/Gemini|Flash/);

    // 接点检查只读展示
    expect(await page.$eval('[aria-label="接点检查结果"]', n => n.textContent)).toContain("单片调色：全部接点达标");
    expect(await page.$eval('[aria-label="接点1"]', n => n.textContent)).toMatch(/4\.0秒.*亮度差1.*达标/);

    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
