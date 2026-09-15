/**
 * 生成意图：复用、冲突、归属、持久化阻断。
 *
 * 对齐 0915 D 施工第二步与审查四条修正。本文件只覆盖**纯模块这一层**；
 * 「一次扣费 / 一个任务 / 一次上游提交」的真实调用次数属于服务端合同，
 * 由另一批测试用真实原子合同验证——**不在这里用 spy 计数冒充**。
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_GENERATION_INTENT_LS_KEY,
  CANVAS_INTENT_MAX_PER_BLOCK,
  CanvasIntentPersistError,
  EMPTY_CANVAS_INTENT_STORE,
  findConflictingCanvasIntent,
  findReusableCanvasIntent,
  isSameCanvasIntentOwner,
  listActiveCanvasIntents,
  loadCanvasIntentStore,
  newCanvasIntentId,
  persistCanvasIntent,
  resolveCanvasIntentForRun,
  upsertCanvasIntent,
  type CanvasGenerationIntent,
  type CanvasIntentOwner,
  type CanvasIntentStorageLike,
} from "./canvasGenerationIntent";

const OWNER: CanvasIntentOwner = { userId: "7", workspaceId: "ws-1", blockId: "clip-e1-s1" };
const OTHER_USER: CanvasIntentOwner = { ...OWNER, userId: "8" };
const DIGEST = "sha-aaa";

function intent(over: Partial<CanvasGenerationIntent> = {}): CanvasGenerationIntent {
  return {
    intentId: "gi_clip-e1-s1_aaaaaaaaaaaaaaaaaaaa",
    owner: OWNER,
    requestDigest: DIGEST,
    status: "submitted",
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

/** 可注入失败的内存存储桩 */
function memStorage(opts?: { failWrite?: boolean; swallowWrite?: boolean; failRead?: boolean }) {
  const map = new Map<string, string>();
  const api: CanvasIntentStorageLike & { raw: Map<string, string> } = {
    raw: map,
    getItem(k) {
      if (opts?.failRead) throw new Error("storage disabled");
      return map.get(k) ?? null;
    },
    setItem(k, v) {
      if (opts?.failWrite) throw new Error("QuotaExceededError");
      // swallowWrite：不抛错但也不真写——隐私模式/配额边界的静默失败
      if (opts?.swallowWrite) return;
      map.set(k, v);
    },
  };
  return api;
}

describe("意图与确认是两件事", () => {
  it("意图归属不含 epoch——否则刷新后 epoch 一变就永远对不上", () => {
    expect(Object.keys(OWNER).sort()).toEqual(["blockId", "userId", "workspaceId"]);
  });

  it("意图对象里不存确认指纹，无法被拿来给新提交盖章", () => {
    const it0 = intent();
    expect(it0).not.toHaveProperty("fingerprint");
    expect(it0).not.toHaveProperty("confirmation");
  });

  it("新意图 ID 每次不同，且带节点标识便于排查", () => {
    const a = newCanvasIntentId("clip-e1-s1");
    const b = newCanvasIntentId("clip-e1-s1");
    expect(a).not.toBe(b);
    expect(a.startsWith("gi_clip-e1-s1_")).toBe(true);
  });
});

describe("复用：重试 / 刷新恢复不另起一单", () => {
  it("同归属同摘要的在途意图会被复用", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent());
    const got = resolveCanvasIntentForRun({ store, owner: OWNER, requestDigest: DIGEST, now: 2000 });
    expect(got.reused).toBe(true);
    expect(got.intent.intentId).toBe(intent().intentId);
    expect(got.intent.updatedAt).toBe(2000);
  });

  it("**状态未知（unverified）也要复用**——问不出状态不等于失败", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent({ status: "unverified" }));
    expect(findReusableCanvasIntent(store, OWNER, DIGEST)?.status).toBe("unverified");
  });

  it("已结算的不复用——那一次结束了，再生成是新意图", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent({ status: "settled" }));
    expect(findReusableCanvasIntent(store, OWNER, DIGEST)).toBeNull();
    expect(resolveCanvasIntentForRun({ store, owner: OWNER, requestDigest: DIGEST, now: 1 }).reused).toBe(
      false,
    );
  });

  it("用户明确再次生成：同样的输入也开新意图，避免永久去重", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent());
    const got = resolveCanvasIntentForRun({
      store,
      owner: OWNER,
      requestDigest: DIGEST,
      now: 3000,
      forceNew: true,
    });
    expect(got.reused).toBe(false);
    expect(got.intent.intentId).not.toBe(intent().intentId);
  });
});

describe("归属：换账号不能捡别人的单", () => {
  it("同 blockId 但不同 userId → 不复用、查不到", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent());
    expect(findReusableCanvasIntent(store, OTHER_USER, DIGEST)).toBeNull();
    expect(listActiveCanvasIntents(store, OTHER_USER)).toEqual([]);
    expect(
      resolveCanvasIntentForRun({ store, owner: OTHER_USER, requestDigest: DIGEST, now: 1 }).reused,
    ).toBe(false);
  });

  it("换工作区也不复用", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent());
    const otherWs = { ...OWNER, workspaceId: "ws-2" };
    expect(findReusableCanvasIntent(store, otherWs, DIGEST)).toBeNull();
  });

  it("isSameCanvasIntentOwner 三项全等才算同一处", () => {
    expect(isSameCanvasIntentOwner(OWNER, { ...OWNER })).toBe(true);
    expect(isSameCanvasIntentOwner(OWNER, OTHER_USER)).toBe(false);
    expect(isSameCanvasIntentOwner(OWNER, { ...OWNER, blockId: "clip-e1-s2" })).toBe(false);
  });
});

