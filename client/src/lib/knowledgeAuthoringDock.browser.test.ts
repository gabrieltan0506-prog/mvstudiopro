import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";

it("顾问在正文旁响应式停靠，切换入口保留同一请求与未发送内容", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "dock-fixture.tsx", loader: "tsx", contents: `
      import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
      import {KnowledgeAuthoringRow,StableStudioDock} from './client/src/components/platform/KnowledgeAuthoringDock';
      function Advisor(){const [draft,setDraft]=useState(''),[result,setResult]=useState('');
        useEffect(()=>{window.mounts=(window.mounts||0)+1;return()=>{window.unmounts=(window.unmounts||0)+1}},[]);
        return <section id="advisor"><textarea aria-label="顾问问题" value={draft} onChange={e=>setDraft(e.target.value)}/>
          <button onClick={()=>{window.requests=(window.requests||0)+1;window.finish=()=>setResult('原请求已返回')}}>发送</button><p>{result}</p></section>}
      function App(){const [target,setTarget]=useState(null),[enabled,setEnabled]=useState(true);
        return <><button id="toggle" onClick={()=>setEnabled(v=>!v)}>切换入口</button>
          <div id="fallback"><StableStudioDock target={target}><Advisor/></StableStudioDock></div>
          <KnowledgeAuthoringRow enabled={enabled} onDock={setTarget}><textarea aria-label="正文" defaultValue="编辑区原文"/></KnowledgeAuthoringRow></>}
      createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" },
  });
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setViewport({ width: 1200, height: 900 });
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: '*{box-sizing:border-box} textarea{width:100%}' + readFileSync('client/src/components/platform/knowledgeAuthoringDock.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('.knowledge-authoring-advisor #advisor', { timeout: 5000 }).catch(error => {
      throw Error(String(error) + "; " + errors.join("; "));
    });
    const boxes = () => page.evaluate(() => {
      const a=document.querySelector('.knowledge-authoring-advisor')!.getBoundingClientRect();
      const t=document.querySelector('[aria-label="正文"]')!.getBoundingClientRect();
      return {a:{x:a.x,y:a.y},t:{y:t.y,right:t.right,bottom:t.bottom},overflow:document.documentElement.scrollWidth>innerWidth};
    });
    const wide = await boxes();
    expect(wide.a.x).toBeGreaterThan(wide.t.right);
    expect(wide.a.y).toBe(wide.t.y);
    await page.type('[aria-label="顾问问题"]', '保留这条未发送的问题');
    await page.click('#advisor button');
    await page.click('#toggle');
    await page.waitForSelector('#fallback #advisor');
    await page.evaluate(() => (window as any).finish());
    await page.waitForFunction(() => document.querySelector('#advisor')?.textContent?.includes('原请求已返回'));
    await page.click('#toggle');
    await page.waitForSelector('.knowledge-authoring-advisor #advisor');
    expect(await page.$eval('[aria-label="顾问问题"]',el=>(el as HTMLTextAreaElement).value)).toBe('保留这条未发送的问题');
    expect(await page.evaluate(() => [(window as any).mounts,(window as any).unmounts||0,(window as any).requests])).toEqual([1,0,1]);
    await page.setViewport({ width: 390, height: 844 });
    const narrow = await boxes();
    expect(narrow.a.y).toBeGreaterThanOrEqual(narrow.t.bottom);
    expect(narrow.overflow).toBe(false);
    expect(await page.$$eval('#advisor',els=>els.length)).toBe(1);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60000);
