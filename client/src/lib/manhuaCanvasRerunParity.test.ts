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

afterEach(() => {
  vi.unstubAllGlobals();
  runErrors.length = 0;
  genericRecompileCalls.length = 0;
});

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

/**
 * 与生产 `prepareManhuaClipRunInput` **同形**的实现：
 * 按操作类型分流——普通重生成才走通用重编译，编辑／延长不走；
 * 结果不写回 state，用就地替换的 blocks 传给准备器。
 */
function makePrepareClipRun(
  blocks: CanvasBlock[],
  edges: CanvasEdge[],
  pilotRun: boolean,
  compileRerun?: (b: CanvasBlock) => Promise<{ prompt: string } | null>,
) {
  return async (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId)!;
    const workMode = String(
      (block as Record<string, unknown>).seedance25WorkMode ?? "",
    ).trim();
    const isEdit = workMode === "video_edit";
    const isExtend = workMode === "video_extend";
    let sourceBlock = block;
    if (!isEdit && !isExtend && compileRerun) {
      const compiled = await compileRerun(block);
      if (compiled?.prompt?.trim()) {
        sourceBlock = { ...block, prompt: compiled.prompt } as CanvasBlock;
      }
    }
    const workingBlocks =
      sourceBlock === block
        ? blocks
        : blocks.map((b) => (b.id === blockId ? sourceBlock : b));
    const { preparedBlock, upstream } = await prepareManhuaFactoryClipInput({
      blocks: workingBlocks, edges, blockId, fallbackBlock: sourceBlock,
      stage: "clip", episodeIndex: 1, preparedVideoEdit: isEdit,
    });
    return {
      preparedBlock,
      upstream,
      runOptions: { pilotRun: !isEdit && !isExtend && pilotRun },
    };
  };
}

const stripNonce = (body: Record<string, unknown>) => {
  const { idempotencyKey: _k, videoSubmissionKey: _s, ...rest } = body as Record<string, unknown>;
  return rest;
};

