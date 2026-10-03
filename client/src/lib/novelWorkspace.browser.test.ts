import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
const mock = `
const cards=Array.from({length:5},(_,i)=>({publicId:'mt_000'+i,nameZh:'模板'+(i+1),featureZh:'人物冲突与对白',introZh:'有代价的抉择',classificationTagsZh:[]}));
globalThis.calls=[];globalThis.receipts={};
const generate=async input=>{
 globalThis.calls.push(input);let value;
 if(input.stage==='advice')value={assessment:'先确定主角代价，前三集逐次兑现冲突。',recommendations:cards.filter(c=>!input.selectedTemplateIds.includes(c.publicId)).slice(0,3).map(c=>({publicId:c.publicId,reason:'强化角色抉择',tradeoff:'减少支线'}))};
 if(input.stage==='outline')value={premise:'补天需要代价',characters:'女娲与守火人',episodes:Array.from({length:input.episodeCount},(_,i)=>({index:i+1,title:'第'+(i+1)+'集',events:'主角作出选择',hook:'新的代价',payoff:'救下一城'}))};
 if(input.stage==='chapter')value={title:'第'+input.chapterIndex+'章',text:'女娲望着破裂的天空，决定留下来。'.repeat(40),notes:'测试生成，非真实模型结果'};
 if(input.stage==='script')value={title:'补天',episodes:Array.from({length:input.episodeCount},(_,i)=>({index:i+1,title:'补天',opening:'天裂',payoff:'救人',hook:'余烬',scenes:[{key:'E'+(i+1)+'-S1',场景:'共同场景。'+(input.templates[0].publicId==='mt_0000'?'雪落城头。':'雨落城头。'),人物:'女娲与守火人。',妆容:'灰衣。',灯光:'火光。',氛围:'紧张。',对白:'女娲说：“把孩子先带出去，我来守住这里。”'}]}))};
 const result={requestId:input.requestId,stage:input.stage,text:JSON.stringify(value),templateIds:input.templates.map(t=>t.publicId),inputSha256:'a'.repeat(64),resultSha256:'b'.repeat(64)};globalThis.receipts[input.requestId]=result;return result;
};
export const trpc={manhuaViralTemplate:{listApprovedPublic:{useQuery:()=>({data:{groups:[{items:cards}]},isLoading:false,isError:false})}},novelWorkspace:{generate:{useMutation:()=>({mutateAsync:generate})}},useUtils:()=>({novelWorkspace:{receipt:{fetch:async({requestId})=>({status:'succeeded',result:globalThis.receipts[requestId]})}}})};
`;
it("浏览器完整走原创→顾问→分章→单独/组合比较→重开恢复，墨菁传保持不变", async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{NovelAdaptationWorkspace}from'./client/src/pages/NovelAdaptation';createRoot(document.getElementById('root')).render(<NovelAdaptationWorkspace userId="1"/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    external: ["pdfjs-dist", "tesseract.js"],
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "mock-transport",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "mock",
          }));
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
            contents:
              args.path === "trpc"
                ? mock
                : 'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false});',
            loader: "js",
          }));
        },
      },
    ],
  });
  let css = "";
  try {
    const dir = "client/dist/assets";
    css = readdirSync(dir)
      .filter(f => f.endsWith(".css"))
      .map(f => readFileSync(dir + "/" + f, "utf8"))
      .join("\n");
  } catch {}
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<meta charset="utf-8"><style>' +
        css +
        '</style><div id="root"></div><script>' +
        built.outputFiles[0].text.replace(/<\/script/g, "<\\/script") +
        "</script>"
    );
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on("dialog", d => d.accept());
    const errors: string[] = [];
    page.on("pageerror", e => {
      errors.push(String(e));
      console.error("BROWSER", String(e));
    });
    await page.goto("http://127.0.0.1:" + port);
    await page.waitForSelector("h1", { timeout: 5000 }).catch(async e => {
      console.error((await page.content()).slice(0, 1000), errors);
      throw e;
    });
    await page.evaluate(() =>
      localStorage.setItem(
        "mv-manhua-writer-session-v1",
        JSON.stringify({ seriesTitle: "墨菁传", asset: "原资产" })
      )
    );
    const click = async (label: string) => {
      await page.waitForFunction(
        label =>
          Array.from(document.querySelectorAll("button")).some(
            b => b.textContent === label && !b.disabled
          ),
        {},
        label
      );
      await page.evaluate(label => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === label
        );
        if (!b || b.disabled) throw new Error("unavailable " + label);
        b.click();
      }, label);
    };
    await click("原创新方向");
    await page.type('[aria-label="作品名称"]', "女娲补天");
    await page.type('[aria-label="创作方向"]', "以守火人视角写牺牲与救赎。");
    await click("请创作顾问建议方向与模板");
    await page.waitForFunction(() =>
      document.body.textContent!.includes("强化角色抉择")
    );
    await click("加入本轮候选");
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button")).filter(
        b => b.textContent === "加入本轮候选" && !b.disabled
      );
      buttons[0].click();
    });
    await click("生成改编提案");
    await page.waitForFunction(() =>
      (
        document.querySelector(
          '[aria-label="提案与大纲"]'
        ) as HTMLTextAreaElement
      )?.value.includes("补天需要代价")
    );
    await click("确认大纲，开始分章");
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(i => {
        const heading = Array.from(document.querySelectorAll("h3")).find(
          e => e.textContent === "第" + i + "章"
        );
        (
          heading?.parentElement?.querySelector("button") as HTMLButtonElement
        ).click();
      }, i);
      await page.waitForFunction(
        i =>
          (
            document.querySelector(
              '[aria-label="第' + i + '章小说"]'
            ) as HTMLTextAreaElement
          )?.value.length > 500,
        {},
        i
      );
    }
    await click("确认这版小说，进入模板比较");
    await click("单独生成 · 模板1");
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="模板比较"] thead th').length ===
        2
    );
    await click("单独生成 · 模板2");
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="模板比较"] thead th').length ===
        3
    );
    await click("按分工组合生成");
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="模板比较"] thead th').length ===
        4
    );
    const calls = await page.evaluate(() => (window as any).calls);
    expect(
      calls
        .filter((c: any) => c.stage === "chapter")
        .map((c: any) => c.chapterIndex)
    ).toEqual([1, 2, 3]);
    expect(
      calls
        .filter((c: any) => c.stage === "script")
        .map((c: any) => c.templates.length)
    ).toEqual([1, 1, 2]);
    expect(
      new Set(
        calls.filter((c: any) => c.stage === "script").map((c: any) => c.novel)
      ).size
    ).toBe(1);
    expect(
      await page.$eval('[aria-label="模板比较"]', e => e.textContent)
    ).toContain("共同场景。");
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    expect(
      await page.$eval(
        ".novel-difference",
        e => getComputedStyle(e).animationName
      )
    ).toBe("none");
    mkdirSync("../backend-work/novel-workspace", { recursive: true });
    await page.screenshot({
      path: "../backend-work/novel-workspace/desktop.png",
      fullPage: true,
    });
    await page.reload();
    await page.waitForSelector('[aria-label="模板比较"] table');
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(0);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("mv-manhua-writer-session-v1")!)
            .seriesTitle
      )
    ).toBe("墨菁传");
    await page.setViewport({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(391);
    await page.screenshot({
      path: "../backend-work/novel-workspace/mobile.png",
      fullPage: true,
    });
    await click("放弃本轮，重新开始");
    await page.waitForFunction(
      () =>
        (document.querySelector('[aria-label="作品名称"]') as HTMLInputElement)
          .value === ""
    );
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some(k => k.includes(":archive:"))
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.close();
  }
}, 60000);
