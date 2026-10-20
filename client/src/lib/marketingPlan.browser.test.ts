import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("三结果切换、修改摘要、采用后保留原稿并进入真实创作编译；旧需求不能误采用", async () => {
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {MarketingPlanResults} from './client/src/components/platform/MarketingPlanPanel';
    import {newMarketingPlan,adoptMarketingPlan} from './shared/marketingPlan';
    import {compileViralCreatorInput} from './shared/viralCreationMethods';
    const result=newMarketingPlan('推广亲子绘本，已有第一页，尚无家长群');
    result.steps.deepseek={status:'succeeded',text:'DeepSeek完整原稿，保留公开招募路线'};
    result.steps.glm={status:'succeeded',text:'GLM完整原稿，保留免费共读路线'};
    result.steps.integrated={status:'succeeded',text:'整合方案：两种创意均保留，以实验验证。',adoptionBrief:'事实只有第一页；假设免费共读可行；建议用妈妈道歉的反差切口，封面和正文对应，发布标签须相关。'};
    result.billing='succeeded';
    function App(){const [value,setValue]=React.useState(result.context);globalThis.compiled=()=>compileViralCreatorInput({profile:value});
    return <><textarea aria-label="原始需求" value={value} readOnly/><MarketingPlanResults result={result} busy={false} stale={value!==result.context} onRetry={()=>{throw Error('不应重试成功结果')}} onApply={brief=>setValue(adoptMarketingPlan(value,brief).value)}/></>}
    createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  const browser=await puppeteer.launch({headless:true});
  try {
    const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(String(e)));
    await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForSelector('[role="tabpanel"]');
    expect(await page.$eval('[role="tabpanel"]',e=>e.textContent)).toContain("两种创意均保留");
    const tabs=await page.$$('[role="tab"]');await tabs[0].click();
    expect(await page.$eval('[role="tabpanel"]',e=>e.textContent)).toContain("DeepSeek完整原稿");
    await tabs[1].click();expect(await page.$eval('[role="tabpanel"]',e=>e.textContent)).toContain("GLM完整原稿");
    await tabs[2].click();
    await page.$eval('#marketing-adoption-brief',el=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,'修改后方案：事实只有第一页，假设共读可行，采用妈妈道歉的故事反差，标题正文封面统一。');
      el.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用方案，继续选题与制作')!.click());
    await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="原始需求"]')!.value.includes('修改后方案'));
    const value=await page.$eval('[aria-label="原始需求"]',e=>(e as HTMLTextAreaElement).value);
    expect(value).toContain('已有第一页，尚无家长群');
    expect(JSON.parse((await page.evaluate(()=>(globalThis as any).compiled())).user).profile).toBe(value);
    expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用方案，继续选题与制作')!.disabled)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await browser.close();}
},60_000);
