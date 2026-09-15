/**
 * D（0915）：客户端生成意图——发送前落盘、意图 ID 即提交键、重试复用、202 恢复。
 *
 * 全部离线：fetch 被拦，健康门被短路。存储用内存 Map，不碰 localStorage。
 * 这里证明的是客户端合同；服务端裁决另见 server/services/canvasGenerationIntent.test.ts。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import {
  manhuaOutboundConfirmationFingerprint,
  previewCanvasBlockOutbound,
  runCanvasBlock,
} from "./canvasRunBlock";
import {
  CANVAS_GENERATION_INTENT_LS_KEY,
  CanvasIntentPersistError,
  canvasIntentDigestFromOutboundFingerprint,
  parseCanvasIntentStore,
  type CanvasIntentStorageLike,
} from "./canvasGenerationIntent";

vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 内存存储：可注入写失败 */
function memoryStorage(opts?: { failSet?: boolean }): CanvasIntentStorageLike & { dump: () => Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (opts?.failSet) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    dump: () => Object.fromEntries(m),
  };
}

const SCOPE: { userId: string; workspaceId: string; projectVersion: string; blockId: string; epoch: number } = {
  userId: "7",
  workspaceId: "manhua-cloud-draft:7",
  projectVersion: "proj-a",
  blockId: "clip-e01-g01",
  epoch: 1,
};

function makeBlock(over: Record<string, unknown> = {}) {
  return {
    ...defaultCanvasBlock("video", 0, 0),
    id: "clip-e01-g01",
    videoModel: "seedance-2.5" as const,
    prompt: "【第1段·10s】0–10s：阿菁在甲板上拔剑格挡，刃口相接后半步卸力。@图片1提供人物身份。",
    refImageUrl: "https://test.invalid/identity.png",
    ...over,
  };
}

/** 先预览拿指纹造确认，再给一份能抓 POST 的 fetch */
async function confirmedGate(block: ReturnType<typeof makeBlock>, scope = SCOPE) {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("预览不得发起任何请求"); }));
  const preview = await previewCanvasBlockOutbound({ optimizeCopy: async () => "", userRole: "admin" }, block);
  const confirmation = {
    fingerprint: manhuaOutboundConfirmationFingerprint(preview, scope),
    scope,
    confirmedAt: Date.now(),
  };
  return { currentScope: scope, confirmation };
}

type Captured = { url: string; init?: RequestInit; body?: Record<string, unknown> };

function stubFetch(handler: (c: Captured, n: number) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Captured = { url: String(url), init };
      if (init?.body) c.body = JSON.parse(String(init.body));
      calls.push(c);
      return handler(c, calls.length);
    }),
  );
  return calls;
}

const ok = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status });

function intentsOf(storage: { dump: () => Record<string, string> }, blockId: string) {
  return parseCanvasIntentStore(storage.dump()[CANVAS_GENERATION_INTENT_LS_KEY]).byBlock[blockId] || [];
}

describe("意图摘要来自确认指纹，但不跟 epoch / projectVersion 走", () => {
  it("同请求换 epoch / projectVersion → 同摘要；换请求或换账号 → 不同摘要", () => {
    const fp = (over: Record<string, unknown>) =>
      JSON.stringify({ engine: "seedance-2.5", scope: { userId: "7", workspaceId: "w", projectVersion: "p1", blockId: "b", epoch: 1, ...over }, request: { prompt: "x" } });
    const base = canvasIntentDigestFromOutboundFingerprint(fp({}));
    expect(canvasIntentDigestFromOutboundFingerprint(fp({ epoch: 9 }))).toBe(base);
    expect(canvasIntentDigestFromOutboundFingerprint(fp({ projectVersion: "p2" }))).toBe(base);
    expect(canvasIntentDigestFromOutboundFingerprint(fp({ userId: "8" }))).not.toBe(base);
    const other = JSON.stringify({ engine: "seedance-2.5", scope: { userId: "7", workspaceId: "w", blockId: "b", epoch: 1 }, request: { prompt: "y" } });
    expect(canvasIntentDigestFromOutboundFingerprint(other)).not.toBe(base);
  });

  it("出站确认指纹不受 intentId / idempotencyKey 影响", () => {
    const scope = SCOPE;
    const a = manhuaOutboundConfirmationFingerprint({ engine: "seedance-2.5", body: { prompt: "p", idempotencyKey: "k1", intentId: "i1" } }, scope);
    const b = manhuaOutboundConfirmationFingerprint({ engine: "seedance-2.5", body: { prompt: "p", idempotencyKey: "k2", intentId: "i2" } }, scope);
    expect(a).toBe(b);
  });
});

