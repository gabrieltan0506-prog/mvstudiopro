/**
 * D（0915）：批量依赖变化 → 暂停等新确认，不自动续发。
 *
 * 用户确认了第 1 段，编排器跑之前上游产物变了（确认指纹对不上）：
 * 该段不重试、不提交、不扣费；依赖它的下游段一并暂停；与它无关的段照旧。
 * 走真实 spawn → 扩展 → 铺段图与真实编排器，fetch 被拦。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  queuedManhuaClipBlocks,
  runManhuaDramaFactoryPipeline,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";
import { recordManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";
import { confirmClipLikeUser, gateFromConfirmations } from "./__testutils__/manhuaOutboundGate";
import type { ManhuaOutboundConfirmation } from "./canvasRunBlock";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const deps = { userRole: "admin" as const, optimizeCopy: async () => "", canvasIntentStorage: null };

function buildFactoryGraph() {
  const spawned = spawnManhuaDramaStudio({ topic: "雨夜守护", episodeIndex: 1, videoModel: "seedance-2.0-mini" });
  const reverse = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!;
  const outputText = Array.from({ length: 18 }, (_, i) => `${i + 1}. 第 ${i + 1} 镜：墨屠护住阿菁`).join("\n");
  const expanded = expandManhuaShotKeyartsAfterReverse(
    spawned.blocks.map((b) => (b.id === reverse.id ? { ...b, status: "done" as const, outputText } : b)),
    spawned.edges,
    reverse.id,
  );
  const ready = expanded.blocks.map((b) => {
    if (!b.id.startsWith("keyart-")) return b;
    const outputUrl = `https://example.com/${b.id}.jpg`;
    return {
      ...b,
      status: "done" as const,
      outputUrl,
      manhuaKeyartLookState: recordManhuaKeyartLookOutput(b, outputUrl),
      manhuaKeyartSourceState: recordManhuaKeyartLookOutput({ manhuaKeyartLookState: b.manhuaKeyartSourceState }, outputUrl),
    };
  });
  const laid = ensureManhuaFragmentClips(ready, expanded.edges, 1, { videoModel: "seedance-2.0-mini" });
  const clipIds = queuedManhuaClipBlocks(laid.blocks, 1, "seedance-2.0-mini").map((b) => b.id);
  return { blocks: laid.blocks, edges: laid.edges, clipIds };
}

function capturePosts() {
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("op=seedanceI2V") && init?.method === "POST") {
        posts.push(String(url));
        return new Response(JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }));
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
  return posts;
}

describe("批量：依赖变化 → 暂停等新确认", () => {
  it("确认后上游静帧换了图：该段零 POST、标待重新确认、进 awaitingConfirmationIds；下游依赖段暂停不跑", async () => {
    const { blocks, edges, clipIds } = buildFactoryGraph();
    expect(clipIds.length).toBeGreaterThan(2);
    const first = clipIds[0]!;
    const second = clipIds[1]!;
    // R1 1464-07：第 3 段不直接依赖第 1 段，但靠尾帧接力依赖第 2 段；第 2 段被暂停没出片，第 3 段也必须暂停
    const third = clipIds[2]!;
    // 段间没有显式边：第 2 段靠「上段尾帧接力」（默认开）依赖第 1 段。只跑这两段，避免把文本阶段带进来
    const edgesWithDep = edges;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("确认阶段不得联网"); }));
    // 用户按当时的图确认了第 1 段
    const confirmations: Record<string, ManhuaOutboundConfirmation> = {
      [first]: await confirmClipLikeUser({ deps, blocks, edges: edgesWithDep, blockId: first, episodeIndex: 1 }),
    };
    // 然后上游静帧被重出了：换掉第 1 段引用的关键静帧地址
    const upstreamKeyart = edgesWithDep
      .filter((e) => e.toId === first)
      .map((e) => e.fromId)
      .find((id) => id.startsWith("keyart-"));
    expect(upstreamKeyart).toBeTruthy();
    // 换图要按产品方式：outputUrl + 两道回执一起更新，否则触发的是「静帧未就绪」而不是确认失效
    const changed = blocks.map((b) => {
      if (b.id !== upstreamKeyart) return b;
      const v2 = `https://example.com/${b.id}-v2.jpg`;
      return {
        ...b,
        outputUrl: v2,
        outputUrls: [v2],
        manhuaKeyartLookState: recordManhuaKeyartLookOutput(b, v2),
        manhuaKeyartSourceState: recordManhuaKeyartLookOutput({ manhuaKeyartLookState: b.manhuaKeyartSourceState }, v2),
      };
    });

    const posts = capturePosts();
    const awaited: Array<{ id: string; reason: string; paused: string[] }> = [];
    const started: string[] = [];
    const skipped: string[] = [];
    const out = await runManhuaDramaFactoryPipeline({
      deps,
      blocks: changed,
      edges: edgesWithDep,
      episodeIndex: 1,
      untilStage: "clip",
      forceFromStage: "clip",
      targetBlockIds: [first, second, third],
      maxRetries: 2, // 有重试额度也不许重试确认失效
      ensureOptions: { videoModel: "seedance-2.0-mini" },
      resolveOutboundGate: gateFromConfirmations(confirmations),
      onAwaitConfirmation: (id, reason, paused) => awaited.push({ id, reason, paused }),
      onStageStart: (id) => started.push(id),
      onStageSkip: (id) => skipped.push(id),
    });

    // 第 1 段：没提交、没扣费、待重新确认
    expect(posts).toHaveLength(0);
    expect(out.awaitingConfirmationIds).toEqual([first]);
    expect(awaited).toHaveLength(1);
    expect(awaited[0]!.id).toBe(first);
    expect(awaited[0]!.reason).toMatch(/待重新确认/);
    expect(awaited[0]!.paused).toEqual([second]);
    const firstAfter = out.blocks.find((b) => b.id === first)!;
    expect(firstAfter.status).toBe("error");
    expect(firstAfter.error).toMatch(/待重新确认/);
    expect(out.completedIds).not.toContain(first);
    // 第 2 段：根本没开跑（不是跑了失败），记入暂停名单，节点上写明原因
    expect(out.pausedDownstreamIds).toEqual([second, third]);
    expect(started).not.toContain(second);
    expect(skipped).toContain(second);
    expect(out.completedIds).not.toContain(second);
    expect(out.blocks.find((b) => b.id === second)!.error).toMatch(/上游段待重新确认/);
    // 第 3 段：沿接力链传递暂停——不能拿第 2 段的旧尾帧接着发；仍然零 POST
    expect(started).not.toContain(third);
    expect(skipped).toContain(third);
    expect(out.completedIds).not.toContain(third);
    expect(out.blocks.find((b) => b.id === third)!.error).toMatch(/上游段待重新确认/);
    expect(posts).toHaveLength(0);
  }, 30_000);

  it("确认仍有效时照常提交：对照组，证明上一条不是被别的门挡住", async () => {
    const { blocks, edges, clipIds } = buildFactoryGraph();
    const first = clipIds[0]!;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("确认阶段不得联网"); }));
    const confirmations = { [first]: await confirmClipLikeUser({ deps, blocks, edges, blockId: first, episodeIndex: 1 }) };
    const posts = capturePosts();
    const out = await runManhuaDramaFactoryPipeline({
      deps, blocks, edges, episodeIndex: 1, untilStage: "clip", forceFromStage: "clip",
      targetBlockIds: [first], preservePreparedTargetBlocks: true, maxRetries: 0,
      ensureOptions: { videoModel: "seedance-2.0-mini" },
      resolveOutboundGate: gateFromConfirmations(confirmations),
    });
    expect(posts).toHaveLength(1);
    expect(out.completedIds).toContain(first);
    expect(out.awaitingConfirmationIds).toEqual([]);
    expect(out.pausedDownstreamIds).toEqual([]);
  }, 30_000);
});
