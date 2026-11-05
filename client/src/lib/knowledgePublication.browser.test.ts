import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("真实单框组件自动分批、断线恢复同编号、可选手改与确认导出", async () => {
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
 window.saved=initial;window.calls=[];window.exports=[];window.generation=0;let disconnected=false;
 window.stream=async input=>{window.calls.push(input);const c=input.knowledgePublicationContext;const s=window.saved.publication.source;const batches=knowledgeReviewBatches(s);if(c.batchIndex===1&&!disconnected){disconnected=true;throw new Error('测试断线，恢复原请求');}const answer=c.batchIndex===batches.length?{kind:'knowledge_consistency_batch_v1',sourceDigest:'a'.repeat(64),batchIndex:2,batchCount:4}:c.batchIndex===batches.length+1?{kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:s.title,pages:s.pages.map(p=>({id:p.id,headline:p.headline,body:'已补充知识解释：蒸发、凝结与降水。',imageStatus:'absent',imageDescription:'',facts:[{term:"知识要点",statement:"测试中的具体知识主张"}],cautions:[],reading:{version:1,templateId:'fusion_ink_mountains',templateReason:'自然主题适合水墨阅读风格',subtitle:'',accent:'jade',blocks:[{type:'prose',title:'知识说明',text:'已补充知识解释：蒸发、凝结与降水。',note:''}]}}))}:{kind:'knowledge_publication_batch_v1',sourceDigest:'a'.repeat(64),batchIndex:c.batchIndex,batchCount:batches.length,reviewedPages:batches[c.batchIndex].map(i=>s.pages[i].id)};return {success:true,answer:JSON.stringify(answer),creditsCharged:0};};
 function App(){const[doc,setDoc]=useState(initial);return <Panel doc={doc} onBusy={()=>{}} onChange={setDoc} commit={async next=>{window.saved=next;setDoc(next);return {generation:String(++window.generation)}}}/>};createRoot(document.getElementById('root')).render(<App/>);
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
              ? `export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>({batches:window.saved.publication.completedBatches>=2?4:3,remaining:4-window.saved.publication.completedBatches,reviewBatches:2,consistencyKnown:window.saved.publication.completedBatches>=2,paidUnit:1,maxCredits:0,estimatedCredits:0})}}}),editableLayout:{exportPublication:{useMutation:()=>({mutateAsync:async input=>{window.exports.push(input);return {htmlUrl:'https://test.invalid/book.html',pdfUrl:'https://test.invalid/book.pdf'}}})}}};`
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
    await click("确认预览并生成 HTML 和 PDF");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("a")).some(
        a => a.textContent === "下载 PDF"
      )
    );
    expect(
      await page.evaluate(
        () => (window as any).saved.publication.confirmedManuscript
      )
    ).toContain("已补充知识解释");
    expect(await page.evaluate(() => (window as any).exports.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).saved.publication.infographicTemplateId)).toBe("fusion_maple_bridge");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 120000);
