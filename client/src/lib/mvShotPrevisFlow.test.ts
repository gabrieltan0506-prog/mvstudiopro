/**
 * 1110 ⑤ MV 多人互动镜头 → 白模动作参考 整链（全离线替身，零付费调用）。
 * - 自动发起去重：镜头 id + 节拍哈希（同内容只发一次，节拍改了才重发）
 * - 打开失败不记「已发起」：重新挂载/刷新/内容变化再自动发起；同一内容自动最多 3 次，满 3 次软提示说明原因
 * - 采用白模后：提交参数里有 previs 视频参考，提示词含白模指令
 * - 无白模：软提示出现但照常提交（不拦、不改费用）
 * - 角色表不足：仍被 R3 硬拦（未提交、未扣费）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build, transform } from "esbuild";
import puppeteer from "puppeteer";
import { createMusicMvShotBlocks } from "./canvasMusicMvWorkflow";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { runCanvasBlock, type CanvasRunDeps } from "./canvasRunBlock";
import { mvShotPrevisBridgeUnavailableZh } from "./mvShotPrevisAccess";
import type { CanvasMusicMvPlan, MusicMvShotBeat } from "@shared/canvasMusicMv";
import { MV_SHOT_CAST_CONFLICT_ERROR_ZH } from "@shared/canvasMusicMvShotGuards";
import {
  MV_PREVIS_SOFT_HINT_ZH,
  buildMvShotPrevisStudio,
  MV_PREVIS_PROMPT_RULE_ZH,
  mvPrevisAdvisorQuestion,
  mvShotNeedsPrevis,
  mvShotPrevisContentKey,
  nextMvShotAutoPrevis,
  type MvPrevisShot,
} from "@shared/canvasMusicMvPrevis";

const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { warning: toastWarning } }));
vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: vi.fn(async () => ({ frames: [] })),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const sf = (n: number) => `sf_${n.toString(16).padStart(48, "0")}`;
const musicUrl = "https://test.invalid/song.mp3";
const PLAN_ID = "00000000-0000-4000-8000-000000000001";
const PREVIS_ID = "00000000-0000-4000-8000-0000000000aa";
const CAST = ["阿宁：短发白衬衫", "阿哲：黑夹克"];
const BEATS: MusicMvShotBeat[] = [
  { startSec: 0, endSec: 2.6, actionZh: "阿宁冲上前扇了他一记耳光", cameraZh: "中景跟拍", lightingZh: "冷色街灯", moodZh: "愤怒", sfxZh: "掌声脆响" },
  { startSec: 2.6, endSec: 5.2, actionZh: "两人对视，阿哲后退半步", cameraZh: "缓慢推近", lightingZh: "冷色街灯", moodZh: "僵持", sfxZh: "雨声" },
];
const plan: CanvasMusicMvPlan = {
  version: 1,
  audioId: "song",
  audioDurationSec: 5.2,
  analysisBasis: "lyrics_and_user_description",
  shots: [{ id: "shot-1", startSec: 0, endSec: 5.2, visualPrompt: "雨夜街头的争执", cameraPrompt: "侧面跟拍", lyricQuote: "", referenceIndices: [0] }],
};
const stockMotion = { source: "stock" as const, assetId: sf(4), gcsUri: "gs://test-bucket/stock-footage/1/motion.mp4", inSec: 0, outSec: 5, durationSec: 12 };
const previsMotion = { source: "previs" as const, previsRequestId: PREVIS_ID, gcsUri: "gs://test-bucket/previs/shot-1.mp4", inSec: 0, outSec: 5.2, durationSec: 5.2 };
function refsWith(motion: typeof stockMotion | typeof previsMotion) {
  return {
    "shot-1": {
      anchorImage: { assetId: sf(1), gcsUri: "gs://test-bucket/stock-footage/1/anchor.jpg" },
      sceneImages: [{ assetId: sf(2), gcsUri: "gs://test-bucket/stock-footage/1/scene-a.jpg" }],
      motionVideos: [motion],
      songSlice: { jobId: "mv_slice_1", gcsUri: "gs://test-bucket/slices/shot-1.wav", startSec: 0, endSec: 5.2 },
    },
  };
}

function shotBlock(opts: { motion: typeof stockMotion | typeof previsMotion; castZh?: string[]; beats?: MusicMvShotBeat[]; id?: string }): CanvasBlock {
  const imgs = [{ id: "hero", fileName: "hero.png", url: "https://test.invalid/hero.png", gcsUri: "gs://test-bucket/hero.png" }];
  const parent: CanvasBlock = {
    ...defaultCanvasBlock("music", 0, 0),
    id: "music-root",
    outputUrl: musicUrl,
    outputUrls: [musicUrl],
    musicMv: { status: "planned", candidates: [{ id: "song", url: musicUrl, durationSec: 5.2 }], selectedCandidateId: "song", plan, referenceImages: imgs },
  };
  const [shot] = createMusicMvShotBlocks(parent, plan, PLAN_ID, imgs, parent.musicMv!.candidates[0], refsWith(opts.motion));
  // 软提示按「块 id + 内容键」页面内去重：各用例用独立块 id，互不影响
  return { ...shot!, ...(opts.id ? { id: opts.id } : {}), musicMvShot: { ...shot!.musicMvShot!, castZh: opts.castZh ?? CAST, beats: opts.beats ?? BEATS } };
}

/** 替身网络：只放行素材签名与 seedanceI2V 出站；其他任何地址直接抛错（绝不真实请求）。 */
function offline() {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const m = /^\/api\/google\?op=materialReadUrl&gcsUri=(.+)$/.exec(url);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      return new Response(JSON.stringify({ ok: true, url: `https://test.invalid/${id.split("/").pop()}?signature=fresh` }));
    }
    if (url !== "/api/jobs?op=seedanceI2V" || init?.method !== "POST") throw new Error(`禁止任何真实网络：${url}`);
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }));
  }));
  return { requests };
}
function run(block: CanvasBlock, key: string, deps: Partial<CanvasRunDeps> = {}) {
  return runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "", ...deps }, block, { visionImages: [], texts: [] }, { videoSubmissionKey: key });
}
const asPrevisShot = (b: CanvasBlock): MvPrevisShot => {
  const s = b.musicMvShot!;
  return { shotId: s.shotId, startSec: s.startSec, endSec: s.endSec, kind: s.kind, visualPrompt: s.visualPrompt, cameraPrompt: s.cameraPrompt, beats: s.beats, castZh: s.castZh };
};

