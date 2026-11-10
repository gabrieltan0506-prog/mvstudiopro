import { describe, expect, it, vi } from "vitest";
import { creativeVoiceProductionSchema } from "@shared/creativeVoiceProduction";
import { MANHUA_ADVISOR_WORKFLOW_HELP } from "@shared/manhuaAdvisorWorkflow";
import { prepareAdvisorVideoEditPrefill } from "@shared/advisorVideoEdit";
import { createAdvisorVideoEditControl, createAdvisorVideoEditHub } from "./advisorVideoEditControl";

const targets = [{ id: "clip-1", label: "第1段成片", url: "https://cdn.test/a.mp4", durationSec: 40 }];
const refs = [{ id: "ref-1", label: "商店门口", url: "https://cdn.test/shop.png" }];
const sig = () => new AbortController().signal;
const prefillAction = (startSec: number, endSec: number, extra: Record<string, unknown> = {}) =>
  ({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec, endSec, promptZh: "背景换成商店门口，人物动作与衣着不变", ...extra }) as const;
const TECH = /Seedance|BytePlus|EvoLink|Gemini|Vertex|Veo|GPT|Claude/i;

describe("顾问 videoEdit 契约", () => {
  it("inspect/prefill 通过；缺参、错位字段、结束不大于开始拒绝；提示写明只预填", () => {
    const ok = (v: unknown) => creativeVoiceProductionSchema.safeParse(v).success;
    expect(ok({ action: "videoEdit", operation: "inspect" })).toBe(true);
    expect(ok(prefillAction(24, 30, { refAssetId: "ref-1" }))).toBe(true);
    expect(ok({ action: "videoEdit", operation: "prefill", targetId: "clip-1", startSec: 24, endSec: 30 })).toBe(false);
    expect(ok({ ...prefillAction(24, 30), sourceUrl: "https://x" })).toBe(false);
    expect(ok({ action: "videoEdit", operation: "inspect", promptZh: "改背景" })).toBe(false);
    expect(ok(prefillAction(30, 24))).toBe(false);
    expect(MANHUA_ADVISOR_WORKFLOW_HELP).toContain("videoEdit(inspect/prefill");
    expect(MANHUA_ADVISOR_WORKFLOW_HELP).toContain("只打开视频局部修改面板并预填");
  });
});

describe("顾问 videoEdit 只预填不提交", () => {
  it("inspect 列真实视频与时长；prefill 打开面板预填、可多轮覆盖，不调用提交", async () => {
    const open = vi.fn();
    const queue = vi.fn();
    const control = createAdvisorVideoEditControl({ targets: () => targets, refs: () => refs, open });
    expect(JSON.parse(await control({ action: "videoEdit", operation: "inspect" }, sig()))).toMatchObject({ videos: [{ targetId: "clip-1", durationSec: 40 }], minSec: 4, maxSec: 30 });
    const r1 = JSON.parse(await control(prefillAction(24, 30, { refAssetId: "ref-1" }), sig()));
    expect(r1).toMatchObject({ status: "prefilled", startSec: 24, endSec: 30 });
    expect(r1.note).toContain("尚未提交、未扣积分");
    expect(JSON.stringify(r1)).not.toMatch(TECH);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ sourceUrl: "https://cdn.test/a.mp4", referenceImageUrl: "https://cdn.test/shop.png" }));
    await control(prefillAction(25, 31.5), sig());
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]![0]).toMatchObject({ startSec: 25, endSec: 31.5 });
    expect(queue).not.toHaveBeenCalled();
  });
  it("越界 / 超 30 秒 / 非一位小数 / 未知视频拒绝且不打开；不足 4 秒按中心扩展并说明", async () => {
    const open = vi.fn();
    const control = createAdvisorVideoEditControl({ targets: () => targets, open });
    const err = (a: unknown) => control(a as never, sig()).then(() => "ok", (e: Error) => e.message);
    expect(await err(prefillAction(36, 41))).toContain("超出视频时长 40 秒");
    expect(await err(prefillAction(0, 31))).toContain("最多 30 秒");
    expect(await err(prefillAction(0, 31))).toContain("拆成几段");
    expect(await err(prefillAction(1.25, 6))).toContain("一位小数");
    expect(await err({ ...prefillAction(1, 6), targetId: "nope" })).toContain("不在当前可编辑清单");
    expect(await err({ ...prefillAction(1, 6), refAssetId: "nope" })).toContain("参考图不在");
    expect(open).not.toHaveBeenCalled();
    const short = JSON.parse(await control(prefillAction(26, 27), sig()));
    expect(short).toMatchObject({ startSec: 24.5, endSec: 28.5 });
    expect(short.notice).toContain("最短 4 秒");
    expect(prepareAdvisorVideoEditPrefill(prefillAction(39, 40), targets)).toMatchObject({ startSec: 36, endSec: 40 });
    expect(prepareAdvisorVideoEditPrefill(prefillAction(0, 1), targets)).toMatchObject({ startSec: 0, endSec: 4 });
  });
});

