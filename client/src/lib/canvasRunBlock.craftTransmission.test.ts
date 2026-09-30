import { afterEach, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { previewCanvasBlockOutbound, runCanvasBlock } from "./canvasRunBlock";
import { applyFactoryPrefsToBlocks, spawnManhuaDramaStudio } from "./canvasDramaStudio";
import { readManhuaTimedStoryboard } from "@shared/manhuaTimedStoryboard";
import { parseWorkbenchShotsFromText, formatWorkbenchSegmentClipInjectBlock } from "@shared/manhuaScriptWorkbench";
import { buildManhuaWriterExpandPrompt } from "@shared/manhuaWriterRoom";
import { formatManhuaEntranceAtmosphereCatalog } from "@shared/manhuaEntranceAtmosphereBank";
import { formatManhuaShotCoreCatalog } from "@shared/manhuaShotCoreBank";
import { buildAdvisorPrevisCraftBlock } from "../../../server/services/manhuaAdvisorPrevisCraft";

vi.mock("./flyHealthGate", () => ({ withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run() }));
vi.mock("./longJobsFlyOrigin", () => ({ withLongJobsFlyDirect: (url: string) => url, flyHealthProbeOriginForUrl: () => "https://test.invalid" }));
afterEach(() => vi.unstubAllGlobals());
const entrances = "【出场氛围与灯光候选库】";
const cores = "【七核心镜头候选库】";

it("编剧与三类顾问真实输入带同源目录，静态场景不携带动态词类", () => {
  const writer = buildManhuaWriterExpandPrompt({ topic: "母女去医", brief: "原天气与对白锁定", episodeCount: 3 });
  for (const prompt of [writer, buildAdvisorPrevisCraftBlock({}), buildAdvisorPrevisCraftBlock({}, "general"), buildAdvisorPrevisCraftBlock({}, "world")]) {
    expect(prompt).toContain(entrances);
    expect(prompt).toContain(cores);
    expect(prompt).toContain("亮暗权力翻转");

  }
  expect(writer).toContain("cameraZh");
  const world = formatManhuaShotCoreCatalog("world");
  expect(world).not.toMatch(/^(?:动势|转场)：/m);
  expect(formatManhuaEntranceAtmosphereCatalog("world")).not.toContain("｜运镜：");
});

it("工厂选择连续同步两次只保留一个目录与选择，用户后加正文保留", () => {
  const spawned = spawnManhuaDramaStudio({ topic: "母女去医", narrativeLightingIds: ["entrance_contact_light"] });
  const source = spawned.blocks.map(block => /^(?:story|beats|reverse)-/.test(block.id) ? { ...block, prompt: block.prompt + "\n\n用户保留正文：同一秒窗中光与动作一致。" } : block);
  const once = applyFactoryPrefsToBlocks(source, { narrativeLightingIds: ["entrance_contact_light"] });
  const twice = applyFactoryPrefsToBlocks(once, { narrativeLightingIds: ["entrance_contact_light"] });
  for (const block of twice.filter(block => /^(?:story|beats|reverse)-/.test(block.id))) {
    expect(block.prompt.split(entrances)).toHaveLength(2);
    expect(block.prompt.split(cores)).toHaveLength(2);
    expect(block.prompt).toContain("接触闪光与受光");
    expect(block.prompt, block.id).toContain("用户保留正文：同一秒窗中光与动作一致。");
  }
});

it("旧节拍节点的优化函数真正收到新目录，普通画布不注入", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("禁止真实网络"); }));
  const optimizeCopy = vi.fn(async (_input: unknown) => "可拍正文");
  const block = { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01", prompt: "母女同向扶行，马在后方。" };
  await runCanvasBlock({ userRole: "admin", optimizeCopy }, block);
  const input = optimizeCopy.mock.calls[0]![0] as { sourceText: string };
  expect(input.sourceText).toContain(cores);
  expect(input.sourceText).toContain(entrances);
  expect(input.sourceText).toContain("cameraZh");
  optimizeCopy.mockClear();
  await runCanvasBlock({ userRole: "admin", optimizeCopy }, { ...block, id: "ordinary-note" });
  expect((optimizeCopy.mock.calls[0]![0] as { sourceText: string }).sourceText).not.toContain(cores);
});

