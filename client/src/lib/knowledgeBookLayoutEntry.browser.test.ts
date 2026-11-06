import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("真实排版按钮保存完整稿、获取方案、采用方案后使用该版本导出PDF", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "layout-entry.tsx", loader: "tsx", contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Panel from './client/src/components/platform/KnowledgeConversationPanel';
      import {layoutFromSource} from './shared/editableLayout';
      import {knowledgeManuscript} from './shared/knowledgePublication';
      window.events=[];window.plans=[];window.exported=null;
      function App(){
        const [doc,setDoc]=useState(()=>{
          const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'test-layout',title:'章节试排',body:'完整说明必须保留'});
          doc.publication.review={kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:doc.title,pages:doc.pages.map(p=>({...p,imageStatus:'absent',imageDescription:'',facts:[{term:'说明',statement:p.body}],cautions:[]}))};
          doc.publication.manuscript=knowledgeManuscript(doc.publication.review);
          return doc;
        });
        const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
        return <><Panel doc={doc} busy={busy} lock={setBusy} save={async next=>{
          const step=next.publication.layoutConversationId?'save-plan':next.publication.conversation?.length?'save-request':'save-manuscript';
          window.events.push(step);window.doc=structuredClone(next);setDoc(next);return {generation:String(window.events.length)};
        }} onLayout={async(next,saved)=>{
          window.events.push('export');window.exported={id:next.publication.layoutConversationId,generation:saved.generation,body:next.publication.manuscript};
          setMessage('PDF已导出');
        }}/><output>{message}</output></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",
    alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},
    define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},
    plugins:[{name:"隔离外部请求",setup(builder){
      builder.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream)$/},args=>({path:args.path,namespace:"fixture"}));
      builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",contents:args.path.endsWith('/trpc') ? `
        export const trpc={useUtils:()=>({editableLayout:{
          bookLayoutInput:{fetch:async()=>{window.events.push('input');return {sourceDigest:'a'.repeat(64),chapters:1,images:0};}},
          publicationQuote:{fetch:async()=>{window.events.push('quote');return {maxCredits:0,paidUnit:1};}}
        }})};` : `
        export async function streamManhuaAdvisor(input){
          window.events.push('advisor');window.plans.push(input);
          return {answer:JSON.stringify({kind:'knowledge_conversation_v1',requestId:input.requestId,answer:'按完整章节排版。',sources:[],supplementalImages:[],layoutPlan:{kind:'knowledge_book_layout_v1',sourceDigest:'a'.repeat(64),chapters:window.doc.pages.map(p=>({pageId:p.id,design:{palette:'ink-cinnabar',layout:'editorial',table:'rules',frame:'none',motif:'bamboo-seal',reason:'本章历史记录以竹简纹样呼应内容。'}}))}})};
        }` }));
    }}],
  });
  const browser=await puppeteer.launch({headless:true});
  try{
    const page=await browser.newPage(),errors:string[]=[];
    page.on('pageerror',e=>errors.push(String(e)));
    page.on("dialog",dialog=>{expect(dialog.message()).toContain("顾问不另收费");void dialog.accept();});
    await page.setRequestInterception(true);
    page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('https://fixture.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('让顾问重新排版')));
    await page.evaluate(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('让顾问重新排版'))!;button.click();button.click();});
    await page.waitForFunction(()=>document.querySelector('output')?.textContent==='PDF已导出');
    const result=await page.evaluate(()=>({events:(window as any).events,plans:(window as any).plans,exported:(window as any).exported,doc:(window as any).doc}));
    expect(result.events).toEqual(['save-manuscript','input','quote','save-request','advisor','save-plan','export']);
    expect(result.plans).toHaveLength(1);expect(result.exported.generation).toBe('6');
    expect(result.exported.id).toBe(result.plans[0].requestId);
    expect(result.doc.publication.conversation[0].request.action).toBe('layout');
    expect(result.exported.body).toContain('完整说明必须保留');expect(errors).toEqual([]);
  }finally{await browser.close();}
},30000);
