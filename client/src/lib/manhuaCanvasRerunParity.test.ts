/**
 * 0914 复审 P1：C 项验收要的是「**真实画布回调**跑出来的 POST」与
 * 工作台确认内容逐字段相同——不是两次预览互比。
 *
 * 上一轮我在测试里替画布补了工厂准备和 pilotRun，生产里根本没有这两步，
 * 等于什么都没证明。现在生产侧统一走 prepareManhuaClipRunInput，
 * 这组测试则**从 FreeformCanvas.tsx 源码抽出真实的 runBlock 回调**执行，
 * 拦 fetch 抓真正发出去的请求体。
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_o: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

import {
  manhuaOutboundConfirmationFingerprint,
  previewCanvasBlockOutbound,
  runCanvasBlock,
} from "./canvasRunBlock";
import {
  ensureManhuaFragmentClips,
  expandManhuaShotKeyartsAfterReverse,
  prepareManhuaFactoryClipInput,
  queuedManhuaClipBlocks,
  spawnManhuaDramaStudio,
} from "./canvasDramaStudio";
import { testOutboundScope } from "./__testutils__/manhuaOutboundGate";
import { recordManhuaKeyartLookOutput } from "@shared/manhuaKeyartLookState";
import type { CanvasBlock, CanvasEdge } from "./canvasTypes";

afterEach(() => vi.unstubAllGlobals());

/** 从真实源码里抽出 runBlock 回调，不复刻 */
function extractRunBlock(): string {
  const source = readFileSync(
    new URL("../components/canvas/FreeformCanvas.tsx", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "FreeformCanvas.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback = "";
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "runBlock" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      callback = node.initializer.arguments[0]!.getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!callback) throw new Error("未找到 FreeformCanvas 的真实 runBlock 回调");
  return ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const deps = {
  userRole: "admin" as const,
  userId: "test-user",
  optimizeCopy: async () => "",
};

/**
 * 真实工厂图：spawn → 扩展静帧 → 铺段。
 * 与 canvasFactoryPreviewParity.test.ts 用的是**同一份夹具口径**，
 * 关键静帧按产品方式标记「已按当前原镜与造型出过图」——
 * 准备器里那两道门禁是真实存在的，不能绕。
 */
function buildGraph() {
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
  return {
    blocks: laid.blocks as CanvasBlock[],
    edges: laid.edges as CanvasEdge[],
    clipIds,
  };
}

/** 生产唯一入口的**同一份实现**（OmniCanvas 里注入给画布的就是它） */
function makePrepareClipRun(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
  pilotRun: boolean,
) {
  return async (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId)!;
    const { preparedBlock, upstream } = await prepareManhuaFactoryClipInput({
      blocks, edges, blockId, fallbackBlock: block,
      stage: "clip", episodeIndex: 1, preparedVideoEdit: false,
    });
    return { preparedBlock, upstream, runOptions: { pilotRun } };
  };
}

const stripNonce = (body: Record<string, unknown>) => {
  const { idempotencyKey: _k, videoSubmissionKey: _s, ...rest } = body as Record<string, unknown>;
  return rest;
};

/** 执行真实 runBlock 所需的上下文；只有与本测试相关的才给真实实现 */
function makeContext(over: Record<string, unknown>) {
  const noop = () => {};
  return {
    Error, JSON, Set, Array, String, Boolean, Object, Promise, console,
    runCanvasBlock,
    canvasVideoTaskInputFingerprint: () => "fp",
    collectVisionImages: () => [],
    collectUpstreamTexts: () => [],
    collectDocumentAssets: () => [],
    loadCanvasDocumentTexts: async () => [],
    sanitizeManhuaRecapUpstreamLinks: (blocks: CanvasBlock[], edges: CanvasEdge[]) => ({ blocks, edges }),
    prepareProjectVideoReferences: async (b: CanvasBlock) => b,
    canSelectProjectVideoReferences: () => false,
    getBlockEpisodeIndex: () => 1,
    // 下面这些只在 clip 之外的分支或错误分支用到；
    // clip 路径的真实行为已由 prepareManhuaClipRun 接管，这里给最小桩。
    resolveNearestUpstreamImageUrl: () => undefined,
    resolveKeyartShotIndex: () => 1,
    resolveClipSegmentIndex: () => 1,
    resolvePreviousSegmentClipUrl: () => undefined,
    projectVideoReferenceFailurePatch: () => ({}),
    isCanvasUploadableFile: () => false,
    recordManhuaKeyartLookOutput: () => undefined,
    patchBlock: () => {},
    capManhuaMediaHistory: (x: unknown) => x,
    finishEditedMusicMvShot: () => ({}),
    rememberMusicMvOutput: () => ({}),
    mergeManhuaMediaVersions: (x: unknown) => x,
    applyManhuaRerunCompilePatch: (c: { prompt: string }) => ({ prompt: c.prompt }),
    toast: { error: noop, message: noop, success: noop },
    projectAssetRefs: [],
    compileManhuaRerun: undefined,
    referencePreparationRef: { current: new Set<string>() },
    setPreparingReferenceIds: noop,
    referenceMountedRef: { current: true },
    projectReferenceContextRef: { current: { userId: "test-user", refs: [], edges: [] } },
    blocksRef: { current: [] as CanvasBlock[] },
    onBlocksChange: noop,
    onEdgesChange: noop,
    patchOne: noop,
    patchMany: noop,
    MANHUA_CLIP_CONTINUITY_HINT_ZH: "【镜头连续性】",
    MANHUA_CLIP_CROSS_SEGMENT_TRANSITION_HINT_ZH: "【跨段转场】",
    ...over,
  };
}

describe("真实画布回调重跑：POST 必须与工作台确认逐字段相同", () => {
  async function workbenchConfirm(
    blocks: CanvasBlock[],
    edges: CanvasEdge[],
    blockId: string,
    pilotRun: boolean,
  ) {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const prep = await makePrepareClipRun(blocks, edges, pilotRun)(blockId);
    const preview = await previewCanvasBlockOutbound(
      deps, prep.preparedBlock, prep.upstream, prep.runOptions,
    );
    const scope = testOutboundScope(blockId);
    return {
      preview,
      scope,
      confirmation: {
        fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
        scope,
        confirmedAt: Date.now(),
      },
    };
  }

  function captureOutbound() {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : {});
      return new Response(
        JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }),
      );
    }));
    return bodies;
  }

  it.each([
    ["普通生成（试片已批准）", false],
    ["未批准试片：10 秒口径", true],
  ])("%s：真实画布 POST === 工作台确认的那一份", async (_label, pilotRun) => {
    const { blocks, edges, clipIds } = buildGraph();
    const blockId = clipIds[0]!;
    const { preview, scope, confirmation } = await workbenchConfirm(
      blocks, edges, blockId, pilotRun,
    );

    const bodies = captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks, edges,
      blocksRef: { current: blocks },
      prepareManhuaClipRun: makePrepareClipRun(blocks, edges, pilotRun),
      resolveManhuaOutboundGate: () => ({ currentScope: scope, confirmation }),
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;

    await run(blockId);

    expect(bodies, "真实画布回调没有发出请求").toHaveLength(1);
    expect(stripNonce(bodies[0]!)).toEqual(stripNonce(preview.body));
  });

  it("第二段（上段已出片 → 接力引用）：真实画布 POST === 工作台确认的那一份", async () => {
    // 这条才是有证明力的：准备器会给第二段补上一段末帧/成片引用与【连续】提示。
    // 画布若不走同一个准备入口，这些东西根本不会出现在它的请求里。
    const { blocks, edges, clipIds } = buildGraph();
    expect(clipIds.length).toBeGreaterThan(1);
    const prevId = clipIds[0]!;
    const blockId = clipIds[1]!;
    const withPrevDone = blocks.map((b) =>
      b.id === prevId
        ? ({
            ...b,
            status: "done" as const,
            outputUrl: "https://example.com/clip-1.mp4",
            outputUrls: ["https://example.com/clip-1.mp4"],
            lastFrameUrl: "https://example.com/clip-1-tail.png",
          } as CanvasBlock)
        : b,
    );

    const { preview, scope, confirmation } = await workbenchConfirm(
      withPrevDone, edges, blockId, false,
    );
    // 先确认准备器确实补了东西，否则这条测试同样没有证明力
    const refCount =
      preview.refs.imageUrls.length + preview.refs.videoUrls.length;
    expect(refCount).toBeGreaterThan(0);

    const bodies = captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks: withPrevDone, edges,
      blocksRef: { current: withPrevDone },
      prepareManhuaClipRun: makePrepareClipRun(withPrevDone, edges, false),
      resolveManhuaOutboundGate: () => ({ currentScope: scope, confirmation }),
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;
    await run(blockId);

    expect(bodies, "真实画布回调没有发出请求").toHaveLength(1);
    expect(stripNonce(bodies[0]!)).toEqual(stripNonce(preview.body));
  });

  it("保留旧确认、只换真实当前引擎：真实画布零 POST", async () => {
    const { blocks, edges, clipIds } = buildGraph();
    const blockId = clipIds[0]!;
    const { scope, confirmation } = await workbenchConfirm(blocks, edges, blockId, false);

    // 确认之后节点真的被改成另一个引擎
    const switched = blocks.map((b) =>
      b.id === blockId ? ({ ...b, videoModel: "seedance-2.5" } as CanvasBlock) : b,
    );
    const bodies = captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks: switched, edges,
      blocksRef: { current: switched },
      prepareManhuaClipRun: makePrepareClipRun(switched, edges, false),
      resolveManhuaOutboundGate: () => ({ currentScope: scope, confirmation }),
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;

    await run(blockId);
    expect(bodies).toEqual([]);
  });

  it("没接准备入口的画布：clip 直接拒绝，零 POST", async () => {
    const { blocks, edges, clipIds } = buildGraph();
    const blockId = clipIds[0]!;
    const bodies = captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks, edges,
      blocksRef: { current: blocks },
      prepareManhuaClipRun: undefined,
      resolveManhuaOutboundGate: undefined,
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;
    await run(blockId);
    expect(bodies).toEqual([]);
  });
});
