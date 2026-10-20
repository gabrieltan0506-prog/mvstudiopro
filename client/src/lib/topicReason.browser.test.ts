import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("实际选题组件保留长理由与旧片段，明确区分原有切口且不提交生成", async () => {
 const full = "针对职场新人的会议表达问题，用前后对照给出可模仿的顺序。".repeat(20);
 const bundle = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {TopicSelectionPanel} from './client/src/components/platform/TopicSelectionPanel';
 import {writeShortlistExpandPersist,readShortlistExpandPersist} from './client/src/lib/platformShortlistExpandPersist';
 const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const base={title:'新人突然被问进度如何回应',conveyGoal:'通过虚构的会议情景，展示结论、事实和下一步的表达顺序。',hookSketch:'从卡壳的错误答法转向三句汇报，以同场景对照呈现差别。',skillsUsed:['xhs-content-growth'],primaryLane:'default',formatHint:'短视频',dedupeKey:'meeting',commentHook:'试试',linkedCampaigns:[]};
 writeShortlistExpandPersist({userKey:'user1',topics:[{...base,id:'old1',viralReason:'适配依据：人群（刚入职年轻人）×高频具体场景（会'},{...base,id:'full1',viralReason:${JSON.stringify(full)}}],contentBlueprints:[]},storage);
 const noop=()=>{};const forbidden=()=>{throw Error('不能自动提交')};
 createRoot(document.getElementById('root')).render(<TopicSelectionPanel id="topic" topics={readShortlistExpandPersist('user1',storage).topics} selectedIds={[]} count={2} countOptions={[2,3]} onCount={noop} generationCost={12} expansionCount={0} expansionCost={0} loading={false} expanding={false} authenticated={true} onGenerate={forbidden} onToggle={noop} onSelectSuggested={noop} onClear={noop} onExpand={forbidden} editingId={null} editingTitle="" onEditingTitle={noop} onEdit={noop} onSave={noop} onCancel={noop}/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForSelector('.topic-reason');
  const reasons=await page.$$('.topic-reason > summary');for(const summary of reasons)await summary.click();
  expect(await page.$eval('[role="status"]',el=>el.textContent)).toContain('可能不完整');
  expect(await page.$eval('.topic-reason strong',el=>el.textContent)).toBe('已有切口说明');
  expect(await page.$$eval('.topic-reason > p',els=>els.map(e=>e.textContent))).toContain(full);
  const old=await page.$eval('.topic-reason details',el=>el.textContent);expect(old).toContain('适配依据：人群（刚入职年轻人）×高频具体场景（会');
  expect(errors).toEqual([]);
 } finally {await browser.close();}
},60_000);
