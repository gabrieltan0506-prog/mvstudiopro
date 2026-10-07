/** Existing multitrack UI + mocked callback only; does not submit a paid video request. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("生成式预设走当前片段原编辑回调，等待回执防双点，取消保留文字，换源清空草案", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Panel from './client/src/components/ManhuaEditMultitrackPanel';
    import {buildRoughCutClipsFromShots} from './shared/manhuaEditWorkflowBank';
    const shots=[1,2].map(index=>({index,durationSec:5,actionZh:'动作',dialogueZh:''}));
    const clips=buildRoughCutClipsFromShots(shots);globalThis.calls=[];
    function App(){const [active,setActive]=React.useState(1);return <Panel roughClips={clips} shots={shots} activeShotIndex={active} onSelectShot={setActive} stillIndexes={new Set()} clipIndexes={new Set([1,2])} fineCutByShot={{}} onFineCutChange={()=>{}}
      shotMedia={[1,2].map(shotIndex=>({shotIndex,clipBlockId:'clip-e01-g0'+shotIndex,outputUrl:'https://offline.invalid/'+shotIndex+'.mp4'}))}
      onVideoEditClip={(clipId,instruction)=>{globalThis.calls.push({clipId,instruction});return new Promise(resolve=>globalThis.finishEdit=resolve);}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.click('[data-manhua-edit-drawer-toggle="effects"]');
    await page.waitForSelector('[data-manhua-generative-effects]');
    await page.click('[data-generative-preset="transformation"]');
    expect(await page.$eval('[data-manhua-action="video-edit-clip"]', button => (button as HTMLButtonElement).disabled)).toBe(true);
    await page.type('[aria-label="生成式特效修改对象"]', "左侧持剑角色");
    const text = await page.$eval('[aria-label="生成式特效修改要求"]', input => (input as HTMLTextAreaElement).value);
    expect(text).toContain("战斗形态");
    await page.click('[data-manhua-action="video-edit-clip"]');
    await page.click('[data-manhua-action="video-edit-clip"]');
    const calls = await page.evaluate(() => (globalThis as any).calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].clipId).toBe("clip-e01-g01");
    expect(calls[0].instruction).toContain("修改对象：左侧持剑角色。");
    expect(calls[0].instruction).toContain("战斗形态");
    await page.evaluate(() => (globalThis as any).finishEdit("用户取消，未提交"));
    await page.waitForFunction(() => document.body.textContent?.includes("用户取消，未提交"));
    expect(await page.$eval('[aria-label="生成式特效修改要求"]', input => (input as HTMLTextAreaElement).value)).toBe(text);
    await page.click('[data-manhua-edit-source-segment="2"]');
    await page.waitForFunction(() => (document.querySelector('[aria-label="生成式特效修改要求"]') as HTMLTextAreaElement)?.value === "");
    expect(await page.$eval('[aria-label="生成式特效修改对象"]', input => (input as HTMLInputElement).value)).toBe("");
    expect(await page.$eval('[data-manhua-action="video-edit-clip"]', button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(1);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
