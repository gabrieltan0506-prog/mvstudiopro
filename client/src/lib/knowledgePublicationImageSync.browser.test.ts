import { expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';

it('实际顾问组件在图片未齐时处理全文，首批图完成即审图而不等末图', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'image-sync-fixture.tsx', loader: 'tsx', contents: `
      import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import Panel from './client/src/components/platform/KnowledgePublicationPanel';
      import{layoutFromSource}from'./shared/editableLayout';
      import{knowledgeReviewBatches}from'./shared/knowledgePublication';
      import{knowledgeIllustrationRun}from'./client/src/lib/knowledgeIllustrationRun';
      window.images=knowledgeIllustrationRun(['image-0','image-1','image-2','image-3','image-4']);
      window.saved=layoutFromSource({owner:'7',sourceId:'sync',kind:'knowledge-publication',title:'同步手册',detailLevel:'full',body:'完整底稿',pages:[
        {pageIndex:1,headline:'完整正文',body:'必须保留的完整文字说明。',knowledgeRole:'reading'},
        ...Array.from({length:5},(_,i)=>({pageIndex:i+2,headline:'配图'+i,body:'配图说明'+i,imageJobId:'image-'+i,knowledgeRole:'illustration'}))
      ]});
      window.saved.publication.synchronizedStarted=true;window.calls=[];window.pending={};window.savedBatches=[];
      window.stream=input=>{const i=input.knowledgePublicationContext.batchIndex;window.calls.push(i);return new Promise(resolve=>{
        window.pending[i]=()=>{const s=window.saved.publication.source,b=knowledgeReviewBatches(s);resolve({success:true,creditsCharged:0,answer:JSON.stringify({kind:'knowledge_publication_batch_v1',batchIndex:i,batchCount:b.length,sourceDigest:'a'.repeat(64),reviewedPages:b[i].map(n=>s.pages[n].id),pages:b[i].map(n=>({id:s.pages[n].id,headline:s.pages[n].headline,body:'审校后的实际正文'+n,imageStatus:'absent',imageDescription:'',facts:[{term:'知识',statement:'真实审校内容'+n}],cautions:[]}))})})};
      })};
      function App(){const[doc,setDoc]=useState(window.saved);return <Panel doc={doc} autoStart preauthorizedCredits={0} waitForImages={window.images.wait} onBusy={()=>{}} onChange={setDoc} commit={async next=>{window.saved=structuredClone(next);window.savedBatches=[...next.publication.parallel?.completed||[]];setDoc(next);return{generation:'1'}}}/>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': path.resolve('client/src'), '@shared': path.resolve('shared') },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    plugins: [{ name: 'external-boundaries', setup(b) {
      b.onResolve({ filter: /^@\/lib\/(trpc|manhuaAdvisorStream|gcsTransfer)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path.endsWith('/trpc')
        ? `export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>({batches:4,remaining:4,consistencyKnown:false,paidUnit:1,maxCredits:0,estimatedCredits:0})}}}),editableLayout:{exportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};`
        : a.path.endsWith('/manhuaAdvisorStream') ? `export const streamManhuaAdvisor=input=>window.stream(input);` : `export const flyDownloadUrl=u=>u;` }));
    } }],
  });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('https://fixture.invalid');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => (window as any).calls.length === 1);
    expect(await page.evaluate(() => (window as any).calls)).toEqual([0]);
    expect(await page.evaluate(() => document.body.innerText)).toContain('创作顾问');
    // 全文仍在处理；只完成前四图，末图保持在途。
    await page.evaluate(() => { for (let i = 0; i < 4; i++) (window as any).images.done('image-' + i); });
    await page.waitForFunction(() => (window as any).calls.length === 2);
    expect(await page.evaluate(() => (window as any).calls)).toEqual([0, 1]);
    await page.evaluate(() => (window as any).pending[1]());
    await page.waitForFunction(() => (window as any).savedBatches.includes(1));
    expect(await page.evaluate(() => document.body.innerText)).toContain('审校后的实际正文1');
    expect(await page.$$eval('iframe',frames=>frames.some(f=>f.srcdoc.includes('审校后的实际正文1')))).toBe(true);
    expect(await page.evaluate(() => (window as any).saved.publication.review)).toBeUndefined();
    await page.evaluate(() => (window as any).pending[0]());
    await page.waitForFunction(() => (window as any).savedBatches.includes(0));
    expect(await page.evaluate(() => (window as any).calls)).toEqual([0, 1]);
    await page.evaluate(() => (window as any).images.done('image-4'));
    await page.waitForFunction(() => (window as any).calls.length === 3);
    expect(await page.evaluate(() => (window as any).calls)).toEqual([0, 1, 2]);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
