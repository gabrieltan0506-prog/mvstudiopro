import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  prepareManhuaFactoryClipInput,
  queuedManhuaClipBlocks,
  runManhuaDramaFactoryPipeline,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";
import { manhuaOutboundConfirmationFingerprint, previewCanvasBlockOutbound } from "./canvasRunBlock";
import { recordManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";
import { gateFromConfirmations, testOutboundScope } from "./__testutils__/manhuaOutboundGate";

/**
 * 审查 P1-4：预览必须和**经工厂编排后真正发出去的请求**一致。
 *
 * 运行时会在提交前给节点补东西：最近上游图覆盖首帧、上段末帧接力、
 * 段内关键静帧作多图参考、试片 10 秒约束。从裸节点算出的预览看不到这些，
 * 于是确认指纹和真实请求对不上。这组测试走**真实 spawn → 扩展 → 铺段**链路，
 * 直接比对两侧的请求体。
 */

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

const deps = { userRole: "admin" as const, optimizeCopy: async () => "" };

/** 造一张真实的漫剧图：反推 → 关键静帧 → 铺段 */
function buildFactoryGraph() {
  const spawned = spawnManhuaDramaStudio({
    topic: "雨夜守护",
    episodeIndex: 1,
    videoModel: "seedance-2.0-mini",
  });
  const reverse = spawned.blocks.find((b) => b.id.startsWith("reverse-"))!;
  const outputText = Array.from(
    { length: 18 },
    (_, i) => `${i + 1}. 第 ${i + 1} 镜：墨屠护住阿菁`,
  ).join("\n");
  const expanded = expandManhuaShotKeyartsAfterReverse(
    spawned.blocks.map((b) =>
      b.id === reverse.id ? { ...b, status: "done" as const, outputText } : b,
    ),
    spawned.edges,
    reverse.id,
  );
  // 关键静帧要按产品的方式标记「已按当前原镜与造型出过图」，
  // 否则共用准备里的两道门禁会直接抛错（那两道门禁是真实存在的，不能绕）。
  const ready = expanded.blocks.map((b) => {
    if (!b.id.startsWith("keyart-")) return b;
    const outputUrl = `https://example.com/${b.id}.jpg`;
    return {
      ...b,
      status: "done" as const,
      outputUrl,
      manhuaKeyartLookState: recordManhuaKeyartLookOutput(b, outputUrl),
      manhuaKeyartSourceState: recordManhuaKeyartLookOutput(
        { manhuaKeyartLookState: b.manhuaKeyartSourceState },
        outputUrl,
      ),
    };
  });
  const laid = ensureManhuaFragmentClips(ready, expanded.edges, 1, {
    videoModel: "seedance-2.0-mini",
  });
  const clipIds = queuedManhuaClipBlocks(laid.blocks, 1, "seedance-2.0-mini").map((b) => b.id);
  return { blocks: laid.blocks, edges: laid.edges, clipIds };
}

/** 拦住真实 POST，把出站请求体抓出来；同时保证测试永不联网 */
function captureSeedancePosts() {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("op=seedanceI2V") && init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }),
        );
      }
      // 质检等其它调用放行成空回执，不让它们把测试带偏
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
  return bodies;
}

const stripNonce = (body: Record<string, unknown>) => {
  const { idempotencyKey: _k, ...rest } = body;
  return rest;
};

describe("预览与真实工厂出站一致", () => {
  it("首段：共用工厂准备后，预览请求体与编排器真正 POST 的逐字段相同", async () => {
    const { blocks, edges, clipIds } = buildFactoryGraph();
    const blockId = clipIds[0]!;
    const block = blocks.find((b) => b.id === blockId)!;

    // 预览：走共用准备，且一次网络都不发
    const noNetwork = vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    });
    vi.stubGlobal("fetch", noNetwork);
    const { preparedBlock, upstream } = await prepareManhuaFactoryClipInput({
      blocks,
      edges,
      blockId,
      fallbackBlock: block,
      stage: "clip",
      episodeIndex: 1,
      preparedVideoEdit: false,
    });
    const preview = await previewCanvasBlockOutbound(deps, preparedBlock, upstream);
    expect(noNetwork).not.toHaveBeenCalled();

    // 拿这份**用户看到的**预览直接生成确认记录，再交给编排器。
    // 于是本用例同时证明两件事：预览体 === 真正 POST 体；
    // 且由预览得到的确认能通过生产门禁（门禁已启用，没有确认这里会零 POST）。
    const scope = testOutboundScope(blockId);
    const confirmation = {
      fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
      scope,
      confirmedAt: Date.now(),
    };

    // 实跑：经真实编排器
    const bodies = captureSeedancePosts();
    await runManhuaDramaFactoryPipeline({
      deps,
      blocks,
      edges,
      episodeIndex: 1,
      untilStage: "clip",
      forceFromStage: "clip",
      targetBlockIds: [blockId],
      preservePreparedTargetBlocks: true,
      maxRetries: 0,
      ensureOptions: { videoModel: "seedance-2.0-mini" },
      resolveOutboundGate: gateFromConfirmations({ [blockId]: confirmation }),
    });

    expect(bodies).toHaveLength(1);
    expect(stripNonce(preview.body)).toEqual(stripNonce(bodies[0]!));
  });

  it("共用准备把段内关键静帧带进首帧与多图参考，预览因此看得到它们", async () => {
    const { blocks, edges, clipIds } = buildFactoryGraph();
    const blockId = clipIds[0]!;
    const block = blocks.find((b) => b.id === blockId)!;
    const { preparedBlock } = await prepareManhuaFactoryClipInput({
      blocks,
      edges,
      blockId,
      fallbackBlock: block,
      stage: "clip",
      episodeIndex: 1,
      preparedVideoEdit: false,
    });
    // 准备之后节点确实带着段内关键静帧作参考。
    // 注意：本夹具里铺段时已把首帧设好，所以这一格不一定变——真正要保证的是
    // 「预览拿到的就是提交前那一份」，由上一条逐字段对照钉住。
    expect(String(preparedBlock.refImageUrl || "")).toContain("keyart-");
    expect(preparedBlock.id).toBe(block.id);
  });

  it("准备函数不修改传入的 blocks（无副作用）", async () => {
    const { blocks, edges, clipIds } = buildFactoryGraph();
    const before = JSON.stringify(blocks);
    const blockId = clipIds[0]!;
    await prepareManhuaFactoryClipInput({
      blocks,
      edges,
      blockId,
      fallbackBlock: blocks.find((b) => b.id === blockId)!,
      stage: "clip",
      episodeIndex: 1,
      preparedVideoEdit: false,
    });
    expect(JSON.stringify(blocks)).toBe(before);
  });
});
