import { expect, it } from "vitest";
import puppeteer from "puppeteer";
import { build } from "esbuild";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import real from "./fixtures/topicDigestRealDrafts.json";
it("真实三稿：切换、分类排序、完整提纲和原稿对应，桌面与手机无溢出", async () => {
 const bundle = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {TopicDraftComparison} from './client/src/components/TopicDraftComparison';
 import {buildTopicReadingComparison} from './shared/topicDigestPresentation';
 createRoot(document.getElementById('root')).render(<TopicDraftComparison comparison={buildTopicReadingComparison(${JSON.stringify(real)})}/>);
 `},bundle:true,write:false,outdir:"preview",platform:"browser",format:"iife",jsx:"automatic",alias:{"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.setViewport({width:1280,height:900});await page.setContent('<style>body{font:16px system-ui;margin:0;background:#f5f3ed;color:#243a30}#root{max-width:960px;margin:32px auto;padding:20px}</style><div id="root"></div>');
  await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css'))!.text});
  await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text});
  await page.waitForSelector('article');
  expect(await page.$$eval('article',els=>els.length)).toBe(8);
  expect(await page.$eval('[aria-selected=true] small',el=>getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  expect(await page.$$eval('.topic-reading-group h3',els=>els.map(e=>e.textContent))).toEqual(['1. 工具与流程','2. 选题与素材','3. 写作与制作','4. 发布与反馈']);
  expect(await page.$eval('article',el=>el.textContent)).toContain('合并自：原稿一 · 第1题、原稿二 · 第6题');
  await page.click('article summary');await page.click('article .topic-reading-source summary');
  expect(await page.$eval('article details',el=>(el as HTMLDetailsElement).open)).toBe(true);
  expect(await page.$eval('article .topic-reading-source',el=>(el as HTMLDetailsElement).open)).toBe(true);
  await mkdir('work',{recursive:true});await page.screenshot({path:'work/topic-reading-desktop.png',fullPage:true});
  for (const [index,key] of [[0,'deepseek'],[1,'glm'],[2,'integrated']] as const) {
    await page.evaluate(index=>(document.querySelectorAll('[role=tab]')[index] as HTMLButtonElement).click(),index);
    await page.waitForFunction(key=>document.querySelector('article')?.getAttribute('data-topic-key')?.startsWith(key),{},key);
    const text = await page.$eval('[role=tabpanel]',el=>el.textContent || '');
    for (const topic of real[key].raw.topics) {expect(text).toContain(topic.title);expect(text).toContain(topic.angle);expect(text).toContain(topic.hook);for(const line of topic.outline) if(line)expect(text).toContain(line);}
    expect(await page.$$eval('article',els=>els.length)).toBe(8);
    expect(text).not.toContain('"topics":');
  }
  await page.setViewport({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'work/topic-reading-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
 } finally {await browser.close();}
},60000);
