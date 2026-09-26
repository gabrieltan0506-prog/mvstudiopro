import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Panel from './client/src/components/canvas/ManhuaOutlineTemplateRewrite';
      const source=[
        '夜雨压在渡口的篷布上，主角在船上追查失落信物。她先让船夫把灯熄掉，再沿着潮湿的舷板摸向货舱；半个月前父亲留下的铜铃，最后一次就是在这条船上响起。',
        '货舱门内传来两个人争执，一个要趁涨潮离港，另一个却坚持等那位戴斗笠的客人。她认出后者的声音属于旧友阿洛，心里一沉，却没有立刻推门。',
        '阿洛曾答应帮她寻找失踪的弟弟，如今却替追兵看守货箱。她把手中的木牌压进袖口，故意碰翻空桶，引得守卫朝甲板跑去，趁乱钻进舱里。',
        '箱盖下不是珠宝，而是一叠写满人名的渡船账册。她看见弟弟的名字旁盖着红印，日期正是他失踪的第二天；账册另一页还列着今晚将被运走的孩子。',
        '阿洛从暗处现身，拔剑拦住出口，却低声说追兵已经包围渡口。他承认自己受人胁迫，只有把账册送出城，才能找到弟弟所在的院子；主角不信，逼他交出押船人的令牌。',
        '甲板上传来三声短哨，船身开始离岸。主角把账册塞进油布，借灯影看清阿洛手腕上同样的红印，意识到他也被记在货单里。两人不得不暂时合作，从舷窗爬上船尾。',
        '守卫逼近时，阿洛替她挡住第一刀，她抓住缆绳荡回甲板，割断系在船尾的小艇。小艇刚落水，远处塔楼却亮起第二盏灯，照见岸边站着本应已经死去的父亲。',
        '父亲没有呼喊，只举起那只失踪的铜铃。铃声一响，船上所有守卫同时转头望向主角；阿洛握剑的手发抖，说出一句她从未听过的话：今晚真正要运走的人是她。'
      ].join('\\n');
      const f=globalThis.fixture={requests:[],applied:[],previews:[],source,failOnce:false,terminalOnce:false,historyRecords:JSON.parse(sessionStorage.getItem('test-server-history')||'[]'),contextUser:'u1'};
      const templates=['mt_a349','mt_4f93'].map((publicId,i)=>({publicId,nameZh:i?'惊险反转':'悲愤',featureZh:'冲突升级',introZh:'节奏增强'}));
      function App(){const [body,setBody]=useState(sessionStorage.getItem('test-initial-source')||source);const [user,setUser]=useState('u1');f.setBody=setBody;f.setUser=(value)=>{f.contextUser=value;setUser(value)};return <Panel userId={user} confirmedProjectVersion='project-v1' templates={templates} onOpenFreePreview={id=>f.previews.push(id)} onApplyRewrite={candidate=>{f.applied.push(candidate);setBody(candidate.rewrittenBody);return true}} project={{context:{seriesTitle:'船战',episodeIndex:1,episodeTitle:'登船',stage:'outline',videoModel:'未选择',writerConfirmed:true,episodeBody:body,assetSummary:'',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'本集'}}/>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [{ name: "离线付费候选接口", setup(context) {
      context.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
      context.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `
        export const trpc={mvAnalysis:{listManhuaTemplateCandidateHistory:{useQuery:(input,options)=>({isSuccess:!!options.enabled,isError:false,data:options.enabled?{candidates:globalThis.fixture.historyRecords.filter(item=>item.userId===globalThis.fixture.contextUser&&item.episodeNumber===input.episodeNumber&&item.sourceSha256===input.sourceSha256)}:undefined})},generateManhuaTemplateCandidate:{useMutation:()=>({mutateAsync:async input=>{
          const f=globalThis.fixture;f.requests.push(input);
          if(f.failOnce){f.failOnce=false;throw Error('网络回执丢失')}
          if(f.terminalOnce){f.terminalOnce=false;throw Object.assign(Error('这次候选生成失败且未扣点，请新建候选请求'),{data:{code:'PRECONDITION_FAILED'}})}
          const candidateMarkdown='候选：'+(input.publicTemplateId==='mt_a349'?'悲愤':'惊险反转')+'。'+input.sourceMarkdown.replace('主角在船上','主角冲上船头');
          const result={requestId:input.requestId,episodeNumber:input.episodeNumber,sourceSha256:input.sourceSha256,originalBody:input.sourceMarkdown,rewrittenBody:candidateMarkdown,publicTemplate:{publicId:input.publicTemplateId,nameZh:input.publicTemplateId==='mt_a349'?'悲愤':'惊险反转'},creditsCost:1,candidateMarkdown,changes:['开场冲突前置'],replayed:f.requests.filter(r=>r.requestId===input.requestId).length>1};
          if(!f.historyRecords.some(item=>item.requestId===result.requestId)){f.historyRecords.push({...result,userId:f.contextUser,createdAt:new Date().toISOString()});sessionStorage.setItem('test-server-history',JSON.stringify(f.historyRecords))}
          return result;
        }})}}};
      ` }));
    } }],
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);

