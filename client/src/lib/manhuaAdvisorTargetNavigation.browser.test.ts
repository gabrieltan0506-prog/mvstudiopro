import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("剪辑台从旧片段切到指定clip后才交顾问修改，打开对应特效抽屉", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import Panel from './client/src/components/ManhuaEditMultitrackPanel';
    import {executeAdvisorEffectsWhenReady} from './client/src/lib/manhuaAdvisorEffectsNavigation';import {buildRoughCutClipsFromShots} from './shared/manhuaEditWorkflowBank';
    const shots=[1,2].map(index=>({index,durationSec:5,actionZh:'动作',dialogueZh:''}));const clips=buildRoughCutClipsFromShots(shots);globalThis.calls=[];window.confirm=()=>true;const noop=()=>{};const register=(_,__,control)=>globalThis.control=control;
    function App(){const[active,setActive]=React.useState(1);globalThis.focusTarget=()=>setActive(2);return <Panel roughClips={clips} shots={shots} activeShotIndex={active} onSelectShot={setActive} stillIndexes={new Set()} clipIndexes={new Set([1,2])} fineCutByShot={{}} onFineCutChange={noop} effectsScopeKey='project:navigation' onAdvisorEffectsControl={register}
    shotMedia={[1,2].map(shotIndex=>({shotIndex,clipBlockId:'clip-e01-g0'+shotIndex,outputUrl:'https://offline.invalid/'+shotIndex+'.mp4'}))} onVideoEditClip={async(clipId,instruction)=>{globalThis.calls.push({clipId,instruction});return '用户取消，未提交';}}/>;}
    globalThis.navigate=()=>executeAdvisorEffectsWhenReady({action:{action:'effects',tool:'generative',operation:'inspect',clipId:'clip-e01-g02'},signal:new AbortController().signal,getControl:()=>globalThis.control,isCurrent:()=>true,attempts:10,wait:async()=>{globalThis.focusTarget();await new Promise(resolve=>setTimeout(resolve,20));}});
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text }); await page.waitForFunction(() => Boolean((globalThis as any).control));
    let target = await page.evaluate(async () => JSON.parse(await (globalThis as any).navigate())); expect(target.clipId).toBe("clip-e01-g02");
    expect(await page.$eval('[data-manhua-edit-drawer="effects"]', element => (element as HTMLElement).hidden)).toBe(false);
    await page.evaluate(async target => (globalThis as any).control({ action: "effects", tool: "generative", operation: "configure", clipId: target.clipId, sourceKey: target.sourceKey, generativeSettings: { presetId: "spirit", target: "持剑角色", instruction: "将衣服转成灵体材质" } }, new AbortController().signal), target);
    await page.waitForFunction(() => (document.querySelector('[aria-label="生成式特效修改对象"]') as HTMLInputElement).value === "持剑角色");
    target = await page.evaluate(async () => JSON.parse(await (globalThis as any).control({ action: "effects", tool: "generative", operation: "inspect" }, new AbortController().signal)));
    await page.evaluate(async target => (globalThis as any).control({ action: "effects", tool: "generative", operation: "submit", clipId: target.clipId, sourceKey: target.sourceKey }, new AbortController().signal), target);
    expect(await page.evaluate(() => (globalThis as any).calls.map((call: any) => call.clipId))).toEqual(["clip-e01-g02"]); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
