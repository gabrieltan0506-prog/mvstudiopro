import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {RangeTrack} from './client/src/components/canvas/RangeTrack';
import {moveSegmentBoundary} from './client/src/lib/rangeTrack';
const f=globalThis.fixture={seeks:[],boundary:[]};
function App(){
  const [value,setValue]=useState([2,6]);
  const [segments,setSegments]=useState([{startSec:0,endSec:4,label:'开场',tone:'ok'},{startSec:4,endSec:9,label:'转折',tone:'warn'},{startSec:9,endSec:12,label:'收尾',tone:'bad'}]);
  f.value=value;f.segments=segments;
  return <div style={{width:600,padding:0}}>
    <div id="range"><RangeTrack min={0} max={10} value={value} onChange={setValue} ghost={[1,8]} cursorSec={3} onSeek={s=>f.seeks.push(s)} ariaLabelStart="保留起点" ariaLabelEnd="保留终点"/></div>
    <div id="seg"><RangeTrack segments={segments} markers={[{sec:4,label:'切点',tone:'warn'}]} onBoundaryChange={(i,s)=>{f.boundary.push([i,s]);setSegments(prev=>moveSegmentBoundary(prev,i,s))}}/></div>
    <div id="off"><RangeTrack min={0} max={10} value={[2,6]} disabled onChange={()=>{f.disabledChanged=true}}/></div>
  </div>
}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" } });
  bundle = built.outputFiles[0]!.text; browser = await puppeteer.launch({ headless: true, ...(process.getuid?.() === 0 ? { args: ["--no-sandbox"] } : {}) });
}, 180000);
afterAll(async () => { await browser?.close(); });

async function setup() {
  const page = await browser.newPage(); page.setDefaultTimeout(6000);
  await page.setViewport({ width: 800, height: 600 });
  await page.setRequestInterception(true); page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<body style="margin:0"><div id="root"></div></body>' }) : void r.abort());
  await page.goto("http://localhost:41833/"); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('#seg [role="slider"]'); return page;
}
const state = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((globalThis as any).fixture)));
async function drag(page: Page, selector: string, toX: number) {
  const box = (await (await page.$(selector))!.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y); await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 6 }); await page.mouse.up();
  // pointermove 属连续事件，React 延后一帧提交；等两帧再读状态。
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)))));
}
const aria = (page: Page, selector: string) => page.$eval(selector, e => ["aria-valuemin", "aria-valuemax", "aria-valuenow"].map(k => Number(e.getAttribute(k))));

it("区间模式：拖动不越过另一端也不出界，aria 值同步", async () => {
  const page = await setup();
  try {
    expect(await aria(page, '[aria-label="保留起点"]')).toEqual([0, 6, 2]);
    expect(await aria(page, '[aria-label="保留终点"]')).toEqual([2, 10, 6]);
    await drag(page, '[aria-label="保留起点"]', 240);
    expect((await state(page)).value).toEqual([4, 6]);
    await drag(page, '[aria-label="保留起点"]', 560);
    expect((await state(page)).value).toEqual([6, 6]);
    await drag(page, '[aria-label="保留终点"]', 2000);
    expect((await state(page)).value).toEqual([6, 10]);
    await drag(page, '[aria-label="保留起点"]', -500);
    expect((await state(page)).value).toEqual([0, 10]);
    expect(await aria(page, '[aria-label="保留起点"]')).toEqual([0, 10, 0]);
    expect((await state(page)).seeks.length).toBeGreaterThan(0);
    expect(await page.$('#range [data-range-track-ghost]')).not.toBeNull();
    expect(await page.$('#range [data-range-track-cursor]')).not.toBeNull();
  } finally { await page.close(); }
}, 30000);

