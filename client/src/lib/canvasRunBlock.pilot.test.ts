import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: vi.fn(async () => ({ frames: [] })),
  extractVideoFramesFromUrl: vi.fn(),
}));
vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

import { compileManhuaPilotPrompt } from "@shared/manhuaPilotGate";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { runManhuaDramaFactoryPipeline, spawnManhuaDramaStudio, expandManhuaShotKeyartsAfterReverse, ensureManhuaFragmentClips, resolveManhuaFragmentRunTargets } from "./canvasDramaStudio";
import { buildManhuaAssetLockRegistry, buildManhuaAssetPathById } from "@shared/manhuaAssetLockRegistry";

const originalPrompt = [
  "【第1段·30s】雨夜仓库",
  "0–6s：人物从左侧进入，摄影机固定。",
  "6–12s：人物抬头，摄影机推近。",
  "12–30s：后段铁门坍塌，人物逃出画面。",
].join("\n");
let requests: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!/^\/api\/jobs\?op=(seedanceI2V|hailuo3Video|wan30Video)$/.test(url) || init?.method !== "POST") {
      throw new Error("禁止真实网络或未声明请求");
    }
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, taskId: "test-created-task", videoUrl: "https://test.invalid/pilot.mp4" }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function pilotBlock(videoModel: CanvasBlock["videoModel"]): CanvasBlock {
  return {
    ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", episodeIndex: 1,
    videoModel, refImageUrl: "https://test.invalid/first-frame.png",
    prompt: compileManhuaPilotPrompt(originalPrompt).prompt,
  };
}

