import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
import {defaultCanvasBlock} from './client/src/lib/canvasTypes';import {createCanvasAudioCue,emptyCanvasAudioStudio,canvasAudioCueInputKey} from './shared/canvasAudioStudio';
const f=globalThis.fixture={posts:[],paid:[],allowResult:false};
const cue={...createCanvasAudioCue('bgm','bgm-one'),labelZh:'重逢 · 柔情',shotZh:'人物对视，随后发现追兵',endSec:25,source:{gcsUri:'gs://test/original.wav',previewUrl:'https://example.test/original.wav',durationSec:25,labelZh:'已有25秒原曲'},sourceEndSec:25,approved:true,selectedTakeId:'old'};
cue.takes=[{id:'old',gcsUri:'gs://test/old.wav',previewUrl:'https://example.test/old.wav',durationSec:25,createdAt:'test',inputKey:canvasAudioCueInputKey(cue)}];
const initial={...emptyCanvasAudioStudio(),cues:[cue],musicDraft:{prompt:'本集保留',durationSec:25,model:'suno-v6',brief:null}};
const services={generateDialogue:async()=>{f.paid.push('tts');return{}},getDialogue:async()=>null,draftMusic:async()=>{f.paid.push('brief');return{}},generateMusic:async()=>{f.paid.push('bgm');return{}},getMusic:async()=>null,listMusic:async()=>[],queuePost:async input=>{f.posts.push(input);return {jobId:'trim-one',status:'queued'}},getPost:async()=>f.allowResult?{jobId:'trim-one',status:'succeeded',output:{gcsUri:'gs://test/trimmed.wav',previewUrl:'https://example.test/trimmed.wav',durationSec:15}}:null};
function App(){const [studio,setStudio]=useState(initial);f.state=studio;f.restore=()=>setStudio(JSON.parse(localStorage.getItem('bgm-fixture')));return <CanvasAudioStudioView block={{...defaultCanvasBlock('video',0,0),id:'clip-e02-g01',audioStudio:studio,prompt:'目标时长：30秒'}} timelineDurationSec={30} services={services} onChange={next=>{localStorage.setItem('bgm-fixture',JSON.stringify(next));setStudio(next)}}/>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "离线服务", setup(b) { b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "offline", namespace: "offline" })); b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: "export const trpc={};", loader: "js" })); } }], define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" } });
  bundle = built.outputFiles[0]!.text; browser = await puppeteer.launch({ headless: true, ...(process.getuid?.() === 0 ? { args: ["--no-sandbox"] } : {}) });
}, 30000);
afterAll(async () => { await browser?.close(); });
async function setup() {
  const page = await browser.newPage(); page.setDefaultTimeout(6000);
  await page.setRequestInterception(true); page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41832/"); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[data-bgm-segment-editor]'); return page;
}
async function setNumber(page: Page, selector: string, value: number) {
  await page.$eval(selector, (e, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(e, String(value)); e.dispatchEvent(new Event("input", { bubbles: true })); }, value);
}
async function click(page: Page, text: string) { await page.evaluate(text => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent === text); if (!b) throw new Error(text); b.click(); }, text); }
it("只选25秒原曲中的15秒，真实裁切入参、未自动采用、恢复草稿与旧候选均正确", async () => {
  const page = await setup();
  try {
    expect(await page.evaluate(() => (globalThis as any).fixture.posts)).toEqual([]);
    expect(await page.evaluate(() => (globalThis as any).fixture.state.cues[0].approved)).toBe(true);
    await setNumber(page, '[aria-label="1 源音频裁切起点"]', 5); await setNumber(page, '[aria-label="1 源音频裁切终点"]', 20);
    await click(page, "按选段长度设置片内结束");
    await page.waitForFunction(() => (globalThis as any).fixture.state.cues[0].endSec === 15);
    expect(await page.$eval('[data-bgm-segment-editor]', e => e.textContent)).toContain("共 15.00 秒");
    await click(page, "只裁这一段 · 免费");
    await page.waitForFunction(() => (globalThis as any).fixture.posts.length === 1);
    expect(await page.evaluate(() => (globalThis as any).fixture.posts[0])).toMatchObject({ action: "audio_trim", params: { audioUri: "gs://test/original.wav", sourceStartSec: 5, sourceEndSec: 20 } });
    expect(await page.evaluate(() => (globalThis as any).fixture.state.cues[0])).toMatchObject({ approved: false, source: { durationSec: 25 }, takes: [expect.objectContaining({ id: "old" })] });
    await page.evaluate(() => (globalThis as any).fixture.restore());
    expect(await page.evaluate(() => (globalThis as any).fixture.state.cues[0])).toMatchObject({ sourceStartSec: 5, sourceEndSec: 20, endSec: 15 });
    expect(await page.evaluate(() => (globalThis as any).fixture.paid)).toEqual([]);
  } finally { await page.close(); }
}, 20000);
it("拆段与音乐主题修改不调用模型、不改对白或原曲；错误切点保留原段", async () => {
  const page = await setup();
  try {
    await setNumber(page, '[aria-label="1 配乐剧情切段秒位"]', 25); await click(page, "在此处分成两段");
    expect(await page.evaluate(() => (globalThis as any).fixture.state.cues.length)).toBe(1);
    await setNumber(page, '[aria-label="1 配乐剧情切段秒位"]', 10); await click(page, "在此处分成两段");
    await page.waitForFunction(() => (globalThis as any).fixture.state.cues.length === 2);
    expect(await page.evaluate(() => (globalThis as any).fixture.state.cues.map((c:any) => [c.startSec,c.endSec,c.sourceStartSec,c.sourceEndSec,c.approved]))).toEqual([[0,10,0,10,false],[10,25,10,25,false]]);
    await page.$eval('[aria-label="2 剧情位置与音乐主题"]', e => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(e,"发现追兵 · 紧张");e.dispatchEvent(new Event("input",{bubbles:true})); });
    await page.waitForFunction(() => (globalThis as any).fixture.state.cues[1].labelZh === "发现追兵 · 紧张");
    expect(await page.$eval('[aria-label="剧情配乐分段表"]', e => e.textContent)).toContain("发现追兵 · 紧张");
    expect(await page.evaluate(() => (globalThis as any).fixture.posts)).toEqual([]);
    expect(await page.evaluate(() => (globalThis as any).fixture.paid)).toEqual([]);
  } finally { await page.close(); }
}, 20000);
it("选段试听从选定起点开始，在终点停止，不播放整条原曲", async () => {
  const page = await setup();
  try {
    await setNumber(page, '[aria-label="1 源音频裁切起点"]', 5); await setNumber(page, '[aria-label="1 源音频裁切终点"]', 20);
    const times = await page.$eval('[aria-label="1 配乐选段试听"]', e => { const audio=e as HTMLAudioElement;audio.currentTime=0;audio.dispatchEvent(new Event("play",{bubbles:true}));const start=audio.currentTime;audio.currentTime=21;audio.dispatchEvent(new Event("timeupdate",{bubbles:true}));return [start,audio.currentTime,audio.paused]; });
    expect(times).toEqual([5,20,true]);
  } finally { await page.close(); }
}, 20000);
it("每段自己的裁切按钮只提交该段，处理期间锁定区间且不重复入队", async () => {
  const page = await setup();
  try {
    await setNumber(page, '[aria-label="1 配乐剧情切段秒位"]', 10); await click(page, "在此处分成两段");
    await page.waitForFunction(() => (globalThis as any).fixture.state.cues.length === 2);
    await page.evaluate(() => { const row = document.querySelectorAll('[data-bgm-segment-editor]')[1]; const b = Array.from(row.querySelectorAll('button')).find(b => b.textContent === '裁切此选段 · 免费')!; b.click(); b.click(); });
    await page.waitForFunction(() => (globalThis as any).fixture.posts.length === 1);
    expect(await page.evaluate(() => (globalThis as any).fixture.posts[0].params)).toMatchObject({ audioUri: "gs://test/original.wav", sourceStartSec: 10, sourceEndSec: 25 });
    expect(await page.evaluate(() => (globalThis as any).fixture.state.pendingOperations[0].cueId)).toBe(await page.evaluate(() => (globalThis as any).fixture.state.cues[1].id));
    expect(await page.$eval('[aria-label="2 源音频裁切起点"]', e => (e as HTMLInputElement).disabled)).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).fixture.state.cues[0].takes[0].id)).toBe("old");
    expect(await page.evaluate(() => (globalThis as any).fixture.paid)).toEqual([]);
  } finally { await page.close(); }
}, 20000);
it("按当前段主题准备不同原曲要求，保留用户生成时长且不自动购买或采用", async () => {
  const page = await setup();
  try {
    await click(page, "为这一段准备原曲要求");
    await page.waitForFunction(() => (globalThis as any).fixture.state.musicDraft.prompt.includes("重逢 · 柔情"));
    expect(await page.evaluate(() => (globalThis as any).fixture.state.musicDraft.durationSec)).toBe(25);
    expect(await page.evaluate(() => (globalThis as any).fixture.state.cues[0].approved)).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).fixture.posts)).toEqual([]);
    expect(await page.evaluate(() => (globalThis as any).fixture.paid)).toEqual([]);
  } finally { await page.close(); }
}, 20000);
