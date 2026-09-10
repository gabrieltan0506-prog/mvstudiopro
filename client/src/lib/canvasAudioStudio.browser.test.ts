import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
      import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
      import {emptyCanvasAudioStudio,createCanvasAudioCue,canvasAudioCueInputKey} from './shared/canvasAudioStudio';
      const f=globalThis.fixture={calls:[],queries:[],musicQueries:[],history:{},posts:[],postQueries:[],postResult:null,masterEntries:[],dropSettle:false,state:null,result:null};
      const services={
        generateDialogue:async input=>{f.calls.push(input);return {jobId:'test-job',status:'succeeded',result:{gcsUri:'gs://test-bucket/generated/test.mp3',audioUrl:'https://audio.test/test.mp3',bytes:12000,voiceGate:{durationSeconds:2.25}}};},
        getDialogue:async input=>{f.queries.push(input);return f.result;},
        draftMusic:async()=>({brief:{model:'suno-v5.5-beta',custom_mode:true,instrumental:true,style:'恢宏',prompt:'展翼时释放气势',title:'守护',duration:30,negative_tags:'',style_weight:0.5,weirdness_constraint:0.5}}),
        generateMusic:async input=>{f.calls.push(input);return {jobId:'bgm-test',status:'queued'};},
        getMusic:async input=>{f.musicQueries.push(input.jobId);return f.history[input.jobId]||{jobId:input.jobId,status:'running',variants:[],titleZh:'守护',durationSec:30};},
        listMusic:async()=>[],
        queuePost:async input=>{f.posts.push(input);return {jobId:'post-'+f.posts.length,status:'queued'};},
        getPost:async input=>{f.postQueries.push(input.jobId);return f.postResult;},
      };
      function App(){
        const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'audio-test',videoModel:'seedance-2.5',prompt:'目标时长：30秒。阿菁先护住受伤的墨屠。墨屠变身，展翼保护阿菁。',audioStudio:emptyCanvasAudioStudio()});
        const [visible,setVisible]=useState(true);
        const [withMasterCb,setWithMasterCb]=useState(false);
        f.state=block.audioStudio;f.block=block;f.configure=audioStudio=>setBlock(b=>({...b,audioStudio}));f.show=setVisible;f.short=()=>setBlock(b=>({...b,prompt:'目标时长：5秒'}));
        f.setMasterCb=setWithMasterCb;f.setMaster=entry=>setBlock(b=>({...b,manhuaSegmentRefs:{...(b.manhuaSegmentRefs||{}),master:entry}}));
        const onMasterTrackReady=withMasterCb?entry=>{f.masterEntries.push(entry);f.setMaster(entry);}:undefined;
        f.longCues=()=>{const cues=Array.from({length:6},(_,i)=>{const cue={...createCanvasAudioCue('dialogue','long-'+i),speakerZh:'角色',voice:'longanlufeng',textZh:'长台词'.repeat(1000),shotZh:'镜头',startSec:i*4,endSec:i*4+3,approved:true,selectedTakeId:'take-'+i};cue.takes=[{id:'take-'+i,gcsUri:'gs://test-bucket/post-prod/7/'+i+'.wav',previewUrl:'https://audio.test/'+i+'.wav',durationSec:2,createdAt:'2026-09-08',inputKey:canvasAudioCueInputKey(cue)}];return cue;});setBlock(b=>({...b,audioStudio:{...b.audioStudio,cues}}));};
        f.addBgm=()=>{const cue=createCanvasAudioCue('bgm','bgm-a');cue.shotZh='变身展翼';cue.startSec=13;cue.endSec=21;cue.source={gcsUri:'gs://test-bucket/generated/source.mp3',previewUrl:'https://audio.test/source.mp3',durationSec:27.77,labelZh:'27秒原曲'};cue.sourceStartSec=13;cue.sourceEndSec=21;setBlock(b=>({...b,audioStudio:{...b.audioStudio,cues:[...b.audioStudio.cues,cue]}}));};
        const onChange=audioStudio=>setBlock(b=>f.dropSettle&&audioStudio.pendingOperations.length<b.audioStudio.pendingOperations.length?b:({...b,audioStudio}));
        return visible&&<CanvasAudioStudioView block={block} services={services} onChange={onChange} onMasterTrackReady={onMasterTrackReady}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    plugins: [
      {
        name: "离线请求边界",
        setup(builder) {
          builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "offline-trpc",
            namespace: "offline",
          }));
          builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            contents: "export const trpc = {};",
            loader: "js",
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

