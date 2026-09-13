import { it, expect } from "vitest";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";
it("动画提交断线后按同一请求键恢复，刷新不再POST，账户隔离", async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';
    import {usePhotoAnimationTask} from './client/src/lib/usePhotoAnimationTask';
    window.fixture={user:7,posts:[],queries:[],success:false,results:[]};
    window.fetch=async(url,init)=>{
      if(url==='/api/me')return{ok:true,json:async()=>({id:fixture.user})};
      if(init?.method==='POST'){fixture.posts.push(JSON.parse(init.body));if(fixture.denied)return{ok:false,status:400,json:async()=>({ok:false,error:'照片超出模型上限',submission:'not_started'})};throw new Error('断线');}
      fixture.queries.push(url);return{ok:true,json:async()=>({ok:true,taskId:'hpa_existing',status:fixture.success?'succeeded':'running',videoUrl:fixture.success?'https://example.com/video.mp4':null})};
    };
    function App(){const t=usePhotoAnimationTask(fixture.user,(...r)=>fixture.results.push(r));return <><button disabled={!t.ready||!!t.pending} onClick={()=>t.submit({imageUrl:'https://example.com/a.png'},79,10).catch(()=>{})}>生成</button><p>{t.message}</p></>}
    const root=createRoot(document.getElementById('root'));let n=0;fixture.render=()=>flushSync(()=>root.render(<App key={++n}/>));fixture.render();
  `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    format: "iife",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "离线媒体入口",
        setup(b) {
          b.onResolve(
            { filter: /longJobsFlyOrigin|photoTemporaryMedia/ },
            a => ({ path: a.path, namespace: "mock" })
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({
            contents: a.path.includes("photoTemporaryMedia")
              ? "export const cachePhotoTemporaryMedia=async url=>url;"
              : "export const withLongJobsFlyDirect=url=>url;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on(
      "request",
      req =>
        void (req.isNavigationRequest()
          ? req.respond({
              status: 200,
              contentType: "text/html",
              body: '<div id="root"></div>',
            })
          : req.abort())
    );
    await page.goto("http://localhost:41777");
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.waitForFunction(
      () => !(document.querySelector("button") as HTMLButtonElement)?.disabled
    );
    await page.evaluate(() => {
      (window as any).fixture.denied = true;
    });
    await page.click("button");
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("照片超出模型上限") &&
        !(document.querySelector("button") as HTMLButtonElement).disabled
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem("home-photo-animation:v1:7")
      )
    ).toBeNull();
    await page.evaluate(() => {
      (window as any).fixture.denied = false;
      (window as any).fixture.posts = [];
      (window as any).fixture.queries = [];
      (window as any).fixture.render();
    });
    await page.waitForFunction(
      () => !(document.querySelector("button") as HTMLButtonElement).disabled
    );
    await page.click("button");
    await page.waitForFunction(
      () => (window as any).fixture.posts.length === 1
    );
    const key = await page.evaluate(
      () => (window as any).fixture.posts[0].requestKey
    );
    await page.evaluate(() => (window as any).fixture.render());
    await page.waitForFunction(
      () => (window as any).fixture.queries.length > 1
    );
    expect(
      await page.evaluate(
        () => (document.querySelector("button") as HTMLButtonElement).disabled
      )
    ).toBe(true);
    expect(
      await page.evaluate(() => (window as any).fixture.posts.length)
    ).toBe(1);
    expect(
      await page.evaluate(() =>
        (window as any).fixture.queries.every((q: string) =>
          q.includes((window as any).fixture.posts[0].requestKey)
        )
      )
    ).toBe(true);
    await page.evaluate(() => {
      (window as any).fixture.success = true;
      (window as any).fixture.render();
    });
    await page.waitForFunction(
      () => (window as any).fixture.results.length === 1
    );
    expect(key).toMatch(/^[a-z0-9-]+$/);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("home-photo-animation:v1:7")
      )
    ).toBeNull();
    await page.evaluate(() => {
      (window as any).fixture.user = 8;
      (window as any).fixture.render();
    });
    await page.waitForFunction(
      () => !(document.querySelector("button") as HTMLButtonElement).disabled
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem("home-photo-animation:v1:8")
      )
    ).toBeNull();
  } finally {
    await browser.close();
  }
}, 30000);
