import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
let browser: Browser;
let bundle: string;
const files = mkdtempSync(path.join(tmpdir(), "manhua-register-"));
const sourceFile = path.join(files, "原第二段.mp4");
beforeAll(async () => {
  writeFileSync(sourceFile, "test-original-video");
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import Panel from './client/src/components/ManhuaEditMultitrackPanel';
    import {buildRoughCutClipsFromShots} from '@shared/manhuaEditWorkflowBank';
    const shots=[1,2].map(index=>({index,durationSec:15,actionZh:'第'+index+'段原稿',dialogueZh:''}));
    const rough=buildRoughCutClipsFromShots(shots);const f=globalThis.fixture={calls:[]};
    function App(){const [active,setActive]=useState(1),[busy,setBusy]=useState(false),[media,setMedia]=useState([]);
      f.busy=setBusy;f.adopt=()=>setMedia([{shotIndex:2,clipBlockId:'clip-e01-g02',outputUrl:'https://test.invalid/original-2.mp4'}]);
      return <Panel roughClips={rough} shots={shots} segmentGroups={[{index:1,durationSec:15,shotIndexes:[1]},{index:2,durationSec:15,shotIndexes:[2]}]}
        activeShotIndex={active} onSelectShot={setActive} stillIndexes={new Set()} clipIndexes={new Set()} fineCutByShot={{}}
        onFineCutChange={()=>{}} shotMedia={media} registerClipBusy={busy} registerClipProgress={0.5}
        onRegisterSegmentClip={(segment,file)=>f.calls.push({segment,name:file.name,size:file.size})}/>;}
    createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"test"' } });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); rmSync(files, { recursive: true, force: true }); });
it("剪辑页按选中源段登记原片，上传锁禁止另一入口，登记后展示真实源片", async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", request => request.isNavigationRequest() ? void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void request.abort());
  try {
    await page.goto("http://localhost:41834"); await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[data-manhua-edit-register-segment="1"]');
    await page.click('[data-manhua-edit-source-segment="2"]');
    await page.waitForSelector('[data-manhua-edit-register-segment="2"]');
    const chooserPromise = page.waitForFileChooser();
    await page.click('[data-manhua-edit-register-segment="2"]');
    await (await chooserPromise).accept([sourceFile]);
    expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([{ segment: 2, name: "原第二段.mp4", size: 19 }]);
    await page.evaluate(() => (window as any).fixture.busy(true));
    await page.waitForFunction(() => (document.querySelector('[data-manhua-edit-register-segment="2"]') as HTMLButtonElement)?.disabled);
    expect(await page.$eval('[data-manhua-edit-register-segment="2"]', element => element.textContent)).toContain("50%");
    await page.click('[data-manhua-edit-source-segment="1"]');
    expect(await page.$eval('[data-manhua-edit-register-segment="1"]', element => (element as HTMLButtonElement).disabled)).toBe(true);
    expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(1);
    await page.evaluate(() => { (window as any).fixture.busy(false); (window as any).fixture.adopt(); });
    await page.click('[data-manhua-edit-source-segment="2"]');
    await page.waitForSelector('video[aria-label="来源第 2 段已生成画面预览"]');
    expect(await page.$eval('video[aria-label="来源第 2 段已生成画面预览"]', element => element.getAttribute('src'))).toBe('https://test.invalid/original-2.mp4');
    expect(await page.$$('[data-manhua-edit-register-segment="2"]')).toHaveLength(0);
    expect(errors).toEqual([]);
  } catch (error) { console.error("登记测试页面:", await page.evaluate(() => document.body.innerText), errors); throw error; } finally { await page.close(); }
}, 30000);
