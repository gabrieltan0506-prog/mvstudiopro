import { readFileSync } from "node:fs";
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

import { extractVideoTailFramesFromUrl } from "./extractVideoFrames";
import { compileManhuaPilotPrompt } from "@shared/manhuaPilotGate";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { confirmClipLikeUser, gateFromConfirmations, testOutboundScope } from "./__testutils__/manhuaOutboundGate";
import { runManhuaDramaFactoryPipeline, spawnManhuaDramaStudio, expandManhuaShotKeyartsAfterReverse, ensureManhuaFragmentClips, resolveManhuaFragmentRunTargets } from "./canvasDramaStudio";
import { buildManhuaAssetLockRegistry, buildManhuaAssetPathById } from "@shared/manhuaAssetLockRegistry";
import { confirmManhuaSegmentLookBindingSource } from "@shared/manhuaCharacterLookSets";
import { recordManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";

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

/** 真实原稿编排后，明确声明夹具图片按当前原镜成功生成，不借旧图空状态绕过门禁。 */
function preparedPipelineFixture(storyboard: string) {
  const spawned = spawnManhuaDramaStudio({ topic: "雨夜仓库", episodeIndex: 1 });
  const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
  const source = spawned.blocks.map(b => b.id === reverse.id ? {
    ...b, status: "done" as const,
    outputText: "| 镜号 | 时长 | 运镜 | 画面 | 对白 | 情绪 |\n|---|---|---|---|---|---|\n|1|10秒|固定|人物走进仓库||警觉|\n|2|10秒|推近|人物抬头||警觉|\n|3|10秒|跟随|人物离开仓库||警觉|",
  } : b);
  const expanded = expandManhuaShotKeyartsAfterReverse(source, spawned.edges, reverse.id, { videoModel: "seedance-2.5" });
  const ready = expanded.blocks.map(b => b.id.startsWith("keyart-") ? {
    ...b, status: "done" as const, outputUrl: `https://test.invalid/${b.id}.png`,
    manhuaKeyartSourceState: recordManhuaKeyartLookOutput({ manhuaKeyartLookState: b.manhuaKeyartSourceState }, `https://test.invalid/${b.id}.png`),
  } : b);
  const clip = ready.find(b => b.manhuaAutoSegment?.segmentIndex === 1)!;
  const block = { ...clip, prompt: pilotBlock("seedance-2.5").prompt, seedance25TimestampStoryboard: storyboard };
  return { block, blocks: ready.map(b => b.id === block.id ? block : b), edges: expanded.edges };
}

describe("首段试片的实际出站载荷（仅虚构网络边界）", () => {
  it("动态接力尾帧只准备一次，变化的上传对象仍以同一最终载荷确认与提交", async () => {
    const tail = vi.mocked(extractVideoTailFramesFromUrl);
    tail.mockResolvedValue({ frames: Array.from({length: 4}, (_, i) => ({dataUrl: `data:image/jpeg;base64,${btoa(`frame-${i}`)}`, timestamp: i})), duration: 10 } as never);
    let uploaded = 0;
    let uploadsAtPost = 0;
    let authorizeCallsAtPost = 0;
    const authorize = vi.fn(async () => ({ projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex: 2, intent: "full" as const }));
    const block = { ...pilotBlock("seedance-2.5"), id: "clip-e01-g02", refVideoUrl: "https://test.invalid/prior.mp4" };
    const storageData = new Map<string,string>();
    const storage = {getItem: (k:string) => storageData.get(k) ?? null, setItem: (k:string,v:string) => { storageData.set(k,v); }};
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        uploadsAtPost = uploaded;
        authorizeCallsAtPost = authorize.mock.calls.length;
        const body = JSON.parse(String(init.body));
        expect(body.imageUrls.filter((u:string)=>u.includes("uploaded-tail"))).toEqual(["https://test.invalid/uploaded-tail-1.jpg"]);
        expect(body.imageUrl).toBe(body.imageUrls[0]);
        expect(body.imageUrls.at(-1)).toBe("https://test.invalid/uploaded-tail-1.jpg");
        expect(body.prompt).toContain(`@图片${body.imageUrls.length}承接上段起幅`);
        expect(body.idempotencyKey).toBe(body.intentId);
        expect(Array.from(storageData.values()).join("")).toContain(body.intentId);
        expect(Array.from(storageData.values()).join("")).toContain('"status":"submitted"');
      }
      return originalFetch(url,init);
    });
    try {
      await runCanvasBlock({userRole:"admin",userId:"test-user", optimizeCopy:async()=>"",authorizeManhuaClip:authorize,
        uploadImageFile:async()=>`https://test.invalid/uploaded-tail-${++uploaded}.jpg`, canvasIntentStorage:storage},block,undefined,{
        enforceOutboundConfirmation:true,resolveOutboundGate:()=>({currentScope:testOutboundScope(block.id),confirmOnGenerate:true}),
      });
      expect(requests).toHaveLength(1);
      expect(uploadsAtPost).toBe(4);
      expect(authorizeCallsAtPost).toBe(1);
    } finally { tail.mockResolvedValue({frames:[]} as never); }
  });

  it("刷新后无手动确认也可正式提交，旧确认不阻断本次输入", async () => {
    const block = pilotBlock("seedance-2.5");
    const authorize = vi.fn(async () => ({ projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex: 1, intent: "full" as const }));
    await runCanvasBlock({ userRole: "admin", userId: "test-user", optimizeCopy: async () => "", authorizeManhuaClip: authorize }, block, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: () => ({ currentScope: testOutboundScope(block.id), confirmOnGenerate: true }),
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].body.manhuaPilot).toMatchObject({ intent: "full" });
  });
  it("点击生成自动校验期间换项目仍零提交", async () => {
    const block = pilotBlock("seedance-2.5");
    let epoch = 1;
    const authorize = vi.fn(async () => { epoch = 2; return { projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex: 1, intent: "full" as const }; });
    await expect(runCanvasBlock({ userRole: "admin", userId: "test-user", optimizeCopy: async () => "", authorizeManhuaClip: authorize }, block, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: () => ({ currentScope: { ...testOutboundScope(block.id), epoch }, confirmOnGenerate: true }),
    })).rejects.toThrow(/重新载入|世代/);
    expect(requests).toHaveLength(0);
  });

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
    const revision = ensureManhuaFragmentClips(ready, expanded.edges, 1).blocks.find(b => b.manhuaAutoSegment?.segmentIndex === 1)!.manhuaAutoSegment!.revision;
    const segmentLookBindings = confirmManhuaSegmentLookBindingSource({ "e1:s1": { heiqi: "look-after" } }, 1, 1, revision);
    const ensured = ensureManhuaFragmentClips(ready, expanded.edges, 1, { customRefs, lookRefs, characterLookSets, segmentLookBindings });
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
      const pilotChanged = vi.fn();
      await runCanvasBlock(
        { userRole: "admin", userId: "test-user", optimizeCopy: async () => "", authorizeManhuaClip: authorize, onVideoTaskCreated: created, onManhuaPilotChanged: pilotChanged },
        pilotBlock(videoModel), undefined, { pilotRun: true, videoSubmissionKey: "test-explicit-submission" },
      );
      expect(authorize).toHaveBeenCalledWith({ episodeIndex: 1, segmentIndex: 1, videoModel, pilotRun: true, durationSec: 10 });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body.manhuaPilot).toEqual(await authorize.mock.results[0]?.value);
      expect(requests[0]?.body.idempotencyKey).toBe("test-explicit-submission");
      expect(created).not.toHaveBeenCalled();
      expect(pilotChanged).toHaveBeenCalled();
    },
  );

  it.each([[1,29],[3,23],[4,24]])("第%s段真实保存全文以%s秒正式意图编译，不被试片误拦", async (segmentIndex, durationSec) => {
    const prompt = readFileSync(new URL(`./__testutils__/fixtures/manhua-closure-1001/segment-${segmentIndex}.txt`, import.meta.url), "utf8");
    const authorize = vi.fn(async () => ({ projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex, intent: "full" as const }));
    const block = { ...pilotBlock("seedance-2.5"), id: `clip-e01-g0${segmentIndex}`, prompt };
    await runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "", authorizeManhuaClip: authorize }, block);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.duration).toBe(durationSec);
    expect(requests[0].body.manhuaPilot).toMatchObject({ intent: "full", segmentIndex });
    expect(String(requests[0].body.prompt).length).toBeGreaterThan(100);
    if (segmentIndex === 1) {
      expect(requests[0].body.prompt).toContain("就牵着这一匹破马，你有钱付诊金吗？小杂种，该不会是要拿它来抵药钱吧。");
      expect(requests[0].body.prompt).toContain("8–13s");
    }
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ pilotRun: false, durationSec }));
  });

  it("第三段待保存扶娘修订按23秒正式编译，保留四句原词与身份", async () => {
    const prompt = readFileSync(new URL("./__testutils__/fixtures/manhua-closure-1001/segment-3-reviewed.txt", import.meta.url), "utf8");
    const authorize = vi.fn(async () => ({ projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex: 3, intent: "full" as const }));
    await runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "", authorizeManhuaClip: authorize }, { ...pilotBlock("seedance-2.5"), id: "clip-e01-g03", prompt });
    expect(requests).toHaveLength(1);
    expect(requests[0].body.duration).toBe(23);
    const outbound = String(requests[0].body.prompt);
    expect(outbound).toContain("扶娘同行");
    expect(outbound).not.toContain("重新背稳娘");
    expect(outbound).not.toContain("娘趴阿菁肩上");
    for (const line of ["先送娘去治病，你到底还瞒了我多少秘密？", "好痛好痛，等等告诉你还不行吗？", "阿菁……那马……", "娘，先睡一会，等等就到医馆了。"]) expect(outbound).toContain(line);
    expect(requests[0].body.manhuaPilot).toMatchObject({ intent: "full", segmentIndex: 3 });
  });

  it("29秒正式稿保留8–13秒完整对白，不触发十秒试片裁切", async () => {
    const prompt = "【第1段·29s】\n0–8s：棕黑马右前蹄落地，左前腿悬空。\n8–13s：曹三说「你今日若不交出来，我便让你再也走不出这条街。」\n13–29s：人物回应并收招。";
    const authorize = vi.fn(async () => ({ projectVersion: "a".repeat(64), episodeIndex: 1, segmentIndex: 1, intent: "full" as const }));
    await runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "", authorizeManhuaClip: authorize }, { ...pilotBlock("seedance-2.5"), prompt });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ pilotRun: false, durationSec: 29 }));
    expect(requests).toHaveLength(1);
    expect(requests[0].body.duration).toBe(29);
    expect(requests[0].body.manhuaPilot).toMatchObject({ intent: "full" });
    expect(requests[0].body.prompt).toContain("你今日若不交出来");
    expect(requests[0].body.prompt).toContain("13–29s");
    expect(() => compileManhuaPilotPrompt(prompt, 10)).toThrow();
  });

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
    const { block, blocks, edges } = preparedPipelineFixture("0–30s：原稿保留。");
    const authorize = vi.fn(async () => { throw new Error("请先审阅并批准试片"); });
    const deps = { userRole: "admin" as const, userId: "test-user", optimizeCopy: async () => "", authorizeManhuaClip: authorize };
    // 门禁已启用：先按用户真实动作取得确认（共用准备 → 生产路径预览 → 同一指纹算法）。
    // 确认这一步不带这个必然抛错的 authorize——用户是先看内容再去过试片审核，
    // 本用例要验的是「审核失败就不提交」，不是让确认卡在审核上。
    const confirmation = await confirmClipLikeUser({
      deps: { userRole: "admin", userId: "test-user", optimizeCopy: async () => "" },
      blocks, edges, blockId: block.id,
    });
    const result = await runManhuaDramaFactoryPipeline({
      deps,
      blocks, edges, episodeIndex: 1, untilStage: "clip", forceFromStage: "clip",
      fragmentShotIndex: 1, targetBlockIds: [block.id], preservePreparedTargetBlocks: true, maxRetries: 0,
      ensureOptions: { videoModel: "seedance-2.5" },
      resolveOutboundGate: gateFromConfirmations({ [block.id]: confirmation }),
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
    const { block, blocks, edges } = preparedPipelineFixture("0–6s：灯笼亮起。\n6–12s：人物停步。\n12–30s：后段石桥断裂。");
    const deps = { userRole: "admin" as const, userId: "test-user", optimizeCopy: async () => "" };
    // 试片口径也必须一致：确认时就按 pilotRun 预览，否则指纹与真正提交对不上
    const confirmation = await confirmClipLikeUser({ deps, blocks, edges, blockId: block.id, pilotRun: true });
    const result = await runManhuaDramaFactoryPipeline({
      deps,
      blocks, edges, episodeIndex: 1,
      untilStage: "clip", forceFromStage: "clip", fragmentShotIndex: 1,
      targetBlockIds: [block.id], preservePreparedTargetBlocks: true,
      pilotRun: true, maxRetries: 0, ensureOptions: { videoModel: "seedance-2.5" },
      resolveOutboundGate: gateFromConfirmations({ [block.id]: confirmation }),
    });
    expect(result.errors).toEqual([]);
    expect(result.completedIds).toEqual([block.id]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body.duration).toBe(10);
    expect(requests[0]?.body.prompt).not.toContain("后段石桥断裂");
    expect(result.blocks.find((item) => item.id === block.id)?.seedance25TimestampStoryboard)
      .toBe(block.seedance25TimestampStoryboard);
  });

  it("显式 EvoLink 通道随正式请求发送，保留参考模式", async () => {
    await runCanvasBlock({ userRole: "admin", optimizeCopy: async () => "" },
      { ...pilotBlock("seedance-2.5"), seedance25Provider: "evolink" });
    expect(requests).toHaveLength(1);
    expect(requests[0].body.seedance25Provider).toBe("evolink");
    expect(requests[0].body.workMode).not.toBe("video_edit");
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


it("试片截断对白在鉴权建单和任何网络之前拒绝", async () => {
  const authorize = vi.fn();
  const block = { ...pilotBlock("seedance-2.5"), prompt: '0–8s：人物走入坊市。\n8–13s：@角色1说「娘，抓紧我，快到了。」' };
  const before = JSON.stringify(block);
  await expect(runCanvasBlock({ userRole: "admin", userId: "test-user", optimizeCopy: async () => "", authorizeManhuaClip: authorize }, block, undefined, { pilotRun: true })).rejects.toThrow(/选择正式完整段/);
  expect(authorize).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(block)).toBe(before);
});

 it("五秒试片鉴权与实际请求采用同一时长，原稿不变", async () => {
  const authorize = vi.fn(async () => ({ projectVersion: 'a'.repeat(64), episodeIndex: 1, segmentIndex: 1, intent: 'pilot' as const }));
  const block = { ...pilotBlock('seedance-2.5'), prompt: '【第1段·13s】坊市\n0–5s：娘说「阿菁……慢点，我喘不上来。」\n5–8s：阿菁说「抓紧我。」' };
  await runCanvasBlock({userRole:'admin',userId:'test-user',optimizeCopy:async()=>'',authorizeManhuaClip:authorize}, block, undefined, {pilotRun:true,pilotDurationSec:5});
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({durationSec:5}));
  expect(requests).toHaveLength(1);
  expect(requests[0].body.duration).toBe(5);
  expect(JSON.stringify(requests[0].body)).not.toContain('抓紧我');
  expect(block.prompt).toContain('抓紧我');
 });

 it("不支持五秒试片的模型在鉴权和网络之前提示换模型", async () => {
  const authorize = vi.fn();
  const block = pilotBlock("wan-3.0");
  await expect(runCanvasBlock(
    { userRole: "admin", userId: "test-user", optimizeCopy: async () => "", authorizeManhuaClip: authorize },
    block,
    undefined,
    { pilotRun: true, pilotDurationSec: 5 },
  )).rejects.toThrow("当前视频模型不支持5秒试片，请更换支持5秒试片的视频模型。");
  expect(authorize).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
 });

 it("五秒试片编排与确认预览使用相同时长", async () => {
  const {block,blocks,edges}=preparedPipelineFixture('0–30s：灯笼摇晃。');
  const authorize=vi.fn(async()=>({projectVersion:'a'.repeat(64),episodeIndex:1,segmentIndex:1,intent:'pilot' as const}));
  const deps={userRole:'admin' as const,userId:'test-user',optimizeCopy:async()=>'',authorizeManhuaClip:authorize};
  const confirmation=await confirmClipLikeUser({deps,blocks,edges,blockId:block.id,pilotRun:true,pilotDurationSec:5});
  const result=await runManhuaDramaFactoryPipeline({deps:{...deps,authorizeManhuaClip:authorize},blocks,edges,episodeIndex:1,untilStage:'clip',forceFromStage:'clip',fragmentShotIndex:1,targetBlockIds:[block.id],preservePreparedTargetBlocks:true,maxRetries:0,pilotRun:true,pilotDurationSec:5,ensureOptions:{videoModel:'seedance-2.5'},resolveOutboundGate:gateFromConfirmations({[block.id]:confirmation})});
  expect(result.errors).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(requests[0].body.duration).toBe(5);
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({durationSec:5}));
 });

 it.each([false,true])("试片只归审核记录，保留正片原稿和旧片且不注册节点恢复（失败=%s）", async failed => {
  const f=preparedPipelineFixture('0–30s：灯笼摇晃。');
  f.block.outputUrl='https://test.invalid/full-original.mp4'; f.block.lastFrameUrl='https://test.invalid/full-tail.png'; f.block.status='done';
  f.blocks=f.blocks.map(b=>b.id===f.block.id?f.block:b);
  const created=vi.fn(); const changed=vi.fn(); const intent=vi.fn();
  const deps={userRole:'admin' as const,userId:'test-user',optimizeCopy:async()=>'',onVideoTaskCreated:created,onManhuaPilotChanged:changed,onCanvasIntentChanged:intent};
  if(failed) vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('验收夹具：提交失败');}));
  const confirmation=await confirmClipLikeUser({deps,blocks:f.blocks,edges:f.edges,blockId:f.block.id,pilotRun:true,pilotDurationSec:5});
  const result=await runManhuaDramaFactoryPipeline({deps,blocks:f.blocks,edges:f.edges,episodeIndex:1,untilStage:'clip',forceFromStage:'clip',fragmentShotIndex:1,targetBlockIds:[f.block.id],preservePreparedTargetBlocks:true,maxRetries:0,pilotRun:true,pilotDurationSec:5,ensureOptions:{videoModel:'seedance-2.5'},resolveOutboundGate:gateFromConfirmations({[f.block.id]:confirmation})});
  expect(result.errors.length).toBe(failed?1:0);
  expect(requests).toHaveLength(failed?0:1);
  const saved=result.blocks.find(b=>b.id===f.block.id)!;
  expect(saved.prompt).toBe(f.block.prompt); expect(saved.outputUrl).toBe(f.block.outputUrl); expect(saved.lastFrameUrl).toBe(f.block.lastFrameUrl);
  expect(saved.videoTaskId).toBeUndefined(); expect(created).not.toHaveBeenCalled(); expect(intent).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalled();
 });
