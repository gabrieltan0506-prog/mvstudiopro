import { expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer";
it("official revision dialog cancels without a request and confirms once with remaining-zero upgrade notice", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import Revision from './client/src/components/code-motion/CodeMotionRevision';globalThis.fixture={remaining:1,submits:[],created:false};const project={id:'11111111-1111-4111-8111-111111111111',brief:{},plan:{scenes:[{heading:'原题',body:'原文'}]}};createRoot(document.getElementById('root')).render(<Revision project={project} generation="1" disabled={false} execute={async f=>f()} onCreated={async()=>{globalThis.fixture.created=true}}/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
    plugins: [
      {
        name: "fake transport",
        setup(b) {
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
            loader: "js",
            resolveDir: process.cwd(),
            contents:
              args.path === "auth"
                ? "export const useAuth=()=>({user:{id:7}})"
                : `import{useState}from'react';export const trpc={codeMotionProduction:{revisionQuote:{useQuery:()=>{const[,tick]=useState(0);return{data:{tier:'free',completed:true,remaining:globalThis.fixture.remaining,message:'每部成片2次'},refetch:async()=>tick(v=>v+1)}}},revisionSubmit:{useMutation:()=>({mutateAsync:async input=>{globalThis.fixture.submits.push(input);globalThis.fixture.remaining=0;return{project:{},generation:'2'}}})}}};`,
          }));
        },
      },
    ],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r =>
      r.isNavigationRequest()
        ? void r.respond({
            status: 200,
            contentType: "text/html",
            body: '<div id="root"></div>',
          })
        : void r.abort()
    );
    await page.goto("http://localhost:41947/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = async (text: string) => {
      await page.waitForFunction(
        t =>
          Array.from(document.querySelectorAll("button")).some(
            b => b.textContent?.trim() === t && !b.disabled
          ),
        {},
        text
      );
      await page.evaluate(
        t =>
          (
            Array.from(document.querySelectorAll("button")).find(
              b => b.textContent?.trim() === t
            ) as HTMLButtonElement
          ).click(),
        text
      );
    };
    await page.waitForSelector('[aria-label="修改标题"]');
    await page.type('[aria-label="修改标题"]', "修改");
    await click("确认提交局部修改");
    await page.waitForSelector('[role="alertdialog"]');
    expect(
      await page.$eval('[role="alertdialog"]', e => e.textContent)
    ).toContain("提交后剩余0次");
    await click("取消");
    expect(
      await page.evaluate(() => ({
        submits: (globalThis as any).fixture.submits.length,
        pending: localStorage.getItem(
          "ink-revision:7:11111111-1111-4111-8111-111111111111"
        ),
      }))
    ).toEqual({ submits: 0, pending: null });
    await click("确认提交局部修改");
    await click("确认并提交修改");
    await page.waitForFunction(() => (globalThis as any).fixture.created);
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits.length)
    ).toBe(1);
    expect(await page.evaluate(() => document.body.textContent)).toContain(
      "免费2次已用完，请充值升级后继续"
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem(
          "ink-revision:7:11111111-1111-4111-8111-111111111111"
        )
      )
    ).toBeNull();
    expect(errors).toEqual([]);
    const dir = path.resolve("docs/evidence/ink-production-1011");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "revision-dialog-browser.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          fixture: (globalThis as any).fixture,
          text: document.body.textContent,
        })),
        null,
        2
      )
    );
    await page.screenshot({
      path: path.join(dir, "revision-dialog-after-confirm.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}, 30000);
