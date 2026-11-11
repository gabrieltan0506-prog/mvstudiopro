import {it,expect} from 'vitest';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import {layoutFromSource} from './editableLayout';
import {buildKnowledgePublicationHtml} from './knowledgePublicationHtml';

it('正式预览和PDF打印样式下原图与说明穿插，最终字体重排不丢正文或越页',async()=>{
 const table='|编号|内容|\n|---|---|\n'+Array.from({length:40},(_,i)=>`|编号${i}|完整知识内容${i}|`).join('\n');
 const doc=layoutFromSource({kind:'knowledge-publication',detailLevel:'full',owner:'7',sourceId:'print-css',title:'原图分页回归',body:'',pages:[{headline:'第一卡',body:table,pageIndex:1},{headline:'第二卡',body:'另一张图的独立说明。'+('长段落完整保留。'.repeat(700))+'尾句没有丢失。\n\n|项目|解释|\n|---|---|\n|长单元格|'+('全部原始内容；'.repeat(120))+'单元格结尾保留|' ,pageIndex:2}],images:{1:'gs://test/own.png',2:'gs://test/own2.png'}});
 const review:any={title:doc.title,pages:doc.pages.map(p=>({...p,imageDescription:'真实测试配图',reading:{templateId:p===doc.pages[0]?'fusion_chinese_garden':'fusion_coastal_lighthouse'},cautions:[]}))};
 const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2s8AAAAASUVORK5CYII=';
 const html=buildKnowledgePublicationHtml(doc,review,{'gs://test/own.png':pixel,'gs://test/own2.png':pixel},true);
 const workerCss=fs.readFileSync('pdf-worker/index.ts','utf8').match(/const MYREPORTS_SNAPSHOT_PRINT_CSS = `([\s\S]*?)`\.trim/)![1];
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setViewport({width:1480,height:1120});await page.setContent(html);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-booklet-root]')).every(el=>el.getAttribute('data-ready')==='true'));
  const before=await page.$$eval('.reading-unit',els=>els.map(el=>el.textContent));
  await page.emulateMediaType('print');await page.addStyleTag({content:workerCss+'\n@media print{html body *:not(img){font-family:Arial,"PingFang SC",sans-serif!important}}'});
  await page.evaluate(async()=>{for(const root of Array.from(document.querySelectorAll('[data-booklet-root]')))await (root as any).__layoutBooklet();});
  const result=await page.evaluate(()=>({texts:Array.from(document.querySelectorAll('.reading-unit')).map(el=>el.textContent),order:Array.from(document.querySelectorAll('.folio')).map(el=>el.classList.contains('lead-folio')?'图':'文'),overflow:Array.from(document.querySelectorAll('.folio,.reading-column')).some(el=>el.scrollHeight>el.clientHeight+2),images:Array.from(document.querySelectorAll('.main-card img')).map(el=>el.getBoundingClientRect().height),colors:Array.from(document.querySelectorAll('.lead-folio')).map(el=>getComputedStyle(el).color),text:document.body.innerText}));
  expect(result.texts).toEqual(before);expect(result.overflow).toBe(false);
  const typography=await page.evaluate(()=>({paragraph:getComputedStyle(document.querySelector('.prose-unit p')!).fontSize,table:getComputedStyle(document.querySelector('td p')!).fontSize,titles:Array.from(document.querySelectorAll('.image-title h1,.reading-title h2')).map(e=>e.textContent),running:Array.from(document.querySelectorAll('.running span:first-child')).map(e=>e.textContent)}));
  expect(typography.paragraph).toBe('24px');expect(typography.table).toBe('22.5px');
  // 2026-11-08 直式图文同页：首页图题保留章节标题，书名在页眉。
  expect(typography.titles[0]).toBe('第一卡');expect(typography.titles.slice(1)).not.toContain(doc.title);
  expect(typography.running.slice(1)).not.toContain(doc.title);expect(typography.titles.slice(1).every(Boolean)).toBe(true);
  expect(result.order[0]).toBe('图');expect(result.order.indexOf('文')).toBeLessThan(result.order.lastIndexOf('图'));
  expect(result.images.every(h=>h>0 && h<=900)).toBe(true);expect(new Set(result.colors).size).toBe(2);
  expect(result.text).toContain('尾句没有丢失。');expect(result.text).toContain('单元格结尾保留');
  expect(result.text).not.toMatch(/中式园林融合|海岸灯塔融合/);
  for(let i=0;i<40;i++)expect(result.text).toContain('完整知识内容'+i);
  const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(Buffer.from(pdf).subarray(0,4).toString()).toBe('%PDF');
 }finally{await browser.close();}
},60000);

