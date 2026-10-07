import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import {prepareManualEpisodeEditAdoption,persistAdvisorRewriteAdoptionWithSnapshot} from './client/src/lib/manhuaAdvisorAdoption';
import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
import {slimBlocksForLocalPersist} from './client/src/lib/manhuaCloudDraftSync';
import {importLocalMediaRecords,rehydrateBlocksFromLocalMedia} from './client/src/lib/manhuaLocalMediaStore';
import {buildManhuaWriterSession,serializeManhuaWriterSession,loadManhuaWriterSessionFromStorage,MANHUA_WRITER_SESSION_LS_KEY} from './shared/manhuaWriterSession';
const canvasKey='mv-freeform-canvas-v1';
globalThis.quotaProbe={
  async adopt(){
    const source='https://test.invalid/retained.png?padding='+'x'.repeat(300000);
    await importLocalMediaRecords([{sourceUrl:source,blob:new Blob(['retained-image-bytes']),mime:'image/png'}]);
    const image={...defaultCanvasBlock('image',0,0),id:'retained-character',outputUrl:source,outputUrls:[source],editFusionUrls:[source],outputText:'完整文字'.repeat(6000)};
    const clip={...defaultCanvasBlock('video',0,0),id:'clip-e01-g01',episodeIndex:1,outputUrl:'https://test.invalid/ep1.mp4',outputUrls:['https://test.invalid/ep1.mp4']};
    const writerPack={seriesTitle:'测试作品',logline:'取血',charactersMd:'先生',propsMd:'碗',locationsMd:'医馆',rawMarkdown:'旧稿',episodeCount:2,episodes:[1,2].map(index=>({index,title:'第'+index+'集',body:'原稿'+index,endHook:'悬念'}))};
    const original={writerPack,projectBible:null,blocks:[image,clip],edges:[],overlays:{}};
    const session=serializeManhuaWriterSession(buildManhuaWriterSession({writerPack}));
    localStorage.setItem(MANHUA_WRITER_SESSION_LS_KEY,session);
    localStorage.setItem(canvasKey,JSON.stringify({blocks:slimBlocksForLocalPersist(original.blocks),edges:[]}));
    localStorage.setItem('mv-manhua-director-board-overlay-v1','{}');
    const used=Object.keys(localStorage).reduce((n,k)=>n+k.length+localStorage.getItem(k).length,0);
    localStorage.setItem('retained-test-history','h'.repeat(4968548-used-'retained-test-history'.length));
    const before=localStorage.getItem(canvasKey);
    let rawRejected=false;
    try{localStorage.setItem(canvasKey,JSON.stringify({blocks:original.blocks,edges:[]}));}catch(e){rawRejected=e.name==='QuotaExceededError';}
    if(!rawRejected||localStorage.getItem(canvasKey)!==before)throw Error('旧路径没有复现原子配额失败');
    const plan=prepareManualEpisodeEditAdoption({...original,busy:false,edit:{episodeIndex:2,originalBody:'原稿2',originalEndHook:'悬念',body:'新剧情：先生取血救娘。',endHook:'红光'}});
    const backupKey=await persistAdvisorRewriteAdoptionWithSnapshot({plan,original,userId:'1',backupId:'native-quota',createdAt:new Date().toISOString()});
    return {rawRejected,backupKey,historyChars:localStorage.getItem('retained-test-history').length,canvasChars:localStorage.getItem(canvasKey).length};
  },
  async restored(){
    const canvas=JSON.parse(localStorage.getItem(canvasKey));
    const hydrated=await rehydrateBlocksFromLocalMedia(canvas.blocks);
    const image=hydrated.find(b=>b.id==='retained-character');
    const bytes=await fetch(image.outputUrl).then(r=>r.text());
    return {body:loadManhuaWriterSessionFromStorage()?.writerPack?.episodes[1]?.body,pointer:canvas.blocks[0].outputUrl.startsWith('local-media:v1/'),bytes,textChars:image.outputText.length,firstEpisode:hydrated.find(b=>b.id==='clip-e01-g01').outputUrl,historyChars:localStorage.getItem('retained-test-history').length};
  }
};` }, bundle: true, write: false, platform: "browser", format: "iife", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" } });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

it("真实浏览器近配额仍可采用，并在刷新后恢复图片字节、正文和第一集引用", async () => {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setRequestInterception(true);
    page.on("request", request => request.isNavigationRequest() ? void request.respond({ status: 200, contentType: "text/html", body: '<div>采用存储定向验证</div>' }) : void request.abort());
    await page.goto("http://localhost:41832/canvas");
    await page.addScriptTag({ content: bundle });
    const saved = await page.evaluate(() => (globalThis as any).quotaProbe.adopt());
    expect(saved.rawRejected).toBe(true);
    expect(saved.canvasChars).toBeLessThan(100000);
    await page.reload();
    await page.addScriptTag({ content: bundle });
    const restored = await page.evaluate(() => (globalThis as any).quotaProbe.restored());
    expect(restored).toEqual({body:"新剧情：先生取血救娘。",pointer:true,bytes:"retained-image-bytes",textChars:24000,firstEpisode:"https://test.invalid/ep1.mp4",historyChars:saved.historyChars});
  } finally { await context.close(); }
}, 30000);
