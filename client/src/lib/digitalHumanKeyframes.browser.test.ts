import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("关键图从上传候选经审图采用和恢复进入真实视频回执，身份变化撤回审图", async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {DigitalHumanKeyframePanel} from './client/src/components/DigitalHumanKeyframePanel';
      import {newDigitalHumanDraft,loadDigitalHumanDraft,prepareDigitalHumanVideo} from './shared/digitalHumanStudio';
      const d=newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000001'), aid='00000000-0000-4000-8000-000000000002';
      d.script='看前方资料。';d.voiceId='test';d.portrait={source:'https://test.invalid/person.png',name:'本人'};d.scene={source:'https://test.invalid/scene.png',name:'场景'};
      d.audios=[{request:{billingRequestId:aid,input:d.script,voice:d.voiceId,speakerZh:'本人',speakerId:'test',voiceStateZh:''},source:'https://test.invalid/audio.wav',durationSec:12,status:'succeeded'}];d.approvedAudioRequestId=aid;
      globalThis.saved=d;globalThis.uploads=0;globalThis.flushes=0;
      function App(){const[draft,setDraft]=React.useState(d);const save=fn=>{globalThis.saved=fn(globalThis.saved);setDraft(globalThis.saved)};
        globalThis.restore=()=>{globalThis.saved=loadDigitalHumanDraft(JSON.stringify(globalThis.saved),'7');setDraft(globalThis.saved)};
        globalThis.changePerson=()=>save(old=>({...old,portrait:{source:'https://test.invalid/new-person.png',name:'新本人图'}}));
        globalThis.consume=()=>prepareDigitalHumanVideo(globalThis.saved,'00000000-0000-4000-8000-000000000003');
        return <DigitalHumanKeyframePanel draft={draft} disabled={false} save={save} beforeSubmit={async()=>{globalThis.flushes++}} acquireWork={()=>()=>{}}
        uploadFile={async file=>{globalThis.uploads++;return{source:'https://test.invalid/'+file.name,name:file.name}}}/>;
      }createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "offline-media", setup(b) {
      b.onResolve({ filter: /^\.\/DigitalHumanStudio$/ }, () => ({ path: "media", namespace: "offline" }));
      b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: `import React from 'react';export const DigitalHumanMedia=({source,name})=><img src={source} alt={name}/>;`, loader: "tsx", resolveDir: process.cwd() }));
    } }], logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r => { void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }); });
    await page.goto("https://test.invalid"); await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.waitForSelector('input[type="file"]');
    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const files = new DataTransfer(); files.items.add(new File(["test-only"], "C.png", { type: "image/png" }));
      input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => (globalThis as any).saved.keyframes?.length === 1);
    expect(await page.evaluate(() => (globalThis as any).consume().keyframes)).toBeUndefined();
    const setField = async (selector: string, value: string) => page.evaluate(({ selector, value }) => {
      const input = document.querySelector(selector)!;
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, { selector, value });
    await setField("textarea", "本人点选前方C板，六板正面平行画面");
    await setField('input[type="number"]', "2");
    await setField('label:has(input[type="number"]) + label input[type="number"]', "8");
    await page.click('input[type="checkbox"]');
    await page.evaluate(() => { const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "采用到对应片段")!; if (button.disabled) throw new Error("采用未解锁"); button.click(); });
    await page.waitForFunction(() => (globalThis as any).saved.keyframes[0].adopted);
    await page.evaluate(() => (globalThis as any).restore());
    const row = await page.evaluate(() => (globalThis as any).consume());
    expect(row.keyframes[0].media.source).toBe("https://test.invalid/C.png");
    expect(row.keyframes[0].startSec).toBe(2); expect(row.keyframes[0].endSec).toBe(8);
    await page.evaluate(() => (globalThis as any).changePerson());
    await page.waitForFunction(() => document.body.textContent?.includes("输入变化，需重新审图"));
    expect(await page.$eval('input[type="checkbox"]', e => (e as HTMLInputElement).checked)).toBe(false);
    expect(await page.evaluate(() => { try { (globalThis as any).consume(); return "错误地通过"; } catch (e) { return String(e); } })).toContain("输入已改变");
    expect(await page.evaluate(() => (globalThis as any).uploads)).toBe(1);
    expect(await page.evaluate(() => (globalThis as any).flushes)).toBeGreaterThanOrEqual(4);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