it('两份独立PDF片段在最终字体重排后仍使用同一全书页码',async()=>{
 const {buildKnowledgeBookletHtml}=await import('./knowledgeBooklet');
 const {knowledgePublicationHead}=await import('./knowledgePublicationHtml');
 const {finalizeKnowledgeBookletPagination}=await import('../pdf-worker/knowledgeBookletPagination');
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.emulateMediaType('print');
  const fragments=[0,1].map(i=>buildKnowledgeBookletHtml({title:'完整手册',fragment:true,pages:[{id:'chapter-'+i,headline:'第'+(i+1)+'章',body:'本章完整的说明与内容。',imageUrl:''}]}));
  const counts:number[]=[];
  for(const fragment of fragments){await page.setContent(knowledgePublicationHead('完整手册')+fragment+'</body></html>');counts.push(await finalizeKnowledgeBookletPagination(page));}
  expect(counts).toEqual([1,1]);const total=counts.reduce((a,b)=>a+b,0);let offset=0;
  const numbers=[];
  for(const [i,fragment]of Array.from(fragments.entries())){
   await page.setContent(knowledgePublicationHead('完整手册',{offset,total,count:counts[i]})+fragment+'</body></html>');
   await finalizeKnowledgeBookletPagination(page);expect(await page.$eval('.reading-title h2',el=>el.textContent)).toBe(i===0?'完整手册':'第2章');numbers.push(await page.$$eval('.page-number',els=>els.map(el=>el.textContent)));offset+=counts[i];
  }
  expect(numbers).toEqual([['01 / 02'],['02 / 02']]);
  await page.setContent(knowledgePublicationHead('完整手册',{offset:0,total:3,count:2})+fragments[0]+'</body></html>');
  await expect(finalizeKnowledgeBookletPagination(page)).rejects.toThrow('页数已变化');
 }finally{await browser.close();}
},60000);

it('正文顺序填满整页，末页两栏再平衡，不把少量内容均摊成两半空栏',async()=>{
 const {buildKnowledgeBookletHtml}=await import('./knowledgeBooklet');
 const paragraphs=Array.from({length:45},(_,i)=>`第${i}段：完整内容按原序保留，不得删减。`);
 const html=buildKnowledgeBookletHtml({title:'实际容量分页',pages:[{id:'overflow-estimate',headline:'顺序填栏',body:paragraphs.join('\n\n'),imageUrl:''}]});
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setContent(html);
  await page.waitForFunction(()=>document.body.getAttribute('data-ready')==='true');
  const result=await page.evaluate(()=>({
   pages:Array.from(document.querySelectorAll('.reading-folio')).map(folio=>Array.from(folio.querySelectorAll('.reading-column')).map(el=>({count:el.children.length,height:Array.from(el.children).reduce((n,e)=>n+(e as HTMLElement).offsetHeight+16,0),capacity:el.clientHeight}))),
   text:Array.from(document.querySelectorAll('.reading-unit p')).map(el=>el.textContent),
  }));
  expect(result.pages.length).toBeGreaterThan(1);expect(result.text).toEqual(paragraphs);
  const columns=result.pages.flat();
  expect(columns.every(c=>c.height<=c.capacity+2)).toBe(true);
  // 非末页两栏都接近填满
  for(const page of result.pages.slice(0,-1))for(const c of page)expect(c.height/c.capacity).toBeGreaterThan(0.85);
  // 末页两栏平衡
  const last=result.pages.at(-1)!;
  if(last[1].count)expect(Math.min(last[0].height,last[1].height)/Math.max(last[0].height,last[1].height)).toBeGreaterThan(0.6);
 }finally{await browser.close();}
},60000);

