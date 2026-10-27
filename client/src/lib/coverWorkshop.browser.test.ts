/** 真实封面组件，离线传输与示意图片；不访问用户浏览器或付费服务。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
it("首页封面入口：三款确认、选择成稿、断网同ID恢复、刷新与账号隔离及390px布局", async () => {
  const transport = `import React,{useEffect,useState} from 'react';
 import {buildCoverPrompt,coverBriefSchema} from './shared/coverWorkshop';
 const w=globalThis;w.calls=[];
 const key=()=> 'fixture-covers-'+(sessionStorage.getItem('user')||'1');
 const rows=()=>JSON.parse(sessionStorage.getItem(key())||'[]');const save=r=>sessionStorage.setItem(key(),JSON.stringify(r));
 const image=i=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="576" height="1024"><rect width="576" height="1024" fill="'+['#d0b9a1','#7c9890','#455363'][i%3]+'"/><circle cx="288" cy="420" r="140" fill="#f1e9d7"/><text x="40" y="820" font-size="36">离线初稿夹具 '+(i+1)+'</text></svg>');
 function query(get){return function(input,opts){const [data,set]=useState(()=>opts?.enabled===false?undefined:get(input));const id=input?.id;useEffect(()=>{set(opts?.enabled===false?undefined:get(input));},[id,opts?.enabled]);return {data,isLoading:false,error:null,refetch:async()=>{const d=get(input);set(d);return {data:d}}};}}
 const mutation=fn=>()=>({mutateAsync:fn,isPending:false});
 const get=({id})=>rows().find(r=>r.id===id);
 export const trpc={coverWorkshop:{
 list:{useQuery:query(input=>{if(input.accountId!==(sessionStorage.getItem('user')||'1'))throw Error('历史查询缺少当前账号范围');return rows().map(r=>({...r,title:r.brief.headline||r.brief.description}));})},get:{useQuery:query(get)},
 prepare:{useMutation:mutation(async req=>{w.calls.push({action:'prepare',...req});let r=rows().find(r=>r.id===req.id);if(!r){const batch=req.stage==='final'?get({id:req.batchId}):null;const brief=coverBriefSchema.parse(batch?.brief||req.brief);r={id:req.id,request:req,stage:req.stage,brief,fingerprint:'a'.repeat(64),createdAt:new Date().toISOString(),totalCredits:req.stage==='draft'?152:54,referencePreviews:batch?[image(req.candidate)]:[],items:(req.stage==='draft'?[0,1,2]:[req.candidate]).map((direction,index)=>({index,direction,jobId:'fixture_'+req.id+'_'+index,prompt:buildCoverPrompt(brief,direction,req.stage==='final'?req.changes:undefined),credits:index?49:54,status:'prepared',imageUrl:null,originalUrl:null,receiptUrl:null,canRecover:false,error:null}))};save([...rows(),r]);}if(sessionStorage.getItem('fail-prepare')){sessionStorage.removeItem('fail-prepare');throw Error('离线模拟响应丢失');}return r;})},
 submit:{useMutation:mutation(async({id})=>{w.calls.push({action:'submit',id});const list=rows(),r=list.find(r=>r.id===id);r.items=r.items.map(i=>({...i,status:'succeeded',imageUrl:image(i.direction),originalUrl:image(i.direction),receiptUrl:'data:application/json,{}'}));save(list);return{id};})},
 recover:{useMutation:mutation(async input=>{w.calls.push({action:'recover',...input});return input;})}},
 mvAnalysis:{getVideoUploadSignedUrl:{useMutation:mutation(async()=>{throw Error('离线禁止上传')})}},
 homePhotoTools:{restoreOldPhoto:{useMutation:mutation(async()=>{throw Error('离线禁止媒体')})}}
 };
 `;
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import Workshop from './client/src/components/HomeImageWorkshop';createRoot(document.getElementById('root')).render(<div data-home-theme="warm" className="home-product"><Workshop/></div>);`,
    },
    bundle: true,
    write: false,
    outdir: "fixture-cover",
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
    plugins: [
      {
        name: "offline",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({
            contents:
              a.path === "trpc"
                ? transport
                : "export const useAuth=()=>({user:{id:Number(sessionStorage.getItem('user')||'1')},isAuthenticated:true,loading:false,refresh:async()=>{}});",
            loader: "tsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const script = built.outputFiles.find(f => f.path.endsWith(".js"))!.text;
  const css = readdirSync("client/dist/assets")
    .filter(f => f.endsWith(".css"))
    .map(f => readFileSync("client/dist/assets/" + f, "utf8"))
    .join("\n");
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(script);
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
          css +
          '</style><div id="root"></div><script src="/fixture.js"></script>'
      );
    }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const out = process.env.COVER_UI_EVIDENCE;
  if (out) mkdirSync(out, { recursive: true });
  try {
    const page = await browser.newPage(),
      errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    const origin = "http://127.0.0.1:" + (server.address() as any).port;
    await page.setRequestInterception(true);
    page.on(
      "request",
      r =>
        void (r.url().startsWith(origin) || r.url().startsWith("data:")
          ? r.continue()
          : r.abort())
    );
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(origin);
    await page.waitForSelector('[aria-label="封面想法"]').catch(e => {
      throw Error(String(e) + "; 页面错误: " + errors.join(" | "));
    });
    expect(
      await page.$eval("#workshop-tab-cover", e =>
        e.getAttribute("aria-selected")
      )
    ).toBe("true");
    expect(await page.$$('[role="tab"]')).toHaveLength(4);
    const click = async (text: string) => {
      const handles = await page.$$("button");
      for (const b of handles) {
        if ((await b.evaluate(e => e.textContent))?.includes(text)) {
          await b.click();
          return;
        }
      }
      throw Error("缺少按钮" + text);
    };
    await page.type(
      '[aria-label="封面想法"]',
      "雨天咖啡馆里朋友随手拍，自然放松"
    );
    await page.type('[aria-label="封面标题"]', "慢一点也很好");
    await page.evaluate(() => sessionStorage.setItem("fail-prepare", "1"));
    await click("整理三款设计");
    await page.waitForSelector('[role="alert"]');
    await click("恢复待确认设计");
    await page.waitForSelector('[aria-label="当前封面设计"]');
    expect(
      await page.evaluate(() => {
        const c = (window as any).calls.filter(
          (c: any) => c.action === "prepare"
        );
        return c.length === 2 && c[0].id === c[1].id;
      })
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          (window as any).calls.filter((c: any) => c.action === "submit").length
      )
    ).toBe(0);
    expect(await page.$$('[aria-label="当前封面设计"] article')).toHaveLength(
      3
    );
    await click("确认生成三款");
    await page.waitForSelector('img[alt="自然叙事初稿"]');
    await click("选择此方向");
    await page.type('[aria-label="成稿修改"]', "保留构图，让光线更柔和");
    const draftId = await page.$eval(
      '[aria-label="已保存的封面"]',
      e => (e as HTMLSelectElement).value
    );
    await page.reload();
    await page.waitForSelector('img[alt="自然叙事初稿"]');
    expect(await page.$('[aria-label="成稿修改"]')).not.toBeNull();
    expect(
      await page.$eval(
        '[aria-label="成稿修改"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toBe("保留构图，让光线更柔和");
    expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
    // 新设计不继承旧设计的选择或修改；返回旧设计应完整恢复。
    await click("整理三款设计");
    await page.waitForFunction(
      id =>
        (
          document.querySelector(
            '[aria-label="已保存的封面"]'
          ) as HTMLSelectElement
        ).value !== id,
      {},
      draftId
    );
    expect(await page.$('[aria-label="成稿修改"]')).toBeNull();
    await click("确认生成三款");
    await page.waitForSelector('img[alt="自然叙事初稿"]');
    await click("选择此方向");
    expect(
      await page.$eval(
        '[aria-label="成稿修改"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toBe("");
    await page.select('[aria-label="已保存的封面"]', draftId);
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            '[aria-label="成稿修改"]'
          ) as HTMLTextAreaElement
        )?.value === "保留构图，让光线更柔和"
    );
    if (out)
      await page.screenshot({
        path: out + "/desktop-drafts.png",
        fullPage: true,
      });
    await click("查看成稿设计");
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="当前封面设计"] h4')
        ?.textContent?.includes("高画质成稿")
    );
    expect(
      await page.evaluate(
        () =>
          (window as any).calls.filter((c: any) => c.action === "submit").length
      )
    ).toBe(1);
    expect(
      await page.$eval('[aria-label="本次实际参考图片"] img', e =>
        e.getAttribute("alt")
      )
    ).toContain("选定初稿");
    await click("确认生成高画质成稿");
    await page.waitForSelector('img[alt="自然叙事成稿"]');
    expect(
      await page.evaluate(() => {
        const c = (window as any).calls.find((c: any) => c.stage === "final");
        return c.candidate === 0 && c.changes === "保留构图，让光线更柔和";
      })
    ).toBe(true);
    await page.reload();
    await page.waitForSelector('img[alt="自然叙事成稿"]');
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(0);
    await page.setViewport({ width: 390, height: 844 });
    if (out)
      await page.screenshot({
        path: out + "/mobile-final.png",
        fullPage: true,
      });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
    expect(
      await page.$eval('[aria-label="当前封面设计"]', e => e.textContent)
    ).not.toMatch(/Flare|Sunburst|Gemini|GLM|Astra/i);
    await page.select('[aria-label="已保存的封面"]', draftId);
    await page.waitForSelector('[aria-label="成稿修改"]');
    // 保存成稿请求时的同步写入也必须保留原设计的本机编辑。
    await page.reload();
    await page.waitForSelector('[aria-label="成稿修改"]');
    expect(
      await page.$eval(
        '[aria-label="成稿修改"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toBe("保留构图，让光线更柔和");
    expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
    await page.evaluate(() => {
      const key = "cover-workshop:1";
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.finalEdits[saved.id].selected = 99;
      localStorage.setItem(key, JSON.stringify(saved));
    });
    await page.reload();
    await page.waitForSelector('img[alt="自然叙事初稿"]');
    expect(await page.$('[aria-label="成稿修改"]')).toBeNull();
    await click("选择此方向");
    await page.waitForSelector('[aria-label="成稿修改"]');
    expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
    await page.evaluate(() => sessionStorage.setItem("user", "2"));
    await page.evaluate(() => localStorage.setItem("cover-workshop:2", "null"));
    await page.reload();
    await page.waitForSelector('[aria-label="封面想法"]');
    expect(await page.$('[aria-label="当前封面设计"]')).toBeNull();
    expect(
      await page.$eval(
        '[aria-label="封面想法"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toBe("");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>(r => server.close(() => r()));
  }
}, 60000);
