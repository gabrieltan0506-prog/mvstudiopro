/** 离线挂载真实输入组件与原草稿函数，不访问生产或模型。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { buildCustomCopyPdfHtml } from "./customCopyPdfExport";

it("商品背景、价格测算、关闭营销与账号隔离草稿往返", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MarketingOfferPanel} from './client/src/components/platform/MarketingOfferPanel';
    import {readWorkbenchDraft,writeWorkbenchDraft} from './client/src/lib/platformWorkbenchMode';
    import {compileViralCreatorInput} from './shared/viralCreationMethods';
    function App(){ const [context,setContext]=React.useState(readWorkbenchDraft('test-user')?.focusPrompt || '保留原稿语气');
      globalThis.compiled=()=>compileViralCreatorInput({profile:context});
      globalThis.other=()=>readWorkbenchDraft('other-user');
      return <><textarea aria-label="创作需求" value={context} readOnly/><MarketingOfferPanel context={context} onChange={value=>{setContext(value);writeWorkbenchDraft('test-user',{mode:'create',focusPrompt:value,persona:{identity:'',domain:'',audience:'',businessGoal:''},freeformOverride:true,enabledSkillIds:[],topicShortlistCount:3,outputType:'single_page',createStep:'persona'});}}/></>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request => { void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }); });
    await page.goto("https://marketing-offline.test");
    const mount = () => page.addScriptTag({ content: bundle.outputFiles[0].text });
    await mount();
    const click = (label: string) => page.evaluate(text => { const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent === text); if (!button) throw Error("找不到按钮:" + text); button.click(); }, label);
    await page.click("summary");
    await click("参考：亲子绘本与动画");
    await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("产品方向：亲子关系"));
    expect(await page.$eval("textarea", element => element.value)).toContain("保留原稿语气");
    await page.evaluate(() => { const details = document.querySelectorAll("details"); details[1].open = true; });
    const values = ["100", "30", "10", "50"];
    await page.evaluate(inputs => { document.querySelectorAll("input").forEach((element, i) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, inputs[i]); element.dispatchEvent(new Event("input", { bubbles: true })); }); }, values);
    await page.waitForFunction(() => document.body.textContent?.includes("单笔贡献：60.00"));
    await click("把本次测算加入需求");
    await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("60.00"));
    const saved = await page.$eval("textarea", element => element.value);
    expect(JSON.parse((await page.evaluate(() => (globalThis as any).compiled())).user).profile).toBe(saved);
    await page.reload(); await mount();
    await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("60.00"));
    expect(await page.$eval("textarea", element => element.value)).toBe(saved);
    expect(await page.evaluate(() => (globalThis as any).other())).toBeNull();
    await click("本轮不用营销方法");
    await page.waitForFunction(() => document.body.textContent?.includes("当前未启用商业方法"));
    const compiled = await page.evaluate(() => (globalThis as any).compiled());
    expect(compiled.system).not.toContain("营销方法补充");
    expect(JSON.parse(compiled.user).methodLibrary.some((method: {id: string}) => method.id.startsWith("marketing-"))).toBe(false);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);

it("导出建议单独成段，不作为正文标题或混入发布文案", () => {
  const html = buildCustomCopyPdfHtml({ kind: "optimize_custom_copy", sourceText: "原文", optimizeResult: "发布正文", optimizeSummary: "候选定价待补成本" });
  expect(html).toContain("优化说明与平台建议");
  expect(html).toContain("候选定价待补成本");
  expect(html).not.toContain("深度优化结果 · 候选定价");
});