it('默认页数由真实排版容量决定，Markdown分隔线长度不增加物理页',async()=>{
 const {buildKnowledgeBookletHtml}=await import('./knowledgeBooklet');
 const body=(separator:string)=>Array.from({length:8},(_,i)=>`### 第${i}项\n\n|项目|说明|\n|${separator}|---|\n|保留${i}|原始事实${i}完整保留。|`).join('\n\n');
 const normal=body('---'),verbose=body('-'.repeat(1800));
 expect(verbose.length).toBeGreaterThan(1600*8);
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  const inspect=async(markdown:string)=>{
   await page.setContent(buildKnowledgeBookletHtml({title:'语法不占页',pages:[{id:'source',headline:'原始知识',body:markdown,imageUrl:''}]}));
   await page.waitForFunction(()=>document.body.getAttribute('data-ready')==='true');
   return page.evaluate(()=>({pages:document.querySelectorAll('.reading-folio').length,texts:Array.from(document.querySelectorAll('.reading-unit')).map(el=>el.textContent),overflow:Array.from(document.querySelectorAll('.reading-column')).some(el=>el.scrollHeight>el.clientHeight+2)}));
  };
  const before=await inspect(normal),after=await inspect(verbose);
  expect(after).toEqual(before);expect(after.pages).toBeLessThan(4);expect(after.overflow).toBe(false);
  for(let i=0;i<8;i++)expect(after.texts.join('')).toContain(`原始事实${i}完整保留。`);
 }finally{await browser.close();}
},60000);

it('默认短Markdown多块和长表按实际容量扩页，显式页数不制造空白页',async()=>{
 const {buildKnowledgeBookletHtml}=await import('./knowledgeBooklet');
 const paragraphs=Array.from({length:45},(_,i)=>`第${i}段原文完整保留。`);
 const table='|编号|解释|\n|---|---|\n'+Array.from({length:90},(_,i)=>`|序号${i}|本行解释${i}。|`).join('\n');
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  const inspect=async(body:string,readingPages?:number)=>{
   await page.setContent(buildKnowledgeBookletHtml({title:'内容容量',readingPages,pages:[{id:'source',headline:'全部原文',body,imageUrl:''}]}));
   await page.waitForFunction(()=>document.body.getAttribute('data-ready')==='true');
   return page.evaluate(()=>({pages:document.querySelectorAll('.reading-folio').length,paragraphs:Array.from(document.querySelectorAll('.prose-unit p')).map(el=>el.textContent),rows:Array.from(document.querySelectorAll('tbody tr')).map(el=>el.textContent),overflow:Array.from(document.querySelectorAll('.reading-column')).some(el=>el.scrollHeight>el.clientHeight+2)}));
  };
  const many=await inspect(paragraphs.join('\n\n'));
  expect(paragraphs.join('\n\n').length).toBeLessThan(1600);expect(many.pages).toBeGreaterThan(1);expect(many.paragraphs).toEqual(paragraphs);expect(many.overflow).toBe(false);
  const longTable=await inspect(table);
  expect(longTable.pages).toBeGreaterThan(1);expect(longTable.rows).toHaveLength(90);expect(longTable.overflow).toBe(false);
  for(let i=0;i<90;i++)expect(longTable.rows[i]).toContain(`本行解释${i}。`);
  // 2026-11-08：不再按预估页数均摊，显式页数参数不增加空白页。
  const short=paragraphs.slice(0,12).join('\n\n'),automatic=await inspect(short),explicit=await inspect(short,3);
  expect(automatic.pages).toBe(1);expect(explicit.pages).toBe(1);expect(explicit.paragraphs).toEqual(paragraphs.slice(0,12));expect(explicit.overflow).toBe(false);
 }finally{await browser.close();}
},60000);