it("独立列与超过48字镜头经过真实reader→工作台→段提示词→出站预览完整传递，零网络", async () => {
  const camera = "低机位推拉结合，18mm/FOV90°俯冲后35mm/FOV54.4°真实推近，再24mm/FOV73.7°真实拉回；三分构图保母女眼线，前景柱、中景母女、后景伤马保持三层，末端焦点明确停在右眼且不越轴";
  const raw = `|镜号|秒位|景别|运镜|构图|焦段/FOV|画面|灯光|氛围|色调|转场|对白|\n|---|---|---|---|---|---|---|---|---|---|---|---|\n|1|0—5秒|中景|${camera}|右三分左留白|24mm/FOV73.7°|母女扶行，伤马跟随|后侧闪电照湿毛后回底光|暴雨忧虑转保护|冷蓝底光与局部掌光|同轴眼线匹配|无对白|\n|2|5—10秒|中景|同轴拉回停稳|两人同框|35mm/FOV54.4°|扶行继续|原侧光|忧虑|原色调|直切|无对白|`;
  const parsed = readManhuaTimedStoryboard(raw);
  expect(parsed.errors).toEqual([]);
  const shots = parseWorkbenchShotsFromText(raw);
  expect(shots).toHaveLength(2);
  expect(shots[0]!.cameraZh).toContain("末端焦点明确停在右眼且不越轴");
  const prompt = formatWorkbenchSegmentClipInjectBlock({ segmentIndex: 1, durationSec: 10, shots });
  const noNetwork = vi.fn(async () => { throw new Error("预览禁止网络"); });
  vi.stubGlobal("fetch", noNetwork);
  const preview = await previewCanvasBlockOutbound({ userRole: "admin", optimizeCopy: async () => "" }, {
    ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", videoModel: "seedance-2.5", prompt, refImageUrl: "https://test.invalid/identity.png",
  });
  const outgoing = String(preview.body.prompt);
  for (const text of ["末端焦点明确停在右眼且不越轴", "后侧闪电照湿毛后回底光", "暴雨忧虑转保护", "冷蓝底光与局部掌光", "同轴眼线匹配", "24mm/FOV73.7°"]) expect(outgoing).toContain(text);
  expect(outgoing).not.toContain(cores);
  expect(outgoing).not.toContain(entrances);
  expect(noNetwork).not.toHaveBeenCalled();
});

it("长节拍拆分后每次实际优化请求都有完整两库，只缺一库的旧稿也补齐", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("禁止真实网络"); }));
  const optimizeCopy = vi.fn(async (_input: unknown) => "可拍正文");
  const source = "母女沿街扶行，伤马跟随。\n".repeat(1600) + formatManhuaShotCoreCatalog("storyboard");
  await runCanvasBlock({ userRole: "admin", optimizeCopy }, { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01", prompt: source });
  expect(optimizeCopy.mock.calls.length).toBeGreaterThan(1);
  for (const call of optimizeCopy.mock.calls) {
    const text = (call[0] as { sourceText: string }).sourceText;
    expect(text.length).toBeLessThanOrEqual(32000);
    expect(text).toContain(entrances);
    expect(text).toContain("【/出场氛围与灯光候选库】");
    expect(text).toContain(cores);
    expect(text).toContain("【/七核心镜头候选库】");
    expect(text).toContain("亮暗权力翻转");
    expect(text).toContain("匹配剪辑");
  }
});

it("主优化失败时真实fallback请求仍带两库与原正文，零真实网络", async () => {
  const bodies: Array<{ prompt: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(String(url)).toBe("/api/google?op=geminiScript");
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true, text: "可拍正文" }));
  }));
  await runCanvasBlock({ userRole: "admin", optimizeCopy: async () => { throw new Error("主通道测试失败"); } }, {
    ...defaultCanvasBlock("text", 0, 0), id: "beats-e01", prompt: "母女扶行，原声与第二段锁定。",
  });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]!.prompt).toContain("母女扶行，原声与第二段锁定。");
  expect(bodies[0]!.prompt).toContain("亮暗权力翻转");
  expect(bodies[0]!.prompt).toContain("匹配剪辑");
  expect(bodies[0]!.prompt).toContain("不改已锁对白、原音轨或段长");
});
