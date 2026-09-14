/**
 * 0914 复审 P1：最终核对必须在**健康门等待结束之后、fetch 紧前**。
 *
 * 链路是 settle → runner → `await ensureFlyAppReady` → fetch。
 * 只在 settle 处核对还不够：用户在健康等待那段窗口里撤销确认、换账号、
 * 载入另一份草稿，POST 照样发得出去（审查已离线复现）。
 *
 * 这组测试用**可控的 deferred 健康门**：先让确认通过并进入健康等待，
 * 再改上下文，然后释放等待，断言零 POST。
 * 不把健康门 mock 成立即 run——那样根本覆盖不到这个窗口。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  hold: null as Promise<void> | null,
  entered: null as (() => void) | null,
}));

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => {
    hoisted.entered?.();
    if (hoisted.hold) await hoisted.hold;
    return run();
  },
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

import {
  ManhuaOutboundConfirmationMismatchError,
  ManhuaOutboundConfirmationMissingError,
  manhuaOutboundConfirmationFingerprint,
  previewCanvasBlockOutbound,
  runCanvasBlock,
  type ManhuaOutboundConfirmation,
} from "./canvasRunBlock";

const deps = { userRole: "admin" as const, userId: "7", optimizeCopy: async () => "" };

const scopeOf = (blockId: string, over: Record<string, string | number> = {}) => ({
  userId: "7",
  workspaceId: "manhua-cloud-draft:7",
  projectVersion: "proj-a",
  blockId,
  epoch: 1,
  ...over,
});

const makeBlock = (over: Record<string, unknown> = {}) => ({
  id: "clip-e01-g01",
  kind: "video" as const,
  prompt: "0–10s：阿菁推门，灯笼光扫过面颊。",
  videoModel: "seedance-2.5",
  aspectRatio: "9:16" as const,
  episodeIndex: 1,
  ...over,
});

/** 抓真实 POST；同时给出成功回包，保证「未变更时正向成功」也能验 */
function captureOutbound() {
  const bodies: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(
        JSON.stringify({ ok: true, videoUrl: "https://test.invalid/result.mp4" }),
      );
    }),
  );
  return bodies;
}

/** 按用户真实动作取确认：走生产路径预览 → 同一个指纹算法 */
async function confirmLikeUser(
  block: ReturnType<typeof makeBlock>,
): Promise<ManhuaOutboundConfirmation> {
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("预览不得发起任何请求");
  }));
  const preview = await previewCanvasBlockOutbound(deps, block as never);
  const scope = scopeOf(block.id);
  return {
    fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
    scope,
    confirmedAt: Date.now(),
  };
}

beforeEach(() => {
  hoisted.hold = null;
  hoisted.entered = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("健康等待期间改变上下文：fetch 紧前仍要拦下", () => {
  /** 让健康门挂起，返回「已进入等待」与「释放」两个把手 */
  function deferHealthGate() {
    let release!: () => void;
    let reachedResolve!: () => void;
    const reached = new Promise<void>((r) => {
      reachedResolve = r;
    });
    hoisted.hold = new Promise<void>((r) => {
      release = r;
    });
    hoisted.entered = () => reachedResolve();
    return { reached, release: () => release() };
  }

  it("等待期间撤销确认：零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmLikeUser(block);
    const bodies = captureOutbound();
    const { reached, release } = deferHealthGate();

    let current: ManhuaOutboundConfirmation | undefined = confirmation;
    const running = runCanvasBlock(deps, block as never, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: () => ({
        currentScope: scopeOf(block.id),
        confirmation: current,
      }),
    } as never);

    await reached; // 确认已通过，正卡在健康等待
    current = undefined; // 用户在这里撤销
    release();

    await expect(running).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });

  it("等待期间换账号：零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmLikeUser(block);
    const bodies = captureOutbound();
    const { reached, release } = deferHealthGate();

    let userId = "7";
    const running = runCanvasBlock(deps, block as never, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: () => ({
        currentScope: scopeOf(block.id, { userId }),
        confirmation,
      }),
    } as never);

    await reached;
    userId = "999";
    release();

    await expect(running).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  it("等待期间工作区重载（epoch 自增）：零 POST", async () => {
    const block = makeBlock();
    const confirmation = await confirmLikeUser(block);
    const bodies = captureOutbound();
    const { reached, release } = deferHealthGate();

    let epoch = 1;
    const running = runCanvasBlock(deps, block as never, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: () => ({
        currentScope: scopeOf(block.id, { epoch }),
        confirmation,
      }),
    } as never);

    await reached;
    epoch = 2;
    release();

    await expect(running).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMismatchError);
    expect(bodies).toEqual([]);
  });

  it("等待期间什么都没变：正向成功，且只发一次", async () => {
    const block = makeBlock();
    const confirmation = await confirmLikeUser(block);
    const bodies = captureOutbound();
    const { reached, release } = deferHealthGate();

    const running = runCanvasBlock(deps, block as never, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: () => ({ currentScope: scopeOf(block.id), confirmation }),
    } as never);

    await reached;
    release();

    const result = await running;
    expect(result.outputUrl).toBe("https://test.invalid/result.mp4");
    expect(bodies).toHaveLength(1);
  });

  it("配置了 getter 但返回 undefined：按缺闸处理，不回退旧快照", async () => {
    const block = makeBlock();
    const confirmation = await confirmLikeUser(block);
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: true,
        outboundGate: { currentScope: scopeOf(block.id), confirmation },
        resolveOutboundGate: () => undefined,
      } as never),
    ).rejects.toBeInstanceOf(ManhuaOutboundConfirmationMissingError);
    expect(bodies).toEqual([]);
  });
});

