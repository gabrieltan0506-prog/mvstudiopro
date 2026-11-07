import {it,expect} from 'vitest';
import puppeteer from 'puppeteer';
import {buildKnowledgeBookletHtml} from './knowledgeBooklet';
it('正式分页器保留空标题和相邻全文，实际浏览器分页继续并报告待补齐',async()=>{
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent(buildKnowledgeBookletHtml({title:'原书',pages:[{id:'empty',headline:'需要补齐的章',body:'',imageUrl:''},{id:'good',headline:'完整章节',body:'原内容不得删除。具体条件与原文数字123。',imageUrl:''}]}));
  await page.waitForFunction(()=>Boolean((window as any).__knowledgeBooklet?.ready||(window as any).__knowledgeBooklet?.error));
  const actual=await page.evaluate(()=>({result:(window as any).__knowledgeBooklet,text:document.body.textContent}));
  expect(actual.result.ready).toBe(true);expect(actual.result.readingPages).toBeGreaterThan(0);
  expect(actual.result.pendingContent).toEqual([{id:'empty',headline:'需要补齐的章'}]);
  expect(actual.text).toContain('需要补齐的章');expect(actual.text).toContain('原内容不得删除。具体条件与原文数字123。');
 }finally{await browser.close();}
},30000);
