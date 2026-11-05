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
 const html=buildKnowledgePublicationHtml(doc,review,{'gs://test/own.png':pixel,'gs://test/own2.png':pixel});
 const workerCss=fs.readFileSync('pdf-worker/index.ts','utf8').match(/const MYREPORTS_SNAPSHOT_PRINT_CSS = `([\s\S]*?)`\.trim/)![1];
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setViewport({width:1480,height:1120});await page.setContent(html);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-booklet-root]')).every(el=>el.getAttribute('data-ready')==='true'));
  const before=await page.$$eval('.reading-unit',els=>els.map(el=>el.textContent));
  await page.emulateMediaType('print');await page.addStyleTag({content:workerCss+'\n@media print{html body *:not(img){font-family:Arial,"PingFang SC",sans-serif!important}}'});
  await page.evaluate(async()=>{for(const root of Array.from(document.querySelectorAll('[data-booklet-root]')))await (root as any).__layoutBooklet();});
  const result=await page.evaluate(()=>({texts:Array.from(document.querySelectorAll('.reading-unit')).map(el=>el.textContent),order:Array.from(document.querySelectorAll('.folio')).map(el=>el.classList.contains('image-folio')?'图':'文'),overflow:Array.from(document.querySelectorAll('.folio,.reading-column')).some(el=>el.scrollHeight>el.clientHeight+2),images:Array.from(document.querySelectorAll('.main-card img')).map(el=>el.getBoundingClientRect().height),colors:Array.from(document.querySelectorAll('.image-folio')).map(el=>getComputedStyle(el).color),text:document.body.innerText}));
  expect(result.texts).toEqual(before);expect(result.overflow).toBe(false);
  expect(result.order[0]).toBe('图');expect(result.order.indexOf('文')).toBeLessThan(result.order.lastIndexOf('图'));
  expect(result.images.every(h=>h>=760 && h<=796)).toBe(true);expect(new Set(result.colors).size).toBe(2);
  expect(result.text).toContain('尾句没有丢失。');expect(result.text).toContain('单元格结尾保留');
  expect(result.text).not.toMatch(/中式园林融合|海岸灯塔融合/);
  for(let i=0;i<40;i++)expect(result.text).toContain('完整知识内容'+i);
  const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});expect(Buffer.from(pdf).subarray(0,4).toString()).toBe('%PDF');
 }finally{await browser.close();}
},60000);