afterAll(async () => { await browser?.close(); });

async function openPage() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => request.isNavigationRequest()
    ? void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' })
    : void request.abort());
  await page.goto("http://localhost:41828/");
  await page.evaluate(() => localStorage.clear());
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[aria-label="剧本大纲剧情增强模板"]');
  return page;
}

async function clickText(page: Awaited<ReturnType<typeof openPage>>, label: string) {
  await page.waitForFunction(text => Array.from(document.querySelectorAll("button"))
    .some(item => item.textContent?.includes(text) && !item.disabled), {}, label);
  await page.evaluate(text => {
    const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.includes(text));
    if (!button) throw Error(`缺少按钮：${text}`);
    button.click();
  }, label);
}

it("免费梗概预览只传所选模板，不提交付费完整候选", async () => {
  const page = await openPage();
  await page.select("#manhua-outline-template-1", "mt_a349");
  await clickText(page, "前往免费梗概预览");
  expect(await page.evaluate(() => (globalThis as any).fixture.previews)).toEqual(["mt_a349"]);
  expect(await page.evaluate(() => (globalThis as any).fixture.requests)).toEqual([]);
  await page.close();
});

it("两张已审核卡各确认收费一次，刷新后仍能切换高亮候选且不会自动采用", async () => {
  const page = await openPage();
  await page.select("#manhua-outline-template-1", "mt_a349");
  await page.select("#manhua-outline-template-2", "mt_4f93");
  await clickText(page, "生成候选 1");
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(0);
  expect(await page.$eval('[aria-label="剧本大纲剧情增强模板"]', element => element.className)).toContain("bg-[#10171f]");
  expect(await page.$eval('[aria-label="确认付费生成候选 1"]', element => element.textContent)).toContain("本版收费 1 积分");
  await clickText(page, "确认付费生成");
  await page.waitForSelector('[aria-label="改写原稿对比"]');
  expect(await page.evaluate(() => (globalThis as any).fixture.applied.length)).toBe(0);
  expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent === "确认采用这版改写")?.disabled)).toBe(true);
  await clickText(page, "生成候选 2");
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(1);
  await clickText(page, "确认付费生成");
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="改写候选历史"] button').length === 3);
  await clickText(page, "两版并列比较");
  expect(await page.$eval('[aria-label="两版候选并列对比"]', element => element.textContent)).toContain("候选 1「悲愤」与候选 2「惊险反转」");
  const requests = await page.evaluate(() => (globalThis as any).fixture.requests);
  expect(requests.map((item: any) => [item.publicTemplateId, item.confirmPaid, item.tier])).toEqual([
    ["mt_a349", true, "excellent"], ["mt_4f93", true, "excellent"],
  ]);
  expect(new Set(requests.map((item: any) => item.requestId)).size).toBe(2);
  expect(await page.$('[data-candidate-diff-kind="changed"]')).not.toBeNull();
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[aria-label="改写候选历史"]');
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(0);
  await page.click('[aria-label="改写候选历史"] button:first-child');
  expect(await page.$eval('[aria-label="改写原稿对比"]', element => element.textContent)).toContain("悲愤");
  expect(await page.evaluate(() => (globalThis as any).fixture.applied.length)).toBe(0);
  await clickText(page, "确认采用这版改写");
  await page.waitForFunction(() => document.body.textContent?.includes("当前正文或两版候选原稿不一致"));
  expect(await page.evaluate(() => (globalThis as any).fixture.applied.length)).toBe(1);
  await page.close();
});

it("完整但较短的真实正文可以进入付费确认，几十字梗概仍被拦截", async () => {
  const page = await openPage();
  await page.select("#manhua-outline-template-1", "mt_a349");
  await page.select("#manhua-outline-template-2", "mt_4f93");
  await page.evaluate(() => { const f=(globalThis as any).fixture; f.setBody(f.source.slice(0, f.source.lastIndexOf("。", 680) + 1)); });
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#manhua-outline-template-1")?.disabled);
  expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("生成候选 1"))?.disabled)).toBe(false);
  await page.evaluate(() => (globalThis as any).fixture.setBody("一句梗概。"));
  await page.waitForFunction(() => document.body.textContent?.includes("完整正文需为 300–8000 字"));
  expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("生成候选 1"))?.disabled)).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(0);
  await page.close();
});

