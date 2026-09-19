import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import ts from "typescript";
import puppeteer, { type Browser } from "puppeteer";
import { beforeAll, afterAll, it, expect } from "vitest";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const raw = readFileSync(
    new URL("../pages/OmniCanvas.tsx", import.meta.url),
    "utf8"
  );
  const source = ts.createSourceFile(
    "OmniCanvas.tsx",
    raw,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let menu = "";
  function visit(node: ts.Node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        p =>
          ts.isJsxAttribute(p) &&
          p.name.getText(source) === "data-canvas-backup-menu"
      )
    )
      menu = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!menu) throw Error("真实备份菜单未找到");
  const start = raw.indexOf("  const latestDraftSnapshotRef =");
  const end = raw.indexOf("  /** 从本机备份导入", start);
  if (start < 0 || end < 0) throw Error("真实导出生产区未找到");
  const production = raw.slice(start, end);
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
 import React,{useRef,useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
 import JSZip from 'jszip';
 import {buildLocalCloudDraftSnapshot} from './client/src/lib/manhuaCloudDraftSync';
 import {collectManhuaBackupImageSources} from './client/src/lib/manhuaBackupImageSources';
 import {assertManhuaBackupImage} from './client/src/lib/manhuaBackupImageValidation';
 import {resolveUrlForLocalPersist,isLocalMediaPointer,localMediaPointerId,getLocalMediaRecord,getLocalMediaRecordBySource} from './client/src/lib/manhuaLocalMediaStore';
 const f=globalThis.fixture={requests:0,downloads:0,toasts:[],failPack:false,release:null};
 const toast=Object.fromEntries(['success','warning','error','message'].map(kind=>[kind,text=>f.toasts.push({kind,text})]));
 const assetImageGcsUri=()=>undefined;const resolveCanvasMaterialUrl=async()=>{throw Error('本夹具无云存储');};
 globalThis.fetch=async()=>{f.requests++;return await new Promise(resolve=>f.release=()=>resolve(new Response('',{status:404})));};
 HTMLAnchorElement.prototype.click=function(){f.downloads++;};
 const pack=JSZip.prototype.generateAsync;JSZip.prototype.generateAsync=function(...args){if(f.failPack)throw Error('测试打包异常');return pack.apply(this,args);};
 function App(){
 ${production}
 latestDraftSnapshotRef.current={writerSession:{},blocks:[],edges:[],factoryPrefs:{customAssetRefs:[{id:'one',url:'https://test.invalid/one.png'}]}};
 const factoryBusy=false,writerBusy=false,cloudSyncReady=true;
 const uploadCloudBackupNow=()=>{},restoreCloudBackupNow=()=>{},importBackupFile=()=>{};
 f.run=exportBackupFile;f.lock=backupOperationRef;f.cloudBusy=cloudBackupBusy;
 return ${menu};
 }
 createRoot(document.getElementById('root')).render(<App/>);
 `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 180000);
afterAll(async () => {
  await browser?.close();
});
it("真实导出菜单显示忙碌；同tick重入仅一次；部分包和异常终态均恢复", async () => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", r => {
    if (r.isNavigationRequest())
      void r.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>',
      });
    else void r.abort();
  });
  try {
    await page.goto("http://localhost:41797");
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector("[data-canvas-backup-menu] select");
    await page.select("select", "export");
    await page.evaluate(() => {
      void (window as any).fixture.run();
    });
    await page.waitForFunction(() => (window as any).fixture.requests === 1);
    expect(
      await page.$eval("select", e => (e as HTMLSelectElement).disabled)
    ).toBe(true);
    expect(await page.$eval('[role="status"]', e => e.textContent)).toContain(
      "正在收集图片 1/1"
    );
    expect(await page.$eval("select", e => e.textContent)).toContain("导出中");
    await page.evaluate(() => (window as any).fixture.release());
    await page.waitForFunction(
      () => !(document.querySelector("select") as HTMLSelectElement).disabled
    );
    let state = await page.evaluate(() => ({
      requests: (window as any).fixture.requests,
      downloads: (window as any).fixture.downloads,
      toasts: (window as any).fixture.toasts,
    }));
    expect(state.requests).toBe(1);
    expect(state.downloads).toBe(1);
    expect(state.toasts.at(-1)?.kind).toBe("warning");
    expect(await page.$('[role="status"]')).toBeNull();
    await page.evaluate(() => ((window as any).fixture.failPack = true));
    await page.select("select", "export");
    await page.waitForFunction(() => (window as any).fixture.requests === 2);
    await page.evaluate(() => (window as any).fixture.release());
    await page.waitForFunction(
      () => !(document.querySelector("select") as HTMLSelectElement).disabled
    );
    expect(
      await page.evaluate(() => (window as any).fixture.toasts.at(-1))
    ).toEqual({ kind: "error", text: "测试打包异常" });
    await page.evaluate(() => ((window as any).fixture.failPack = false));
    await page.select("select", "export");
    await page.waitForFunction(() => (window as any).fixture.requests === 3);
    await page.evaluate(() => (window as any).fixture.release());
    await page.waitForFunction(() => (window as any).fixture.downloads === 2);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}, 30000);
