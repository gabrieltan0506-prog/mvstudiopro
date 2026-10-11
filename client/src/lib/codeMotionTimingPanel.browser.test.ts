import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
it("real timing panel keeps irregular word times, edits/confirmation survive reload and removed source selection resets", async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Panel from './client/src/components/code-motion/CodeMotionTimingPanel';const original={id:'22222222-2222-4222-8222-222222222222',name:'真实原音',gcsUri:'gs://fixture/audio.wav',duration:10,mimeType:'audio/wav',sha256:'a'.repeat(64),bytes:20};const replacement={...original,id:'33333333-3333-4333-8333-333333333333',name:'新原音'};function App(){const[value,setValue]=useState(JSON.parse(localStorage.getItem('timing')||'null')||undefined),[sources,setSources]=useState([original]);globalThis.fixture={value,replace:()=>{setValue(undefined);setSources([replacement])}};return <Panel value={value} sources={sources} audioSources={[]} onChange={next=>{setValue(next);localStorage.setItem('timing',JSON.stringify(next));}} onAnalyze={async sourceId=>({version:1,sourceId,sourceSha256:original.sha256,method:'native-audio-estimate',review:'needs-review',words:[{id:'word',text:'跳跃',startSec:.37,endSec:.83,confidence:.8,action:'pop'}],beats:[{id:'beat',at:.52,strength:.9}]})}/>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.setRequestInterception(true);
    page.on("request", r =>
      r.isNavigationRequest()
        ? void r.respond({
            status: 200,
            contentType: "text/html",
            body: '<div id="root"></div>',
          })
        : void r.abort()
    );
    const open = async () => {
      await page.goto("http://localhost:41959/");
      await page.addScriptTag({ content: result.outputFiles[0].text });
      await page.waitForSelector('select[aria-label="词拍原音"]');
    };
    await open();
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent?.includes("分析 / 恢复"))!
        .click()
    );
    await page.waitForSelector('input[aria-label="1 startSec"]');
    expect(
      await page.$eval(
        'input[aria-label="1 startSec"]',
        e => (e as HTMLInputElement).value
      )
    ).toBe("0.37");
    await page.$eval('input[aria-label="1 startSec"]', e => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(e, "0.44");
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent?.includes("已试听核对"))!
        .click()
    );
    await page.waitForFunction(
      () => (globalThis as any).fixture.value?.review === "confirmed"
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.value.words[0])
    ).toMatchObject({ startSec: 0.44, endSec: 0.83, action: "pop" });
    await open();
    expect(
      await page.evaluate(() => (globalThis as any).fixture.value.review)
    ).toBe("confirmed");
    await page.evaluate(() => (globalThis as any).fixture.replace());
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            'select[aria-label="词拍原音"]'
          ) as HTMLSelectElement
        ).value === "33333333-3333-4333-8333-333333333333"
    );
    expect(await page.$('[role="alert"]')).toBeNull();
  } finally {
    await browser.close();
  }
}, 45000);
