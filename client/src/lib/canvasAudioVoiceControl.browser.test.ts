import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("语音沿真实音轨视图起草，原确认才提交，切段及保存失败不覆盖旧音频", async () => {
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
      import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
      import {emptyCanvasAudioStudio,createCanvasAudioCue} from './shared/canvasAudioStudio';
      import {sanitizeManhuaCloudDraftBlock} from './shared/manhuaCloudDraft';
      const f=globalThis.fixture={drafts:[],submissions:[],controls:{},persist:true,defer:false,settled:false};
      const old={...createCanvasAudioCue('bgm','old-cue'),takes:[{id:'old-take',gcsUri:'gs://test/old.wav',previewUrl:'https://test.invalid/old.wav',durationSec:5,createdAt:'today',inputKey:'old'}]};
      const job=id=>({jobId:id,titleZh:'旧原曲',status:id==='bgm-old'||f.settled?'succeeded':'queued',durationSec:20,variants:id==='bgm-old'||f.settled?[{index:0,gcsUri:'gs://test/old.wav',previewUrl:'https://test.invalid/old.wav'}]:[]});
      const services={generateDialogue:async()=>{throw Error('不应调用对白');},getDialogue:async()=>null,
        draftMusic:async input=>{f.drafts.push(input);if(f.defer)await new Promise(resolve=>f.release=resolve);return {brief:{model:input.model,custom_mode:true,instrumental:true,style:'古琴',prompt:'[Intro] [End]',title:'配乐',duration:input.durationSec,negative_tags:'vocals',style_weight:.7,weirdness_constraint:.2}};},
        generateMusic:async input=>{f.submissions.push({input,persisted:f.persisted});return job('bgm_'+input.billingRequestId.replaceAll('-',''));},
        getMusic:async({jobId})=>job(jobId),listMusic:async()=>[job('bgm-old')],queuePost:async()=>{throw Error('不应调用裁切');},getPost:async()=>null};
      const register=(id,control)=>{f.controls[id]=control;};
      function App(){
        const [rows,setRows]=useState([1,2].map(ep=>({...defaultCanvasBlock('video',0,0),id:'clip-e0'+ep+'-g01',episodeIndex:ep,videoModel:'seedance-2.5',prompt:'目标时长：20秒',audioStudio:{...emptyCanvasAudioStudio(),cues:[old],musicJobIds:['bgm-old'],musicDraft:{prompt:'保留古琴主题',durationSec:20,model:'suno-v6',brief:null}}})));
        const [index,setIndex]=useState(0);const [disabled,setDisabled]=useState(false);f.rows=rows;f.switch=setIndex;f.disable=setDisabled;
        return <CanvasAudioStudioView key={rows[index].id} block={rows[index]} compact={false} disabled={disabled} timelineDurationSec={20}
          sourceShots={[{index:1,durationSec:20,cameraZh:'平视',actionZh:index===0?'扶母撤退':'渡河追击',intentZh:'守护',emotionZh:'紧张',dialogueZh:'娘，抓紧我'}]}
          services={services} onVoiceControl={register} onChange={audioStudio=>{if(!f.persist)return false;const next=sanitizeManhuaCloudDraftBlock(JSON.parse(JSON.stringify({...rows[index],audioStudio})));f.persisted=next.audioStudio;setRows(previous=>previous.map((row,i)=>i===index?next:row));return true;}}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [{ name: "离线服务", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "offline", namespace: "offline" }));
      builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: "export const trpc={};", loader: "js" }));
    } }], define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const run = (operation: string, clipId = "clip-e01-g01", question?: string) => page.evaluate(async ({ operation, clipId, question }) => {
    const f = (globalThis as any).fixture;
    try { return await f.controls[clipId]({ action: "bgm", operation, clipId, ...(question ? { question } : {}) }); }
    catch (error) { return { error: String(error) }; }
  }, { operation, clipId, question });
  try {
    await page.setRequestInterception(true);
    page.on("request", request => request.isNavigationRequest() ? void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void request.abort());
    await page.goto("http://localhost:41829");
    await page.addScriptTag({ content: built.outputFiles[0]!.text });
    await page.waitForFunction(() => Boolean((globalThis as any).fixture?.controls["clip-e01-g01"]));
    const before = await page.evaluate(() => JSON.stringify((globalThis as any).fixture.rows[0].audioStudio.cues));
    expect(await run("inspect")).toMatchObject({ status: "inspected", musicJobIds: ["bgm-old"], jobs: [{ jobId: "bgm-old", variants: [{ index: 0, available: true }] }] });
    const prepared = await run("prepare", "clip-e01-g01", "结尾留白");
    expect(prepared.status).toBe("prepared");
    expect(prepared.draft.prompt).toContain("扶母撤退");
    expect(prepared.draft.prompt).toContain("保留古琴主题");
    expect(prepared.draft.prompt).toContain("本次用户补充：\n结尾留白");
    expect(await page.evaluate(() => (globalThis as any).fixture.drafts[0].moodArcZh)).toBe(prepared.draft.prompt);
    expect(await run("generate")).toMatchObject({ status: "awaiting_user_confirmation" });
    expect(await page.evaluate(() => (globalThis as any).fixture.submissions.length)).toBe(0);
    await page.waitForSelector('[role="dialog"][aria-label="确认音频费用"]');
    await page.evaluate(() => { const button = Array.from(document.querySelectorAll("button")).find(row => row.textContent?.trim() === "确认生成"); if (!button) throw Error("缺少原确认按钮"); button.click(); });
    await page.waitForFunction(() => (globalThis as any).fixture.submissions.length === 1);
    const submitted = await page.evaluate(() => (globalThis as any).fixture.submissions[0]);
    const jobId = `bgm_${submitted.input.billingRequestId.replaceAll("-", "")}`;
    expect(submitted.persisted.pendingOperations).toContainEqual({ id: jobId, kind: "bgm", inputKey: JSON.stringify(submitted.input.brief) });
    expect((await run("generate")).error).toContain("原配乐任务尚未结束");
    await page.evaluate(() => { const f = (globalThis as any).fixture; f.settled = true; });
    expect((await run("inspect")).jobs).toContainEqual({ jobId, titleZh: "旧原曲", status: "succeeded", variants: [{ index: 0, available: true }] });
    expect(await page.evaluate(() => JSON.stringify((globalThis as any).fixture.rows[0].audioStudio.cues))).toBe(before);
    await page.evaluate(() => { const f = (globalThis as any).fixture; f.oldControl = f.controls["clip-e01-g01"]; f.switch(1); });
    await page.waitForFunction(() => Boolean((globalThis as any).fixture.controls["clip-e02-g01"]));
    const stale = await page.evaluate(async () => { try { await (globalThis as any).fixture.oldControl({ action: "bgm", operation: "generate", clipId: "clip-e01-g01" }); } catch (error) { return String(error); } });
    expect(stale).toContain("目标片段已变化");
    await page.evaluate(() => { (globalThis as any).fixture.persist = false; });
    expect((await run("prepare", "clip-e02-g01", "用鼓点")).error).toContain("未能保存");
    expect(await page.evaluate(() => (globalThis as any).fixture.rows[1].audioStudio.musicDraft.brief)).toBeNull();
    await page.evaluate(() => { const f = (globalThis as any).fixture; f.persist = true; f.defer = true; f.controls["clip-e02-g01"]({ action: "bgm", operation: "prepare", clipId: "clip-e02-g01", question: "再留白" }).then(() => f.late = "错误落稿", error => f.late = String(error)); });
    await page.waitForFunction(() => Boolean((globalThis as any).fixture.release));
    await page.evaluate(() => (globalThis as any).fixture.switch(0));
    await page.waitForFunction(() => Boolean((globalThis as any).fixture.controls["clip-e01-g01"]));
    await page.evaluate(() => (globalThis as any).fixture.release());
    await page.waitForFunction(() => Boolean((globalThis as any).fixture.late));
    expect(await page.evaluate(() => (globalThis as any).fixture.late)).toContain("本次起草未覆盖");
    expect(await page.evaluate(() => (globalThis as any).fixture.rows[1].audioStudio.musicDraft.brief)).toBeNull();
    expect(await page.evaluate(() => (globalThis as any).fixture.submissions.length)).toBe(1);
  } finally { await browser.close(); }
}, 90_000);