describe("发送前落盘，意图 ID 即提交键", () => {
  it("POST 之前意图已在存储里且状态为 submitted；body 的 intentId === idempotencyKey === 存储里的 intentId", async () => {
    const block = makeBlock();
    const gate = await confirmedGate(block);
    const storage = memoryStorage();
    let seenAtPost: { intentId?: string; status?: string } = {};
    const calls = stubFetch((c) => {
      // fetch 时刻：存储里必须已经有这次意图，且已标「已发出」
      const [it] = intentsOf(storage, block.id);
      seenAtPost = { intentId: it?.intentId, status: it?.status };
      return ok({ ok: true, videoUrl: "https://test.invalid/r.mp4" });
    });
    await runCanvasBlock(
      { optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: storage },
      block, undefined,
      { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate } as never,
    );
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body!;
    expect(typeof body.intentId).toBe("string");
    expect(body.intentId).toBe(body.idempotencyKey);
    expect(seenAtPost.intentId).toBe(body.intentId);
    expect(seenAtPost.status).toBe("submitted");
    // 成功返回后结算
    expect(intentsOf(storage, block.id)[0]!.status).toBe("settled");
  });

  it("存储写不进去 → 抛 CanvasIntentPersistError，**零 POST**", async () => {
    const block = makeBlock();
    const gate = await confirmedGate(block);
    const calls = stubFetch(() => ok({ ok: true, videoUrl: "https://test.invalid/r.mp4" }));
    await expect(
      runCanvasBlock(
        { optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: memoryStorage({ failSet: true }) },
        block, undefined,
        { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate } as never,
      ),
    ).rejects.toBeInstanceOf(CanvasIntentPersistError);
    expect(calls).toHaveLength(0);
  });

  it("预览不创建意图", async () => {
    const block = makeBlock();
    const storage = memoryStorage();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("预览不得发起任何请求"); }));
    await previewCanvasBlockOutbound({ optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: storage }, block);
    expect(intentsOf(storage, block.id)).toHaveLength(0);
  });
});