it("网络回执丢失后沿用 requestId 恢复，且不同用户看不到旧候选", async () => {
  const page = await openPage();
  await page.select("#manhua-outline-template-1", "mt_a349");
  await page.select("#manhua-outline-template-2", "mt_4f93");
  await page.evaluate(() => { (globalThis as any).fixture.failOnce = true; });
  await clickText(page, "生成候选 1");
  await clickText(page, "确认付费生成");
  await page.waitForFunction(() => document.body.textContent?.includes("恢复原请求回执"));
  const firstId = await page.evaluate(() => (globalThis as any).fixture.requests[0].requestId);
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[aria-label="剧本大纲剧情增强模板"]');
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(0);
  await clickText(page, "恢复原请求回执");
  await page.waitForSelector('[aria-label="改写原稿对比"]');
  expect(await page.evaluate(() => (globalThis as any).fixture.requests[0].requestId)).toBe(firstId);
  await page.evaluate(() => (globalThis as any).fixture.setUser("u2"));
  await page.waitForFunction(() => !document.querySelector('[aria-label="改写候选历史"]'));
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(1);
  await page.close();
});

it("明确 PRECONDITION_FAILED 未扣点才释放 pending，新提交使用新 requestId", async () => {
  const page = await openPage();
  await page.select("#manhua-outline-template-1", "mt_a349");
  await page.select("#manhua-outline-template-2", "mt_4f93");
  await page.evaluate(() => { (globalThis as any).fixture.terminalOnce = true; });
  await clickText(page, "生成候选 1");
  await clickText(page, "确认付费生成");
  await page.waitForFunction(() => document.body.textContent?.includes("已释放原请求编号"));
  expect(await page.$('button')).not.toBeNull();
  expect(await page.evaluate(() => document.body.textContent?.includes("恢复原请求回执"))).toBe(false);
  expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("生成候选 1"))?.disabled)).toBe(false);
  const oldId = await page.evaluate(() => (globalThis as any).fixture.requests[0].requestId);
  await clickText(page, "生成候选 1");
  await clickText(page, "确认付费生成");
  await page.waitForSelector('[aria-label="改写原稿对比"]');
  const ids = await page.evaluate(() => (globalThis as any).fixture.requests.map((request: any) => request.requestId));
  expect(ids).toHaveLength(2);
  expect(ids[1]).not.toBe(oldId);
  await page.close();
});

it("刷新后禁止第二版重复选已付费模板，原稿变化时禁止继续付费", async () => {
  const page = await openPage();
  await page.select("#manhua-outline-template-1", "mt_a349");
  await page.select("#manhua-outline-template-2", "mt_4f93");
  await clickText(page, "生成候选 1");
  await clickText(page, "确认付费生成");
  await page.waitForSelector('[aria-label="改写原稿对比"]');
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[aria-label="改写候选历史"]');
  await page.select("#manhua-outline-template-2", "mt_a349");
  expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("生成候选 2"))?.disabled)).toBe(true);
  await page.select("#manhua-outline-template-2", "mt_4f93");
  expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("生成候选 2"))?.disabled)).toBe(false);
  await page.evaluate(() => { const f=(globalThis as any).fixture;f.setBody(f.source+'\n岸上的火把突然熄灭。'); });
  await page.waitForFunction(() => document.body.textContent?.includes("已暂停新的付费生成"));
  expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("生成候选 2"))?.disabled)).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(0);
  await page.close();
});

it("本机记录丢失时只按登录用户、集次和当前原稿 SHA 只读恢复已结算候选", async () => {
  const page = await openPage();
  await page.select("#manhua-outline-template-1", "mt_a349");
  await page.select("#manhua-outline-template-2", "mt_4f93");
  await clickText(page, "生成候选 1");
  await clickText(page, "确认付费生成");
  await page.waitForSelector('[aria-label="改写原稿对比"]');
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.startsWith("mvs:manhua-template-candidates:v1:"));
    if (!key) throw Error("缺少本机候选记录");
    localStorage.removeItem(key);
  });
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[aria-label="改写候选历史"]');
  expect(await page.$eval('[aria-label="改写原稿对比"]', item => item.textContent)).toContain("悲愤");
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(0);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.startsWith("mvs:manhua-template-candidates:v1:"));
    if (!key) throw Error("恢复没有落本机记录");
    localStorage.removeItem(key);
    sessionStorage.setItem("test-initial-source", (globalThis as any).fixture.source + "\n船头突然响起追兵的号角。");
  });
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[aria-label="剧本大纲剧情增强模板"]');
  await page.waitForFunction(() => document.body.textContent?.includes("付费完整剧本候选"));
  expect(await page.$('[aria-label="改写候选历史"]')).toBeNull();
  expect(await page.evaluate(() => (globalThis as any).fixture.requests.length)).toBe(0);
  await page.close();
});
