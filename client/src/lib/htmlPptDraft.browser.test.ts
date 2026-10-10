import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("PPT真实面板刷新恢复编辑，作品隔离且坏稿不覆盖", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import{createRoot}from'react-dom/client';import Panel from './client/src/components/PlatformHtmlPptPanel';let root=createRoot(document.getElementById('root'));globalThis.mount=(key)=>root.render(<Panel key={key} draftKey={key} initialContent={{title:'初始标题',request:'原要求',text:''}}/>);globalThis.mount('test:1');` }, bundle:true, write:false, format:"iife", platform:"browser", jsx:"automatic", alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")}, define:{"process.env.NODE_ENV":'"test"',"import.meta.env":"{}"}, plugins:[{name:"服务隔离",setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"trpc",namespace:"stub"}));b.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:`const leaf={useMutation:()=>({isPending:false,mutateAsync:async()=>{throw Error('禁止调用')}}),useQuery:()=>({data:[],refetch:async()=>({data:[]})})};export const trpc={codeMotion:{resolveImages:leaf},mvAnalysis:new Proxy({}, {get:()=>leaf})};`}));}}]});
  const browser=await puppeteer.launch({headless:true});
  try {
    const p=await browser.newPage();p.setDefaultTimeout(7000);
    await p.setRequestInterception(true);p.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
    const open=async()=>{await p.goto('http://localhost:41945/');await p.addScriptTag({content:bundle.outputFiles[0].text});await p.waitForSelector('input');};
    await open();
    await p.evaluate(()=>{const input=Array.from(document.querySelectorAll('input')).find(e=>e.value==='初始标题')!;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,'用户编辑的标题');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await p.waitForFunction(()=>JSON.parse(localStorage.getItem('test:1')||'{}').title==='用户编辑的标题');
    await open();await p.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(e=>e.value==='用户编辑的标题'));
    await p.evaluate(()=>(globalThis as any).mount('test:2'));
    await p.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(e=>e.value==='初始标题'));
    expect(await p.evaluate(()=>JSON.parse(localStorage.getItem('test:1')!).title)).toBe('用户编辑的标题');
    await p.evaluate(()=>{localStorage.setItem('test:bad','invalid');(globalThis as any).mount('test:bad');});
    await p.waitForFunction(()=>document.body.innerText.includes('已保留原记录'));
    expect(await p.evaluate(()=>localStorage.getItem('test:bad'))).toBe('invalid');
  } finally {await browser.close();}
},30000);
