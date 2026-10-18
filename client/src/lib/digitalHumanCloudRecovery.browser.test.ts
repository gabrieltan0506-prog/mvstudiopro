/** 真实工作台恢复入口，云端/任务服务使用明确的离线回执。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("云备份回填保留身份和段落；场景缺单只在确认后按原编号提交，查询失败不提交", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
 import React from 'react';import{createRoot}from'react-dom/client';import{DigitalHumanStudio}from'./client/src/components/DigitalHumanStudio';
 import{newDigitalHumanDraft,digitalHumanDraftKey}from'./shared/digitalHumanStudio';
 const id='00000000-0000-4000-8000-000000000007';
 globalThis.cloud=newDigitalHumanDraft('7',id);globalThis.cloud.script='当前完整文稿';globalThis.cloud.scenes=[{request:{requestId:'00000000-0000-4000-8000-000000000099',description:'原始书房要求',aspectRatio:'9:16'},status:'unknown'}];
 globalThis.savedBackup=structuredClone(globalThis.cloud);globalThis.savedBackup.script='备份中的完整文稿';
 globalThis.generation=1;globalThis.calls=[];globalThis.lookup='missing';globalThis.accept=false;globalThis.failCloud=false;
 globalThis.confirm=()=>globalThis.accept;
 function App(){const[key,setKey]=React.useState(0);globalThis.remount=()=>{localStorage.removeItem(digitalHumanDraftKey('7'));setKey(k=>k+1)};return <DigitalHumanStudio key={key}/>;}createRoot(document.getElementById('root')).render(<App/>);
 `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [
      {
        name: "offline",
        setup(b) {
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "offline",
          }));
          b.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({
            path: "rpc",
            namespace: "offline",
          }));
          b.onResolve(
            {
              filter:
                /\/DigitalHuman(?:SpatialStudio|Recorder|OmniPanel|PostProduction|ProductionPanel|FilmDirectorPanel|KeyframeAdvicePanel|KeyframeGenerationPanel|KeyframePanel|PublicationPanel)$/,
            },
            args => ({ path: args.path.split("/").pop()!, namespace: "panel" })
          );
          b.onLoad({ filter: /.*/, namespace: "panel" }, args => ({
            contents: "export function " + args.path + "(){return null}",
            loader: "js",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, a => ({
            loader: "js",
            contents:
              a.path === "auth"
                ? `export const useAuth=()=>({user:{id:7,role:'user'}});`
                : `
 const backupId='1792317600000-00000000000000000000000000000001';
 const list=[{id:backupId,createdAt:'2026-10-18T12:00:00Z',status:'complete',title:'已保存文稿',reason:'manual',assetCount:0,savedAssets:0}];
 async function call(group,name,input){globalThis.calls.push({group,name,input});
 if(name==='getDraft')return{draft:structuredClone(globalThis.cloud),generation:String(globalThis.generation)};
 if(name==='saveDraft'){if(globalThis.failCloud)throw Error('云保存失败');if(input.expectedGeneration!==String(globalThis.generation))throw Error('云版本冲突');globalThis.cloud=structuredClone(input.draft);return{generation:String(++globalThis.generation)}}
 if(name==='createBackup')return list[0]; if(name==='advanceBackup')return list[0];
 if(name==='restoreBackup'){if(input.expectedGeneration!==String(globalThis.generation))throw Error('云版本冲突');globalThis.cloud=structuredClone(globalThis.savedBackup);return{status:'restored',draft:structuredClone(globalThis.cloud),generation:String(++globalThis.generation),safetyBackupId:backupId}}
 if(name==='getScene'){if(globalThis.lookup==='error')throw Error('原任务查询超时');return globalThis.lookup==='found'?{jobId:'original-scene-job'}:null;}
 if(name==='createScene'){globalThis.lookup='found';return{jobId:'original-scene-job'}}
 if(name==='getJob')return{status:'running'};return null;}
 const utils=new Proxy({}, {get:(_,g)=>new Proxy({}, {get:(_,n)=>({fetch:i=>call(g,n,i)})})});
 export const trpc=new Proxy({}, {get:(_,g)=>g==='useUtils'?()=>utils:new Proxy({}, {get:(_,n)=>({useQuery:()=>({data:n==='listBackups'?list:[],refetch:async()=>({data:n==='listBackups'?list:[]})}),useMutation:()=>({mutateAsync:i=>call(g,n,i)})})})});`,
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on(
      "request",
      r =>
        void r.respond({
          status: 200,
          contentType: "text/html",
          body: '<div id="root"></div>',
        })
    );
    await page.goto("https://test.invalid");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = (text: string) =>
      page.evaluate(text => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent?.trim() === text
        );
        if (!b || b.disabled) throw Error("按钮不可用 " + text);
        b.click();
      }, text);
    await page.waitForFunction(() =>
      document.body.textContent?.includes("云端稿件已恢复")
    );
    await click("立即云备份");
    await page.waitForFunction(() =>
      (globalThis as any).calls.some((c: any) => c.name === "advanceBackup")
    );
    await click("使用原编号恢复场景提交");
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>(
          '[aria-label="云端备份与回填"] button'
        )?.disabled
    );
    expect(
      await page.evaluate(() =>
        (globalThis as any).calls.filter((c: any) => c.name === "createScene")
      )
    ).toHaveLength(0);
    await page.evaluate(() => {
      (globalThis as any).accept = true;
      (globalThis as any).lookup = "error";
    });
    await click("使用原编号恢复场景提交");
    await page.waitForFunction(() =>
      document.body.textContent?.includes("原任务查询超时")
    );
    expect(
      await page.evaluate(() =>
        (globalThis as any).calls.filter((c: any) => c.name === "createScene")
      )
    ).toHaveLength(0);
    await page.evaluate(() => {
      (globalThis as any).lookup = "missing";
    });
    await click("使用原编号恢复场景提交");
    await page.waitForFunction(() =>
      (globalThis as any).calls.some((c: any) => c.name === "createScene")
    );
    const creations = await page.evaluate(() =>
      (globalThis as any).calls.filter((c: any) => c.name === "createScene")
    );
    expect(creations).toHaveLength(1);
    expect(creations[0].input).toEqual({
      requestId: "00000000-0000-4000-8000-000000000099",
      description: "原始书房要求",
      aspectRatio: "9:16",
    });
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>(
          '[aria-label="云端备份与回填"] button'
        )?.disabled
    );
    await click("回填此版本");
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLTextAreaElement>(
          'textarea[maxlength="4000"]'
        )?.value === "备份中的完整文稿"
    );
    expect(await page.evaluate(() => (globalThis as any).cloud.id)).toBe(
      "00000000-0000-4000-8000-000000000007"
    );
    expect(
      await page.evaluate(() =>
        (globalThis as any).calls.filter((c: any) => c.name === "createScene")
      )
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