describe("首段试片的实际出站载荷（仅虚构网络边界）", () => {
  it("本段选择的同角色形态图穿过编排及执行器进入最终 POST，缺路径时零提交", async () => {
    const spawned = spawnManhuaDramaStudio({ topic: "黑奇保护阿菁", episodeIndex: 1 });
    const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
    const source = spawned.blocks.map(b => b.id === reverse.id ? { ...b, outputText: "1. 黑奇抬头\n2. 黑奇站直\n3. 黑奇向前", status: "done" as const } : b);
    const expanded = expandManhuaShotKeyartsAfterReverse(source, spawned.edges, reverse.id);
    const ready = expanded.blocks.map(b => b.id.startsWith("keyart-") ? { ...b, outputUrl: `https://test.invalid/${b.id}.png`, status: "done" as const } : b);
    const customRefs = [{ id: "heiqi", role: "character" as const, url: "https://test.invalid/heiqi.png", labelZh: "黑奇" }];
    const lookRefs = [{ id: "after-image", role: "character" as const, claimedAnchorIds: ["heiqi"], url: "https://test.invalid/after.png", labelZh: "变身后" }];
    const characterLookSets = [{ id: "look-after", characterId: "heiqi", index: 1, labelZh: "变身后", lookRefId: "after-image" }];
    const registry = buildManhuaAssetLockRegistry({ customRefs, lookRefs, characterLookSets });
    const ensured = ensureManhuaFragmentClips(ready, expanded.edges, 1, { customRefs, lookRefs, characterLookSets, segmentLookBindings: { "e1:s1": { heiqi: "look-after" } } });
    const clip = ensured.blocks.find(b => b.id === resolveManhuaFragmentRunTargets(ensured.blocks, 1, 1).clipId)!;
    const deps = { userRole: "admin", userId: "test-user", optimizeCopy: async () => "", manhuaAssetPathById: buildManhuaAssetPathById(registry), authorizeManhuaClip: async () => ({ projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex: 1, intent: "pilot" as const }) };
    await runCanvasBlock(deps, clip, undefined, { pilotRun: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.imageUrls).toContain("https://test.invalid/after.png");
    requests = [];
    await expect(runCanvasBlock({ ...deps, manhuaAssetPathById: { heiqi: "https://test.invalid/heiqi.png" } }, clip, undefined, { pilotRun: true })).rejects.toThrow(/造型/);
    expect(requests).toHaveLength(0);
  });
  it.each(["seedance-2.0", "seedance-2.0-mini", "seedance-2.0-fast", "seedance-2.5", "wan-3.0", "minimax-hailuo-3"] as const)(
    "%s：共用执行入口真实消费审核身份，稳定任务键进入最终POST",
    async (videoModel) => {
      const authorize = vi.fn(async () => ({
        projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex: 1, intent: "pilot" as const,
      }));
      const created = vi.fn();
      await runCanvasBlock(
        { userRole: "admin", userId: "test-user", optimizeCopy: async () => "", authorizeManhuaClip: authorize, onVideoTaskCreated: created },
        pilotBlock(videoModel), undefined, { pilotRun: true, videoSubmissionKey: "test-explicit-submission" },
      );
      expect(authorize).toHaveBeenCalledWith({ episodeIndex: 1, segmentIndex: 1, videoModel, pilotRun: true, durationSec: 10 });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body.manhuaPilot).toEqual(await authorize.mock.results[0]?.value);
      expect(requests[0]?.body.idempotencyKey).toBe("test-explicit-submission");
      expect(created).toHaveBeenCalledTimes(1);
      expect(created).toHaveBeenCalledWith("clip-e01-g01", { taskId: "test-created-task", engine: videoModel });
    },
  );

  it("画布直接运行未批准长片在网络/上游之前拒绝", async () => {
    const authorize = vi.fn(async () => { throw new Error("请先审阅并批准试片"); });
    await expect(runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "", authorizeManhuaClip: authorize },
      { ...pilotBlock("seedance-2.5"), prompt: originalPrompt },
    )).rejects.toThrow("请先审阅");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ pilotRun: false, durationSec: 30 }));
    expect(requests).toEqual([]);
  });

  it("编排入口同样不能绕过审核，失败不提交和不删除独立分镜", async () => {
    const block = { ...pilotBlock("seedance-2.5"), seedance25TimestampStoryboard: "0–30s：原稿保留。" };
    const keys = [1, 2, 3].map((shot) => ({
      ...defaultCanvasBlock("image", 0, shot * 100),
      id: `keyart-e01-s0${shot}-test`, episodeIndex: 1, status: "done" as const,
      prompt: `第${shot}镜`, outputUrl: `https://test.invalid/still${shot}.png`,
    }));
    const authorize = vi.fn(async () => { throw new Error("请先审阅并批准试片"); });
    const result = await runManhuaDramaFactoryPipeline({
      deps: { userRole: "admin", optimizeCopy: async () => "", authorizeManhuaClip: authorize },
      blocks: [...keys, block], edges: [], episodeIndex: 1, untilStage: "clip", forceFromStage: "clip",
      fragmentShotIndex: 1, targetBlockIds: [block.id], preservePreparedTargetBlocks: true, maxRetries: 0,
      ensureOptions: { videoModel: "seedance-2.5" },
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.errors)).toContain("请先审阅并批准试片");
    expect(requests).toEqual([]);
    expect(result.blocks.find((item) => item.id === block.id)?.seedance25TimestampStoryboard).toBe(block.seedance25TimestampStoryboard);
  });

  it.each(["seedance-2.0", "seedance-2.5", "wan-3.0", "minimax-hailuo-3"] as const)(
    "%s：只提交 10 秒且正文不包含后 10 秒剧情",
    async (videoModel) => {
      const result = await runCanvasBlock(
        { userRole: "admin", userId: "test-user", optimizeCopy: async () => "" },
        pilotBlock(videoModel),
        undefined, { pilotRun: true },
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body.duration).toBe(10);
      expect(requests[0]?.body.prompt).toContain("人物从左侧进入");
      expect(requests[0]?.body.prompt).toContain("人物抬头");
      expect(requests[0]?.body.prompt).not.toMatch(/后段铁门坍塌|12[–—-]30/);
      expect(result.outputUrl).toBe("https://test.invalid/pilot.mp4");
    },
  );

  it("独立秒级分镜也必须裁成 10 秒，不能在主提示词之后重新灌入长片后段", async () => {
    const block = {
      ...pilotBlock("seedance-2.5"),
      seedance25TimestampStoryboard: "0–6s：灯笼亮起。\n6–12s：人物停步。\n12–30s：后段石桥断裂。",
    };
    const before = JSON.stringify(block);
    await runCanvasBlock(
      { userRole: "admin", userId: "test-user", optimizeCopy: async () => "" }, block,
      undefined, { pilotRun: true },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.duration).toBe(10);
    expect(requests[0]?.body.prompt).not.toMatch(/后段石桥断裂|12[–—-]30/);
    expect(requests[0]?.body.prompt).toContain("6–10s：人物停步");
    expect(requests[0]?.body).not.toHaveProperty("pilotRun");
    expect(JSON.stringify(block)).toBe(before);
  });

  it("正式生成保持原 30 秒和独立秒级分镜，不被试片编译改短", async () => {
    const block = {
      ...pilotBlock("seedance-2.5"), prompt: originalPrompt,
      seedance25TimestampStoryboard: "12–30s：后段石桥断裂。",
    };
    const before = JSON.stringify(block);
    await runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "" }, block);
    expect(requests[0]?.body.duration).toBe(30);
    expect(requests[0]?.body.prompt).toContain("后段石桥断裂");
    expect(JSON.stringify(block)).toBe(before);
  });

  it("没有可解析的时长标题时，试片的实际请求仍为 10 秒", async () => {
    await runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      { ...pilotBlock("wan-3.0"), prompt: "人物走进雨夜仓库，摄影机固定。" },
      undefined, { pilotRun: true },
    );
    expect(requests[0]?.body.duration).toBe(10);
  });

  it("实际编排核把试片约束传到最终请求，但保留节点中的独立分镜原稿", async () => {
    const block = {
      ...pilotBlock("seedance-2.5"),
      seedance25TimestampStoryboard: "0–6s：灯笼亮起。\n6–12s：人物停步。\n12–30s：后段石桥断裂。",
    };
    const keys = [1, 2, 3].map((shot) => ({
      ...defaultCanvasBlock("image", 0, shot * 100),
      id: `keyart-e01-s0${shot}-test`, episodeIndex: 1,
      status: "done" as const, prompt: `第${shot}镜`,
      outputUrl: `https://test.invalid/still${shot}.png`,
    }));
    const result = await runManhuaDramaFactoryPipeline({
      deps: { userRole: "admin", optimizeCopy: async () => "" },
      blocks: [...keys, block], edges: [], episodeIndex: 1,
      untilStage: "clip", forceFromStage: "clip", fragmentShotIndex: 1,
      targetBlockIds: [block.id], preservePreparedTargetBlocks: true,
      pilotRun: true, maxRetries: 0, ensureOptions: { videoModel: "seedance-2.5" },
    });
    expect(result.errors).toEqual([]);
    expect(result.completedIds).toEqual([block.id]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.duration).toBe(10);
    expect(requests[0]?.body.prompt).not.toContain("后段石桥断裂");
    expect(result.blocks.find((item) => item.id === block.id)?.seedance25TimestampStoryboard)
      .toBe(block.seedance25TimestampStoryboard);
  });

  it.each(["video_edit", "video_extend"] as const)("试片不能误用原片 %s 路径", async (mode) => {
    await expect(runCanvasBlock(
      { userRole: "admin", optimizeCopy: async () => "" },
      { ...pilotBlock("seedance-2.5"), seedance25WorkMode: mode, refVideoUrl: "https://test.invalid/source.mp4" },
      undefined, { pilotRun: true },
    )).rejects.toThrow("不能代替原片编辑或延长");
    expect(requests).toEqual([]);
  });
});
