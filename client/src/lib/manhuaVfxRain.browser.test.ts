import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("数字雨参数经真实编辑器保存、重新挂载恢复并进入同一渲染请求", async () => {
  const bundle = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    const clip={id:'source',url:'gs://offline/source.mp4',label:'原片'};
    globalThis.saved=undefined;globalThis.submitted=[];
    HTMLMediaElement.prototype.pause=function(){};
    let root=createRoot(document.getElementById('root'));
    function App(){const[state,setState]=React.useState(globalThis.saved);return <ManhuaVfxEditor scopeKey="rain-scope" state={state} clips={[clip]} jobs={[]} busy={false}
     onStateChange={async next=>{globalThis.saved=JSON.parse(JSON.stringify(next));setState(next);return next;}}
     onSubmit={async input=>{globalThis.submitted.push(input);return 'offline-job';}} onSourceChange={()=>{}} onPreview={()=>{}}/>;}
    globalThis.remount=()=>{root.unmount();root=createRoot(document.getElementById('root'));root.render(<App/>);};root.render(<App/>);
  `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},logLevel:"silent"});
  const browser=await puppeteer.launch({headless:true});
  try {
    const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(String(e)));
    await page.setRequestInterception(true);page.on("request",r=>r.respond({status:200,body:""}));await page.goto("http://localhost/");await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const metadata=async()=>{await page.waitForSelector("video");await page.$eval("video",v=>{for(const[k,val]of Object.entries({duration:5,videoWidth:640,videoHeight:360}))Object.defineProperty(v,k,{configurable:true,value:val});v.dispatchEvent(new Event("loadedmetadata"));});};
    const click=async(label:string)=>page.evaluate(label=>{const b=Array.from(document.querySelectorAll("button")).find(b=>b.textContent===label);if(!b||b.disabled)throw Error(label+" unavailable");b.click();},label);
    await page.waitForSelector("select");await page.select("select:not([aria-label])","source");await metadata();await page.select('[aria-label="添加特效"]',"digital_rain");
    for(const[label,value]of [["列数","32"],["下落速度","0.47"],["拖尾字符","15"]])await page.$eval('[aria-label="数字雨'+label+'"]',(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));},value);
    await click("保存方案");await page.waitForFunction(()=>(globalThis as any).saved?.draft?.composition.effects.some((e:any)=>e.kind==="digital_rain"));
    const expected={columns:32,speed:.47,trail:15};
    expect(await page.evaluate(()=>(globalThis as any).saved.draft.composition.effects.find((e:any)=>e.kind==="digital_rain").rain)).toEqual(expected);
    await page.evaluate(()=>(globalThis as any).remount());await metadata();
    // 保存稿恢复后重新选中该层，不能只检查测试存储里的值。
    await page.evaluate(()=>{const b=Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="特效图层"] button')).find(b=>b.textContent?.includes('数字雨'));if(!b)throw Error('缺数字雨图层');b.click();});
    expect(await page.$eval('[aria-label="数字雨列数"]',el=>(el as HTMLInputElement).value)).toBe("32");
    expect(await page.$eval('[aria-label="数字雨下落速度"]',el=>(el as HTMLInputElement).value)).toBe("0.47");
    expect(await page.$eval('[aria-label="数字雨拖尾字符"]',el=>(el as HTMLInputElement).value)).toBe("15");
    await click("渲染特效候选");await page.waitForFunction(()=>(globalThis as any).submitted.length===1);
    expect(await page.evaluate(()=>(globalThis as any).submitted[0].params.composition.effects.find((e:any)=>e.kind==="digital_rain").rain)).toEqual(expected);
    expect(errors).toEqual([]);
  }finally{await browser.close();}
},60_000);
