/**
 * 1110 ⑤ MV 多人互动镜头 → 白模动作参考 整链（全离线替身，零付费调用）。
 * - 自动发起去重：镜头 id + 节拍哈希（同内容只发一次，节拍改了才重发）
 * - 采用白模后：提交参数里有 previs 视频参考，提示词含白模指令
 * - 无白模：软提示出现但照常提交（不拦、不改费用）
 * - 角色表不足：仍被 R3 硬拦（未提交、未扣费）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";
import { createMusicMvShotBlocks } from "./canvasMusicMvWorkflow";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { runCanvasBlock, type CanvasRunDeps } from "./canvasRunBlock";
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
  it.todo("参考选择器挂载后自动发起顾问白模：同一镜头同节拍刷新/重挂载不重复发起（等 CanvasMvShotReferencePicker 推送）");
  it("自动发起 → 顾问白模页：只预填并以面板 send 提问，超额时走现有 pendingPaid 费用确认，不带已确认付费、不直接调用付费接口", async () => {
    const omni = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
    const panel = readFileSync("client/src/components/canvas/ManhuaCreativeAdvisorPanel.tsx", "utf8");
    const a = omni.indexOf("  function openMvShotAdvisorPrevis("); const b = omni.indexOf("  /** 交 FreeformCanvas", a);
    expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
    const names = ["canUseManhua3d", "factoryBusy", "blocksRef", "advisor3dOpenVersion", "setAdvisor3dContext", "setAdvisorPreviewSelection", "setAdvisorPrevisClipId", "setAdvisorFocusSection", "chooseAdvisorVisibility", "setAdvisorNudge", "setAdvisorQuestionSeed", "advisorComponentKey"];
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
