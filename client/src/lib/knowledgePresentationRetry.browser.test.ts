import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("KP-04失败重试需核对与确认，恢复后只调用一个新编号", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      sourcefile: "knowledge-publication-fixture.tsx",
      loader: "tsx",
      contents: `
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import Panel from './client/src/components/platform/KnowledgePublicationPanel';
 import {layoutFromSource} from './shared/editableLayout';
 import {knowledgeReviewBatches} from './shared/knowledgePublication';
 const initial=layoutFromSource({owner:'7',sourceId:'fixture',kind:'knowledge-publication',detailLevel:'full',title:'水循环',body:'',pages:Array.from({length:5},(_,i)=>({pageIndex:i+1,headline:'水循环阶段'+(i+1),body:'原始说明'+i}))});
 window.saved=initial;window.calls=[];window.exports=[];window.pptxExports=[];window.generation=0;let disconnected=false;
 window.stream=async input=>{window.calls.push(input);const c=input.knowledgePublicationContext;const s=window.saved.publication.source;if(c.purpose==='presentation'){if(!window.allowSuccess)throw new Error('ADVISOR_OPERATION_FAILED：本次问答未完成，请重新提问');const r=window.saved.publication.presentationRequest;return {answer:JSON.stringify({kind:'knowledge_presentation_v1',requestId:r.id,sourceDigest:'b'.repeat(64),title:s.title,minSlides:r.minSlides,maxSlides:r.maxSlides,fontStyle:'editorial',slides:Array.from({length:r.minSlides},(_,i)=>({type:'points',title:'提纲主题'+(i+1),sourcePageIds:[s.pages[i%s.pages.length].id],points:[i===0?'字\\n'.repeat(20)+'末':'顾问选择的实质知识'],notes:''}))}),creditsCharged:0};}const batches=knowledgeReviewBatches(s);if(c.batchIndex===1&&!disconnected){disconnected=true;throw new Error('测试断线，恢复原请求');}const answer=c.batchIndex===batches.length?{kind:'knowledge_consistency_batch_v1',sourceDigest:'a'.repeat(64),batchIndex:2,batchCount:4}:c.batchIndex===batches.length+1?{kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:s.title,pages:s.pages.map(p=>({id:p.id,headline:p.headline,body:'已补充知识解释：蒸发、凝结与降水。',imageStatus:'absent',imageDescription:'',facts:[{term:"知识要点",statement:"测试中的具体知识主张"}],cautions:[],reading:{version:1,templateId:'fusion_ink_mountains',templateReason:'自然主题适合水墨阅读风格',subtitle:'',accent:'jade',blocks:[{type:'prose',title:'知识说明',text:'已补充知识解释：蒸发、凝结与降水。',note:''}]}}))}:{kind:'knowledge_publication_batch_v1',sourceDigest:'a'.repeat(64),batchIndex:c.batchIndex,batchCount:batches.length,reviewedPages:batches[c.batchIndex].map(i=>s.pages[i].id)};return {success:true,answer:JSON.stringify(answer),creditsCharged:0};};
 function App(){const[doc,setDoc]=useState(window.saved);return <Panel doc={doc} onBusy={()=>{}} onChange={setDoc} commit={async next=>{window.saved=next;setDoc(next);return {generation:String(++window.generation)}}}/>};const root=createRoot(document.getElementById('root'));window.remount=()=>root.render(<App key={Date.now()}/>);root.render(<App/>);
 `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [
      {
        name: "test-boundary",
        setup(b) {
          b.onResolve(
            { filter: /^@\/lib\/(trpc|manhuaAdvisorStream|gcsTransfer)$/ },
            args => ({ path: args.path, namespace: "fixture" })
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
            loader: "js",
            contents: args.path.endsWith("/trpc")
              ? `export const trpc={useUtils:()=>({editableLayout:{presentationRetry:{fetch:async()=>{window.retryChecks=(window.retryChecks||0)+1;if(window.retryBlocked)throw Error('原请求积分仍在对账');return {requestId:'22222222-2222-4222-a222-222222222222'}}},publicationQuote:{fetch:async()=>({batches:window.saved.publication.completedBatches>=2?4:3,remaining:4-window.saved.publication.completedBatches,reviewBatches:2,consistencyKnown:window.saved.publication.completedBatches>=2,paidUnit:1,maxCredits:0,estimatedCredits:0})}}}),editableLayout:{exportPublicationPptx:{useMutation:()=>({mutateAsync:async input=>{window.pptxExports.push(input);return {pptxUrl:'https://test.invalid/book.pptx',pptxBytes:12000,slides:10}}})},exportPublication:{useMutation:()=>({mutateAsync:async input=>{window.exports.push(input);return {htmlUrl:'https://test.invalid/book.html',pdfUrl:'https://test.invalid/book.pdf'}}})}}};`
              : args.path.endsWith("/manhuaAdvisorStream")
                ? `export const streamManhuaAdvisor=(input)=>window.stream(input);`
                : `export const flyDownloadUrl=url=>url;`,
          }));
        },
      },
    ],
  });
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage(),
      errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on(
      "request",
      req =>
        void req.respond({
          status: 200,
          contentType: "text/html",
          body: '<html><body><div id="root"></div></body></html>',
        })
    );
    await page.goto("https://fixture.invalid");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = async (text: string) =>
      page.evaluate(text => {
        const button = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === text
        );
        if (!button) throw Error("按钮未找到:" + text);
        button.click();
      }, text);
    await page.waitForSelector("button").catch(error => {
      throw new Error(String(error) + "; 页面错误:" + errors.join(";"));
    });
    expect(await page.$("textarea")).toBeNull();
    expect(await page.$eval("body",el=>el.textContent)).toContain("完整版图卡 · 顾问精简重复说明");
    await click("开始自动审校");
    await page.waitForFunction(() =>
      document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("原稿")
    );
    expect(
      await page.evaluate(
        () => (window as any).saved.publication.completedBatches
      )
    ).toBe(1);
    await click("继续自动审校");
    await page.waitForFunction(
      () => (window as any).saved.publication.review?.pages.length === 5
    );
    const ids = await page.evaluate(() =>
      (window as any).calls.map((c: any) => c.requestId)
    );
    expect(ids[1]).toBe(ids[2]);
    expect(ids).toHaveLength(5);
    expect(await page.evaluate(() => (window as any).calls.some((c: any) => c.qaModel))).toBe(false);
    expect(await page.$eval("body", el => el.textContent)).not.toMatch(/DeepSeek|OpenRouter|EvoLink|Gemini|requestId/);
    expect(await page.$("textarea")).toBeNull();
    await click("查看或手动修改说明（可选）");
    await page.waitForSelector("textarea");
    expect(await page.$$eval("textarea", els => els.length)).toBe(1);
    expect(
      await page.$eval("textarea", el => (el as HTMLTextAreaElement).value)
    ).toContain("已补充知识解释");
    expect(await page.evaluate(() => (window as any).exports.length)).toBe(0);
    expect(await page.$eval('iframe', el => (el as HTMLIFrameElement).getAttribute('sandbox'))).toBe('allow-scripts');
    const frame=await (await page.$('iframe'))!.contentFrame();
    await frame!.waitForFunction(()=>document.querySelector('[data-booklet-root]')?.getAttribute('data-ready')==='true');
    expect(await frame!.$eval('body',el=>el.textContent)).toContain('已补充知识解释');
    expect(await page.$eval('iframe', el => (el as HTMLIFrameElement).srcdoc)).toContain('theme-fusion_ink_mountains');
    await page.select('select[aria-label="阅读模板"]', 'fusion_maple_bridge');
    await page.waitForFunction(() => document.querySelector('iframe')?.srcdoc.includes('class="theme-fusion_maple_bridge"'));
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(5);
    expect(await page.evaluate(() => (window as any).exports.length)).toBe(0);
    const setNumber=async(label:string,value:string)=>page.$eval(`input[aria-label="${label}"]`,(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    await setNumber("PPTX最少页数","5");await setNumber("PPTX最多页数","8");
    await click("规划 PPTX 提纲");
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent?.includes('未完成'));
    const first=await page.evaluate(()=>(window as any).calls.at(-1).requestId);
    await click("规划 PPTX 提纲");
    await page.waitForFunction(()=>(window as any).calls.length===7);
    const second=await page.evaluate(()=>(window as any).calls.at(-1).requestId);
    expect(second).toBe(first);
    expect(await page.evaluate(()=>(window as any).saved.publication.presentationPlan)).toBeUndefined();
    expect(await page.$('section[aria-label="修订PPTX提纲"]')).toBeNull();
    await page.evaluate(()=>{(window as any).retryBlocked=true;});
    await click("核对失败状态并重试");
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent?.includes('积分退款尚未核对完成'));
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(7);
    await page.evaluate(()=>{(window as any).retryBlocked=false;(window as any).confirmCalls=0;window.confirm=()=>{(window as any).confirmCalls++;return false;};});
    await click("核对失败状态并重试");
    await page.waitForFunction(()=>(window as any).confirmCalls===1);
    expect(await page.evaluate(()=>(window as any).saved.publication.presentationRequest.id)).toBe(first);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(7);
    await page.evaluate(()=>{(window as any).allowSuccess=true;window.confirm=()=>true;});
    await click("核对失败状态并重试");
    await page.waitForFunction(()=>(window as any).saved.publication.presentationPlan);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(8);
    expect(await page.evaluate(()=>(window as any).calls.at(-1).requestId)).toBe('22222222-2222-4222-a222-222222222222');
    await page.evaluate(()=>(window as any).remount());
    await page.waitForSelector('button');
    await click("规划 PPTX 提纲");
    await page.waitForFunction(()=>document.body.textContent?.includes('已恢复当前提纲'));
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(8);
    expect(errors).toEqual([]);

  } finally {
    await browser.close();
  }
}, 120000);
