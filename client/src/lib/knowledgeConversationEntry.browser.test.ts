import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("手册对话在保存前拒绝单字问题，合法问题仍能保存并显示回复", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: "conversation-entry.tsx", loader: "tsx",
      contents: `
        import React,{useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import Panel from './client/src/components/platform/KnowledgeConversationPanel';
        import {layoutFromSource} from './shared/editableLayout';
        window.saves=[]; window.calls=[]; window.quotes=0;
        function App(){
          const [doc,setDoc]=useState(()=>layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'test',title:'水循环',body:'完整原文'}));
          const [busy,setBusy]=useState(false);
          return <Panel doc={doc} busy={busy} lock={setBusy} save={async next=>{window.saves.push(structuredClone(next));setDoc(next);}}/>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      `,
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [{ name: "对话外部边界", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(trpc|manhuaAdvisorStream)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path.endsWith("/trpc")
        ? `export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>{window.quotes++;return {maxCredits:0,paidUnit:1}}}}})};`
        : `export async function streamManhuaAdvisor(input){window.calls.push(input);if(input.question.trim().length<2)throw Error('问题至少两个字');return {answer:JSON.stringify({kind:'knowledge_conversation_v1',requestId:input.requestId,answer:'蒸发和凝结形成循环。',sources:[],supplementalImages:[]})};}`,
      }));
    } }],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request => void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://fixture.invalid");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector("textarea");
    const enter = async (text: string) => {
      await page.evaluate(text => {
        const input = document.querySelector("textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, text);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    };
    await enter("好");
    await page.evaluate(() => (document.querySelector("button:last-child") as HTMLButtonElement).click());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    expect(await page.evaluate(() => ({ saves: (window as any).saves.length, calls: (window as any).calls.length, quotes: (window as any).quotes })))
      .toEqual({ saves: 0, calls: 0, quotes: 0 });
    await enter("解释水循环");
    await page.evaluate(() => (document.querySelector("button:last-child") as HTMLButtonElement).click());
    await page.waitForFunction(() => document.body.innerText.includes("蒸发和凝结形成循环。"));
    expect(await page.evaluate(() => ({ saves: (window as any).saves.length, calls: (window as any).calls.length })))
      .toEqual({ saves: 2, calls: 1 });
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