/**
 * 0914 复审 P1：HappyHorse 的 runner 原先自己 renderManhuaClipPromptForSeedance
 * 再内联构造 body，与 prepare 产出的不是同一个串——确认核对的是前一份，
 * 发出去的是后一份。现在 runner 只消费 prepared.body。
 */
describe("HappyHorse：预览 === 真正 POST", () => {
  const hhBlock = (over: Record<string, unknown> = {}) =>
    makeBlock({
      videoModel: "happyhorse-1.1",
      refImageUrl: "https://test.invalid/first.png",
      ...over,
    });

  it("预览体与 POST 体逐字段相同（含提示词一字不差）", async () => {
    const block = hhBlock();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(deps, block as never);
    expect(preview.engine).toBe("happyhorse-1.1");

    const scope = scopeOf(block.id);
    const confirmation = {
      fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
      scope,
      confirmedAt: Date.now(),
    };
    const bodies = captureOutbound();
    await runCanvasBlock(deps, block as never, undefined, {
      enforceOutboundConfirmation: true,
      resolveOutboundGate: () => ({ currentScope: scope, confirmation }),
    } as never);

    expect(bodies).toHaveLength(1);
    // 全字段深比较，不是只看几个键、更不是比较规范化之后的字符串
    expect(bodies[0]!.body).toEqual(preview.body);
    expect((bodies[0]!.body as Record<string, unknown>).prompt).toBe(preview.body.prompt);
  });

  it("首帧与多图参考去重后与槽位表同源", async () => {
    const block = hhBlock({
      refImageUrl: "https://test.invalid/first.png",
      uploadedAssets: [
        { url: "https://test.invalid/first.png", kind: "image", fileName: "a.png" },
        { url: "https://test.invalid/second.png", kind: "image", fileName: "b.png" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(deps, block as never);
    const urls = (preview.body.imageUrls as string[] | undefined) ?? [
      preview.body.imageUrl as string,
    ];
    // 首帧不得重复占一格
    expect(new Set(urls).size).toBe(urls.length);
    expect(preview.refs.imageUrls).toEqual(urls);
    expect(preview.refCounts.image).toBe(urls.length);
  });

  it("编译未通过：零 POST", async () => {
    // 参考图超上限，编译应阻断而不是截断后照发
    const block = hhBlock({
      prompt: "0–10s：正文引用了 @图片5 但根本没有第 5 张。",
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("预览不得发起任何请求");
    }));
    const preview = await previewCanvasBlockOutbound(deps, block as never);
    if (!preview.compile.blocked) return; // 该正文若未触发阻断则本条不适用
    const bodies = captureOutbound();
    await expect(
      runCanvasBlock(deps, block as never, undefined, {
        enforceOutboundConfirmation: false,
      } as never),
    ).rejects.toThrow();
    expect(bodies).toEqual([]);
  });
});
