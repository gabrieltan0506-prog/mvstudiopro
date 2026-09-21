/** 挂载真实终审与交付组件，验证同段重复节点不会造成两区缺口矛盾。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("终审和交付同时显示缺第二段，不把第一段两个节点算两段", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Workbench from './client/src/components/ManhuaScriptWorkbench';
    import Dock from './client/src/components/canvas/ManhuaClipDock';
    import {TooltipProvider} from './client/src/components/ui/tooltip';
    import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
    import {resolveShotsForEpisodeKeyarts} from './client/src/lib/canvasDramaStudio';
    import {groupShotsIntoSegments} from './shared/manhuaScriptWorkbench';
    import {buildManhuaAutoSegmentBinding} from './shared/manhuaAutoSegment';
    import {emptyManhuaClipQualityChecks} from './shared/manhuaClipQuality';
    const model='seedance-2.0';
    const story={...defaultCanvasBlock('text',0,0),id:'beats-e01-plan',episodeIndex:1,outputText:'| 镜号 | 秒位 | 景别运镜 | 画面 | 对白 |\\n| --- | --- | --- | --- | --- |\\n'+Array.from({length:6},(_,i)=>'| '+(i+1)+' | '+i*4+'-'+(i+1)*4+' | 中景固定 | 人物走入庭院 | 无 |').join('\\n')};
    const plan=groupShotsIntoSegments(resolveShotsForEpisodeKeyarts([story],1),{videoModel:model});
    const first={...defaultCanvasBlock('video',0,0),episodeIndex:1,videoModel:model,status:'done',outputUrl:'https://offline.invalid/first.mp4',manhuaAutoSegment:buildManhuaAutoSegmentBinding(1,plan[0],model),manhuaClipQuality:{status:'passed',checks:emptyManhuaClipQualityChecks(),failedKeys:[],summary:'离线回执',raw:'',attempts:1,reviewedAt:'2026-09-21'}};
    const blocks=[story,{...first,id:'clip-e01-g01-a'},{...first,id:'clip-e01-g01-b'}];
    function App(){const [current,setCurrent]=React.useState(blocks);globalThis.replaceClips=()=>setCurrent([story,{...first,id:'clip-e01-g01-failed',manhuaClipQuality:{...first.manhuaClipQuality,status:'failed'}},blocks[1],{...first,id:'clip-e01-g02',manhuaAutoSegment:buildManhuaAutoSegmentBinding(1,plan[1],model)}]);return <TooltipProvider><Workbench blocks={current} videoModel={model} topic='两段缺一段' episodeCount={1} focusEpisode={1} onFocusEpisode={()=>{}} characterIds={[]} propIds={[]} outlineConfirmed={true} workflowPhase='final'/><Dock reviewMode blocks={current} videoModel={model} currentEpisodeIndex={1} selectedIds={new Set()} onSelectedIdsChange={()=>{}}/></TooltipProvider>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForSelector('[data-manhua-final-check="content"]');
    expect(await page.$eval('[data-manhua-final-check="content"]', el => ({ state: el.getAttribute("data-manhua-final-check-state"), text: el.textContent }))).toEqual({ state: "fail", text: expect.stringContaining("1/2 段成片，缺 1 段") });
    expect(await page.$eval('[data-manhua-final-check="picture"]', el => el.getAttribute("data-manhua-final-check-state"))).toBe("unknown");
    expect(await page.$eval('[data-manhua-delivery-gaps]', el => el.textContent)).toContain("1段尚无成片");
    expect(await page.$$('[data-manhua-review-issue="2"]')).toHaveLength(1);
    await page.evaluate(() => (globalThis as any).replaceClips());
    await page.waitForFunction(() => document.querySelector('[data-manhua-final-check="content"]')?.getAttribute("data-manhua-final-check-state") === "pass");
    expect(await page.$eval('[data-manhua-final-check="picture"]', el => el.getAttribute("data-manhua-final-check-state"))).toBe("pass");
    expect(await page.$$("[data-manhua-review-issue]")).toHaveLength(0);
    expect(await page.$eval('[data-manhua-delivery-gaps]', el => el.textContent)).not.toContain("段尚无成片");
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
