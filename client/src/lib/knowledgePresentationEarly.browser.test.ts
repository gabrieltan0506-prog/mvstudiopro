import {it,expect} from 'vitest';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
it('图片尚在生成时自动提前规划，保存不覆盖审校且不重复规划',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'early-ppt.tsx',loader:'tsx',contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import Panel from './client/src/components/platform/KnowledgePublicationPanel';
 import{layoutFromSource}from'./shared/editableLayout';import{knowledgePresentationSourceManuscript}from'./shared/knowledgePresentation';
 const doc=layoutFromSource({owner:'7',sourceId:'fixture',kind:'knowledge-publication',title:'完整知识',body:'第一项知识以及最后一项重要依据'});
 doc.publication.source.pages[0].imageJobId='original-image-job';doc.publication.synchronizedStarted=true;
 doc.publication.presentationRequest={id:'00000000-0000-4000-8000-000000000111',basis:'source',minSlides:1,maxSlides:2,manuscript:knowledgePresentationSourceManuscript(doc.publication.source)};
 window.saved=doc;window.calls=[];window.overlap=false;let saving=false;const waiting=new Promise(r=>window.release=r);
 window.stream=async input=>{window.calls.push(input);const p=window.saved.publication,s=p.source,c=input.knowledgePublicationContext;
 if(c.purpose==='presentation')return{answer:JSON.stringify({kind:'knowledge_presentation_v1',requestId:p.presentationRequest.id,sourceDigest:'b'.repeat(64),minSlides:1,maxSlides:2,title:s.title,fontStyle:'editorial',slides:[{type:'points',title:'完整重点',points:['最后一项重要依据'],sourcePageIds:[s.pages[0].id],notes:''}]}),creditsCharged:0};
 if(c.batchIndex===0)return{answer:JSON.stringify({kind:'knowledge_publication_batch_v1',sourceDigest:'a'.repeat(64),batchIndex:0,batchCount:1,reviewedPages:s.pages.map(p=>p.id)}),creditsCharged:0};
 return{answer:JSON.stringify({kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:s.title,pages:s.pages.map(p=>({id:p.id,headline:p.headline,body:'最终审校后的完整知识',imageStatus:'consistent',imageDescription:'原图中的知识',facts:[{term:'要点',statement:'最后一项重要依据'}],cautions:[]}))}),creditsCharged:0};};
 function App(){const[d,setD]=useState(doc);return <Panel doc={d} autoStart preauthorizedCredits={0} autoPreparePresentation preauthorizedPresentationCredits={0} waitForImages={()=>waiting} onBusy={()=>{}} onChange={setD} commit={async next=>{if(saving)window.overlap=true;saving=true;await new Promise(r=>setTimeout(r,10));window.saved=next;setD(next);saving=false;return{generation:'1'}}}/>};createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@shared\/knowledgePublicationPublic$/},a=>({path:a.path,namespace:'errors'}));b.onLoad({filter:/.*/,namespace:'errors'},()=>({loader:'js',contents:'export const knowledgePublicationPublicError=e=>({message:String(e),retryable:false});'}));b.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream|gcsTransfer)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'js',contents:a.path.endsWith('/trpc')?`export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>({batches:2,remaining:2,reviewBatches:1,consistencyKnown:true,paidUnit:0,maxCredits:0,estimatedCredits:0})}}}),editableLayout:{exportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};`:a.path.endsWith('/manhuaAdvisorStream')?'export const streamManhuaAdvisor=i=>window.stream(i);':'export const flyDownloadUrl=u=>u;'}));}}]});
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://fixture.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>(window as any).saved.publication.presentationPlan,{timeout:4000}).catch(async e=>{throw Error('early:'+await page.$eval('body',e=>e.textContent))});
  expect(await page.evaluate(()=>(window as any).saved.publication.review)).toBeUndefined();
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.knowledgePublicationContext.purpose==='presentation').length)).toBe(1);
  await page.evaluate(()=>(window as any).release());
  await page.waitForFunction(()=>(window as any).saved.publication.review,{timeout:5000});
  expect(await page.evaluate(()=>(window as any).saved.publication.presentationPlan.slides[0].points[0])).toBe('最后一项重要依据');
  expect(await page.evaluate(()=>(window as any).saved.publication.manuscript)).toContain('最终审校后的完整知识');
  expect(await page.evaluate(()=>(window as any).overlap)).toBe(false);
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='规划 PPTX 提纲')!.click());
  await page.waitForFunction(()=>document.body.textContent?.includes('已恢复当前提纲'),{timeout:4000}).catch(async e=>{throw Error('reuse:'+await page.$eval('body',e=>e.textContent))});
  expect(await page.evaluate(()=>(window as any).saved.publication.confirmedManuscript)).toBeUndefined();

  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.knowledgePublicationContext.purpose==='presentation').length)).toBe(1);
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='按最终审校稿重新规划')!.click());
  await page.waitForFunction(()=>(window as any).saved.publication.presentationRequest.basis===undefined&&(window as any).saved.publication.presentationPlan,{timeout:4000}).catch(async e=>{throw Error('final:'+await page.$eval('body',e=>e.textContent))});
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.knowledgePublicationContext.purpose==='presentation').length)).toBe(2);
 }finally{await browser.close();}
},15000);
