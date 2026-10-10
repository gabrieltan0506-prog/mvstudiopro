/** New advisor controls in the real workshop and editors; all transports/metadata are local fixtures. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("顾问VFX/标题/转场/生成式按当前指纹填参，原链提交返回真回执，拒绝过期与失败保存", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Workshop from './client/src/components/canvas/PostProdWorkshopCard';
    import {ManhuaGenerativeEffectsEditor} from './client/src/components/canvas/ManhuaGenerativeEffectsEditor';
    import {makeManhuaVfxEffect,manhuaVfxSourceKey} from './client/src/lib/manhuaVfxWorkflow';
    globalThis.controls={};globalThis.calls=[];globalThis.saved=[];globalThis.failSave=false;window.confirm=()=>true;
    const register=(scope,tool,control)=>{globalThis.controls[tool]=control;};const noop=()=>{};
    const blocks=[1,2].map(index=>({id:'clip-e01-g0'+index,kind:'video',episodeIndex:1,prompt:'片段'+index,outputUrl:'gs://offline/source'+index+'.mp4',uploadedAssets:[],manhuaClipQuality:{status:'unverified',userAcceptedDespiteQc:true}}));
    blocks.push({id:'keyart-e01-s01',kind:'image',episodeIndex:1,prompt:'标志',outputUrl:'gs://offline/stamp.png',uploadedAssets:[]});
    const clip={id:blocks[0].id,url:blocks[0].outputUrl};const initial={version:1,scopeKey:'project:advisor',requests:{},draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition:{version:1,seed:1,effects:[makeManhuaVfxEffect('shield','effect-1')]}}};
    function App(){const[state,setState]=React.useState(initial);return <><Workshop blocks={blocks} userId='offline' projectScopeKey='project:base' vfxScopeKey='project:advisor' focusEpisode={1} vfxState={state} onVfxStateChange={async next=>{if(globalThis.failSave)throw new Error('云保存失败');globalThis.saved.push(next);setState(next);return next;}} onAdvisorEffectsControl={register}/><ManhuaGenerativeEffectsEditor clipBlockId='clip-e01-g01' effectsScopeKey='project:advisor' sourceIdentity='source1' sourceDurationSec={5} onAdvisorEffectsControl={register} onSubmit={async(clipId,instruction)=>{globalThis.calls.push({action:'generative',clipId,instruction});return '用户取消，未生成';}}/></>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [{ name: "offline-trpc", setup(builder) {
      builder.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({ path: "trpc", namespace: "offline" }));
      builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `
        const query={data:undefined,isLoading:false,isFetching:false,error:null};
        const mutation={isPending:false,mutate:()=>{},mutateAsync:async input=>{globalThis.calls.push(input);return {jobId:'job-'+globalThis.calls.length,status:'queued'};}};
        const utils=new Proxy({}, {get:()=>new Proxy({}, {get:()=>({invalidate:async()=>{},fetch:async()=>null})})});
        const leaf=new Proxy({}, {get:(_,key)=>key==='useQuery'?()=>query:key==='useMutation'?()=>mutation:()=>{}});
        export const trpc=new Proxy({}, {get:(_,key)=>key==='useUtils'?()=>utils:new Proxy({}, {get:()=>leaf})});
      ` }));
    } }], define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => ["vfx", "title", "transition", "generative"].every(tool => (globalThis as any).controls[tool]));
    const inspect = async (tool: string) => page.evaluate(async name => JSON.parse(await (globalThis as any).controls[name]({ action: "effects", tool: name, operation: "inspect" }, new AbortController().signal)), tool);
    const act = async (action: Record<string, unknown>) => page.evaluate(async action => {
      try { return { receipt: await (globalThis as any).controls[action.tool as string](action, new AbortController().signal) }; }
      catch (error) { return { error: String(error) }; }
    }, action);
    const metadata = async (selector: string) => page.$eval(selector, video => { for (const [key, value] of Object.entries({ duration: 5, videoWidth: 1280, videoHeight: 720 })) Object.defineProperty(video, key, { configurable: true, value }); video.dispatchEvent(new Event("loadedmetadata")); });

    let vfx = await inspect("vfx"); expect(vfx.clips).toHaveLength(2); expect(vfx.images[0].id).toBe("keyart-e01-s01"); expect(JSON.stringify(vfx)).not.toContain("gs://");
    const recipe = { version: 1, seed: 2, effects: [{ ...vfx.vfxRecipe.effects[0], kind: "image_overlay", imageId: vfx.images[0].id }] };
    await page.evaluate(() => { (globalThis as any).failSave = true; });
    expect((await act({ action: "effects", tool: "vfx", operation: "configure", sourceKey: vfx.sourceKey, sourceIds: [vfx.clips[0].id], vfxRecipe: recipe })).error).toContain("云保存失败");
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    await page.evaluate(() => { (globalThis as any).failSave = false; });
    expect((await act({ action: "effects", tool: "vfx", operation: "configure", sourceKey: vfx.sourceKey, sourceIds: [vfx.clips[0].id], vfxRecipe: recipe })).receipt).toContain("已保存");
    await page.waitForFunction(() => (globalThis as any).saved.length === 1);
    expect((await act({ action: "effects", tool: "vfx", operation: "submit", sourceKey: vfx.sourceKey })).error).toContain("已变化");
    await metadata('[data-vfx-position-frame] video'); vfx = await inspect("vfx");
    expect(vfx.creditsPer15Seconds.shield).toBe(8); expect(vfx.creditsPer15Seconds.motion_ghost).toBe(16); expect(vfx.creditsPer15Seconds.bullet_time).toBe(32);
    expect(vfx.creditQuote.credits).toBe(8); expect(vfx.billingEnabled).toBe(false);
    expect(await page.$eval('[aria-label="特效积分标价"]', node => node.textContent)).toContain("本片标价 8 积分");
    expect(await page.$$eval('option', nodes => nodes.map(node => node.textContent))).toContain("能量护盾 · 8积分/15秒");
    const vfxReceipt = await act({ action: "effects", tool: "vfx", operation: "submit", sourceKey: vfx.sourceKey }); expect(vfxReceipt.error).toBeUndefined();
    const queuedVfx = await page.evaluate(() => (globalThis as any).calls.find((input: any) => input.action === "manhua_vfx")); expect(queuedVfx.scopeKey).toBe("project:advisor"); expect(queuedVfx.params.composition.effects[0].imageUri).toBe("gs://offline/stamp.png");

    let title = await inspect("title");
    expect((await act({ action: "effects", tool: "title", operation: "configure", sourceKey: title.sourceKey, sourceIds: [title.sources[1].id], titleSettings: { text: "第二回", startSec: 1, endSec: 3, fontSize: 32, alignment: 8 } })).receipt).toContain("已选入");
    await page.waitForSelector('[aria-label="标题原片预览"]'); await metadata('[aria-label="标题原片预览"]'); title = await inspect("title");
    expect(title.titleSettings.text).toBe("第二回");
    expect((await act({ action: "effects", tool: "title", operation: "submit", sourceKey: title.sourceKey })).receipt).toContain("job-");
    const queuedTitle = await page.evaluate(() => (globalThis as any).calls.find((input: any) => input.action === "burn_subtitle")); expect(queuedTitle.params.videoUri).toBe("gs://offline/source2.mp4"); expect(queuedTitle.params.styleOverride.alignment).toBe(8);

    let transition = await inspect("transition");
    await act({ action: "effects", tool: "transition", operation: "configure", sourceKey: transition.sourceKey, sourceIds: transition.sources.map((item: any) => item.id).reverse(), transitionSettings: { kind: "wipeleft", durationSec: 0.4, resolution: "720p", aspect: "16:9" } });
    await page.waitForFunction(() => (document.querySelector('[aria-label="拼接转场"]') as HTMLSelectElement).value === "wipeleft"); transition = await inspect("transition");
    expect((await act({ action: "effects", tool: "transition", operation: "submit", sourceKey: transition.sourceKey })).receipt).toContain("job-");
    const queuedConcat = await page.evaluate(() => (globalThis as any).calls.find((input: any) => input.action === "concat")); expect(queuedConcat.params.clips).toEqual(["gs://offline/source2.mp4", "gs://offline/source1.mp4"]); expect(queuedConcat.params.transition).toEqual({ kind: "wipeleft", durationSec: 0.4 });

    let generative = await inspect("generative");
    await act({ action: "effects", tool: "generative", operation: "configure", sourceKey: generative.sourceKey, clipId: generative.clipId, generativeSettings: { presetId: "spirit", target: "左侧角色", instruction: "保持运动，将衣服改为灵体材质", startSec: 1, endSec: 3 } });
    await page.waitForFunction(() => (document.querySelector('[aria-label="生成式特效修改对象"]') as HTMLInputElement).value === "左侧角色");
    expect((await act({ action: "effects", tool: "generative", operation: "submit", sourceKey: generative.sourceKey, clipId: generative.clipId })).error).toContain("已变化");
    generative = await inspect("generative"); expect((await act({ action: "effects", tool: "generative", operation: "submit", sourceKey: generative.sourceKey, clipId: generative.clipId })).receipt).toBe("用户取消，未生成");
    const edit = await page.evaluate(() => (globalThis as any).calls.find((input: any) => input.action === "generative")); expect(edit.clipId).toBe("clip-e01-g01"); expect(edit.instruction).toContain("原片1—3秒"); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);


it("顾问旧候选可读回原方案并保存后采用，成功任务续查不再提交", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    import {makeManhuaVfxEffect,manhuaVfxSourceKey} from './client/src/lib/manhuaVfxWorkflow';
    const clip={id:'clip-e01-g01',url:'gs://offline/original.mp4',label:'原片'};const effect=makeManhuaVfxEffect('shield','shield-1');
    const recipe={version:1,seed:1,effects:[{...effect,scale:.4}]};const requestId='00000000-0000-4000-8000-000000000001';
    const request={requestId,sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition:recipe,createdAt:1,status:'succeeded',jobId:'old-job',output:{requestId,sourceKey:manhuaVfxSourceKey(clip),composition:recipe,gcsUri:'gs://offline/candidate.mp4'}};
    const initial={version:1,scopeKey:'project:old-candidate',requests:{[requestId]:request},draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition:{version:1,seed:1,effects:[{...effect,scale:.2}]}}};
    globalThis.saved=[];globalThis.queued=0;window.confirm=()=>true;const noop=()=>{};const register=(_,__,control)=>globalThis.control=control;
    function App(){const[state,setState]=React.useState(initial);return <ManhuaVfxEditor scopeKey='project:old-candidate' state={state} clips={[clip]} jobs={[]} busy={false} onAdvisorEffectsControl={register} onStateChange={async next=>{globalThis.saved.push(next);setState(next);return next;}} onSubmit={async()=>{globalThis.queued++;return 'unexpected';}} onSourceChange={noop} onPreview={noop}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => Boolean((globalThis as any).control));
    const inspect = () => page.evaluate(async () => JSON.parse(await (globalThis as any).control({ action: "effects", tool: "vfx", operation: "inspect" }, new AbortController().signal)));
    let current = await inspect(); const candidate = current.requests[0];
    expect(candidate.canAdopt).toBe(false); expect(candidate.vfxRecipe.effects[0].scale).toBe(0.4);
    await page.evaluate(async ({ current, candidate }) => (globalThis as any).control({ action: "effects", tool: "vfx", operation: "configure", sourceKey: current.sourceKey, sourceIds: [candidate.sourceId], vfxRecipe: candidate.vfxRecipe }, new AbortController().signal), { current, candidate });
    await page.waitForFunction(() => (globalThis as any).saved.length === 1);
    await page.$eval("video", video => { for (const [key, value] of Object.entries({ duration: 5, videoWidth: 1280, videoHeight: 720 })) Object.defineProperty(video, key, { configurable: true, value }); video.dispatchEvent(new Event("loadedmetadata")); });
    current = await inspect(); expect(current.requests[0].canAdopt).toBe(true);
    const result = await page.evaluate(async ({ current, candidate }) => (globalThis as any).control({ action: "effects", tool: "vfx", operation: "adopt", sourceKey: current.sourceKey, requestId: candidate.requestId }, new AbortController().signal), { current, candidate });
    expect(JSON.parse(result).status).toBe("adopted");
    expect(await page.evaluate(() => (globalThis as any).saved.at(-1).adoptedRequestId)).toBe(candidate.requestId);
    current = await inspect(); const resumed = await page.evaluate(async ({ current, candidate }) => (globalThis as any).control({ action: "effects", tool: "vfx", operation: "resume", sourceKey: current.sourceKey, requestId: candidate.requestId }, new AbortController().signal), { current, candidate });
    expect(JSON.parse(resumed).status).toBe("succeeded"); expect(await page.evaluate(() => (globalThis as any).queued)).toBe(0); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
