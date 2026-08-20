import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasMediaOwnershipCacheForTests,
  extractCanvasMediaObjectPath,
  registerCanvasImageDeliveryOrThrow,
  registerCanvasMediaOwner,
  verifyCanvasMediaOwnership,
  type OwnerRecord,
  type OwnerStore,
} from "./canvasMediaOwnership";

const OBJ_A = "generated/canvas-gpt-image2/111_aa.png";
const OBJ_VICTIM = "generated/canvas-gpt-image2/victim_known.png";

/** 模拟原子 createIfAbsent 的内存店:同一路径只有第一笔写入成功 */
function memStore(): OwnerStore & { map: Map<string, OwnerRecord>; failGetWith?: Error } {
  const map = new Map<string, OwnerRecord>();
  const store: OwnerStore & { map: Map<string, OwnerRecord>; failGetWith?: Error } = {
    map,
    async get(p) {
      if (store.failGetWith) throw store.failGetWith;
      return map.get(p) || null;
    },
    async createIfAbsent(p, rec) {
      if (map.has(p)) return "exists";
      map.set(p, rec);
      return "created";
    },
  };
  return store;
}

describe("canvasMediaOwnership v3 · 原子权威登记簿(五审 P0-3)", () => {
  beforeEach(() => __resetCanvasMediaOwnershipCacheForTests());

  it("核心:草稿引用不构成所有权——他人对象无论怎么引用都拒绝,真主放行", async () => {
    const store = memStore();
    expect(await registerCanvasMediaOwner({ objectPath: OBJ_VICTIM, ownerUserId: 8, store })).toBe(
      "created",
    );
    expect(await verifyCanvasMediaOwnership(7, OBJ_VICTIM, { store, skipCache: true })).toBe(false);
    expect(await verifyCanvasMediaOwnership(8, OBJ_VICTIM, { store, skipCache: true })).toBe(true);
  });

  it("并发登记:两用户同时抢同一对象,只有一个 created,owner 永不被覆盖", async () => {
    const store = memStore();
    const [a, b] = await Promise.all([
      registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 7, store }),
      registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 8, store }),
    ]);
    const outcomes = [a, b].sort();
    expect(outcomes).toEqual(["conflict", "created"]);
    const winner = a === "created" ? 7 : 8;
    const loser = winner === 7 ? 8 : 7;
    expect(store.map.get(OBJ_A)?.ownerUserId).toBe(winner);
    expect(await verifyCanvasMediaOwnership(winner, OBJ_A, { store, skipCache: true })).toBe(true);
    expect(await verifyCanvasMediaOwnership(loser, OBJ_A, { store, skipCache: true })).toBe(false);
  });

  it("同主重复登记=alreadyOwned(幂等);后写冒领=conflict;无记录验证=拒绝", async () => {
    const store = memStore();
    expect(await verifyCanvasMediaOwnership(7, OBJ_A, { store, skipCache: true })).toBe(false);
    expect(await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 8, store })).toBe(
      "created",
    );
    expect(await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 8, store })).toBe(
      "alreadyOwned",
    );
    expect(await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 7, store })).toBe(
      "conflict",
    );
    expect(store.map.get(OBJ_A)?.ownerUserId).toBe(8);
  });

  it("存储故障(非 404)必须抛错,不许当'无记录'误判——register 与 verify 两端都拦", async () => {
    const store = memStore();
    await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 8, store });
    store.failGetWith = new Error("gcs_download_failed:503:upstream");
    // register 撞 exists 后要读回比对,读挂就抛,绝不下 conflict/alreadyOwned 结论
    await expect(
      registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 7, store }),
    ).rejects.toThrow(/503/);
    await expect(
      verifyCanvasMediaOwnership(8, OBJ_A, { store, skipCache: true }),
    ).rejects.toThrow(/503/);
  });

  it("负结果不缓存(五审 P1-2):首查无记录,另一实例登记后立刻放行,不用等 60s", async () => {
    const store = memStore();
    expect(await verifyCanvasMediaOwnership(7, OBJ_A, { store })).toBe(false);
    await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 7, store });
    store.map.set(OBJ_A, { ownerUserId: 7 }); // 模拟登记发生在"另一实例"
    __resetCanvasMediaOwnershipCacheForTests(); // 本实例 register 会写正缓存,清掉以模拟纯跨实例
    expect(await verifyCanvasMediaOwnership(7, OBJ_A, { store })).toBe(true);
  });

  it("路径穿越/非法前缀/非图片后缀:invalid,登记与验证两端都拦", async () => {
    const store = memStore();
    expect(
      await registerCanvasMediaOwner({ objectPath: "generated/a/../b.png", ownerUserId: 7, store }),
    ).toBe("invalid");
    expect(await verifyCanvasMediaOwnership(7, "generated/a/../b.png", { store })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, "blog-media/x.png", { store })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, "generated/a/b.mp4", { store })).toBe(false);
  });

  it("交付登记契约(五审 P0-1/P1-1):成功登记放行;冲突抛错;非本站 URL 跳过;/generated/ 提取失败抛错", async () => {
    const store = memStore();
    expect(
      await registerCanvasImageDeliveryOrThrow({
        imageUrl: `/api/canvas-media/${OBJ_A}`,
        ownerUserId: 7,
        store,
      }),
    ).toBe("created");
    expect(store.map.get(OBJ_A)?.ownerUserId).toBe(7);
    // 他人已在册:必须抛错,调用方不得报 succeeded
    await expect(
      registerCanvasImageDeliveryOrThrow({
        imageUrl: `https://storage.googleapis.com/bkt/${OBJ_A}`,
        ownerUserId: 8,
        store,
      }),
    ).rejects.toThrow(/conflict/);
    // 外部存储(无 /generated/):不属于受保护路由,跳过登记不阻断
    expect(
      await registerCanvasImageDeliveryOrThrow({
        imageUrl: "https://cdn.example.com/foo/bar.png",
        ownerUserId: 7,
        store,
      }),
    ).toBe("skipped");
    // 明显是本站受保护对象却提取不出:异常,不许静默交付断链半成品
    await expect(
      registerCanvasImageDeliveryOrThrow({
        imageUrl: "https://storage.googleapis.com/bkt/generated/a b/坏 路径.png",
        ownerUserId: 7,
        store,
      }),
    ).rejects.toThrow(/extract_failed/);
  });

  it("对象路径提取:签名链/稳定链/裸路径三种形态,穿越拒绝", () => {
    expect(extractCanvasMediaObjectPath(`/api/canvas-media/${OBJ_A}`)).toBe(OBJ_A);
    expect(extractCanvasMediaObjectPath(`https://storage.googleapis.com/bkt/${OBJ_A}?X-Goog=1`)).toBe(
      OBJ_A,
    );
    expect(extractCanvasMediaObjectPath(OBJ_A)).toBe(OBJ_A);
    expect(extractCanvasMediaObjectPath("/api/canvas-media/generated/a/../b.png")).toBe(null);
  });
});