describe("顾问 videoEdit 接线", () => {
  it("MV 后期工作台转给后期工坊登记口；工坊打开「局部修改这条」并按 nonce 预填，不经提交路径", async () => {
    const { readFileSync } = await import("node:fs");
    const card = readFileSync("client/src/components/canvas/PostProdWorkshopCard.tsx", "utf8");
    const mv = readFileSync("client/src/components/canvas/CanvasMvPostProdWorkbench.tsx", "utf8");
    expect(mv).toContain("onAdvisorVideoEditControl={registerVideoEdit}");
    expect(mv).toMatch(/action\.action === "videoEdit"[\s\S]{0,200}videoEditHub\.control\(action, signal\)/);
    expect(card).toContain("createAdvisorVideoEditControl(");
    expect(card).toMatch(/open: p => \{\s*setQuickEditOpen\(true\);\s*setAdvisorEditPrefill\(/);
    expect(card).toContain("prefill={advisorEditPrefill}");
    expect(card.indexOf("const busy = queueMutation.isPending || disabled;")).toBeLessThan(card.indexOf("const advisorVideoEditLive"));
  });
  it("后期工坊/代码动画与首页/营销成片：自建控件经面板预填闸门（确认/报价/提交/任务进行中拒绝并回原因）", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["client/src/components/canvas/PostProdWorkshopCard.tsx", "client/src/components/HomePhotoVideoUpscale.tsx", "client/src/components/platform/MarketingProductionPanel.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("const editGuard = useVideoEditPrefillGuard();");
      expect(src).toMatch(/onAdvisorVideoEditControl\(\s*editGuard\.withGuard\(\s*createAdvisorVideoEditControl\(/);
      expect(src).toContain("onAdvisorPrefillGuard={editGuard.register}");
    }
  });
  it("营销成片：面板与顾问清单都按实测秒数一位小数向下取", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("client/src/components/platform/MarketingProductionPanel.tsx", "utf8");
    expect(src).toContain("durationSec={videoEditDurationSec(finalSec)}");
    expect(src).toContain("const editSec = videoEditDurationSec(sec);");
    expect(src).toContain("[{ ...target, url, durationSec: editSec }]");
  });
});

describe("多个「局部修改」入口汇总", () => {
  const mk = (id: string, label: string, durationSec: number, open: (p: unknown) => void) =>
    createAdvisorVideoEditControl({ targets: () => [{ id, label, url: `https://cdn.test/${id}.mp4`, durationSec }], open });
  it("inspect 合并去重、prefill 按 targetId 只开对应面板；无入口给中文原因", async () => {
    const hub = createAdvisorVideoEditHub();
    expect(await hub.control({ action: "videoEdit", operation: "inspect" }, sig()).then(() => "ok", (e: Error) => e.message)).toContain("没有可局部修改的成片");
    const openA = vi.fn(), openB = vi.fn();
    hub.register("postprod")(mk("postprod-selected", "后期工坊所选这一条成片", 20, openA));
    hub.register("mv-final")(mk("mv-final", "MV 合成成片", 60, openB));
    hub.register("dup")(mk("mv-final", "MV 合成成片", 60, vi.fn()));
    const inv = JSON.parse(await hub.control({ action: "videoEdit", operation: "inspect" }, sig()));
    expect(inv.videos.map((v: { targetId: string }) => v.targetId)).toEqual(["postprod-selected", "mv-final"]);
    const r = JSON.parse(await hub.control({ action: "videoEdit", operation: "prefill", targetId: "mv-final", startSec: 40, endSec: 50, promptZh: "结尾天空更亮" }, sig()));
    expect(r).toMatchObject({ status: "prefilled", targetId: "mv-final" });
    expect(openB).toHaveBeenCalledTimes(1);
    expect(openA).not.toHaveBeenCalled();
    // 超出该片时长：按目标片校验（20 秒片不接受 40–50）
    expect(await hub.control({ action: "videoEdit", operation: "prefill", targetId: "postprod-selected", startSec: 40, endSec: 50, promptZh: "改背景" }, sig()).then(() => "ok", (e: Error) => e.message)).toContain("超出视频时长 20 秒");
    expect(await hub.control({ action: "videoEdit", operation: "prefill", targetId: "nope", startSec: 0, endSec: 5, promptZh: "改背景" }, sig()).then(() => "ok", (e: Error) => e.message)).toContain("不在当前可编辑清单");
    hub.register("mv-final")(null);
    hub.register("dup")(null);
    expect(JSON.parse(await hub.control({ action: "videoEdit", operation: "inspect" }, sig())).videos).toHaveLength(1);
    expect(hub.register("postprod")).toBe(hub.register("postprod"));
  });
  it("各入口接线：画布视频块、MV 第 6 步成片、漫剧页汇总；预填只开面板", async () => {
    const { readFileSync } = await import("node:fs");
    const canvas = readFileSync("client/src/components/canvas/FreeformCanvas.tsx", "utf8");
    // 画布视频块局部修改 / 调色的逻辑（含顾问登记）在 useCanvasVideoTools，FreeformCanvas 只调用与渲染
    const canvasTools = readFileSync("client/src/components/canvas/useCanvasVideoTools.ts", "utf8");
    expect(canvas).toMatch(/= useCanvasVideoTools\(\{ blocks, blocksRef, onBlocksChangeRef, onAdvisorVideoEditControl, blockLabel: freeformNodeListLabel \}\);/);
    const studio = readFileSync("client/src/components/canvas/CanvasMusicMvStudio.tsx", "utf8");
    const omni = readFileSync("client/src/pages/OmniCanvas.tsx", "utf8");
    expect(canvasTools).toMatch(/open: p => \{\s*setEditPanelBlockId\(p\.targetId\);\s*setEditPrefill\(/);
    expect(canvas).toContain("prefill={editPrefill?.blockId === block.id ? editPrefill : undefined}");
    expect(studio).toContain('advisorVideoEditHub.register("mv-final")');
    expect(studio).toMatch(/open: p => \{\s*setEditOpen\(true\);\s*setFinalEditPrefill\(/);
    expect(studio).toContain("prefill={finalEditPrefill}");
    expect(studio).toContain("advisorVideoEditHub={advisorVideoEditHub}");
    expect(omni).toContain('if (action.action === "videoEdit") return advisorVideoEditHub.control(action, signal);');
    for (const k of ["canvas-1", "canvas-2", "canvas-3", "postprod"]) expect(omni).toContain(`advisorVideoEditHub.register("${k}")`);
    // 画布清单只列真有「局部修改」入口的块（与渲染条件同一谓词），防预填了却打不开面板
    expect(canvas).toContain("{canvasBlockHasVideoTools(block) ? (");
    expect(canvasTools).toMatch(/const videos = \(\) => cur\(\)\.blocks\.filter\(b => canvasBlockHasVideoTools\(b\)/);
    for (const src of [canvas, canvasTools, studio]) expect(src).not.toMatch(/queueVideoPartialEdit/);
  });
  it("代码动画与营销成片：登记口 + advisorTarget 唯一，预填只开面板", async () => {
    const { readFileSync } = await import("node:fs");
    const upscale = readFileSync("client/src/components/HomePhotoVideoUpscale.tsx", "utf8");
    const marketing = readFileSync("client/src/components/platform/MarketingProductionPanel.tsx", "utf8");
    expect(upscale).toContain('{ id: `code-motion:${projectKey}`.slice(0, 200), label: "代码动画成片" }');
    expect(upscale).toContain('{ id: "home-video-tool", label: "首页视频工具当前视频" }');
    expect(marketing).toContain('advisorTarget = { id: "marketing-final", label: "营销成片" }');
    for (const src of [upscale, marketing]) {
      expect(src).toContain("createAdvisorVideoEditControl(");
      expect(src).toMatch(/open: p => \{\s*setTool\("edit"\);\s*setEditPrefill\(/);
      expect(src).toContain("prefill={editPrefill}");
      expect(src).toContain("return () => onAdvisorVideoEditControl(null);");
      expect(src).not.toMatch(/queueVideoPartialEdit/);
    }
  });
});
