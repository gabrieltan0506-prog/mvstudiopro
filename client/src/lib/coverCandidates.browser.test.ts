import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("候选组件不自动采用，支持原图对照、显式选择、重新挂载恢复和免费后期恢复", async () => {
 const bundle = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {CoverCandidatePicker} from './client/src/components/platform/CoverCandidatePicker';
 const root=createRoot(document.getElementById('root'));window.mount=(key)=>root.render(<CoverCandidatePicker key={key} sceneId="scene1" enabled onAdopt={url=>window.adopted.push(url)}/>);window.mount('first');
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@/lib/trpc":path.resolve("client/src/lib/fixtures/coverCandidateUiMock.tsx"),"@/components/TrialWatermarkImage":path.resolve("client/src/lib/fixtures/coverCandidateUiMock.tsx"),"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForSelector('article');
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  expect(await page.evaluate(()=>(window as any).adopted)).toEqual([]);
  expect(await page.$$eval('article button',els=>els.map(e=>(e as HTMLButtonElement).disabled))).toEqual([false,false,true]);
  await page.click('button[aria-pressed]');
  expect(await page.$eval('article img',el=>(el as HTMLImageElement).src)).toContain('raw-story');
  const buttons=await page.$$('article button');await buttons[1].click();
  await page.waitForFunction(()=>(window as any).adopted.length>0);
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([{jobId:'job1',candidateId:'subject'}]);
  await page.evaluate(()=>{(window as any).adopted=[];(window as any).mount('reload')});
  await page.waitForFunction(()=>(window as any).adopted.length>=1);
  expect(await page.evaluate(()=>(window as any).adopted.every((s:string)=>s.endsWith('graded-subject.png')))).toBe(true);
  const recovery=await page.$('section > button');await recovery!.click();
  await page.waitForFunction(()=>(window as any).calls.length===2);
  expect(await page.$$eval('article button',els=>els.every(e=>(e as HTMLButtonElement).disabled))).toBe(true);
  expect(errors).toEqual([]);
 } finally {await browser.close();}
},60_000);
