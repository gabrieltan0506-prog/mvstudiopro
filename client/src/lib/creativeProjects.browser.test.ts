/** 真实组件、IndexedDB 与项目命名空间；云端仅用明确的离线传输夹具，不调用媒体服务。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { novelMockTransport } from "./novelWorkspace.browser.fixture";

it("小说新建保存切换、旧稿迁移、账号隔离与失败保留；MV建档与首页三个真实入口", async () => {
  const transport = novelMockTransport + `
  const uid=()=>sessionStorage.getItem('fixture-user')||'1';
  globalThis.backups=JSON.parse(sessionStorage.getItem('fixture-backups')||'[]');
  const query=()=>({data:globalThis.backups.filter(r=>r.userId===uid()),isLoading:false,isError:false,refetch:async()=>({data:globalThis.backups.filter(r=>r.userId===uid())})});
  trpc.novelWorkspace.listBackups.useQuery=query;
  trpc.novelWorkspace.backup.useMutation=()=>({mutateAsync:async({workspaceJson})=>{
    if(sessionStorage.getItem('fail-backup'))throw Error('离线模拟：云端保存失败，本机稿保留');
    const d=JSON.parse(workspaceJson),row={backupId:crypto.randomUUID(),userId:uid(),projectId:d.projectId||d.roundId,roundId:d.roundId,title:d.topic,season:d.season||1,createdAt:new Date().toISOString(),bytes:workspaceJson.length,sha256:'fixture',workspaceJson};
    globalThis.backups.push(row);sessionStorage.setItem('fixture-backups',JSON.stringify(globalThis.backups));return row;
  }});
  trpc.manhuaCloudDraft={listProjects:{useQuery:()=>({data:{projects:[],hasMore:false},isLoading:false,isError:false})},upsert:{useMutation:()=>({mutateAsync:async input=>{const rows=JSON.parse(sessionStorage.getItem('fixture-mvs')||'[]');rows.push(input);sessionStorage.setItem('fixture-mvs',JSON.stringify(rows));return {generation:String(rows.length)}}})}};
  trpc.homePhotoTools={restoreOldPhoto:{useMutation:()=>({mutateAsync:async()=>{throw Error('媒体禁止')}})}};
  `;
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import Novel from './client/src/pages/NovelAdaptation';
      import {NovelProjectLibrary} from './client/src/pages/NovelProjects';
      import {MusicMvProjectLibrary} from './client/src/pages/MusicMvProjects';
      import Workshop from './client/src/components/HomeImageWorkshop';
      import * as db from './client/src/lib/novelWorkspaceDb';
      import * as workspace from './client/src/lib/novelWorkspace';
      import * as scope from './shared/manhuaProjectScope';
      globalThis.projectProbe={...db,...workspace,...scope};
      const path=location.pathname,uid=sessionStorage.getItem('fixture-user')||'1';
      createRoot(document.getElementById('root')).render(path==='/novel-projects'?<NovelProjectLibrary userId={uid}/>:path==='/novel-adaptation'?<Novel/>:path==='/mv-projects'?<MusicMvProjectLibrary userId={uid}/>:path==='/home'?<div data-home-theme="warm" className="home-product"><Workshop/></div>:<p>离线夹具</p>);
    ` },
    bundle: true, write: false, outdir: "offline-projects", format: "iife", platform: "browser", jsx: "automatic", tsconfig: "tsconfig.json",
    external: ["pdfjs-dist", "tesseract.js"], define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
    plugins: [{ name: "offline", setup(b) {
      b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "fixture" }));
      b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({ path: "auth", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "trpc" ? transport : "export const useAuth=()=>({user:{id:Number(sessionStorage.getItem('fixture-user')||'1'),role:'admin'},loading:false,isAuthenticated:true,refresh:async()=>{}});", loader: "js", resolveDir: process.cwd() }));
    }}],
  });
  const css = (readdirSync("client/dist/assets").filter(f => f.endsWith(".css")).map(f => readFileSync("client/dist/assets/" + f, "utf8")).join("\n")) + built.outputFiles.filter(f => f.path.endsWith(".css")).map(f => f.text).join("\n");
  const script = built.outputFiles.find(f => f.path.endsWith(".js"))!.text;
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(script); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const evidence = process.env.PROJECT_UI_EVIDENCE;
  if (evidence) mkdirSync(evidence, { recursive: true });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.setDefaultTimeout(10_000);
    page.on("pageerror", e => errors.push(String(e)));
    page.on("dialog", d => void d.accept());
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true);
    page.on("request", r => void (r.url().startsWith(origin) ? r.continue() : r.abort()));
    const goto = (path: string) => page.goto(origin + path);
    const click = async (label: string) => {
      await page.waitForFunction(label => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === label && !b.disabled), {}, label);
      await page.evaluate(label => Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === label)!.click(), label);
    };
    const screenshot = async (name: string) => {
      for (const width of [1440, 390]) {
        await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (evidence) await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
      }
    };
    await goto("/blank");
    const legacy = await page.evaluate(() => {
      const f=(globalThis as any).projectProbe,a={...f.emptyNovelWorkspace(),topic:"旧活动稿",chapters:["原小说正文"]},b={...f.emptyNovelWorkspace(),topic:"旧封存稿"};delete a.projectId;delete b.projectId;
      localStorage.setItem(f.novelWorkspaceKey('1'),JSON.stringify(a));localStorage.setItem(f.novelWorkspaceKey('1')+':archive:old',JSON.stringify(b));return {a,b};
    });
    await goto("/novel-projects");
    await page.waitForFunction(() => document.querySelectorAll(".creative-project-row").length === 2);
    expect(await page.evaluate(async () => (await (globalThis as any).projectProbe.listNovelProjectsDb('2')).projects)).toEqual([]);
    // 两个标签页拿到相同旧版本时，后写入者失败且首个结果保留；不同账号不能读取。
    const cas = await page.evaluate(async id => {
      const f=(globalThis as any).projectProbe,row=await f.readNovelWorkspaceDb('1',id);
      await f.saveNovelWorkspaceDb('1',row.raw,{...row.value,topic:'旧活动稿已编辑'},undefined,id);
      let conflict='',wrongUser='';try{await f.saveNovelWorkspaceDb('1',row.raw,{...row.value,topic:'不应覆盖'},undefined,id)}catch(e){conflict=String(e)}
      try{await f.readNovelWorkspaceDb('2',id)}catch(e){wrongUser=String(e)}
      await f.listNovelProjectsDb('1');return {conflict,wrongUser,title:(await f.readNovelWorkspaceDb('1',id)).value.topic,legacy:localStorage.getItem(f.novelWorkspaceKey('1'))};
    }, legacy.a.roundId);
    expect(cas.conflict).toContain("另一页面");expect(cas.wrongUser).toContain("本机没有");expect(cas.title).toBe("旧活动稿已编辑");expect(JSON.parse(cas.legacy!).topic).toBe("旧活动稿");
    const createNovel = async (title: string) => {
      await goto("/novel-projects");await page.type('[aria-label="新小说名称"]',title);
      await click("新建小说");await page.waitForSelector('[data-novel-studio]');
      return new URL(page.url()).searchParams.get("project")!;
    };
    const a = await createNovel("雨夜来信");
    await page.type('[aria-label="作品名称"]'," · 修订");
    await page.waitForFunction(() => document.querySelector(".novel-save")?.textContent?.includes("已保存"));
    await click("保存作品");await page.waitForFunction(() => document.body.innerText.includes("作品已保存到当前账号"));
    await click("我的小说 · 切换作品");await page.waitForSelector("[data-novel-projects]");
    const b = await createNovel("无声海岸");expect(b).not.toBe(a);
    await goto(`/novel-adaptation?project=${a}&owner=1`);await page.waitForSelector('[aria-label="作品名称"]');
    expect(await page.$eval('[aria-label="作品名称"]', e => (e as HTMLInputElement).value)).toBe("雨夜来信 · 修订");
    await page.reload();await page.waitForSelector('[aria-label="作品名称"]');
    expect(await page.$eval('[aria-label="作品名称"]',e=>(e as HTMLInputElement).value)).toBe("雨夜来信 · 修订");
    await goto(`/novel-adaptation?project=${a}&owner=2`);await page.waitForFunction(()=>document.body.innerText.includes('创建此小说的账号'));
    expect(await page.$('[data-novel-studio]')).toBeNull();
    await goto(`/novel-adaptation?project=${b}&owner=1`);await page.waitForSelector('[data-novel-studio]');
    await page.evaluate(async id=>{const f=(globalThis as any).projectProbe,row=await f.readNovelWorkspaceDb('1',id);await f.saveNovelWorkspaceDb('1',row.raw,{...row.value,pending:{requestId:crypto.randomUUID(),roundId:row.value.roundId,stage:'advice',topic:row.value.topic,direction:'原任务保持',templates:[],episodeCount:3}},undefined,id);},b);
    await page.reload();await page.waitForSelector('[data-novel-studio]');await click('我的小说 · 切换作品');
    await page.waitForFunction(()=>document.body.innerText.includes('当前作品有任务待核对'));expect(new URL(page.url()).searchParams.get('project')).toBe(b);
    await goto('/novel-projects');await page.waitForSelector('.creative-project-row');await screenshot('小说作品列表');
    // 云端失败会留下可打开的本机作品，不误报云端成功。
    await page.evaluate(()=>sessionStorage.setItem('fail-backup','1'));await page.type('[aria-label="新小说名称"]','云端失败保留稿');await click('新建小说');
    await page.waitForFunction(()=>document.body.innerText.includes('离线模拟：云端保存失败'));
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.creative-project-row h3')).some(el=>el.textContent==='云端失败保留稿'));
    await page.evaluate(()=>sessionStorage.removeItem('fail-backup'));
    // 删去的仅是离线浏览器中的本机测试键，模拟换设备从不可变云备份恢复。
    await page.evaluate(async id=>{const f=(globalThis as any).projectProbe;await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('mv-novel-workspaces',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(f.novelProjectKey('1',id));tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);};});},a);
    await page.reload();await page.waitForSelector('.creative-project-row');
    await page.evaluate(()=>{const row=Array.from(document.querySelectorAll('.creative-project-row')).find(el=>el.querySelector('h3')?.textContent==='雨夜来信 · 修订')!;(row.querySelector('button') as HTMLButtonElement).click()});
    await page.waitForSelector('[aria-label="作品名称"]');expect(new URL(page.url()).searchParams.get('project')).toBe(a);
    expect(await page.$eval('[aria-label="作品名称"]',e=>(e as HTMLInputElement).value)).toBe('雨夜来信 · 修订');
    // 第二账号的列表与前一账号不混合。
    await page.evaluate(()=>sessionStorage.setItem('fixture-user','2'));await goto('/novel-projects');await page.waitForFunction(()=>document.body.innerText.includes('还没有小说作品'));expect(await page.$$('.creative-project-row')).toHaveLength(0);
    await page.evaluate(()=>sessionStorage.setItem('fixture-user','1'));
    for(const name of ['南风','晚星']){await goto('/mv-projects');await page.type('[aria-label="新MV作品名称"]',name);await click('新建 MV');await page.waitForFunction(()=>location.pathname==='/canvas');}
    const mvs=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('fixture-mvs')!));expect(mvs).toHaveLength(2);
    expect(mvs[0].projectId).not.toBe(mvs[1].projectId);
    for(const row of mvs){const payload=JSON.parse(row.payloadJson);expect(payload.writerSession.workspaceKind).toBe('mv');expect(payload.canvas.blocks).toHaveLength(1);expect(payload.canvas.blocks[0]).toMatchObject({kind:'music',musicMv:{status:'idle',candidates:[]}});expect(row.expectedGeneration).toBe('0');}
    await goto('/mv-projects');await page.waitForFunction(()=>document.querySelectorAll('.creative-project-row').length===2);await screenshot('MV作品列表');
    await goto('/home');await page.waitForSelector('#image-workshop');
    await page.type('#image-workshop textarea','照片动作草稿保留');
    await page.click('#workshop-tab-manhua');expect(await page.$eval('#workshop-panel-manhua',e=>!(e as HTMLElement).hidden)).toBe(true);
    expect(await page.$eval('#workshop-panel-manhua a',e=>e.getAttribute('href'))).toBe('/manhua-projects');
    await page.keyboard.press('ArrowRight');expect(await page.$eval('#workshop-tab-mv',e=>e.getAttribute('aria-selected'))).toBe('true');
    expect(await page.$eval('#workshop-panel-mv a',e=>e.getAttribute('href'))).toBe('/mv-projects');await screenshot('影像工坊MV入口');
    await page.click('#workshop-tab-photo');expect(await page.$eval('#image-workshop textarea',e=>(e as HTMLTextAreaElement).value)).toBe('照片动作草稿保留');
    expect(await page.evaluate(()=>(globalThis as any).calls)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(r=>server.close(()=>r())); }
}, 90_000);