async function open() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.isNavigationRequest())
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>',
      });
    else void request.abort();
  });
  await page.goto("http://localhost:41811");
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('section[aria-label="逐句配音与分段配乐"]');
  const click = async (text: string) =>
    page.evaluate(t => {
      const el = Array.from(document.querySelectorAll("button")).find(el =>
        el.textContent?.includes(t)
      );
      if (!el) throw Error("找不到按钮 " + t);
      el.click();
    }, text);
  const fill = async (label: string, value: string) => {
    const selector = `[aria-label="${label}"]`;
    await page.click(selector, { clickCount: 3 });
    await page.type(selector, value);
  };
  return { context, page, click, fill };
}
describe("逐句配音与分段配乐真实视图（仅虚构服务）", () => {
  it("旧配乐不在最近页仍按持久任务取回并选择", async () => {
    const { context, page, click } = await open();
    try {
      await click("添加一段配乐");
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.history.old = { jobId: "old", status: "succeeded", titleZh: "早期守护原曲", durationSec: 27, variants: [{ index: 0, gcsUri: "gs://test-bucket/post-prod/7/old.wav", previewUrl: "https://audio.test/old.wav" }] };
        f.configure({ ...f.state, musicJobIds: ["old"] });
      });
      await click("刷新配乐素材");
      await page.waitForSelector('audio[aria-label="早期守护原曲 版本 1"]');
      await page.evaluate(() => {
        const el = document.querySelector('audio[aria-label="早期守护原曲 版本 1"]')!;
        Object.defineProperty(el, "duration", { value: 27 });
        el.dispatchEvent(new Event("loadedmetadata", { bubbles: true }));
      });
      await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.includes("选这条原曲") && !b.disabled));
      await click("选这条原曲");
      await page.waitForFunction(() => (window as any).fixture.state.cues[0].source?.gcsUri.endsWith("old.wav"));
      expect(await page.evaluate(() => (window as any).fixture.musicQueries)).toContain("old");
    } finally { await context.close(); }
  }, 20_000);
  it("多条合法长台词合听使用短签名，真实回写状态不超字段容量", async () => {
    const { context, page, click } = await open();
    try {
      await page.evaluate(() => (window as any).fixture.longCues());
      await page.waitForFunction(() => (window as any).fixture.state.cues.length === 6);
      await click("合听已确认秒窗");
      await page.waitForFunction(() => (window as any).fixture.posts.length === 1 && (window as any).fixture.state.pendingOperations.length === 1);
      const result = await page.evaluate(() => ({ key: (window as any).fixture.state.pendingOperations[0].inputKey, clips: (window as any).fixture.posts[0].params.clips.length }));
      expect(result.key).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.clips).toBe(6);
    } finally { await context.close(); }
  }, 20_000);
  it("字段越界保留原值，满一百条不截旧草稿也不新增", async () => {
    const { context, page, click, fill } = await open();
    try {
      await page.evaluate(() => (window as any).fixture.addBgm());
      await page.waitForSelector('[data-cue-id="bgm-a"]');
      await fill("1 音量", "2");
      expect(
        await page.evaluate(() => (window as any).fixture.state.cues[0].volume)
      ).toBe(1);
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.configure({
          ...f.state,
          cues: Array.from({ length: 100 }, (_, index) => ({
            ...f.state.cues[0],
            id: "cue-" + index,
          })),
        });
      });
      await page.waitForFunction(
        () => document.querySelectorAll("[data-cue-id]").length === 100
      );
      await click("添加一句对白");
      expect(
        await page.evaluate(() => (window as any).fixture.state.cues.length)
      ).toBe(100);
      expect(
        await page.$eval('[role="alert"]', el => el.textContent)
      ).toContain("100");
      expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual(
        []
      );
    } finally {
      await context.close();
    }
  }, 20_000);
  it("未知语气控制在报价确认前拒绝，阶段标签不冒充实际声线", async () => {
    const { context, page, click, fill } = await open();
    try {
      await click("添加一句对白");
      await fill("1 镜头与动作", "墨屠护翼");
      await fill("1 说话角色", "墨屠");
      await fill("1 本句台词", "别怕。");
      await fill("1 语气标签", "[unknown_magic_voice]");
      await click("生成本句");
      await page.waitForSelector('[role="alert"]');
      expect(await page.$('[role="dialog"]')).toBeNull();
      expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual(
        []
      );
      expect(
        await page.$eval(
          'section[aria-label="逐句配音与分段配乐"]',
          el => el.textContent
        )
      ).toContain("阶段标签用于区分候选；实际声音由音色和语气决定");
    } finally {
      await context.close();
    }
  }, 20_000);
  it("保存结算恢复须再次确认，并使用原输入原编号而非重购", async () => {
    const { context, page, click } = await open();
    try {
      await click("添加一句对白");
      await page.evaluate(() => {
        const f = (window as any).fixture;
        const id = "11111111-1111-4111-8111-111111111111";
        f.result = {
          jobId: "original-job",
          status: "running",
          canResumeSettlement: true,
          billingRequestId: id,
          input: "原台词",
          voice: "longanlufeng",
          speakerZh: "墨屠",
          voiceStateZh: "原声音状态",
        };
        f.configure({
          ...f.state,
          pendingOperations: [
            {
              id,
              kind: "dialogue",
              cueId: f.state.cues[0].id,
              inputKey: "original-key",
            },
          ],
        });
        f.show(false);
      });
      await page.waitForFunction(() => !document.querySelector("section"));
      await page.evaluate(() => (window as any).fixture.show(true));
      await page.waitForFunction(() =>
        document.body.textContent?.includes("恢复保存与结算")
      );
      expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual(
        []
      );
      await click("恢复保存与结算");
      expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual(
        []
      );
      await click("确认恢复原单");
      await page.waitForFunction(
        () => (window as any).fixture.calls.length === 1
      );
      expect(
        await page.evaluate(() => (window as any).fixture.calls[0])
      ).toEqual({
        billingRequestId: "11111111-1111-4111-8111-111111111111",
        input: "原台词",
        voice: "longanlufeng",
        speakerZh: "墨屠",
        voiceStateZh: "原声音状态",
      });
      await page.waitForFunction(
        () => (window as any).fixture.state.pendingOperations.length === 0
      );
      expect(
        await page.evaluate(
          () => (window as any).fixture.state.cues[0].takes.length
        )
      ).toBe(1);
    } finally {
      await context.close();
    }
  }, 20_000);
  it("先显示剧本；单句页面确认才调用，变身声音状态随请求且不自动采用", async () => {
    const { context, page, click, fill } = await open();
    try {
      expect(await page.$eval("pre", el => el.textContent)).toContain(
        "墨屠变身"
      );
      await click("添加一句对白");
      await fill("1 镜头与动作", "墨屠低头护住阿菁");
      await fill("1 说话角色", "墨屠");
      await fill("1 声音状态", "变身后沉稳有威势");
      await fill("1 本句台词", "别怕，站我身后。");
      await click("生成本句");
      expect(
        await page.evaluate(() => (window as any).fixture.calls.length)
      ).toBe(0);
      await page.waitForSelector('[role="dialog"]');
      await click("确认生成");
      await page.waitForFunction(
        () => (window as any).fixture.state.cues[0].takes.length === 1
      );
      const result = await page.evaluate(() => ({
        calls: (window as any).fixture.calls,
        cue: (window as any).fixture.state.cues[0],
      }));
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].voiceStateZh).toBe("变身后沉稳有威势");
      expect(result.calls[0].input).toBe("别怕，站我身后。");
      expect(result.cue.approved).toBe(false);
      expect(result.cue.selectedTakeId).toBeUndefined();
      expect(result.cue.takes[0].durationSec).toBe(2.25);
      await click("试听后确认本段");
      await page.waitForFunction(
        () => (window as any).fixture.state.cues[0].approved
      );
      await click("合听已确认秒窗");
      await page.waitForFunction(
        () => (window as any).fixture.posts.length === 1
      );
      expect(
        await page.evaluate(() => (window as any).fixture.posts[0])
      ).toEqual({
        action: "audio_timeline",
        params: {
          durationSec: 30,
          clips: [
            {
              audioUri: "gs://test-bucket/generated/test.mp3",
              sourceStartSec: 0,
              sourceEndSec: 2.25,
              startSec: 1.5,
              volume: 1,
              fadeInSec: 0,
              fadeOutSec: 0,
            },
          ],
        },
      });
      await fill("1 声音状态", "变身后温柔但有力量");
      const changed = await page.evaluate(
        () => (window as any).fixture.state.cues[0]
      );
      expect(changed.approved).toBe(false);
      expect(changed.takes).toHaveLength(1);
      await page.click('input[type="checkbox"]');
      await page.waitForFunction(
        () => (window as any).fixture.state.cues[0].enabled === false
      );
      expect(
        await page.evaluate(
          () => (window as any).fixture.state.cues[0].takes.length
        )
      ).toBe(1);
      expect(await page.$eval("audio", el => el.getAttribute("src"))).toBe(
        "https://audio.test/test.mp3"
      );
    } finally {
      await context.close();
    }
  }, 20_000);
  it("短段越界在免费裁切前拒绝，不套用三十秒默认窗", async () => {
    const { context, page, click } = await open();
    try {
      await page.evaluate(() => {
        (window as any).fixture.addBgm();
        (window as any).fixture.short();
      });
      await page.waitForSelector('[data-cue-id="bgm-a"]');
      await click("只裁这一段");
      await page.waitForSelector('[role="alert"]');
      expect(
        await page.$eval('[role="alert"]', el => el.textContent)
      ).toContain("本段 5 秒");
      expect(await page.evaluate(() => (window as any).fixture.posts)).toEqual(
        []
      );
    } finally {
      await context.close();
    }
  }, 20_000);
  it("裁切只发送当前这一段，原曲和其他段均保留", async () => {
    const { context, page, click } = await open();
    try {
      await page.evaluate(() => (window as any).fixture.addBgm());
      await page.waitForSelector('[data-cue-id="bgm-a"]');
      await click("添加一句对白");
      await click("只裁这一段");
      await page.waitForFunction(
        () => (window as any).fixture.posts.length === 1
      );
      const result = await page.evaluate(() => ({
        posts: (window as any).fixture.posts,
        state: (window as any).fixture.state,
      }));
      expect(result.posts).toEqual([
        {
          action: "audio_trim",
          params: {
            audioUri: "gs://test-bucket/generated/source.mp3",
            sourceStartSec: 13,
            sourceEndSec: 21,
            volume: 1,
            fadeInSec: 0,
            fadeOutSec: 0,
          },
        },
      ]);
      expect(result.state.cues).toHaveLength(2);
      expect(result.state.cues[0].source.durationSec).toBe(27.77);
      expect(result.state.cues[0].takes).toEqual([]);
      expect(result.state.pendingOperations[0].cueId).toBe("bgm-a");
    } finally {
      await context.close();
    }
  }, 20_000);
  it("恢复只查询原配音编号，不重新提交；未知状态不清原任务", async () => {
    const { context, page } = await open();
    try {
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.configure({
          ...f.state,
          pendingOperations: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              kind: "dialogue",
              cueId: "missing",
              inputKey: "old",
            },
          ],
        });
        f.show(false);
      });
      await page.waitForFunction(() => !document.querySelector("section"));
      await page.evaluate(() => (window as any).fixture.show(true));
      await page.waitForFunction(
        () => (window as any).fixture.queries.length === 1
      );
      const result = await page.evaluate(() => ({
        queries: (window as any).fixture.queries,
        calls: (window as any).fixture.calls,
        state: (window as any).fixture.state,
      }));
      expect(result.calls).toEqual([]);
      expect(result.queries).toEqual([
        { jobId: "11111111-1111-4111-8111-111111111111" },
      ]);
      expect(result.state.pendingOperations).toHaveLength(1);
    } finally {
      await context.close();
    }
  }, 20_000);

  const PREMIX_PENDING = {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "post_prod",
    inputKey: "premix:sha256:abc",
  };
  const PREMIX_RESULT = {
    jobId: "22222222-2222-4222-8222-222222222222",
    status: "succeeded",
    output: { gcsUri: "gs://test-bucket/post-prod/7/premix.wav", url: "https://audio.test/premix.wav", durationSec: 12.5 },
  };

  it("预混母轨回来：有回调则挂 master 一次并 settle；无回调保留 pending 不 settle", async () => {
    const { context, page } = await open();
    try {
      // 无回调（自由画布同一节点）：pending 留着，master 不挂
      await page.evaluate((pending, result) => {
        const f = (window as any).fixture;
        f.postResult = result;
        f.configure({ ...f.state, pendingOperations: [pending] });
        f.show(false);
      }, PREMIX_PENDING, PREMIX_RESULT);
      await page.waitForFunction(() => !document.querySelector("section"));
      await page.evaluate(() => (window as any).fixture.show(true));
      await page.waitForFunction(() => (window as any).fixture.postQueries.length >= 1);
      let snap = await page.evaluate(() => ({
        pending: (window as any).fixture.state.pendingOperations.length,
        masters: (window as any).fixture.masterEntries.length,
      }));
      expect(snap).toEqual({ pending: 1, masters: 0 });

      // 回到工厂（带回调）：挂一次、settle 掉
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.setMasterCb(true);
        f.show(false);
      });
      await page.waitForFunction(() => !document.querySelector("section"));
      await page.evaluate(() => (window as any).fixture.show(true));
      await page.waitForFunction(() => (window as any).fixture.state.pendingOperations.length === 0);
      snap = await page.evaluate(() => ({
        pending: (window as any).fixture.state.pendingOperations.length,
        masters: (window as any).fixture.masterEntries.length,
        gcsUri: (window as any).fixture.block.manhuaSegmentRefs?.master?.gcsUri,
        durationSec: (window as any).fixture.block.manhuaSegmentRefs?.master?.durationSec,
      }));
      expect(snap).toEqual({ pending: 0, masters: 1, gcsUri: "gs://test-bucket/post-prod/7/premix.wav", durationSec: 12.5 });
    } finally {
      await context.close();
    }
  }, 20_000);

  it("真实触发路径：出片中 settle 被丢弃、pending 留着，下一轮轮询读到最新 master 不再重复挂", async () => {
    const { context, page } = await open();
    try {
      await page.evaluate((pending, result) => {
        const f = (window as any).fixture;
        f.postResult = result;
        f.dropSettle = true; // 模拟 OmniCanvas 对 running 段丢掉 audioStudio 更新
        f.setMasterCb(true);
        f.configure({ ...f.state, pendingOperations: [pending] });
        f.show(false);
      }, PREMIX_PENDING, PREMIX_RESULT);
      await page.waitForFunction(() => !document.querySelector("section"));
      await page.evaluate(() => (window as any).fixture.show(true));
      // 等两轮以上轮询（间隔 5 s）
      await page.waitForFunction(() => (window as any).fixture.masterEntries.length >= 1, { timeout: 10_000 });
      await new Promise((r) => setTimeout(r, 11_000));
      const snap = await page.evaluate(() => ({
        queries: (window as any).fixture.postQueries.length,
        masters: (window as any).fixture.masterEntries.length,
        pending: (window as any).fixture.state.pendingOperations.length,
        gcsUri: (window as any).fixture.block.manhuaSegmentRefs?.master?.gcsUri,
      }));
      expect(snap.queries, JSON.stringify(snap)).toBeGreaterThanOrEqual(2);
      expect(snap.masters).toBe(1);
      expect(snap.pending).toBe(1);
      expect(snap.gcsUri).toBe("gs://test-bucket/post-prod/7/premix.wav");
    } finally {
      await context.close();
    }
  }, 45_000);

  it("母轨已是同一份产物时再次命中不重复挂、不重复提示，只 settle", async () => {
    const { context, page } = await open();
    try {
      await page.evaluate((pending, result) => {
        const f = (window as any).fixture;
        f.postResult = result;
        f.setMasterCb(true);
        f.setMaster({ url: result.output.url, gcsUri: result.output.gcsUri, fileName: "x.wav", durationSec: 12.5, updatedAt: "2026-09-10" });
        f.configure({ ...f.state, pendingOperations: [pending] });
        f.show(false);
      }, PREMIX_PENDING, PREMIX_RESULT);
      await page.waitForFunction(() => !document.querySelector("section"));
      await page.evaluate(() => (window as any).fixture.show(true));
      await page.waitForFunction(() => (window as any).fixture.state.pendingOperations.length === 0);
      const snap = await page.evaluate(() => ({ masters: (window as any).fixture.masterEntries.length }));
      expect(snap).toEqual({ masters: 0 });
    } finally {
      await context.close();
    }
  }, 20_000);
});