/** 参考选择器真机夹具：第一镜多人互动、第二镜空镜；全离线替身，零服务端/付费调用。 */
const pickerBlock = () => shotBlock({ motion: stockMotion, id: "mvshot-picker" });
const PICKER_SCENE = { assetId: sf(2), gcsUri: "gs://test-bucket/stock-footage/1/scene-a.jpg", label: "雨夜街景" };
const QUIET_BEATS: MusicMvShotBeat[] = [{ startSec: 5.2, endSec: 8, actionZh: "霓虹招牌在雨里闪烁", cameraZh: "固定机位", lightingZh: "霓虹", moodZh: "冷清", sfxZh: "雨声" }];
/**
 * 页面打包一次、各用例复用。夹具预设（注入打包前写 window.__mvPrevisPreset，刷新后需重写）：
 * openError → 桥 open 抛此错（f.openError 可随时改）；previsStudio → 第一镜块已有的白模工作台（如仍在处理）。
 * f.attempts 记每次 open 调用（含失败），f.opens 只记打开成功。
 */
let pickerBundleText: Promise<string> | undefined;
function pickerBundle() {
  return (pickerBundleText ??= (async () => {
    const block = pickerBlock();
    const s = block.musicMvShot!;
    const shots = [
      { id: s.shotId, startSec: s.startSec, endSec: s.endSec, visualPrompt: s.visualPrompt, cameraPrompt: s.cameraPrompt, lyricQuote: "", referenceIndices: [0], kind: "generated",
        beats: BEATS, complexity: { people: 2, action: "strong", contact: true, cameraSetups: 1, scenes: 1 } },
      { id: "shot-2", startSec: 5.2, endSec: 8, visualPrompt: "城市夜景空镜", cameraPrompt: "固定机位", lyricQuote: "", referenceIndices: [0], kind: "generated", beats: QUIET_BEATS },
    ];
    const refs = { "shot-1": { ...refsWith(stockMotion)["shot-1"], sceneImages: [PICKER_SCENE] } };
    const rows = [{ shotId: "shot-1", blockId: block.id, castZh: CAST }, { shotId: "shot-2", blockId: "mvshot-quiet", castZh: CAST }];
    const mocks: Record<string, string> = {
      "@/lib/trpc": `const hook={useMutation:()=>({mutateAsync:async()=>{throw new Error('离线：不得调用服务端')},isPending:false}),useQuery:()=>({data:undefined})};
        const ns=new Proxy({},{get:()=>hook});export const trpc=new Proxy({},{get:(_,k)=>k==='useUtils'?()=>new Proxy({},{get:()=>ns}):ns});`,
      "@/_core/hooks/useAuth": "export const useAuth=()=>({user:{id:7,role:'user'}});",
      "@/lib/jobs": "export const createJobSameOrigin=async()=>{throw new Error('禁止付费任务')};export const pollJobUntilTerminal=async()=>{throw new Error('离线')};",
      "@/lib/manhuaAssetImageSource": "export const assetImageGcsUri=()=>undefined;",
      "@/components/stockFootage/StockFootageDrawer": "export const StockFootageDrawer=()=>null;",
    };
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
        import React,{useState} from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';
        import {CanvasMvShotReferencePicker} from './client/src/components/canvas/CanvasMvShotReferencePicker';
        const init=${JSON.stringify({ shots, refs, rows })};
        const preset=window.__mvPrevisPreset||{};
        const f=window.fixture={opens:[],attempts:[],patches:[],changes:[],fetches:[],shots:init.shots,refs:init.refs,unavailable:undefined,active:null,openError:preset.openError,
          rows:preset.previsStudio?init.rows.map(r=>r.shotId==='shot-1'?{...r,previsStudio:preset.previsStudio}:r):init.rows};
        window.fetch=async(url)=>{f.fetches.push(String(url));throw new Error('离线');};
        function App(){
          const [,set]=useState(0);f.force=()=>flushSync(()=>set(n=>n+1));
          return <CanvasMvShotReferencePicker projectId="proj-1" planRequestId="${PLAN_ID}" shots={f.shots} shotReferences={f.refs} shotBlocks={f.rows} orientation="landscape"
            onPatchShotPrevis={(blockId,studio)=>{f.patches.push({blockId,studio});f.rows=f.rows.map(r=>r.blockId===blockId?{...r,previsStudio:studio}:r);set(n=>n+1);}}
            mvPrevis={{open:(id,q,submit)=>{f.attempts.push({id,submit});if(f.openError)throw new Error(f.openError);f.opens.push({id,q,submit});},onPreviewHostChange:()=>{},activeClipId:f.active,...(f.unavailable?{unavailableZh:f.unavailable}:{})}}
            onChange={next=>{f.changes.push(next);f.refs=next.shotReferences;set(n=>n+1);}}/>;
        }
        const root=createRoot(document.getElementById('root'));let v=0;f.render=()=>flushSync(()=>root.render(<App key={++v}/>));f.render();`,
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
      define: { "process.env.NODE_ENV": '"test"' },
      plugins: [{
        name: "离线替身",
        setup(b) {
          b.onResolve({ filter: /^@\// }, a => (mocks[a.path] ? { path: a.path, namespace: "mock" } : undefined));
          b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path], loader: "js" }));
        },
      }],
    });
    return bundle.outputFiles[0]!.text;
  })());
}
type PickerPreset = { openError?: string; previsStudio?: unknown };
/** 起无头浏览器挂选择器：拦截一切出站（记录后中止）；load(true) 首次打开、load(false) 整页刷新。 */
async function openPickerPage() {
  const bundle = await pickerBundle();
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage().catch(async e => { await browser.close(); throw e; });
  const outbound: string[] = [];
  await page.setRequestInterception(true).catch(async e => { await browser.close(); throw e; });
  page.on("request", req => {
    if (req.isNavigationRequest()) void req.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' });
    else { outbound.push(req.url()); void req.abort(); }
  });
  const load = async (first: boolean, preset?: PickerPreset) => {
    await (first ? page.goto("http://localhost:41933") : page.reload());
    if (preset) await page.evaluate(p => { (window as unknown as { __mvPrevisPreset: unknown }).__mvPrevisPreset = p; }, preset as never);
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[data-mv-shot-refs="shot-1"]');
  };
  const fx = <T,>(fn: string) => page.evaluate(`(()=>{const f=window.fixture;return ${fn}})()`) as Promise<T>;
  const settle = () => new Promise(r => setTimeout(r, 300));
  /** 本机按作品保存的记录：mv-previs-auto:v1 = 已成功打开；mv-previs-auto-fail:v1 = 自动打开失败次数与原因。 */
  const store = (name: "mv-previs-auto:v1" | "mv-previs-auto-fail:v1") =>
    page.evaluate(k => JSON.parse(localStorage.getItem(k) || "{}"), `${name}:proj-1`) as Promise<Record<string, any>>;
  const hint = () => page.$eval("[data-mv-previs-hint]", el => el.textContent || "");
  return { browser, page, outbound, load, fx, settle, store, hint };
}

describe("自动发起去重：镜头 id + 节拍哈希", () => {
  /** 自动发起替身：与参考选择器同口径——已发起键集合 + 已有白模参考即跳过。 */
  function autoLauncher() {
    const launched = new Set<string>();
    const advisorCalls: string[] = [];
    const tick = (blocks: CanvasBlock[]) => {
      const pick = nextMvShotAutoPrevis(
        blocks.map(b => ({ ...asPrevisShot(b), hasPrevis: Boolean(b.musicMvShot?.references?.motionVideos?.some(v => v.source === "previs")) })),
        (shot, key) => shot.hasPrevis || launched.has(key),
      );
      if (!pick) return;
      launched.add(pick.key);
      advisorCalls.push(pick.key);
    };
    return { tick, advisorCalls };
  }
  it("同内容只发一次；节拍改了才重发；已有白模参考不发", () => {
    const a = autoLauncher();
    const block = shotBlock({ motion: stockMotion });
    expect(mvShotNeedsPrevis(asPrevisShot(block)).needed).toBe(true);
    a.tick([block]);
    a.tick([block]);
    a.tick([{ ...block, musicMvShot: { ...block.musicMvShot!, visualPrompt: block.musicMvShot!.visualPrompt } }]);
    expect(a.advisorCalls).toHaveLength(1);
    const key1 = mvShotPrevisContentKey(asPrevisShot(block));
    expect(a.advisorCalls[0]).toBe(key1);
    expect(key1.startsWith("shot-1:")).toBe(true);

    const edited = shotBlock({ motion: stockMotion, beats: [{ ...BEATS[0]!, actionZh: "阿宁冲上前一把拥抱阿哲" }, BEATS[1]!] });
    const key2 = mvShotPrevisContentKey(asPrevisShot(edited));
    expect(key2).not.toBe(key1);
    a.tick([edited]);
    a.tick([edited]);
    expect(a.advisorCalls).toEqual([key1, key2]);

    const b = autoLauncher();
    b.tick([shotBlock({ motion: previsMotion })]);
    expect(b.advisorCalls).toEqual([]);
  });
  it("角色表不足不自动发起（交给 R3 先补角色表）", () => {
    const block = shotBlock({ motion: stockMotion, castZh: ["阿宁：短发白衬衫"] });
    expect(mvShotNeedsPrevis(asPrevisShot(block))).toMatchObject({ needed: false, reason: "cast_insufficient" });
    const a = autoLauncher();
    a.tick([block]);
    expect(a.advisorCalls).toEqual([]);
  });
  it("参考选择器挂载后自动发起顾问白模：同一镜头同节拍刷新/重挂载不重复发起；不可用/顾问占用时不发；顾问说明可读、采用后成为白模参考并进提示词", async () => {
    const block = pickerBlock();
    // 对照：第二镜无互动，不该被自动发起
    expect(mvShotNeedsPrevis({ shotId: "shot-2", startSec: 5.2, endSec: 8, visualPrompt: "城市夜景空镜", cameraPrompt: "固定机位", beats: QUIET_BEATS, castZh: CAST }).needed).toBe(false);
    const { browser, page, outbound, load, fx, settle } = await openPickerPage();
    try {
      const cue = mvShotNeedsPrevis(asPrevisShot(block)).cues;

      // ① 挂载即自动发起一次：先写白模基线（演员只有角色名、无动作），再按块 id 以 submit=true 打开顾问
      await load(true);
      await page.waitForFunction(() => (window as any).fixture.opens.length > 0);
      await settle();
      const opens = await fx<Array<{ id: string; q: string; submit: boolean }>>("f.opens");
      expect(opens).toEqual([{ id: block.id, q: mvPrevisAdvisorQuestion(asPrevisShot(block), { sceneLabels: ["雨夜街景"], cues: cue }), submit: true }]);
      expect(opens[0]!.q).toContain("用户不手填数值");
      const patches = await fx<Array<{ blockId: string; studio: ReturnType<typeof buildMvShotPrevisStudio> }>>("f.patches");
      expect(patches).toHaveLength(1);
      expect(patches[0]!.blockId).toBe(block.id);
      expect(patches[0]!.studio.advisorShotSource).toEqual(buildMvShotPrevisStudio(block.id, asPrevisShot(block)).advisorShotSource);
      expect(patches[0]!.studio.spec.actors.map(a => [a.nameZh, a.actions.length])).toEqual([["阿宁", 0], ["阿哲", 0]]);
      // 页面上没有任何让用户填坐标的数字框（图库片无入点框）
      expect(await page.$$eval('[data-mv-shot-refs="shot-1"] input[type="number"]', els => els.length)).toBe(0);
      const storeKey = `mv-previs-auto:v1:proj-1`;
      const launchedKey = mvShotPrevisContentKey(asPrevisShot(block));
      expect(Object.keys(JSON.parse((await page.evaluate(k => localStorage.getItem(k), storeKey)) || "{}"))).toEqual([launchedKey]);

      // ② 同内容反复重渲染 / 重挂载 / 整页刷新：不再发起，也不再重写基线
      await fx("(f.force(),f.force(),f.render(),f.render(),0)");
      await settle();
      expect(await fx<number>("f.opens.length")).toBe(1);
      expect(await fx<number>("f.patches.length")).toBe(1);
      await load(false);
      await settle();
      expect(await fx<number>("f.opens.length")).toBe(0);
      expect(await fx<number>("f.patches.length")).toBe(0);

      // ③ 不可用（未登录/制作中）或顾问正占用：不发起；软提示带原因
      const editedBeats = [{ ...BEATS[0]!, actionZh: "阿宁冲上前一把拥抱阿哲" }, BEATS[1]!];
      await page.evaluate(b => { const f = (window as any).fixture; f.unavailable = "正在制作中，结束后再生成白模"; f.shots = f.shots.map((s: any) => s.id === "shot-1" ? { ...s, beats: b } : s); f.render(); }, editedBeats);
      await settle();
      expect(await fx<number>("f.opens.length")).toBe(0);
      expect(await page.$eval("[data-mv-previs-hint]", el => el.textContent)).toContain("正在制作中，结束后再生成白模");
      await fx("(f.unavailable=undefined,f.active='mvshot-other',f.render(),0)");
      await settle();
      expect(await fx<number>("f.opens.length")).toBe(0);

      // ④ 顾问空闲且节拍已改：按新内容键再发起一次（只一次）
      await fx("(f.active=null,f.render(),0)");
      await page.waitForFunction(() => (window as any).fixture.opens.length > 0);
      await fx("(f.force(),f.render(),0)");
      await settle();
      expect(await fx<Array<{ id: string; submit: boolean }>>("f.opens.map(o=>({id:o.id,submit:o.submit}))")).toEqual([{ id: block.id, submit: true }]);
      const editedKey = mvShotPrevisContentKey({ ...asPrevisShot(block), beats: editedBeats });
      expect(Object.keys(JSON.parse((await page.evaluate(k => localStorage.getItem(k), storeKey)) || "{}")).sort()).toEqual([launchedKey, editedKey].sort());

      // ⑤ 顾问试看后用户在面板确认应用 → 镜头卡读出顾问站位说明 → 采用为动作参考；之后不再自动发起
      await page.evaluate(({ previsId }) => {
        const f = (window as any).fixture;
        f.rows = f.rows.map((r: any) => r.shotId !== "shot-1" ? r : {
          ...r,
          previs: { gcsUri: "gs://test-bucket/previs/shot-1.mp4", durationSec: 5.2, requestId: previsId },
          previsStudio: { ...r.previsStudio, selectedJobId: "job-1",
            history: [{ jobId: "job-1", requestId: previsId, gcsUri: "gs://test-bucket/previs/shot-1.mp4", url: "https://test.invalid/previs.mp4", durationSec: 5.2, createdAt: "t", spec: r.previsStudio.spec }],
            specHistory: [...(r.previsStudio.specHistory || []), { spec: r.previsStudio.spec, createdAt: "t", reasonZh: `用户确认应用顾问试看 ${previsId}；阿宁站在阿哲左侧，右手扇耳光后阿哲后退半步` }] },
        });
        f.render();
      }, { previsId: PREVIS_ID });
      await page.waitForSelector('[data-mv-previs-adopted="shot-1"]');
      expect(await page.$eval('[data-mv-previs-adopted="shot-1"]', el => el.textContent)).toContain("顾问站位与动作说明：阿宁站在阿哲左侧，右手扇耳光后阿哲后退半步");
      await page.evaluate(() => (Array.from(document.querySelectorAll('[data-mv-previs-adopted="shot-1"] button')).find(b => b.textContent === "采用为动作参考") as HTMLButtonElement).click());
      await page.waitForFunction(() => (window as any).fixture.changes.length > 0);
      // 已有白模参考：节拍再改也不自动发起
      await fx("(f.shots=f.shots.map(s=>s.id==='shot-1'?{...s,beats:s.beats.map(w=>({...w,moodZh:w.moodZh+'。'}))}:s),f.render(),0)");
      await settle();
      expect(await fx<number>("f.opens.length")).toBe(1);
      expect(await page.$eval('[data-mv-previs-adopted="shot-1"]', el => el.textContent)).toContain("已采用为动作参考");
      const adopted = await fx<Record<string, any>>("f.changes.at(-1).shotReferences");
      expect(adopted["shot-1"].motionVideos[0]).toMatchObject({ source: "previs", previsRequestId: PREVIS_ID, gcsUri: "gs://test-bucket/previs/shot-1.mp4", inSec: 0, outSec: 5.2 });
      expect(adopted["shot-1"].motionVideos[1]).toMatchObject({ source: "stock", gcsUri: stockMotion.gcsUri });
      // 除白模试看片本身的播放与浏览器自带图标外，页面没有任何出站请求（无接口、无付费任务）
      expect(outbound.filter(u => !u.startsWith("data:") && !u.endsWith("/favicon.ico") && u !== "https://test.invalid/previs.mp4")).toEqual([]);
      expect(await fx<string[]>("f.fetches")).toEqual([]);

      // ⑥ 用选择器写出的参考出片（离线出站）：提示词带白模参考片与白模指令，不出软提示
      const { requests } = offline();
      const onMvShotAdvisory = vi.fn();
      const [built] = createMusicMvShotBlocks(
        { ...defaultCanvasBlock("music", 0, 0), id: "music-root", outputUrl: musicUrl, outputUrls: [musicUrl],
          musicMv: { status: "planned", candidates: [{ id: "song", url: musicUrl, durationSec: 5.2 }], selectedCandidateId: "song", plan, referenceImages: [{ id: "hero", fileName: "hero.png", url: "https://test.invalid/hero.png", gcsUri: "gs://test-bucket/hero.png" }] } },
        plan, PLAN_ID, [{ id: "hero", fileName: "hero.png", url: "https://test.invalid/hero.png", gcsUri: "gs://test-bucket/hero.png" }], { id: "song", url: musicUrl, durationSec: 5.2 }, adopted as never);
      await run({ ...built!, id: "mvshot-picker-adopted", musicMvShot: { ...built!.musicMvShot!, castZh: CAST, beats: BEATS } }, "picker-adopted", { onMvShotAdvisory });
      expect(requests).toHaveLength(1);
      expect((requests[0]!.videoUrls as string[])[0]).toBe("https://test.invalid/shot-1.mp4?signature=fresh");
      expect(String(requests[0]!.prompt)).toMatch(/@视频1＝白模/);
      expect(String(requests[0]!.prompt)).toContain(MV_PREVIS_PROMPT_RULE_ZH("@视频1", "@图片1、@图片2"));
      expect(onMvShotAdvisory).not.toHaveBeenCalled();
    } finally {
      await browser.close();
    }
  }, 120_000);
  it("打开失败不记「已发起」：基线约 1 秒内没保存好只算一次失败、同一挂载不连发；重新挂载再自动发起，打开成功才记，之后重挂载/刷新不再发起", async () => {
    const block = pickerBlock();
    const key = mvShotPrevisContentKey(asPrevisShot(block));
    const baselineZh = "本镜白模基线尚未保存，未打开顾问";
    const { browser, page, load, fx, settle, store, hint } = await openPickerPage();
    try {
      // ① 基线一直未就绪：本次发起内每 100ms 重试、共 11 次 open 后放弃；0 次打开、只记 1 次失败、不记已发起；报错与软提示说明原因
      await load(true, { openError: baselineZh });
      await page.waitForFunction(() => (window as any).fixture.attempts.length >= 11);
      await settle();
      expect(await fx<number>("f.attempts.length")).toBe(11);
      expect(await fx<number>("f.opens.length")).toBe(0);
      expect(await fx<number>("f.patches.length")).toBe(1);
      expect(await store("mv-previs-auto:v1")).toEqual({});
      expect(await store("mv-previs-auto-fail:v1")).toEqual({ [key]: { count: 1, reasonZh: baselineZh, at: expect.any(String) } });
      expect(await page.$eval('[role="alert"]', el => el.textContent)).toBe(baselineZh);
      expect(await hint()).toContain(`自动打开创作顾问未成功：${baselineZh}。重新进入本步或刷新页面会再自动尝试，同一内容最多 3 次`);
      // ② 同一挂载反复重渲染：不连发
      await fx("(f.force(),f.force(),0)");
      await settle();
      expect(await fx<number>("f.attempts.length")).toBe(11);
      // ③ 重新挂载（基线已就绪）：再自动发起并打开；打开成功才记已发起、清失败记录，基线不重写
      await fx("(f.openError=undefined,f.render(),0)");
      await page.waitForFunction(() => (window as any).fixture.opens.length > 0);
      await settle();
      expect(await fx<Array<{ id: string; submit: boolean }>>("f.opens.map(o=>({id:o.id,submit:o.submit}))")).toEqual([{ id: block.id, submit: true }]);
      expect(await fx<number>("f.attempts.length")).toBe(12);
      expect(await fx<number>("f.patches.length")).toBe(1);
      expect(Object.keys(await store("mv-previs-auto:v1"))).toEqual([key]);
      expect(await store("mv-previs-auto-fail:v1")).toEqual({});
      expect(await hint()).toContain("已交创作顾问按逐窗节拍排站位与动作");
      // ④ 已成功打开过：重挂载、整页刷新都不再自动发起
      await fx("(f.render(),f.render(),0)");
      await settle();
      expect(await fx<number>("f.attempts.length")).toBe(12);
      await load(false);
      await settle();
      expect(await fx<number>("f.attempts.length")).toBe(0);
      expect(await fx<string[]>("f.fetches")).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
  it("白模还在处理：自动发起失败不记「已发起」、重挂载/刷新再试；同一内容连续失败 3 次后不再自动发起、软提示说明原因；手动重新生成打开成功才记；内容变化再自动发起", async () => {
    const block = pickerBlock();
    const key = mvShotPrevisContentKey(asPrevisShot(block));
    const studio = buildMvShotPrevisStudio(block.id, asPrevisShot(block));
    const running = { ...studio, pending: { requestId: "00000000-0000-4000-8000-0000000000bb", scopeId: studio.scopeId, clipId: block.id, spec: studio.spec } };
    const busyZh = "本镜白模仍在处理，请等任务结束";
    const { browser, page, load, fx, settle, store, hint } = await openPickerPage();
    const failures = async () => (await store("mv-previs-auto-fail:v1"))[key]?.count ?? 0;
    try {
      // ① 首次挂载：白模还在处理 → 未打开顾问（不调 open）、不记已发起；失败 1 次，报错与软提示说明原因
      await load(true, { previsStudio: running });
      await settle();
      expect(await fx<number>("f.attempts.length")).toBe(0);
      expect(await store("mv-previs-auto:v1")).toEqual({});
      expect(await failures()).toBe(1);
      expect(await page.$eval('[role="alert"]', el => el.textContent)).toBe(busyZh);
      expect(await hint()).toContain(`自动打开创作顾问未成功：${busyZh}`);
      // ② 同一挂载重渲染不连发；③ 重新挂载再试（第 2 次）；④ 整页刷新再试（第 3 次）→ 软提示说明已停止自动发起及原因
      await fx("(f.force(),f.force(),0)");
      await settle();
      expect(await failures()).toBe(1);
      await fx("(f.render(),0)");
      await settle();
      expect(await failures()).toBe(2);
      await load(false, { previsStudio: running });
      await settle();
      expect(await failures()).toBe(3);
      expect(await store("mv-previs-auto:v1")).toEqual({});
      expect(await hint()).toContain(`已自动尝试 3 次仍未打开创作顾问：${busyZh}。不再自动发起，处理好后请点「重新生成白模」`);
      // ⑤ 满 3 次：白模处理完（已可打开）后重挂载、刷新都不再自动发起，软提示保留原因
      await page.evaluate(s => { const f = (window as any).fixture; f.rows = f.rows.map((r: any) => r.shotId === "shot-1" ? { ...r, previsStudio: s } : r); f.render(); f.render(); }, studio as never);
      await settle();
      expect(await fx<number>("f.attempts.length")).toBe(0);
      await load(false, { previsStudio: studio });
      await settle();
      expect(await fx<number>("f.attempts.length")).toBe(0);
      expect(await failures()).toBe(3);
      expect(await hint()).toContain("已自动尝试 3 次仍未打开创作顾问");
      // ⑥ 用户手动「重新生成白模」：打开成功才记已发起、清失败记录，软提示恢复
      await page.evaluate(() => (Array.from(document.querySelectorAll('[data-mv-shot-refs="shot-1"] button')).find(b => b.textContent === "重新生成白模") as HTMLButtonElement).click());
      await page.waitForFunction(() => (window as any).fixture.opens.length > 0);
      await settle();
      expect(await fx<Array<{ id: string; submit: boolean }>>("f.opens.map(o=>({id:o.id,submit:o.submit}))")).toEqual([{ id: block.id, submit: true }]);
      expect(Object.keys(await store("mv-previs-auto:v1"))).toEqual([key]);
      expect(await store("mv-previs-auto-fail:v1")).toEqual({});
      expect(await hint()).toContain("已交创作顾问按逐窗节拍排站位与动作");
      // ⑦ 内容变化（同一挂载改节拍）：新内容键自动发起一次
      const edited = [{ ...BEATS[0]!, actionZh: "阿宁冲上前一把拥抱阿哲" }, BEATS[1]!];
      await page.evaluate(b => { const f = (window as any).fixture; f.shots = f.shots.map((s: any) => s.id === "shot-1" ? { ...s, beats: b } : s); f.force(); }, edited);
      await page.waitForFunction(() => (window as any).fixture.opens.length > 1);
      await settle();
      expect(await fx<number>("f.opens.length")).toBe(2);
      const editedKey = mvShotPrevisContentKey({ ...asPrevisShot(block), beats: edited });
      expect(Object.keys(await store("mv-previs-auto:v1")).sort()).toEqual([key, editedKey].sort());
      expect(await fx<string[]>("f.fetches")).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
  it("自动发起 → 顾问白模页：只预填并以面板 send 提问，超额时走现有 pendingPaid 费用确认，不带已确认付费、不直接调用付费接口", async () => {
    const omni = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
    const panel = readFileSync("client/src/components/canvas/ManhuaCreativeAdvisorPanel.tsx", "utf8");
    const a = omni.indexOf("  function openMvShotAdvisorPrevis("); const b = omni.indexOf("  /** 交 FreeformCanvas", a);
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
    const names = ["canUseManhua3d", "factoryBusy", "blocksRef", "advisor3dOpenVersion", "setAdvisor3dContext", "setAdvisorPreviewSelection", "setAdvisorPrevisClipId", "setAdvisorFocusSection", "chooseAdvisorVisibility", "setAdvisorNudge", "setAdvisorQuestionSeed", "advisorComponentKey", "user", "mvShotPrevisBridgeUnavailableZh"];
    const { code } = await transform(`const {${names.join(",")}}=ctx;${omni.slice(a, b)}`, { loader: "ts", target: "es2022" });
    const makeOpen = new Function("ctx", `${code};return openMvShotAdvisorPrevis;`) as (ctx: Record<string, unknown>) => (id: string, q: string, submit: boolean) => void;

    const fetchSpy = vi.fn(async () => { throw new Error("自动发起不得直接发请求"); });
    vi.stubGlobal("fetch", fetchSpy);
    const block = shotBlock({ motion: stockMotion, id: "mvshot-auto" });
    const pick = nextMvShotAutoPrevis([asPrevisShot(block)], () => false)!;
    expect(pick).toBeTruthy();
    const withStudio = { ...block, previsStudio: buildMvShotPrevisStudio(block.id, pick.shot) };
    const ctx = {
      canUseManhua3d: true, factoryBusy: false, blocksRef: { current: [withStudio] }, advisor3dOpenVersion: { current: 0 },
      setAdvisor3dContext: vi.fn(), setAdvisorPreviewSelection: vi.fn(), setAdvisorPrevisClipId: vi.fn(), setAdvisorFocusSection: vi.fn(),
      chooseAdvisorVisibility: vi.fn(), setAdvisorNudge: vi.fn(), setAdvisorQuestionSeed: vi.fn(), advisorComponentKey: "mv-project",
      // 1110 白模入口对普通登录用户开放：桥只看登录与制作中
      user: { id: 7, role: "user" }, mvShotPrevisBridgeUnavailableZh,
    };
    const question = mvPrevisAdvisorQuestion(pick.shot, { cues: mvShotNeedsPrevis(pick.shot).cues });
    makeOpen(ctx)(block.id, question, true);
    expect(ctx.setAdvisorPrevisClipId).toHaveBeenCalledWith(block.id);
    const seed = ctx.setAdvisorQuestionSeed.mock.calls[0]![0] as Record<string, unknown>;
    expect(seed).toMatchObject({ question, submit: true, projectKey: "mv-project" });
    expect(Object.keys(seed).sort()).toEqual(["id", "projectKey", "question", "submit"]);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 面板种子分支只 send(question)，不传已确认付费；在途/待确认付费时不重复发；超额由服务端拒绝后展示「确认支付」
    const effect = panel.slice(panel.indexOf("const appliedQuestionSeed"), panel.indexOf("const operationKey"));
    expect(effect).toMatch(/if \(seed\.submit && !draft\.trim\(\)\) \{\s*send\(seed\.question\);/);
    expect(effect).toMatch(/asking \|\| pendingPaid \|\| unresolvedFailed/);
    expect(panel).toMatch(/setPendingPaid\(\{ request, credits:/);
    expect(panel).toMatch(/确认支付 \{pendingPaid\.credits/);
  });
});

describe("出片路径：白模参考 / 软提示 / R3 硬拦（离线出站）", () => {
  it("采用白模后：提交参数里有 previs 视频参考，提示词标注白模站位片，不出软提示", async () => {
    const { requests } = offline();
    const onMvShotAdvisory = vi.fn();
    await run(shotBlock({ motion: previsMotion }), "previs-adopted", { onMvShotAdvisory });
    expect(requests).toHaveLength(1);
    const body = requests[0]!;
    expect(body.workMode).toBe("reference_to_video");
    expect(body.videoUrls).toEqual(["https://test.invalid/shot-1.mp4?signature=fresh"]);
    expect(String(body.prompt)).toMatch(/@视频1＝白模站位片/);
    // 头部白模指令 + 逐窗白模秒点（镜内相对秒）
    const prompt = String(body.prompt);
    expect(prompt).toContain(MV_PREVIS_PROMPT_RULE_ZH("@视频1", "@图片1、@图片2"));
    // 秒数写法以编译器为准（0 / 0.00 均可），只锁定白模序号与窗界
    expect(prompt).toMatch(/站位与动作按@视频1镜内 0(?:\.0+)?–2\.60? 秒段执行；接触瞬间以@视频1白模接触帧为准/);
    expect(prompt).toMatch(/站位与动作按@视频1镜内 2\.60?–5\.20? 秒段执行/);
    expect(onMvShotAdvisory).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });
  it("无白模参考：提示词不含白模指令（逐字节不变由 canvasMusicMvShotPrompt 自测保证）", async () => {
    const { requests } = offline();
    await run(shotBlock({ motion: stockMotion, id: "mvshot-no-rule" }), "no-rule", { onMvShotAdvisory: vi.fn() });
    expect(String(requests[0]!.prompt)).not.toContain(MV_PREVIS_PROMPT_RULE_ZH("@视频1", "§").split("§")[0]!);
    expect(String(requests[0]!.prompt)).not.toMatch(/站位与动作按@视频\d镜内/);
  });

  it("无白模：软提示出现，但照常提交且费用参数不变", async () => {
    const { requests } = offline();
    const onMvShotAdvisory = vi.fn();
    const block = shotBlock({ motion: stockMotion, id: "mvshot-no-previs" });
    await run(block, "no-previs", { onMvShotAdvisory });
    expect(onMvShotAdvisory).toHaveBeenCalledTimes(1);
    expect(onMvShotAdvisory).toHaveBeenCalledWith(block.id, MV_PREVIS_SOFT_HINT_ZH);
    expect(requests).toHaveLength(1);

    // 对照：同一镜头换成白模参考，除参考片外出站的计费参数（模型/分辨率/时长）一致
    const { requests: withPrevis } = offline();
    await run(shotBlock({ motion: previsMotion }), "with-previs");
    const pick = (r: Record<string, unknown>) => ({ model: r.model, resolution: r.resolution, duration: r.duration, workMode: r.workMode });
    expect(pick(requests[0]!)).toEqual(pick(withPrevis[0]!));
  });
  it("无白模且未注入回调：缺省走页面 toast 警告，照常提交", async () => {
    const { requests } = offline();
    await run(shotBlock({ motion: stockMotion, id: "mvshot-toast" }), "no-previs-toast");
    await vi.waitFor(() => expect(toastWarning).toHaveBeenCalledWith(MV_PREVIS_SOFT_HINT_ZH));
    expect(requests).toHaveLength(1);
  });
  it("同一镜头同一内容只提示一次（重跑/重试不重复）；节拍改了或换镜头才再提示，均照常提交", async () => {
    const { requests } = offline();
    const onMvShotAdvisory = vi.fn();
    const block = shotBlock({ motion: stockMotion, id: "mvshot-dedupe" });
    await run(block, "dedupe-1", { onMvShotAdvisory });
    await run(block, "dedupe-1", { onMvShotAdvisory });
    await run(block, "dedupe-2", { onMvShotAdvisory });
    expect(onMvShotAdvisory).toHaveBeenCalledTimes(1);
    const edited = shotBlock({ motion: stockMotion, id: "mvshot-dedupe", beats: [{ ...BEATS[0]!, actionZh: "阿宁冲上前一把拥抱阿哲" }, BEATS[1]!] });
    await run(edited, "dedupe-3", { onMvShotAdvisory });
    await run(edited, "dedupe-4", { onMvShotAdvisory });
    expect(onMvShotAdvisory).toHaveBeenCalledTimes(2);
    await run(shotBlock({ motion: stockMotion, id: "mvshot-dedupe-other" }), "dedupe-5", { onMvShotAdvisory });
    expect(onMvShotAdvisory).toHaveBeenCalledTimes(3);
    expect(onMvShotAdvisory.mock.calls.map(c => c[0])).toEqual(["mvshot-dedupe", "mvshot-dedupe", "mvshot-dedupe-other"]);
    expect(requests.length).toBeGreaterThanOrEqual(5);
  });
  it("MV 镜头不进生成前确认预览（previewOnly 在任何外部调用前拒绝），因此不会在预览阶段多弹一次", async () => {
    offline();
    const onMvShotAdvisory = vi.fn();
    await expect(
      runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "", onMvShotAdvisory }, shotBlock({ motion: stockMotion, id: "mvshot-preview" }), { visionImages: [], texts: [] }, { previewOnly: true }),
    ).rejects.toThrow();
    expect(onMvShotAdvisory).not.toHaveBeenCalled();
  });
  it("角色表不足：仍被 R3 硬拦，未提交、无软提示", async () => {
    const { requests } = offline();
    const onMvShotAdvisory = vi.fn();
    await expect(run(shotBlock({ motion: stockMotion, castZh: ["阿宁：短发白衬衫"] }), "cast-short", { onMvShotAdvisory })).rejects.toThrow(MV_SHOT_CAST_CONFLICT_ERROR_ZH);
    expect(requests).toEqual([]);
    expect(onMvShotAdvisory).not.toHaveBeenCalled();
  });
});