describe("冲突：同意图换输入", () => {
  it("摘要不同不复用，并报出在途的那一条供早期提示", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent());
    const got = resolveCanvasIntentForRun({
      store,
      owner: OWNER,
      requestDigest: "sha-bbb",
      now: 4000,
    });
    expect(got.reused).toBe(false);
    expect(got.conflict?.requestDigest).toBe(DIGEST);
  });

  it("已结算的不算冲突——它不在途", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent({ status: "settled" }));
    expect(findConflictingCanvasIntent(store, OWNER, "sha-bbb")).toBeNull();
  });

  it("客户端冲突只是提示：模块不做拒绝，裁决留给服务端扣费前的原子占位", () => {
    const store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent());
    const got = resolveCanvasIntentForRun({ store, owner: OWNER, requestDigest: "sha-bbb", now: 1 });
    // 仍然返回了一个可用意图（由服务端裁决），而不是在客户端直接抛错
    expect(got.intent.requestDigest).toBe("sha-bbb");
    expect(got.conflict).not.toBeNull();
  });
});

describe("持久化：存不下必须在发送前阻断", () => {
  it("正常写入后能回读到", () => {
    const s = memStorage();
    const next = persistCanvasIntent(s, intent());
    expect(next.byBlock[OWNER.blockId]?.[0]?.intentId).toBe(intent().intentId);
    expect(loadCanvasIntentStore(s).byBlock[OWNER.blockId]).toHaveLength(1);
  });

  it("setItem 抛错 → CanvasIntentPersistError（调用方据此中止提交）", () => {
    const s = memStorage({ failWrite: true });
    expect(() => persistCanvasIntent(s, intent())).toThrow(CanvasIntentPersistError);
  });

  it("**静默失败**（不抛错但没写进去）也要被回读校验抓出来", () => {
    const s = memStorage({ swallowWrite: true });
    expect(() => persistCanvasIntent(s, intent())).toThrow(CanvasIntentPersistError);
  });

  it("读取失败也抛——读不到旧记录就无法保证不重复下单", () => {
    const s = memStorage({ failRead: true });
    expect(() => persistCanvasIntent(s, intent())).toThrow(CanvasIntentPersistError);
  });

  it("坏 JSON / 坏结构不炸，退回空 store（恢复线索丢了但不阻塞读取）", () => {
    const s = memStorage();
    s.raw.set(CANVAS_GENERATION_INTENT_LS_KEY, "{不是 json");
    expect(loadCanvasIntentStore(s)).toEqual(EMPTY_CANVAS_INTENT_STORE);
    s.raw.set(CANVAS_GENERATION_INTENT_LS_KEY, JSON.stringify({ format: "wrong", byBlock: {} }));
    expect(loadCanvasIntentStore(s)).toEqual(EMPTY_CANVAS_INTENT_STORE);
  });
});

describe("容量：在途的不能被挤掉", () => {
  it("超上限时优先丢已结算的，在途意图保留", () => {
    let store = EMPTY_CANVAS_INTENT_STORE;
    for (let i = 0; i < CANVAS_INTENT_MAX_PER_BLOCK; i += 1) {
      store = upsertCanvasIntent(
        store,
        intent({ intentId: `gi_settled_${i}`, status: "settled", requestDigest: `d${i}` }),
      );
    }
    store = upsertCanvasIntent(store, intent({ intentId: "gi_live", status: "submitted" }));
    const list = store.byBlock[OWNER.blockId]!;
    expect(list).toHaveLength(CANVAS_INTENT_MAX_PER_BLOCK);
    expect(list.some((x) => x.intentId === "gi_live")).toBe(true);
  });

  it("同 intentId 重复写入是更新不是追加", () => {
    let store = upsertCanvasIntent(EMPTY_CANVAS_INTENT_STORE, intent());
    store = upsertCanvasIntent(store, intent({ status: "acknowledged", taskId: "cv_1" }));
    const list = store.byBlock[OWNER.blockId]!;
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("acknowledged");
    expect(list[0]!.taskId).toBe("cv_1");
  });
});

describe("并发边界：本地存储只是恢复线索", () => {
  it("多标签竞争会后写覆盖先写——这是已知边界，由服务端兜底", () => {
    const shared = memStorage();
    // 两个「标签页」各自读到同一份空 store
    const a = loadCanvasIntentStore(shared);
    const b = loadCanvasIntentStore(shared);
    const fromA = upsertCanvasIntent(a, intent({ intentId: "gi_tab_a" }));
    const fromB = upsertCanvasIntent(b, intent({ intentId: "gi_tab_b" }));
    shared.setItem(CANVAS_GENERATION_INTENT_LS_KEY, JSON.stringify(fromA));
    shared.setItem(CANVAS_GENERATION_INTENT_LS_KEY, JSON.stringify(fromB));
    const final = loadCanvasIntentStore(shared);
    // 实测行为：后写者赢，A 的记录丢失。测试固定这一事实，避免有人误以为本地已防重。
    expect(final.byBlock[OWNER.blockId]?.map((x) => x.intentId)).toEqual(["gi_tab_b"]);
  });
});
