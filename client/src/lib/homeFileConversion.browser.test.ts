import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { readdir, readFile, mkdir } from "node:fs/promises";

it("转换格式与文件选择保持一致，检查后必须按报价确认才提交转换，窄屏不溢出", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import HomeFileConversion from './client/src/components/HomeFileConversion';
    globalThis.fixtureCalls=[];globalThis.fixtureHistory=[];globalThis.fetch=async()=>({ok:true});createRoot(document.getElementById('root')).render(<HomeFileConversion/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent", plugins: [{ name: "offline-query-fixture", setup(b) {
    b.onLoad({ filter: /[/\\]useAuth\.ts$/ }, () => ({ contents: "export const useAuth=()=>({user:{id:1}});", loader: "ts" }));
    b.onLoad({ filter: /[/\\]trpc\.ts$/ }, () => ({ contents: `import React from 'react';
      const query=name=>({useQuery:()=>{const[n,set]=React.useState(0);return {data:name==='formats'?{available:true,paidAvailable:true}:name==='quota'?{remaining:2}:globalThis.fixtureHistory,refetch:async()=>set(v=>v+1)};}});
      const mutation=name=>({useMutation:()=>({mutateAsync:async input=>{globalThis.fixtureCalls.push({name,input});if(name==='upload')return{uploadUrl:'https://offline.invalid/upload',requiredHeaders:{},objectName:'private-source'};if(name==='inspect'){globalThis.fixtureHistory=[{id:'inspection-1',status:'succeeded',fileName:input.fileName,formatId:input.formatId,lane:input.lane,phase:'inspect',result:{type:'inspection',notice:'PDF文字层可转为Word',source:{bytes:input.bytes},billing:{credits:4,needsOcr:false,available:true}}}];return{};}return{status:'queued'};}})});
      export const trpc={fileConversion:{formats:query('formats'),history:query('history'),quota:query('quota'),...Object.fromEntries(['upload','inspect','convert','cancel','download'].map(n=>[n,mutation(n)]))}};`, loader: "js" }));
  } }] });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1000 });
    const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true); page.on("request", r => r.respond({ status: 200, body: "" })); await page.goto("http://localhost/");
    await page.setContent('<html class="dark"><body style="margin:0;background:#0a0915"><div id="root"></div></body></html>');
    const assets = path.resolve("client/dist/assets");
    const styles = (await readdir(assets)).filter(f => f.endsWith(".css"));
    for (const style of styles) await page.addStyleTag({ content: await readFile(path.join(assets, style), "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = async (label: string) => page.evaluate(label => { const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === label); if (!b || b.disabled) throw Error(label + " unavailable"); b.click(); }, label);
    await page.waitForSelector('[aria-label="转换类别"]'); await click("电子书");
    expect(await page.$eval('input[type="file"]', el => el.getAttribute("accept"))).toBe(".epub");
    await click("文档"); await click("HTML → PDF");
    expect(await page.$eval('input[type="file"]', el => el.getAttribute("accept"))).toBe(".html,.htm");
    await page.$eval('input[type="file"]', el => { const dt = new DataTransfer(); dt.items.add(new File(['<p>正文</p>'], '原件.html', { type: 'text/html' })); (el as HTMLInputElement).files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await click("PDF → Word"); expect(await page.$eval('input[type="file"]', el => (el as HTMLInputElement).files?.length)).toBe(0);
    await page.$eval('input[type="file"]', el => { const dt = new DataTransfer(); dt.items.add(new File(['%PDF'], '原件.pdf', { type: 'application/pdf' })); (el as HTMLInputElement).files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.$eval('input[name="conversion-lane"]:not(:checked)', el => (el as HTMLInputElement).click());
    await click("免费检查文件"); await page.waitForFunction(() => document.body.textContent?.includes("确认内容与费用，开始转换"));
    const before = await page.evaluate(() => (globalThis as any).fixtureCalls);
    expect(before.map((c: any) => c.name)).toEqual(["upload", "inspect"]);
    expect(before[1].input).toMatchObject({ fileName: "原件.pdf", formatId: "pdf-docx", lane: "paid" });
    await mkdir('/tmp/matrix-vfx-home-ui', { recursive: true });
    await page.screenshot({ path: '/tmp/matrix-vfx-home-ui/desktop.png', fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/matrix-vfx-home-ui/mobile.png', fullPage: true });
    await click("确认内容与费用，开始转换");
    await page.waitForFunction(() => (globalThis as any).fixtureCalls.some((c: any) => c.name === "convert"));
    expect(await page.evaluate(() => (globalThis as any).fixtureCalls.find((c: any) => c.name === "convert").input)).toEqual({ id: "inspection-1", confirmedCredits: 4 });
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
