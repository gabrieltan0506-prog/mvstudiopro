import {expect,it} from 'vitest';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';

it.each([false,true])('真实组件自动排版同ID恢复；保存失败场景=%s',async(saveFailure)=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'auto-layout.tsx',loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import Panel from './client/src/components/platform/KnowledgePublicationPanel';
 import{layoutFromSource}from'./shared/editableLayout';
 window.saved=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'auto-layout',title:'完整手册',body:'完整正文不可丢失'});
 window.saved.publication.synchronizedStarted=true;window.saved.publication.billing.confirmed=true;
 window.saved.publication.automaticLayout={requestId:'11111111-1111-4111-a111-111111111111',maxCredits:0};
 window.calls=[];window.exports=[];window.disconnected=false;
 window.stream=async input=>{
 window.calls.push(input);const s=window.saved.publication.source;
 if(input.knowledgePublicationContext.purpose==='conversation'){
 if(!window.disconnected){window.disconnected=true;throw Error('测试网络断开，保留原排版请求');}
 return {creditsCharged:0,answer:JSON.stringify({kind:'knowledge_conversation_v1',requestId:input.requestId,answer:'完整图文已安排。',sources:[],supplementalImages:[],layoutPlan:{kind:'knowledge_book_layout_v1',sourceDigest:'b'.repeat(64),chapters:s.pages.map(p=>({pageId:p.id,design:{palette:'ink-cinnabar',layout:'editorial',table:'rules',frame:'none',motif:'bamboo-seal',reason:'内容采用编辑式层次'}}))}})};
 }
 const pages=s.pages.map(p=>({id:p.id,headline:p.headline,body:'完整正文不可丢失，加入真实审校解释。',imageStatus:'absent',imageDescription:'',facts:[{term:'原文',statement:'完整正文不可丢失'}],cautions:[]}));
 return {creditsCharged:0,answer:JSON.stringify(input.knowledgePublicationContext.batchIndex===0?{kind:'knowledge_publication_batch_v1',batchIndex:0,batchCount:1,sourceDigest:'a'.repeat(64),reviewedPages:pages.map(p=>p.id),pages}:{kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:s.title,pages})};
 };
 function App(){const[doc,setDoc]=useState(window.saved);return <Panel doc={doc} autoStart preauthorizedCredits={0} onBusy={()=>{}} onChange={setDoc} commit={async next=>{if(next.publication.layoutConversationId&&window.failSavePlan){window.failSavePlan=false;window.planSaveFailed=true;throw Error("模拟排版保存失败");}window.saved=structuredClone(next);setDoc(next);return {generation:'7'}}}/>};
 const root=createRoot(document.getElementById('root'));window.remount=()=>root.render(<App key={Date.now()}/>);root.render(<App/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'external-only',setup(b){b.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream|gcsTransfer)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/trpc')?`
 export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>({maxCredits:0,estimatedCredits:0,paidUnit:1,batches:2,consistencyKnown:true})},bookLayoutInput:{fetch:async()=>({sourceDigest:'b'.repeat(64)})},bookLayoutPreview:{fetch:async()=>({doc:window.saved,review:window.saved.publication.review,images:{}})}}}),editableLayout:{exportPublicationPptx:{useMutation:()=>({})},exportPublication:{useMutation:()=>({mutateAsync:async input=>{window.exports.push({...input,doc:structuredClone(window.saved)});return {htmlUrl:'https://test.invalid/book.html',pdfUrl:'https://test.invalid/book.pdf',imagePages:0,totalPages:2};}})}}};
 `:a.path.endsWith('/manhuaAdvisorStream')?'export const streamManhuaAdvisor=i=>window.stream(i);':'export const flyDownloadUrl=u=>u;'}));}}]});
 const browser=await puppeteer.launch({headless:true});try{
 const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('https://fixture.invalid');await page.evaluate(flag=>(window as any).failSavePlan=flag,saveFailure);await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.waitForFunction(()=>document.body.innerText.includes('暂时未能完成') && (window as any).disconnected,{timeout:8000}).catch(async e=>{throw Error(String(e)+JSON.stringify(await page.evaluate(()=>({body:document.body.innerText,calls:(window as any).calls,saved:(window as any).saved})))+errors.join(';'))});
 expect(await page.evaluate(()=>(window as any).exports)).toHaveLength(0);
 await page.evaluate(()=>(window as any).remount());
 if(saveFailure){
 await page.waitForFunction(()=>(window as any).planSaveFailed&&document.body.innerText.includes('暂时未能完成'));
 expect(await page.evaluate(()=>(window as any).exports)).toHaveLength(0);expect(await page.evaluate(()=>(window as any).saved.publication.layoutConversationId)).toBeUndefined();
 await page.evaluate(()=>(window as any).remount());
 }
 await page.waitForFunction(()=>(window as any).exports.length===1,{timeout:8000}).catch(async e=>{throw Error(String(e)+JSON.stringify(await page.evaluate(()=>({body:document.body.innerText,calls:(window as any).calls,saved:(window as any).saved})))+errors.join(';'))});
 const result=await page.evaluate(()=>({calls:(window as any).calls,exports:(window as any).exports}));
 const layoutCalls=result.calls.filter((c:any)=>c.knowledgePublicationContext.purpose==='conversation');
 expect(layoutCalls).toHaveLength(saveFailure?3:2);expect(new Set(layoutCalls.map((c:any)=>c.requestId)).size).toBe(1);
 expect(result.calls.filter((c:any)=>!c.knowledgePublicationContext.purpose)).toHaveLength(2);
 expect(result.exports[0].doc.publication.layoutConversationId).toBe(layoutCalls[0].requestId);
 expect(result.exports[0].doc.publication.confirmedManuscript).toContain('完整正文不可丢失');
 expect(result.exports[0].expectedGeneration).toBe('7');expect(errors).toEqual([]);
 }finally{await browser.close();}
},30000);