/** 执行真实 runBlock 所需的上下文；只有与本测试相关的才给真实实现 */
/** 记录通用重编译被调到了哪些节点；clip 必须一个都不在里面 */
const genericRecompileCalls: string[] = [];
/** 真实回调把异常吞进 toast；测试要看得见，否则「零 POST」会掩盖别的错误 */
const runErrors: string[] = [];

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
    // 把真实异常原文透出来，不然「零 POST」会掩盖别的错误（复审点名）
    projectVideoReferenceFailurePatch: (opt: { error?: unknown }) => ({
      error: opt?.error instanceof Error ? opt.error.message : String(opt?.error ?? "未知错误"),
    }),
    isCanvasUploadableFile: () => false,
    recordManhuaKeyartLookOutput: () => undefined,
    patchBlock: () => {},
    capManhuaMediaHistory: (x: unknown) => x,
    finishEditedMusicMvShot: () => ({}),
    rememberMusicMvOutput: () => ({}),
    mergeManhuaMediaVersions: (x: unknown) => x,
    applyManhuaRerunCompilePatch: (c: { prompt: string }) => ({ prompt: c.prompt }),
    toast: {
      error: (msg: unknown, opt?: unknown) => {
        const text = `${String(msg)} ${JSON.stringify(opt ?? "")}`;
        console.error("[runBlock toast.error]", text);
        runErrors.push(text);
      },
      message: (msg: unknown) => runErrors.push(String(msg)),
      success: noop,
    },
    projectAssetRefs: [],
    // **不再设成 undefined**（复审点名）。这里给的是一个会把编辑操作清掉的
    // 重编译实现——生产里通用重编译正是这么干的。clip 必须在它之前分流，
    // 否则用户确认的「改这段原片」会被改写成「重新生成一段」。
    compileManhuaRerun: async (b: CanvasBlock) => {
      genericRecompileCalls.push(b.id);
      return {
        prompt: `${String(b.prompt || "")}\n[通用重编译改写过]`,
        beforePrompt: String(b.prompt || ""),
        afterPrompt: `${String(b.prompt || "")}\n[通用重编译改写过]`,
        stashOutputUrls: [],
        changed: true,
        videoRunPatch: {
          // 通用重编译会清掉编辑身份——这正是要防的
          seedance25WorkMode: undefined,
          seedance25RefVideoUrls: undefined,
          refVideoUrl: undefined,
        },
      };
    },
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
    // 生产用每次渲染刷新的 ref 读这两个回调（复审 P2），harness 照同一形状给
    prepareManhuaClipRunRef: { current: over.prepareManhuaClipRun },
    resolveManhuaOutboundGateRef: { current: over.resolveManhuaOutboundGate },
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

    expect(runErrors, "真实画布回调报错了").toEqual([]);
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

    expect(runErrors, "真实画布回调报错了").toEqual([]);
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
    // 不能只看零 POST：必须是**这个**原因拒的
    expect(runErrors.join("｜")).toMatch(
      /提示词、模型、时长或参考素材在确认之后发生了变化，本次未提交、未扣费/,
    );
    expect(bodies).toEqual([]);
  });

  it.each([
    ["原片编辑", "video_edit"],
    ["原片延长", "video_extend"],
  ])("%s：真实画布 POST 保住原片与指令，且 === 工作台确认的那一份", async (_label, mode) => {
    const { blocks, edges, clipIds } = buildGraph();
    const blockId = clipIds[0]!;
    const source = "https://example.com/original.mp4";
    const edited = blocks.map((b) =>
      b.id === blockId
        ? ({
            ...b,
            videoModel: "seedance-2.5",
            seedance25WorkMode: mode,
            seedance25RefVideoUrls: [source],
            refVideoUrl: source,
            prompt: `${b.prompt}\n【视频编辑指令】把第 3 秒的剑光调暗`,
          } as CanvasBlock)
        : b,
    );

    // 工作台确认：试片**未批准**，编辑／延长仍不得被套上 pilotRun
    const { preview, scope, confirmation } = await workbenchConfirm(
      edited, edges, blockId, true,
    );

    const bodies = captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks: edited, edges,
      blocksRef: { current: edited },
      prepareManhuaClipRun: makePrepareClipRun(edited, edges, true),
      resolveManhuaOutboundGate: () => ({ currentScope: scope, confirmation }),
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;
    await run(blockId);

    expect(runErrors, "真实画布回调报错了").toEqual([]);
    expect(bodies).toHaveLength(1);
    // clip 不得进通用重编译——那条路会把编辑身份清掉
    expect(genericRecompileCalls).toEqual([]);
    const body = bodies[0]! as Record<string, unknown>;
    expect(body.workMode).toBe(mode);
    expect(body.videoUrls).toEqual([source]);
    expect(String(body.prompt || "")).toContain("剑光调暗");
    expect(stripNonce(body)).toEqual(stripNonce(preview.body));
  });

  it("普通重生成：clip 仍不进通用重编译（重编译由统一入口内部按操作做）", async () => {
    const { blocks, edges, clipIds } = buildGraph();
    const blockId = clipIds[0]!;
    const { scope, confirmation } = await workbenchConfirm(blocks, edges, blockId, false);
    captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks, edges,
      blocksRef: { current: blocks },
      prepareManhuaClipRun: makePrepareClipRun(blocks, edges, false),
      resolveManhuaOutboundGate: () => ({ currentScope: scope, confirmation }),
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;
    await run(blockId);
    expect(genericRecompileCalls, "clip 不该走画布的通用重编译").toEqual([]);
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
    expect(runErrors.join("｜")).toMatch(
      /这个画布没有接入生成前确认，漫剧段成片不能从这里提交，本次未提交、未扣费/,
    );
    expect(bodies).toEqual([]);
  });

  it("保留旧确认、换到另一个账号：拒绝原因是身份不符，零 POST", async () => {
    const { blocks, edges, clipIds } = buildGraph();
    const blockId = clipIds[0]!;
    const { scope, confirmation } = await workbenchConfirm(blocks, edges, blockId, false);
    const bodies = captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks, edges,
      blocksRef: { current: blocks },
      prepareManhuaClipRun: makePrepareClipRun(blocks, edges, false),
      // 确认记录原样保留，只切当前账号
      resolveManhuaOutboundGate: () => ({
        currentScope: { ...scope, userId: "another-user" },
        confirmation,
      }),
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;
    await run(blockId);
    expect(runErrors.join("｜")).toMatch(/账号|项目|节点/);
    expect(bodies).toEqual([]);
  });

  it("工作区换代（epoch 自增）：拒绝原因是工作区被重新载入，零 POST", async () => {
    const { blocks, edges, clipIds } = buildGraph();
    const blockId = clipIds[0]!;
    const { scope, confirmation } = await workbenchConfirm(blocks, edges, blockId, false);
    const bodies = captureOutbound();
    const run = runInNewContext(extractRunBlock(), makeContext({
      blocks, edges,
      blocksRef: { current: blocks },
      prepareManhuaClipRun: makePrepareClipRun(blocks, edges, false),
      resolveManhuaOutboundGate: () => ({
        currentScope: { ...scope, epoch: Number(scope.epoch) + 1 },
        confirmation,
      }),
      runDepsWithPlan: deps,
      runDeps: deps,
    })) as (id: string) => Promise<void>;
    await run(blockId);
    expect(runErrors.join("｜")).toMatch(/工作区在你确认之后被重新载入过/);
    expect(bodies).toEqual([]);
  });
});
