import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

/** 离线夹具：直接挂 MontagePlanner，trpc 全部打桩、请求一律 200 空响应，不触发任何付费调用。 */
it("调色与转场：选预设+转场→采用→onSubmit 带 grade/transition；顾问 edit 只写草稿不提交", async () => {
  const cut = (startSec: number, endSec: number) => ({ startSec, endSec, reason: "保留回答", evidence: "回答之后停顿" });
  const plan = {
    sourceDurationSec: 10,
    summary: "先问后答",
    sourceSrt: "1\n00:00:02,100 --> 00:00:04,500\n完整口播正文\n",
    uncertainties: [],
    plans: [
      // 第一版两段均避开对白 → 允许转场；第二版带对白 → 只能直接切换
      { title: "预告", kind: "trailer", rationale: "保留悬念", cuts: [cut(0, 1.5), cut(6, 8)] },
      { title: "短版", kind: "short", rationale: "保留因果", cuts: [cut(2, 5), cut(6, 8)] },
    ],
    creativeDirections: ["听者", "回访"].map(title => ({ title, evidence: "原片回答", difference: "改变叙述角度" })),
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MontagePlanner} from './client/src/components/canvas/MontagePlanner';
    import {manhuaVfxMediaIdentity} from './client/src/lib/manhuaVfxWorkflow';
    const url='gs://test-only/source.mp4';
    globalThis.calls=[];globalThis.submits=[];globalThis.control=null;
    const map=new Map();globalThis.saved=map;
    const store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),clear:()=>map.clear(),key:i=>[...map.keys()][i],get length(){return map.size;}};
    map.set('montage-test',JSON.stringify({sourceId:'source',sourceIdentity:manhuaVfxMediaIdentity(url),analysisSourceUri:url,target:30,aspect:'9:16',answer:${JSON.stringify(JSON.stringify(plan))}}));
    window.confirm=()=>true;
    function App(){const[v,setV]=React.useState(0);globalThis.remount=()=>setV(v=>v+1);return <MontagePlanner key={v} clips={[{id:'source',url,label:'口播原片'}]} story='完整口播正文' storage={store} storageKey='montage-test' busy={false}
      context={{projectId:'one',episodeBody:'完整口播正文',shotSummary:''}}
      onAdvisorEditControl={c=>{globalThis.control=c;}}
      concatResults={[{jobId:'job-9',title:'预告',output:{gcsUri:'gs://test-only/out.mp4',gradeSegmentCheck:{mode:'junctions',spans:[],
        check:{pass:false,junctions:[{index:0,junctionSec:1.2,pass:true,delta:{YAVG:1.5,UAVG:-0.4,VAVG:0.2,SATAVG:2.1}},{index:1,junctionSec:2.3,pass:false,delta:{YAVG:9,UAVG:0,VAVG:0,SATAVG:0}}]},
        autoMatch:{adjusted:[2],spans:[],check:{pass:false,junctions:[{index:0,junctionSec:1.2,pass:true,delta:{YAVG:1.5,UAVG:-0.4,VAVG:0.2,SATAVG:2.1}},{index:1,junctionSec:2.3,pass:false,delta:{YAVG:6.2,UAVG:0,VAVG:0.1,SATAVG:-1}}]}}}}}]}
      onSubmit={async(params,title)=>{globalThis.submits.push({params,title});return {jobId:'job-1'};}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [
      {
        name: "offline",
        setup(b) {
          b.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({ path: "trpc", namespace: "offline" }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: `
      const query={data:undefined,isLoading:false,isFetching:false,error:null};
      const mutation={isPending:false,mutate:()=>{},mutateAsync:async input=>{
        if(input&&input.videoGsUri){(globalThis.adviceCalls??=[]).push(input);return {advice:{arcZh:'先冷后亮',grades:[],seams:[]},segments:[{startSec:0,endSec:2.3,lutId:'basic_cool'}],usedBy:{channel:'x',model:'x',failuresZh:[]}};}
        globalThis.calls.push(input);throw new Error('离线夹具不应调用顾问');}};
      const utils=new Proxy({}, {get:()=>new Proxy({}, {get:()=>({invalidate:async()=>{},fetch:async()=>null})})});
      const leaf=new Proxy({}, {get:(_,key)=>key==='useQuery'?()=>query:key==='useMutation'?()=>mutation:()=>{}});
      export const trpc=new Proxy({}, {get:(_,key)=>key==='useUtils'?()=>utils:new Proxy({}, {get:()=>leaf})});
    `,
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r => r.respond({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('[aria-label="调色预设"]');
    const drafts = () => page.evaluate(() => JSON.parse((globalThis as any).saved.get("montage-test")).finishes ?? {});
    const draft = async (key = "1:预告") => (await drafts())[key];
    const setNum = (label: string, v: number) =>
      page.$eval(`[aria-label="${label}"]`, (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, v);
    const clickNth = (text: string, nth: number) =>
      page.$$eval(
        '[aria-label="剪辑方案工坊"] button',
        (nodes, text, nth) => {
          const n = nodes.filter(n => n.textContent?.trim() === text)[nth] as HTMLButtonElement;
          if (!n || n.disabled) throw new Error("按钮不可用：" + text);
          n.click();
        },
        text,
        nth
      );

    // 默认：不选调色/转场直接采用 → 参数与改前一致，无 grade/transition
    await clickNth("采用并生成此版", 0);
    await page.waitForFunction(() => (globalThis as any).submits.length === 1);
    const plain = await page.evaluate(() => (globalThis as any).submits[0].params);
    expect(Object.keys(plain).sort()).toEqual(["clips", "fps", "height", "trims", "width"]);

    // 选预设 + 转场 → 草稿写入，未提交
    await page.select('[aria-label="调色预设"]', "neo_noir_subtle");
    await page.select('[aria-label="镜头转场"]', "dissolve");
    await page.waitForFunction(() => (globalThis as any).saved.get("montage-test").includes("dissolve"));
    expect(await draft()).toEqual({ grade: { all: { lutId: "neo_noir_subtle" } }, transition: { kind: "dissolve", durationSec: 0.5 } });
    expect(await page.evaluate(() => (globalThis as any).submits.length)).toBe(1);

    // 刷新恢复后采用第一版 → grade + transition 随合成提交
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForFunction(() => (document.querySelector('[aria-label="调色预设"]') as HTMLSelectElement)?.value === "neo_noir_subtle");
    await clickNth("采用并生成此版", 0);
    await page.waitForFunction(() => (globalThis as any).submits.length === 2);
    const first = await page.evaluate(() => (globalThis as any).submits[1]);
    expect(first.title).toBe("预告");
    expect(first.params).toMatchObject({
      clips: ["gs://test-only/source.mp4", "gs://test-only/source.mp4"],
      trims: [{ startSec: 0, endSec: 1.5 }, { startSec: 6, endSec: 8 }],
      grade: { all: { lutId: "neo_noir_subtle" } },
      transition: { kind: "dissolve", durationSec: 0.5 },
    });
    expect(first.params.subtitleSrt).toBeUndefined();

    // 第二版：草稿按方案各存一份，第一版的调色/转场不串到第二版
    await clickNth("采用并生成此版", 1);
    await page.waitForFunction(() => (globalThis as any).submits.length === 3);
    const second = await page.evaluate(() => (globalThis as any).submits[2].params);
    expect(second.subtitleSrt).toBeTruthy();
    expect(second.grade).toBeUndefined();
    expect(second.transition).toBeUndefined();
    // 切到第二版设置：带对白只能直接切换，单独设调色只进第二版草稿
    await page.select('[aria-label="调色转场所属方案"]', "1");
    await page.waitForFunction(() => (document.querySelector('[aria-label="镜头转场"]') as HTMLSelectElement)?.disabled);
    expect(await page.$eval('[aria-label="调色与转场"]', n => n.textContent)).toContain("只能直接切换");
    await page.select('[aria-label="调色预设"]', "basic_cool");
    await page.waitForFunction(() => (globalThis as any).saved.get("montage-test").includes("basic_cool"));
    expect(await drafts()).toEqual({
      "1:预告": { grade: { all: { lutId: "neo_noir_subtle" } }, transition: { kind: "dissolve", durationSec: 0.5 } },
      "2:短版": { grade: { all: { lutId: "basic_cool" } } },
    });
    await clickNth("采用并生成此版", 1);
    await page.waitForFunction(() => (globalThis as any).submits.length === 4);
    expect(await page.evaluate(() => (globalThis as any).submits[3].params.grade)).toEqual({ all: { lutId: "basic_cool" } });

    // 顾问 edit 控件：调色/转场只写草稿，不提交合成
    await page.waitForFunction(() => typeof (globalThis as any).control === "function");
    // 顾问自拟调色（无 user_explicit 与用户原话）→ 拒绝，草稿不变
    const invented = await page.evaluate(() =>
      (globalThis as any)
        .control({ action: "edit", episode: 1, operation: "grade", grade: { all: { lutId: "basic_cool" } } }, new AbortController().signal)
        .then(() => "ok", (e: Error) => e.message)
    );
    expect(invented).toBe("调色方案请用『AI 调色建议』生成");
    expect((await draft()).grade.all.lutId).toBe("neo_noir_subtle");
    const gradeResult = await page.evaluate(() =>
      (globalThis as any).control(
        { action: "edit", episode: 1, operation: "grade", source: "user_explicit", userQuoteZh: "按用户原话", grade: { all: { lutId: "golden_hour_standard", saturation: 0.7 } } },
        new AbortController().signal
      )
    );
    expect(JSON.parse(gradeResult)).toMatchObject({ status: "saved", operation: "grade" });
    const transResult = await page.evaluate(() =>
      (globalThis as any).control(
        { action: "edit", episode: 1, operation: "transition", transitionSettings: { kind: "wipeleft", durationSec: 1.2 } },
        new AbortController().signal
      )
    );
    expect(JSON.parse(transResult)).toMatchObject({ status: "saved", operation: "transition" });
    expect(await draft()).toEqual({
      grade: { all: { lutId: "golden_hour_standard", saturation: 0.7 } },
      transition: { kind: "wipeleft", durationSec: 1.2 },
    });
    expect((await draft("2:短版")).grade.all.lutId).toBe("basic_cool");
    await page.select('[aria-label="调色转场所属方案"]', "0");
    await page.waitForFunction(() => (document.querySelector('[aria-label="调色预设"]') as HTMLSelectElement)?.value === "golden_hour_standard");
    // 逐段调色项数与本方案切点数（2）不符 → 写入即拒绝，草稿不变
    const mismatch = await page.evaluate(() =>
      (globalThis as any)
        .control({ action: "edit", episode: 1, operation: "grade", source: "user_explicit", userQuoteZh: "按用户原话", grade: { clips: [{ saturation: 0.8 }, null, null] } }, new AbortController().signal)
        .then(() => "ok", (e: Error) => e.message)
    );
    expect(mismatch).toContain("逐段调色有3项，本方案有2个切点");
    expect((await draft()).grade).toEqual({ all: { lutId: "golden_hour_standard", saturation: 0.7 } });
    // 带对白的第二版不接受顾问转场
    const blocked = await page.evaluate(() =>
      (globalThis as any)
        .control({ action: "edit", episode: 2, operation: "transition", transition: "fade" }, new AbortController().signal)
        .then(() => "ok", (e: Error) => e.message)
    );
    expect(blocked).toContain("未改动");
    // 白名单外预设被拒，草稿不变
    const bad = await page.evaluate(() =>
      (globalThis as any)
        .control({ action: "edit", episode: 1, operation: "grade", source: "user_explicit", userQuoteZh: "按用户原话", grade: { all: { lutId: "made_up" } } }, new AbortController().signal)
        .then(() => "ok", (e: Error) => e.message)
    );
    expect(bad).toContain("调色预设不存在");
    expect((await draft()).grade.all.lutId).toBe("golden_hour_standard");

    // 分段调色：第一版成片 3.5−1.2(左划重叠)=2.3 秒；添加分段 → 0–1.2 / 1.2–2.3
    await page.click('[aria-label="添加调色分段"]');
    await page.waitForSelector('[aria-label="第2段调色预设"]');
    expect((await draft()).grade.segments).toEqual([{ startSec: 0, endSec: 1.2 }, { startSec: 1.2, endSec: 2.3 }]);
    await page.select('[aria-label="第2段调色预设"]', "basic_cool");
    await setNum("段间过渡秒数", 0.3);
    await setNum("第1段饱和度", 0.8);
    await page.click('[aria-label="自动修正接点"]');
    await page.waitForFunction(() => (globalThis as any).saved.get("montage-test").includes("autoMatchJunctions"));
    // 末段不到片尾 → 提示且采用被拦，不提交
    await setNum("第2段结束秒", 2);
    await page.waitForSelector('[aria-label="分段校验"]');
    expect(await page.$eval('[aria-label="分段校验"]', n => n.textContent)).toContain("末段须到成片结尾2.3秒");
    await clickNth("采用并生成此版", 0);
    await page.waitForSelector('[role="alert"]');
    expect(await page.evaluate(() => (globalThis as any).submits.length)).toBe(4);
    await setNum("第2段结束秒", 2.3);
    await page.waitForFunction(() => !document.querySelector('[aria-label="分段校验"]'));
    await clickNth("采用并生成此版", 0);
    await page.waitForFunction(() => (globalThis as any).submits.length === 5);
    const seg = await page.evaluate(() => (globalThis as any).submits[4].params);
    expect(seg.grade).toEqual({
      all: { lutId: "golden_hour_standard", saturation: 0.7 },
      segments: [
        { startSec: 0, endSec: 1.2, saturation: 0.8 },
        { startSec: 1.2, endSec: 2.3, lutId: "basic_cool" },
      ],
      crossfadeSec: 0.3,
      autoMatchJunctions: true,
    });
    expect(seg.transition).toEqual({ kind: "wipeleft", durationSec: 1.2 });
    // 删除一段 → 剩一段即回到全片调色
    await page.click('[aria-label="删除第2段"]');
    await page.waitForFunction(() => !document.querySelector('[aria-label="第1段调色预设"]'));
    expect((await draft()).grade.segments).toBeUndefined();

    // 顾问写入分段：同一套校验（不覆盖片长被拒、草稿不变）
    const segBad = await page.evaluate(() =>
      (globalThis as any)
        .control({ action: "edit", episode: 1, operation: "grade", source: "user_explicit", userQuoteZh: "按用户原话", grade: { segments: [{ startSec: 0, endSec: 1 }] } }, new AbortController().signal)
        .then(() => "ok", (e: Error) => e.message)
    );
    expect(segBad).toContain("末段须到成片结尾2.3秒");
    const segOk = await page.evaluate(() =>
      (globalThis as any).control(
        { action: "edit", episode: 1, operation: "grade", source: "user_explicit", userQuoteZh: "按用户原话", grade: { segments: [{ startSec: 0, endSec: 1 }, { startSec: 1, endSec: 2.3, lutId: "basic_warm" }], crossfadeSec: 0.5 } },
        new AbortController().signal
      )
    );
    expect(JSON.parse(segOk)).toMatchObject({ status: "saved", operation: "grade" });
    await page.waitForSelector('[aria-label="第2段调色预设"]');
    expect(await page.$eval('[aria-label="第2段调色预设"]', n => (n as HTMLSelectElement).value)).toBe("basic_warm");

    // 接点检查结果渲染；调色建议入口文案中性
    const check = await page.$eval('[aria-label="接点检查结果"]', n => n.textContent);
    expect(check).toContain("有接点未达标");
    expect(await page.$eval('[aria-label="接点1"]', n => n.textContent)).toMatch(/1\.2秒.*亮度差1\.5.*饱和差2\.1.*达标/);
    expect(await page.$eval('[aria-label="接点2"]', n => n.textContent)).toMatch(/2\.3秒.*亮度差6\.2.*未达标 · 已自动修正/);
    const adviceText = await page.$eval('[data-testid="montage-grade-advice"]', n => n.textContent);
    expect(adviceText).toContain("AI 调色建议");
    expect(adviceText).not.toMatch(/Gemini|Flash/);

    // 顾问 gradeAdvice：走「AI 调色建议」同一调用（用户要求拼进 storyZh），只回建议，不写草稿、不合成
    const before = await draft();
    const advised = JSON.parse(
      await page.evaluate(() =>
        (globalThis as any).control({ action: "edit", episode: 1, operation: "gradeAdvice", userRequestZh: "雨景偏冷一点、结尾更亮" }, new AbortController().signal)
      )
    );
    expect(advised).toMatchObject({ status: "advised", operation: "gradeAdvice", arcZh: "先冷后亮", segmentCount: 1 });
    const adviceCalls = await page.evaluate(() => (globalThis as any).adviceCalls);
    expect(adviceCalls).toHaveLength(1);
    expect(adviceCalls[0]).toMatchObject({ videoGsUri: "gs://test-only/out.mp4" });
    expect(adviceCalls[0].storyZh).toMatch(/^用户调色要求：雨景偏冷一点、结尾更亮\n完整口播正文/);
    expect(await draft()).toEqual(before);

    expect(await page.evaluate(() => (globalThis as any).submits.length)).toBe(5);
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
