import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { readFile } from "node:fs/promises";

it("实际选题组件在手机和桌面完整展示恢复内容与逐题依据，不沿用旧全推荐标记", async () => {
 const full="从会议现场的具体提问开始，先给结论再给事实，最后明确下一步。".repeat(40)+"完整结束标记。";
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {TopicSelectionPanel} from './client/src/components/platform/TopicSelectionPanel';
 import {rankTopicShortlistByViralScore} from './shared/platformTopicShortlist';
 import {writeShortlistExpandPersist,readShortlistExpandPersist} from './client/src/lib/platformShortlistExpandPersist';
 const storage=window.localStorage;
 const evidence={platform:'xiaohongshu',version:'test',capturedAt:'2026-10-30T00:00:00Z',windowStart:'2026-10-23T00:00:00Z',windowEnd:'2026-10-30T00:00:00Z',sourceCount:1,eligibleCount:1,excludedUnknownDate:0,excludedOutsideWindow:0,duplicateCount:0,selectedCount:1,samples:[{id:'real-shape',title:'会议沟通参考样本',url:'https://example.com/fictional-source',date:'2026-10-29T00:00:00Z',dateKind:'publishedAt',likes:12,comments:3,tags:[]}],note:'离线测试样本，不是真实热度证明。'};
 const base={title:'会议沟通练习方案',conveyGoal:${JSON.stringify(full)},hookSketch:${JSON.stringify(full)},viralReason:${JSON.stringify(full)},skillsUsed:['xhs-content-growth'],primaryLane:'default',formatHint:'图文',dedupeKey:'meeting',isTopPick:true,evidenceBindingVersion:'topic-v1'};
 writeShortlistExpandPersist({userKey:'offline-user',topics:[{...base,id:'first',viralScore:95,commentHeat:90,xhsGrowthEvidence:evidence},{...base,id:'second',viralScore:70,commentHeat:70},{...base,id:'third',viralScore:40,commentHeat:40}],contentBlueprints:[]},storage);
 const topics=rankTopicShortlistByViralScore(readShortlistExpandPersist('offline-user',storage).topics);
 const noop=()=>{};const forbidden=()=>{throw Error('不能自动生成')};
 createRoot(document.getElementById('root')).render(<TopicSelectionPanel id="topic" windowDays={7} topics={topics} selectedIds={[]} count={3} countOptions={[2,3]} onCount={noop} generationCost={12} expansionCount={0} expansionCost={0} loading={false} expanding={false} authenticated={true} onGenerate={forbidden} onToggle={noop} onSelectSuggested={noop} onClear={noop} onExpand={forbidden} editingId={null} editingTitle="" onEditingTitle={noop} onEdit={noop} onSave={noop} onCancel={noop}/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  // 本地虚构域仅提供localStorage来源，全部请求拦截，不访问外网或生产。
  await page.setRequestInterception(true);page.on('request',request=>void request.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://topic-test.local');
  await page.addStyleTag({content:await readFile('client/src/components/platform/creation-workbench.css','utf8')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('.topic-candidate');
  for(const width of [390,1280]){
   await page.setViewport({width,height:900});
   expect(await page.$$eval('.topic-candidate-value',els=>els.map(el=>el.textContent))).toEqual([full,full,full]);
   expect(await page.$$eval('.topic-candidate-meta',els=>els.filter(el=>el.textContent?.includes('优先试做')).length)).toBe(1);
   expect(await page.$$eval('.topic-candidate-meta',els=>els.filter(el=>el.textContent?.includes('待数据验证')).length)).toBe(2);
   for(const summary of await page.$$('.topic-cut > summary, .topic-reason > summary')){
    if(!await summary.evaluate(el=>(el.parentElement as HTMLDetailsElement).open))await summary.click();
   }
   expect(await page.$$eval('.topic-cut > p',els=>els.map(el=>el.textContent))).toEqual([full,full,full]);
   expect(await page.$$eval('.topic-reason > p',els=>els.map(el=>el.textContent))).toEqual([full,full,full]);
   expect(await page.$$eval('.topic-candidate-value',els=>els.every(el=>el.scrollHeight<=el.clientHeight+1))).toBe(true);
  }
  expect(await page.$$eval('a[href="https://example.com/fictional-source"]',els=>els.length)).toBe(1);
  expect(await page.$eval('body',el=>el.textContent)).toContain('近 7 天');expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);