it("区间模式：方向键 ±0.1、Shift ±1 秒、Home/End，且键盘同样不越过另一端", async () => {
  const page = await setup();
  try {
    await page.focus('[aria-label="保留起点"]');
    await page.keyboard.press("ArrowRight");
    expect((await state(page)).value).toEqual([2.1, 6]);
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
    expect((await state(page)).value).toEqual([1.9, 6]);
    await page.keyboard.down("Shift"); await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
    expect((await state(page)).value).toEqual([2.9, 6]);
    await page.keyboard.press("End");
    expect((await state(page)).value).toEqual([6, 6]);
    await page.keyboard.press("ArrowRight");
    expect((await state(page)).value).toEqual([6, 6]);
    await page.keyboard.press("Home");
    expect((await state(page)).value).toEqual([0, 6]);
    await page.focus('[aria-label="保留终点"]');
    await page.keyboard.press("End");
    expect((await state(page)).value).toEqual([0, 10]);
    await page.keyboard.down("Shift"); await page.keyboard.press("ArrowLeft"); await page.keyboard.up("Shift");
    expect((await state(page)).value).toEqual([0, 9]);
  } finally { await page.close(); }
}, 30000);

it("点击轨道只回报预览秒位，不改区间；禁用时拖动与键盘都无效", async () => {
  const page = await setup();
  try {
    const box = (await (await page.$('#range [data-range-track="range"] > div'))!.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    const s = await state(page);
    expect(s.value).toEqual([2, 6]);
    expect(s.seeks.at(-1)).toBeCloseTo(8, 1);
    await drag(page, '#off [data-range-track-handle="0"]', 500);
    await page.$eval('#off [data-range-track-handle="0"]', e => e.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect((await state(page)).disabledChanged).toBeUndefined();
    expect(await page.$eval('#off [data-range-track-handle="0"]', e => (e as HTMLButtonElement).disabled)).toBe(true);
  } finally { await page.close(); }
}, 30000);

it("分段模式：拖动与键盘移动边界后各段仍首尾相接，边界不越过相邻段", async () => {
  const page = await setup();
  try {
    const contiguous = (segs: any[]) => segs.every((s, i) => s.endSec > s.startSec && (i === 0 || s.startSec === segs[i - 1].endSec));
    expect(await page.$$eval('#seg [role="slider"]', list => list.length)).toBe(2);
    expect(await aria(page, '#seg [data-range-track-handle="0"]')).toEqual([0.1, 8.9, 4]);
    expect(await page.$$eval('#seg [data-range-track-segment]', list => list.map(e => e.getAttribute("data-tone")))).toEqual(["ok", "warn", "bad"]);
    expect(await page.$$eval('#seg [data-range-track-marker]', list => list.length)).toBe(1);
    await drag(page, '#seg [data-range-track-handle="0"]', 300);
    let s = await state(page);
    expect(s.segments.map((x: any) => [x.startSec, x.endSec])).toEqual([[0, 6], [6, 9], [9, 12]]);
    expect(s.boundary.at(-1)).toEqual([0, 6]);
    await drag(page, '#seg [data-range-track-handle="0"]', 2000);
    s = await state(page);
    expect(s.segments.map((x: any) => [x.startSec, x.endSec])).toEqual([[0, 8.9], [8.9, 9], [9, 12]]);
    expect(contiguous(s.segments)).toBe(true);
    await page.focus('#seg [data-range-track-handle="1"]');
    await page.keyboard.press("ArrowRight");
    await page.keyboard.down("Shift"); await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
    s = await state(page);
    expect(s.segments.map((x: any) => [x.startSec, x.endSec])).toEqual([[0, 8.9], [8.9, 10.1], [10.1, 12]]);
    await page.keyboard.press("Home");
    s = await state(page);
    expect(s.segments.map((x: any) => [x.startSec, x.endSec])).toEqual([[0, 8.9], [8.9, 9], [9, 12]]);
    await page.keyboard.press("End");
    s = await state(page);
    expect(s.segments.map((x: any) => [x.startSec, x.endSec])).toEqual([[0, 8.9], [8.9, 11.9], [11.9, 12]]);
    expect(contiguous(s.segments)).toBe(true);
    expect(s.segments[0].startSec).toBe(0); expect(s.segments[2].endSec).toBe(12);
    expect(await page.$eval('#seg', e => e.textContent)).toContain("切点");
  } finally { await page.close(); }
}, 30000);
