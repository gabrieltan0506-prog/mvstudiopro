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
    const dz=(YAVG,VAVG)=>({YAVG,UAVG:0,VAVG,SATAVG:0});
    const mixed={jobId:'job-10',title:'分段成片',output:{gradeSegmentCheck:{mode:'junctions',
      spans:[{startSec:0,endSec:2},{startSec:2,endSec:4,junctionIntent:'intended'},{startSec:4,endSec:6},{startSec:6,endSec:8,junctionIntent:'unwanted'},{startSec:8,endSec:8.5}],
      check:{pass:false,junctions:[{index:0,junctionSec:2,pass:false,delta:dz(-9,0)},{index:1,junctionSec:4,pass:true,delta:dz(1,0)},{index:2,junctionSec:6,pass:false,delta:dz(0,4.5)},{index:3,junctionSec:8,pass:false,delta:dz(7,0)}]}}}};
    function App(){
      const[grade,setGrade]=React.useState({all:{lutId:'basic_warm'}});
      const[gs,setGs]=React.useState(undefined);
      const[frozen,setFrozen]=React.useState(false);
      const[results,setResults]=React.useState([junction]);
      globalThis.setGs=setGs;globalThis.freeze=()=>setFrozen(true);globalThis.setGrade=setGrade;globalThis.showMixed=()=>setResults([mixed]);
      return <VideoGradePanel value={grade} outputSec={8.5} adviceVideoGsUri={gs} adviceAspect='16:9' junctionResults={results}
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
    // 时间轴区间条：两段 + 一个可聚焦的分界滑块；方向键一位小数微调、Shift 走 1 秒、Home/End 到两端，相邻段联动保持首尾相接
    const segsNow = async () => (await changes()).at(-1).segments.map((x: { startSec: number; endSec: number }) => [x.startSec, x.endSec]);
    const handle = '[role="slider"][aria-label="第1段与第2段的分界"]';
    expect(await page.$$eval('[aria-label="分段时间轴"] [data-range-track-segment]', n => n.length)).toBe(2);
    expect(await page.$eval(handle, n => [n.getAttribute("aria-valuenow"), n.getAttribute("aria-valuemin"), n.getAttribute("aria-valuemax"), n.getAttribute("aria-valuetext"), (n as HTMLElement).tabIndex])).toEqual(["4.3", "0.1", "8.4", "4.3秒", 0]);
    await page.focus(handle);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => (globalThis as any).changes.at(-1)?.segments?.[0]?.endSec === 4.4);
    expect(await segsNow()).toEqual([[0, 4.4], [4.4, 8.5]]);
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");
    await page.waitForFunction(() => (globalThis as any).changes.at(-1)?.segments?.[0]?.endSec === 3.4);
    await page.keyboard.press("End");
    await page.waitForFunction(() => (globalThis as any).changes.at(-1)?.segments?.[0]?.endSec === 8.4);
    expect(await segsNow()).toEqual([[0, 8.4], [8.4, 8.5]]);
    await page.keyboard.press("Home");
    await page.waitForFunction(() => (globalThis as any).changes.at(-1)?.segments?.[0]?.endSec === 0.1);
    expect(await page.evaluate(h => document.activeElement === document.querySelector(h), handle)).toBe(true);
    // 拖动分界：按轨道宽度换算成秒，取一位小数
    await page.$eval('[aria-label="分段时间轴"]', n => n.scrollIntoView({ block: "center" }));
    const rail = (await (await page.$('[aria-label="分段时间轴"]'))!.boundingBox())!;
    const grip = (await (await page.$(handle))!.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(rail.x + rail.width * (5 / 8.5), rail.y + rail.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => (globalThis as any).changes.at(-1)?.segments?.[0]?.endSec === 5);
    expect(await segsNow()).toEqual([[0, 5], [5, 8.5]]);
    // onChange 先于界面重绘：等输入框跟上再断言（否则偶发读到拖动中途的值）
    await page.waitForFunction(() => (document.querySelector('[aria-label="第1段结束秒"]') as HTMLInputElement | null)?.value === "5");
    // 数字输入仍可用，并与时间轴同步
    await setNum("第1段结束秒", 4.3);
    await page.waitForFunction(h => document.querySelector(h)?.getAttribute("aria-valuenow") === "4.3", {}, handle);
    // 点时间轴上的段 → 跳到该段设置
    await page.click('[aria-label="分段时间轴"] [data-range-track-segment="1"]');
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("第2段调色预设");

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

    // 草稿带接点意图（套用调色建议后的形态）→ 直接画在时间轴上
    await page.evaluate(() => (globalThis as any).setGrade({ segments: [{ startSec: 0, endSec: 3 }, { startSec: 3, endSec: 6, junctionIntent: "intended", color_temperature: 4500 }, { startSec: 6, endSec: 8.5, junctionIntent: "unwanted" }] }));
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="分段时间轴"] [data-range-track-segment]').length === 3);
    expect(await page.$$eval('[aria-label="分段时间轴"] [data-range-track-marker]', n => n.length)).toBe(2);
    expect(await page.$eval('[aria-label="分段时间轴"]', n => n.textContent)).toMatch(/剧情需要 3\.0秒.*不该跳 6\.0秒/);
    await page.evaluate(() => (globalThis as any).setGrade(undefined));

    // 接点检查：全部达标只占一行（数值收在折叠里）
    expect(await page.$eval('[aria-label="接点检查结果"] summary', n => n.textContent)).toBe("接点色彩检查 · 单片调色：全部接点达标（1 个）");
    expect(await page.$eval('[aria-label="接点检查结果"] details', n => (n as HTMLDetailsElement).open)).toBe(false);
    expect(await page.$eval('[aria-label="接点检查结果"]', n => n.textContent)).toContain("单片调色：全部接点达标");
    expect(await page.$eval('[aria-label="接点1"]', n => n.textContent)).toMatch(/4\.0秒.*亮度差1.*达标/);

    // 未达标：不该跳且未修平置顶，其次未标注、剧情需要；达标的收成一行
    await page.evaluate(() => (globalThis as any).showMixed());
    await page.waitForSelector('[data-junction-kind="fix"]');
    expect(await page.$$eval('[aria-label="接点检查结果"] [aria-label^="接点"]', n => n.map(x => [x.getAttribute("aria-label"), x.getAttribute("data-junction-kind")]))).toEqual([["接点3", "fix"], ["接点4", "unmarked"], ["接点1", "story"], ["接点2", "pass"]]);
    const fix = await page.$eval('[aria-label="接点3"]', n => n.textContent);
    expect(fix).toMatch(/6\.0秒.*不该跳 · 未修平.*色偏偏红 4\.5（允许 3）.*勾选「自动修正接点」.*调大「段间过渡秒数」.*第4段的色温/);
    expect(await page.$eval('[aria-label="接点4"]', n => n.textContent)).toMatch(/8\.0秒.*未标注是否该跳.*亮度变亮 7（允许 5）/);
    expect(await page.$eval('[aria-label="接点1"]', n => n.textContent)).toMatch(/2\.0秒.*剧情需要.*亮度变暗 9（允许 5）.*不用处理/);
    expect(await page.$eval('[aria-label="接点检查结果"]', n => n.textContent)).toContain("1 处不该跳、还没修平");
    expect(await page.$eval('[aria-label="接点检查结果"]', n => n.textContent)).toContain("其余 1 个接点达标");

    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
