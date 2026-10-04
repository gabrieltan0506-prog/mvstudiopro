declare global {
  interface Window {
    writes: Array<{ projectId: string; payloadJson: string }>;
    reads: string[];
  }
}
import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
it.each([false, true])(
  "R1661-001真实OmniCanvas新设备保留云稿（直传=%s）",
  async direct => {
    const cloud = buildManhuaCloudDraftPayload({
      clientUpdatedAt: "2026-10-01T00:00:00.000Z",
      writerSession: { topic: "云端珍贵原稿", episodeCount: 3, novelOrigin:{imports:[{requestId:"22222222-2222-4222-8222-222222222222",sha:"a".repeat(64)}]} },
      blocks: [],
      edges: [],
    });
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
 import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{httpBatchLink}from'@trpc/client';import superjson from'superjson';import{trpc}from'@/lib/trpc';import OmniCanvas from'@/pages/OmniCanvas';
 const cloud=${JSON.stringify(cloud)};const direct=${direct};window.writes=[];window.reads=[];
 globalThis.fetch=async(url,init)=>{const s=String(url);if(init?.method==='PUT'){window.writes.push({projectId:'11111111-1111-4111-8111-111111111111',payloadJson:JSON.stringify(JSON.parse(init.body).payload)});return new Response('',{status:200});}const names=s.split('/api/trpc/')[1]?.split('?')[0].split(',')||[];const request=JSON.parse(String(init?.body||'{}'));return new Response(JSON.stringify(names.map((name,i)=>{window.reads.push(name);let data=null;if(name==='manhuaCloudDraft.prepareDirectUpload'&&direct)data={uploadUrl:'https://storage.googleapis.com/test/draft.json'};if(name==='manhuaCloudDraft.commitDirectUpload')data={ok:true};if(name==='manhuaCloudDraft.get')data={draft:cloud,serverUpdatedAt:cloud.clientUpdatedAt};if(name==='manhuaCloudDraft.upsert'){window.writes.push(request[String(i)]?.json);data={ok:true}};if(name==='stripe.getSubscription')data={plan:'free'};return{result:{data:{json:data}}}})),{headers:{'content-type':'application/json'}})};
 const q=new QueryClient({defaultOptions:{queries:{retry:false}}});const c=trpc.createClient({links:[httpBatchLink({url:'/api/trpc',transformer:superjson})]});createRoot(document.getElementById('root')).render(<trpc.Provider client={c} queryClient={q}><QueryClientProvider client={q}><OmniCanvas/></QueryClientProvider></trpc.Provider>);
 `,
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
      plugins: [
        {
          name: "auth",
          setup(b) {
            b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
              path: "auth",
              namespace: "offline",
            }));
            b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
              loader: "js",
              contents:
                'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false,isAuthenticated:true,logout:()=>{}});',
            }));
          },
        },
      ],
      loader: {
        ".png": "dataurl",
        ".svg": "dataurl",
        ".jpg": "dataurl",
        ".css": "text",
      },
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.env": "__ENV__",
      },
      banner: {
        js: 'var __ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};',
      },
      logLevel: "silent",
    });
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
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
      await page.goto(
        "http://localhost:41859/canvas?project=11111111-1111-4111-8111-111111111111&owner=1"
      );
      await page.addScriptTag({ content: result.outputFiles[0].text });
      await page
        .waitForFunction(() => window.writes.length > 0, { timeout: 12000 })
        .catch(() => {});
      const evidence = await page.evaluate(() => ({
        reads: window.reads,
        writes: window.writes.map(x => ({
          projectId: x.projectId,
          topic: JSON.parse(x.payloadJson).writerSession.topic,
          origin: JSON.parse(x.payloadJson).writerSession.novelOrigin,
          clientUpdatedAt: JSON.parse(x.payloadJson).clientUpdatedAt,
        })),
        local: Object.entries(localStorage)
          .filter(([k]) => k.endsWith("mv-manhua-writer-session-v1"))
          .map(([k, v]) => ({ k, topic: JSON.parse(v).topic })),
      }));
      console.log("R1661-001 UI PROOF", JSON.stringify({ evidence, errors }));
      expect(evidence.writes.length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      for(const write of evidence.writes){expect(write.topic).toBe("云端珍贵原稿");expect(write.origin).toEqual(cloud.writerSession.novelOrigin);}
    } finally {
      await browser.close();
    }
  },
  60000
);
