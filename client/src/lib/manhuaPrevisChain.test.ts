import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./extractVideoFrames", () => ({
  extractVideoTailFramesFromUrl: vi.fn(async () => ({ frames: [] })),
  extractVideoFramesFromUrl: vi.fn(),
}));
vi.mock("./videoUpscaleApi", () => ({
  probeVideoDurationSec: vi.fn(async () => 10),
}));
vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
import {
  createManhuaPrevisStudio,
  formatPrevisMotionGuide,
} from "@shared/manhuaPrevis";
import {
  sanitizeManhuaCloudDraftBlock,
  serializeManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
  type ManhuaCloudDraftPayload,
} from "@shared/manhuaCloudDraft";
import { defaultCanvasBlock, normalizeCanvasBlock } from "./canvasTypes";
import { cloudDraftBlocksToCanvas } from "./manhuaCloudDraftSync";
import { runCanvasBlock } from "./canvasRunBlock";
import {
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  queuedManhuaClipBlocks,
  replaceManhuaEpisodeChain,
  spawnManhuaDramaStudio,
  stripManhuaFactoryCanvasArtifacts,
} from "./canvasDramaStudio";

const scopeId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const fresh = "https://test.invalid/previs-fresh.mp4";
function work() {
  const studio = createManhuaPrevisStudio(10, scopeId);
  studio.spec.actors[0].nameZh = "阿菁";
  studio.spec.actors[0].actions = [{ kind: "guard", startSec: 2, endSec: 6 }];
  studio.pending = {
    requestId,
    scopeId,
    clipId: "clip-e01-g01",
    spec: structuredClone(studio.spec),
  };
  studio.history.push({
    jobId: "prv_test",
    requestId,
    gcsUri: "gs://test-bucket/post-prod/1/previs.mp4",
    url: "https://test.invalid/previs.mp4",
    durationSec: 10,
    createdAt: "2026-09-11",
    spec: structuredClone(studio.spec),
  });
  return studio;
}
function adopted() {
  const previsStudio = work();
  const take = previsStudio.history[0];
  return {
    previsStudio,
    manhuaSegmentRefs: {
      previs: {
        url: take.url,
        gcsUri: take.gcsUri,
        durationSec: take.durationSec,
        updatedAt: take.createdAt,
        motionGuideZh: formatPrevisMotionGuide(take.spec),
      },
    },
  };
}
function prepare() {
  const spawned = spawnManhuaDramaStudio({
    topic: "雨夜守护",
    episodeIndex: 1,
    videoModel: "seedance-2.0-mini",
  });
  const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
  const outputText = Array.from(
    { length: 18 },
    (_, i) => `${i + 1}. 第 ${i + 1} 镜：墨屠护住阿菁`
  ).join("\n");
  const expanded = expandManhuaShotKeyartsAfterReverse(
    spawned.blocks.map(b =>
      b.id === reverse.id ? { ...b, status: "done" as const, outputText } : b
    ),
    spawned.edges,
    reverse.id
  );
  const ready = expanded.blocks.map(b =>
    b.id.startsWith("keyart-")
      ? {
          ...b,
          status: "done" as const,
          outputUrl: `https://test.invalid/${b.id}.jpg`,
        }
      : b
  );
  const result = ensureManhuaFragmentClips(ready, expanded.edges, 1, {
    videoModel: "seedance-2.0-mini",
  });
  return {
    ...result,
    reverseId: reverse.id,
    clipIds: queuedManhuaClipBlocks(result.blocks, 1, "seedance-2.0-mini").map(
      b => b.id
    ),
  };
}
let requests: Array<Record<string, unknown>>;
beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/google?op=materialReadUrl&gcsUri="))
        return new Response(JSON.stringify({ ok: true, url: fresh }));
      if (
        !["/api/jobs?op=seedanceI2V", "/api/jobs?op=wan30Video"].includes(
          url
        ) ||
        init?.method !== "POST"
      )
        throw new Error(`禁止真实网络：${url}`);
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          ok: true,
          videoUrl: "https://test.invalid/result.mp4",
        })
      );
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("动作白模草稿与最终消费闭环（离线）", () => {
  it("本机规范化与云往返保留原请求、原配置、候选及动作说明", () => {
    const block = normalizeCanvasBlock({
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01",
      ...adopted(),
    });
    const payload = {
      format: "mv-manhua-cloud-draft-v1",
      clientUpdatedAt: "2026-09-11",
      writerSession: {},
      canvas: { blocks: [sanitizeManhuaCloudDraftBlock(block)!], edges: [] },
    } as unknown as ManhuaCloudDraftPayload;
    const parsed = parseManhuaCloudDraftPayload(
      serializeManhuaCloudDraftPayload(payload)
    )!;
    const restored = cloudDraftBlocksToCanvas(parsed.canvas.blocks)[0];
    expect(restored.previsStudio).toEqual(block.previsStudio);
    expect(restored.manhuaSegmentRefs).toEqual(block.manhuaSegmentRefs);
    expect(restored.previsStudio?.pending?.requestId).toBe(requestId);
    expect(restored.manhuaSegmentRefs?.previs?.motionGuideZh).toContain(
      "2—6秒抬臂保护"
    );
  });
  it.each(["seedance-2.5", "seedance-2.0-mini", "wan-3.0"] as const)(
    "%s 最终出站请求同时包含非空视频与同一角色动作，不被提示词清洗吞掉",
    async videoModel => {
      const block = {
        ...defaultCanvasBlock("video", 0, 0),
        id: "clip-e01-g01",
        episodeIndex: 1,
        videoModel,
        refImageUrl: "https://test.invalid/keyart.png",
        prompt: "【第1段·10s】0–10s：阿菁护住墨屠。",
        ...adopted(),
      };
      await runCanvasBlock(
        {
          userId: "test-user",
          userRole: "admin",
          optimizeCopy: async () => "",
        },
        block
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].videoUrls).toEqual([fresh]);
      expect(String(requests[0].prompt)).toContain("白模角色1对应阿菁");
      expect(String(requests[0].prompt)).toContain("2—6秒抬臂保护");
    }
  );
  it("Wan 超过十五秒的生成白模明确拒绝，零成片提交", async () => {
    const state = adopted();
    state.manhuaSegmentRefs.previs.durationSec = 30;
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01",
      videoModel: "wan-3.0" as const,
      refImageUrl: "https://test.invalid/keyart.png",
      prompt: "0–10s：阿菁护住墨屠。",
      ...state,
    };
    await expect(
      runCanvasBlock(
        {
          userId: "test-user",
          userRole: "admin",
          optimizeCopy: async () => "",
        },
        block
      )
    ).rejects.toThrow(/白模/);
    expect(requests).toHaveLength(0);
  });
  it.each(["happyhorse-1.1", "minimax-hailuo-3"] as const)(
    "%s 不支持动作视频参考时明确拒绝，不静默丢掉已采用白模",
    async videoModel => {
      const block = {
        ...defaultCanvasBlock("video", 0, 0),
        id: "clip-e01-g01",
        videoModel,
        refImageUrl: "https://test.invalid/keyart.png",
        prompt: "0–10s：阿菁护住墨屠。",
        ...adopted(),
      };
      await expect(
        runCanvasBlock(
          {
            userId: "test-user",
            userRole: "admin",
            optimizeCopy: async () => "",
          },
          block
        )
      ).rejects.toThrow(/不支持动作白模/);
      expect(requests).toHaveLength(0);
    }
  );
  it("旧上传白模超过 Wan 上限仍沿用原行为，不新增拒绝", async () => {
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01",
      videoModel: "wan-3.0" as const,
      refImageUrl: "https://test.invalid/keyart.png",
      prompt: "0–10s：阿菁护住墨屠。",
      manhuaSegmentRefs: {
        previs: { url: fresh, durationSec: 30, updatedAt: "2026-09-11" },
      },
    };
    await runCanvasBlock(
      { userId: "test-user", userRole: "admin", optimizeCopy: async () => "" },
      block
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].videoUrls ?? []).toEqual([]);
    expect(String(requests[0].prompt)).not.toContain("白模动作");
  });
  it.each(["text_to_video", "image_to_video"] as const)(
    "显式 %s 模式拒绝已采用的生成白模，不发出说明与视频脱节的请求",
    async seedance25WorkMode => {
      const block = {
        ...defaultCanvasBlock("video", 0, 0),
        id: "clip-e01-g01",
        videoModel: "seedance-2.5" as const,
        seedance25WorkMode,
        refImageUrl: "https://test.invalid/keyart.png",
        prompt: "0–10s：阿菁护住墨屠。",
        ...adopted(),
      };
      await expect(
        runCanvasBlock(
          {
            userId: "test-user",
            userRole: "admin",
            optimizeCopy: async () => "",
          },
          block
        )
      ).rejects.toThrow(/白模|参考视频/);
      expect(requests).toHaveLength(0);
    }
  );
  it.each(["seedance-2.5", "wan-3.0"] as const)(
    "%s 十秒试片不注入生成白模，也不因旧三十秒参考拒绝",
    async videoModel => {
      const state = adopted();
      state.manhuaSegmentRefs.previs.durationSec = 30;
      const block = {
        ...defaultCanvasBlock("video", 0, 0),
        id: "clip-e01-g01",
        videoModel,
        refImageUrl: "https://test.invalid/keyart.png",
        prompt: "0–10s：阿菁护住墨屠。",
        ...state,
      };
      await runCanvasBlock(
        {
          userId: "test-user",
          userRole: "admin",
          optimizeCopy: async () => "",
        },
        block,
        undefined,
        { pilotRun: true }
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].videoUrls ?? []).toEqual([]);
      expect(String(requests[0].prompt)).not.toContain("白模角色1");
      expect(String(requests[0].prompt)).not.toContain("2—6秒抬臂保护");
    }
  );
  it("旧稿没有白模时不生成工作室，不注入动作说明或视频参考", async () => {
    const block = normalizeCanvasBlock({
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01",
      videoModel: "seedance-2.5",
      refImageUrl: "https://test.invalid/keyart.png",
      prompt: "0–10s：阿菁护住墨屠。",
    });
    expect(block.previsStudio).toBeUndefined();
    expect(sanitizeManhuaCloudDraftBlock(block)?.previsStudio).toBeUndefined();
    await runCanvasBlock(
      { userId: "test-user", userRole: "admin", optimizeCopy: async () => "" },
      block
    );
    expect(String(requests[0].prompt)).not.toContain("白模动作");
    expect(requests[0].videoUrls ?? []).toEqual([]);
  });
  it("补铺同修订保留本段工作，新段不克隆白模或采用项", () => {
    const initial = prepare();
    expect(initial.clipIds).toHaveLength(6);
    const [first, missing] = initial.clipIds;
    const state = adopted();
    const next = ensureManhuaFragmentClips(
      initial.blocks
        .filter(b => b.id !== missing)
        .map(b => (b.id === first ? { ...b, ...state } : b)),
      initial.edges,
      1,
      { videoModel: "seedance-2.0-mini" }
    );
    expect(next.blocks.find(b => b.id === first)).toMatchObject(state);
    const current = queuedManhuaClipBlocks(next.blocks, 1, "seedance-2.0-mini");
    expect(current).toHaveLength(6);
    expect(
      current
        .filter(b => b.id !== first)
        .every(b => !b.previsStudio && !b.manhuaSegmentRefs?.previs)
    ).toBe(true);
  });
  it.each(["改档", "改稿"])("%s 后旧白模和请求归档，新段不串用", mode => {
    const initial = prepare();
    const first = initial.clipIds[0];
    const state = adopted();
    const blocks = initial.blocks.map(b =>
      b.id === first
        ? { ...b, ...state }
        : mode === "改稿" && b.id === initial.reverseId
          ? {
              ...b,
              outputText: b.outputText!.replace(
                "墨屠护住阿菁",
                "墨屠转身走进雨里"
              ),
            }
          : b
    );
    const videoModel = mode === "改档" ? "seedance-2.5" : "seedance-2.0-mini";
    const next = ensureManhuaFragmentClips(blocks, initial.edges, 1, {
      videoModel,
    });
    expect(next.blocks.find(b => b.id === first)).toMatchObject({
      ...state,
      archivedFromPreviousScript: true,
    });
    const active = queuedManhuaClipBlocks(next.blocks, 1, videoModel);
    expect(active.length).toBeGreaterThan(0);
    expect(
      active.every(b => !b.previsStudio && !b.manhuaSegmentRefs?.previs)
    ).toBe(true);
  });
  it("换稿清链保留未生成的编辑配置和独立上传参考", () => {
    const state = adopted();
    const blocks = [
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "clip-e01-g01",
        previsStudio: work(),
      },
      {
        ...defaultCanvasBlock("video", 0, 0),
        id: "clip-e01-g02",
        manhuaSegmentRefs: state.manhuaSegmentRefs,
      },
      { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g03" },
    ];
    const next = stripManhuaFactoryCanvasArtifacts(blocks, []);
    expect(next.archivedCount).toBe(2);
    expect(next.removedCount).toBe(1);
    expect(next.blocks.find(b => b.id === blocks[0].id)?.previsStudio).toEqual(
      blocks[0].previsStudio
    );
    expect(
      next.blocks.find(b => b.id === blocks[1].id)?.manhuaSegmentRefs
    ).toEqual(state.manhuaSegmentRefs);
  });
  it("整集重铺同名节点时旧白模另行归档，不覆盖新节点或保留旧连线", () => {
    const initial = prepare();
    const first = initial.clipIds[0];
    const state = adopted();
    const staged = initial.blocks.map(b =>
      b.id === first ? { ...b, ...state } : b
    );
    const spawned = spawnManhuaDramaStudio({
      topic: "新故事",
      episodeIndex: 1,
    });
    const replacement = {
      ...defaultCanvasBlock("video", 0, 0),
      id: first,
      episodeIndex: 1,
    };
    const result = replaceManhuaEpisodeChain(
      staged,
      initial.edges,
      { ...spawned, blocks: [...spawned.blocks, replacement] },
      1
    );
    const archived = result.blocks.find(
      b => b.previsStudio?.scopeId === scopeId
    );
    expect(archived).toMatchObject({
      ...state,
      archivedFromPreviousScript: true,
    });
    expect(archived?.id).not.toBe(first);
    expect(archived?.parentId).toBeUndefined();
    expect(
      result.blocks.find(b => b.id === first)?.previsStudio
    ).toBeUndefined();
    expect(
      result.blocks.find(b => b.id === first)?.manhuaSegmentRefs?.previs
    ).toBeUndefined();
    expect(
      result.edges.some(
        e => e.fromId === archived?.id || e.toId === archived?.id
      )
    ).toBe(false);
  });
});
