import { buildTopicReadingComparison } from "../../../shared/topicDigestPresentation";
import realDrafts from "./fixtures/topicDigestRealDrafts.json";
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("免费1条/付费2条消息、采用保留原稿、不自动创作、切账号不串通知", async () => {
  const fakeRpc = `import React from 'react';
    const card=i=>({id:'topic-'+i,title:'通知选题'+i+'：妈妈道歉后的变化',angle:'以一个递画动作写亲子修复，正文兑现标题，避免编造效果。',hook:'妈妈蹲下来时，孩子把画递给了她。',format:'图文',outline:['先写争执后的距离','再写蹲下来倾听的动作','以孩子递画收尾'],tags:['亲子'],kind:'常青选题',sourceIds:[],sources:[]});
    const digest={id:'pool',lane:'parenting',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),topics:[card(1)]};
    const users={'7':{preference:{enabled:true,lane:'parenting',keywords:''},recommendationCount:1,notifications:[{id:'pool',digest,read:false,dismissed:[],adopted:[]}]},'8':{preference:{enabled:true,lane:'parenting',keywords:''},recommendationCount:2,notifications:[{id:'pool',digest:{...digest,topics:[card(1),card(2)]},read:false,dismissed:[],adopted:[]}]}};
    globalThis.calls=[];
    const query=(kind)=>({useQuery:input=>{const[,set]=React.useState(0);const u=users[input.scope];return {data:kind==='inbox'?{...u,nextAt:digest.expiresAt,batchState:'ready'}:{title:'通知选题1',brief:'【通知选题】妈妈道歉后的变化。用孩子递画的动作表现修复；正文兑现标题，先交代冲突再写倾听。',expired:false},isLoading:false,isError:false,refetch:async()=>set(x=>x+1)}}});
    const mutation=name=>({useMutation:()=>({isPending:false,mutateAsync:async input=>{globalThis.calls.push({name,input});if(name==='read')users[globalThis.uid].notifications[0].read=true;return {ok:true}}})});
    export const trpc={mvAnalysis:{getTopicDraftComparison:{useQuery:(_input,options)=>({data:options.enabled?${JSON.stringify(buildTopicReadingComparison(realDrafts,{method:"deepseek",topics:[{...realDrafts.deepseek.raw.topics[0],id:"topic-1"}] as any}))}:undefined,isLoading:false,isError:false})},topicDigestInbox:query('inbox'),getTopicDigestDraft:query('draft'),saveTopicDigestPreference:mutation('save'),readTopicDigest:mutation('read'),dismissTopicDigest:mutation('dismiss'),adoptTopicDigest:mutation('adopt')}};
  `;
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {useLocation} from 'wouter';
    import {TopicDigestBell,TopicDigestDraft,readTopicDigestLocation} from './client/src/components/TopicDigestBell';
    import {compileViralCreatorInput} from './shared/viralCreationMethods';
    function App(){const[uid,setUid]=React.useState('7');const[value,setValue]=React.useState('原有亲子绘本背景，保留我的语气');const[loc]=useLocation();
    globalThis.uid=uid;globalThis.switchUser=()=>setUid('8');globalThis.compiled=()=>compileViralCreatorInput({profile:value});const target=readTopicDigestLocation(window.location.search);
    return <><TopicDigestBell key={uid} userId={uid}/><textarea aria-label="原需求" value={value} readOnly/>{loc==='/platform'&&target&&<TopicDigestDraft key={uid+target.id} userId={uid} value={value} notificationId={target.id} topicId={target.topicId} onApply={setValue}/>}</>}
    createRoot(document.getElementById('root')).render(<App/>);
  `},plugins:[{name:"offline-rpc",setup(b){b.onLoad({filter:/client\/src\/lib\/trpc\.ts$/},()=>({contents:fakeRpc,loader:"tsx",resolveDir:process.cwd()}));}}],bundle:true,write:false,outdir:"preview",platform:"browser",format:"iife",jsx:"automatic",
    alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  const browser=await puppeteer.launch({headless:true});
  try{
    const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(String(e)));
    await page.setRequestInterception(true);page.on("request",r=>void r.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}));
    await page.goto("https://topic-digest.test");await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith(".js"))!.text});
    await page.waitForSelector('[aria-label^="选题通知"]');await page.click('[aria-label^="选题通知"]');
    await page.waitForSelector('article');
    expect(await page.$eval('[role="dialog"]',e=>e.textContent)).not.toMatch(/DeepSeek|GLM|FlashX|high/);expect(await page.$$eval('article',els=>els.length)).toBe(1);
    expect(await page.$eval('[role="dialog"]',e=>e.textContent)).toContain('当前账号每期1条');
    await page.evaluate(()=>Array.from(document.querySelectorAll('summary')).find(e=>e.textContent==='对照原稿与整合稿')!.click());
    await page.waitForSelector('.topic-reading article');
    expect(await page.$eval('.topic-reading article',e=>e.textContent)).toContain(realDrafts.deepseek.raw.topics[0].title);
    expect(await page.$$eval('.topic-reading [role=tab]',els=>els.length)).toBe(1);
    await page.evaluate(()=>Array.from(document.querySelectorAll('summary')).find(e=>e.textContent==='对照原稿与整合稿')!.click());
    await page.waitForFunction(()=>!document.querySelector('.topic-reading'));
    await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='用这个选题开始创作')!.click());
    await page.waitForSelector('[aria-label="原需求"]');
    await page.waitForFunction(()=>document.body.textContent?.includes('保留原稿，加入这个选题'));
    expect(await page.$eval('[aria-label="原需求"]',e=>(e as HTMLTextAreaElement).value)).not.toContain('通知选题');
    await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保留原稿，加入这个选题')!.click());
    await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="原需求"]')!.value.includes('通知选题'));
    expect((await page.evaluate(()=>(globalThis as any).compiled())).user).toContain('原有亲子绘本背景');
    expect(await page.evaluate(()=>(globalThis as any).calls.map((c:any)=>c.name))).toEqual(['adopt']);
    await page.evaluate(()=>(globalThis as any).switchUser());await page.click('[aria-label^="选题通知"]');
    await page.waitForFunction(()=>document.querySelectorAll('article').length===2);
    expect(await page.$eval('[role="dialog"]',e=>e.textContent)).toContain('当前账号每期2条');
    expect(errors).toEqual([]);
  }finally{await browser.close();}
},60_000);
