/**
 * 1119 C3：真实 EditableLayoutStudio（esbuild 打包 + puppeteer，全离线；只桩 trpc 与顾问流）。
 * - 只出卡片：一次云端保存、写 synchronizedStarted、不写 automaticLayout、零报价、零顾问请求、不需要 start。
 * - 手册路径：三项报价并发发出；任一失败按原串行顺序抛第一个错误，不提交排版、不继续。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const out = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "cards-only.tsx", loader: "tsx", contents: `
import React,{useRef}from'react';import{createRoot}from'react-dom/client';import Studio from'./client/src/components/platform/EditableLayoutStudio';
window.saved={library:{version:1,owner:'7',documents:[]},generation:'0'};window.saves=0;window.calls=[];window.quotes=[];window.quoteMode={};window.pendingQuotes=[];
function App(){const ref=useRef();window.prepare=(opts)=>ref.current.prepare({kind:'knowledge-publication',owner:'7',sourceId:'cards',title:'新手册',body:'完整资料'},async()=>{},undefined,opts);window.start=(id,c)=>ref.current.start(id,c);return <Studio ref={ref} owner='7' source={null} compact/>};createRoot(document.getElementById('root')).render(<App/>);
` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [{ name: "only-boundaries", setup(b) {
      b.onResolve({ filter: /^@\/lib\/(trpc|manhuaAdvisorStream)$/ }, a => ({ path: a.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ loader: "js", contents: a.path.endsWith("/trpc") ? `
const quote=input=>{window.quotes.push(input);const purpose=input.purpose||'review';const mode=window.quoteMode[purpose];
  if(mode==='hold')return new Promise((resolve,reject)=>window.pendingQuotes.push({purpose,resolve:()=>resolve({maxCredits:0,estimatedCredits:0,paidUnit:8,batches:2,consistencyKnown:true}),reject}));
  if(mode&&mode.fail)return new Promise((_,reject)=>setTimeout(()=>reject(new Error(mode.fail)),mode.delay||0));
  return Promise.resolve({maxCredits:0,estimatedCredits:0,paidUnit:8,batches:2,consistencyKnown:true});};
export const trpc={useUtils:()=>({client:{auth:{me:{query:async()=>({id:7})}},editableLayout:{exportPublicationStatus:{query:async()=>({status:'missing'})}}},editableLayout:{get:{fetch:async()=>window.saved},publicationQuote:{fetch:quote}}}),
 editableLayout:{save:{useMutation:()=>({mutateAsync:async input=>{window.saves++;window.saved={library:structuredClone(input.library),generation:String(Number(window.saved.generation)+1)};return {generation:window.saved.generation,updatedAt:new Date().toISOString()}}})},
  startExportPublication:{useMutation:()=>({mutateAsync:async()=>({status:'missing',taskId:'t'})})},exportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};
` : "export const streamManhuaAdvisor=input=>{window.calls.push(input);return new Promise(()=>{});};" }));
    } }],
  });
  bundle = out.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
}, 180_000);
afterAll(async () => { await browser?.close(); });

async function mount(): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage(); const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", r => void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://fixture.invalid");
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.includes("打开稿件库")), { timeout: 30_000 });
  return { page, errors };
}
const w = (page: Page, expr: string) => page.evaluate(expr) as Promise<any>;

it("只出卡片：一次云端保存，写 synchronizedStarted，不写 automaticLayout，零报价零顾问", async () => {
  const { page, errors } = await mount();
  const quote = await page.evaluate(() => (window as any).prepare({ cardsOnly: true }));
  expect(quote).toMatchObject({ maxCredits: 0, estimatedCredits: 0 });
  expect(await w(page, "window.saves")).toBe(1);
  expect(await w(page, "window.quotes.length")).toBe(0);
  const pub = await w(page, "window.saved.library.documents[0].publication");
  expect(pub.synchronizedStarted).toBe(true);
  expect(pub.automaticLayout).toBeUndefined();
  await new Promise(r => setTimeout(r, 500));
  expect(await w(page, "window.calls.length")).toBe(0);
  // 不调用 start：start 对只出卡片会因无准备记录而拒绝，证明不存在可被误触的顾问启动
  await expect(page.evaluate(q => (window as any).start(q.documentId, 0), quote)).rejects.toThrow("同步稿件已变化");
  expect(errors).toEqual([]);
  await page.close();
}, 60_000);

it("手册路径：三项报价同时发出（并发），全部完成后才写排版并返回", async () => {
  const { page, errors } = await mount();
  await w(page, "window.quoteMode={review:'hold',presentation:'hold',conversation:'hold'}");
  const done = page.evaluate(() => (window as any).prepare({ preparePresentation: true }));
  await page.waitForFunction(() => (window as any).pendingQuotes.length === 3, { timeout: 10_000 });
  expect(await w(page, "window.quotes.map(q=>q.purpose||'review')")).toEqual(["review", "presentation", "conversation"]);
  expect(await w(page, "window.saves")).toBe(1);
  await w(page, "window.pendingQuotes.forEach(q=>q.resolve())");
  await done;
  expect(await w(page, "window.saves")).toBe(2);
  expect(await w(page, "typeof window.saved.library.documents[0].publication.automaticLayout.requestId")).toBe("string");
  expect(await w(page, "window.saved.library.documents[0].publication.synchronizedStarted")).toBe(false);
  expect(errors).toEqual([]);
  await page.close();
}, 60_000);

it("手册路径：一项报价失败→与原串行同一错误；两项失败取原顺序在前者；不写排版、不前进", async () => {
  const { page } = await mount();
  // 排序在后的 conversation 先失败（0ms），排序在前的 presentation 后失败（200ms）：仍须抛 presentation 的错误
  await w(page, "window.quoteMode={presentation:{fail:'演示报价失败',delay:200},conversation:{fail:'排版报价失败',delay:0}}");
  await expect(page.evaluate(() => (window as any).prepare({ preparePresentation: true }))).rejects.toThrow("演示报价失败");
  expect(await w(page, "window.saves")).toBe(1);
  expect(await w(page, "window.saved.library.documents[0].publication.automaticLayout")).toBeUndefined();
  expect(await w(page, "window.saved.library.documents[0].publication.synchronizedStarted")).toBe(false);
  await w(page, "window.quoteMode={conversation:{fail:'排版报价失败'}}");
  await expect(page.evaluate(() => (window as any).prepare({}))).rejects.toThrow("排版报价失败");
  expect(await w(page, "window.calls.length")).toBe(0);
  await page.close();
}, 60_000);