describe("重试复用 / 明确再生成", () => {
  it("已发出后网络断（TypeError）→ 意图 unverified；同输入再跑复用**同一个** intentId，不另起一单", async () => {
    const block = makeBlock();
    const gate = await confirmedGate(block);
    const storage = memoryStorage();
    const deps = { optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: storage };
    const opts = { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate } as never;

    const first = stubFetch(() => { throw new TypeError("Failed to fetch"); });
    await expect(runCanvasBlock(deps, block, undefined, opts)).rejects.toThrow();
    expect(first).toHaveLength(1);
    const [afterFail] = intentsOf(storage, block.id);
    expect(afterFail!.status).toBe("unverified");

    const second = stubFetch(() => ok({ ok: true, videoUrl: "https://test.invalid/r.mp4" }));
    await runCanvasBlock(deps, block, undefined, opts);
    expect(second[0]!.body!.intentId).toBe(first[0]!.body!.intentId);
    expect(intentsOf(storage, block.id)).toHaveLength(1);
  });

  it("换了 epoch（刷新后重新确认）同输入再发，仍复用同一意图", async () => {
    const block = makeBlock();
    const storage = memoryStorage();
    const deps = { optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: storage };
    const gate1 = await confirmedGate(block, { ...SCOPE, epoch: 1 });
    const first = stubFetch(() => { throw new TypeError("Failed to fetch"); });
    await expect(runCanvasBlock(deps, block, undefined, { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate1 } as never)).rejects.toThrow();
    const gate2 = await confirmedGate(block, { ...SCOPE, epoch: 2 });
    const second = stubFetch(() => ok({ ok: true, videoUrl: "https://test.invalid/r.mp4" }));
    await runCanvasBlock(deps, block, undefined, { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate2 } as never);
    expect(second[0]!.body!.intentId).toBe(first[0]!.body!.intentId);
  });

  it("forceNewIntent：同输入也开新意图；旧的保留不被覆盖", async () => {
    const block = makeBlock();
    const gate = await confirmedGate(block);
    const storage = memoryStorage();
    const deps = { optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: storage };
    const first = stubFetch(() => { throw new TypeError("Failed to fetch"); });
    await expect(runCanvasBlock(deps, block, undefined, { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate } as never)).rejects.toThrow();
    const second = stubFetch(() => ok({ ok: true, videoUrl: "https://test.invalid/r.mp4" }));
    await runCanvasBlock(deps, block, undefined, { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate, forceNewIntent: true } as never);
    expect(second[0]!.body!.intentId).not.toBe(first[0]!.body!.intentId);
    expect(intentsOf(storage, block.id)).toHaveLength(2);
  });

  it("没发出去就失败（确认不符）→ 这次意图作废（settled），零 POST", async () => {
    const block = makeBlock();
    const gate = await confirmedGate(block);
    const storage = memoryStorage();
    const calls = stubFetch(() => ok({ ok: true, videoUrl: "https://test.invalid/r.mp4" }));
    // 确认的是这份，跑的却是改过提示词的那份 → 指纹不符，在健康门之前就拒
    await expect(
      runCanvasBlock(
        { optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: storage },
        makeBlock({ prompt: "【第1段·10s】0–10s：阿菁改为收剑后退。" }), undefined,
        { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate } as never,
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
    const list = intentsOf(storage, block.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("settled");
  });
});

describe("服务端 202 creating：按意图恢复，不当失败也不重发", () => {
  it("POST 202 → 轮询 canvasIntentStatus 拿到 taskId → 再走任务轮询；全程只有一次 POST", async () => {
    vi.stubGlobal("setTimeout", (fn: () => void) => { queueMicrotask(fn); return 0 as unknown as ReturnType<typeof setTimeout>; });
    const block = makeBlock();
    const gate = await confirmedGate(block);
    const storage = memoryStorage();
    let statusPolls = 0;
    const calls = stubFetch((c) => {
      if (c.init?.method === "POST") {
        return ok({ ok: true, async: true, pending: true, intentId: c.body!.intentId, status: "creating" }, 202);
      }
      if (c.url.includes("op=canvasIntentStatus")) {
        statusPolls += 1;
        return statusPolls < 2
          ? ok({ ok: false, code: "intent_unreadable", error: "读不出来" }, 503) // 503 不算失败，继续核实
          : ok({ ok: true, pending: false, intentId: "x", taskId: "cv_from_intent_01", status: "queued" });
      }
      if (c.url.includes("op=canvasVideoStatus")) {
        return ok({ ok: true, status: "succeeded", videoUrl: "https://test.invalid/done.mp4" });
      }
      throw new Error(`unexpected ${c.url}`);
    });
    const taskIds: string[] = [];
    const out = await runCanvasBlock(
      {
        optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: storage,
        onVideoTaskCreated: (_b, info) => { taskIds.push(info.taskId); },
      },
      block, undefined,
      { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate } as never,
    );
    expect(out.outputUrl).toBe("https://test.invalid/done.mp4");
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
    expect(taskIds).toEqual(["cv_from_intent_01"]);
    const [it] = intentsOf(storage, block.id);
    expect(it!.taskId).toBe("cv_from_intent_01");
    expect(it!.status).toBe("settled");
  });

  it("恢复时服务端说这次意图不存在 → 报错、不重发", async () => {
    vi.stubGlobal("setTimeout", (fn: () => void) => { queueMicrotask(fn); return 0 as unknown as ReturnType<typeof setTimeout>; });
    const block = makeBlock();
    const gate = await confirmedGate(block);
    const calls = stubFetch((c) => {
      if (c.init?.method === "POST") return ok({ ok: true, pending: true, intentId: c.body!.intentId }, 202);
      if (c.url.includes("op=canvasIntentStatus")) return ok({ ok: false, code: "intent_not_found" }, 404);
      throw new Error(`unexpected ${c.url}`);
    });
    await expect(
      runCanvasBlock(
        { optimizeCopy: async () => "", userRole: "admin", canvasIntentStorage: memoryStorage() },
        block, undefined,
        { enforceOutboundConfirmation: true, resolveOutboundGate: () => gate } as never,
      ),
    ).rejects.toThrow(/没有留下记录/);
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
  });
});
