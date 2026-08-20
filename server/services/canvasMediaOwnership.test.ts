import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasMediaOwnershipCacheForTests,
  backfillCanvasMediaOwnersFromDraft,
  extractCanvasMediaObjectPath,
  registerCanvasMediaOwner,
  verifyCanvasMediaOwnership,
  type OwnerStore,
} from "./canvasMediaOwnership";

const OBJ_A = "generated/canvas-gpt-image2/111_aa.png";
const OBJ_VICTIM = "generated/canvas-gpt-image2/victim_known.png";

function memStore(): OwnerStore & { map: Map<string, { ownerUserId: number }> } {
  const map = new Map<string, { ownerUserId: number }>();
  return {
    map,
    async get(p) {
      return map.get(p) || null;
    },
    async put(p, rec) {
      map.set(p, { ownerUserId: rec.ownerUserId });
    },
  };
}

describe("canvasMediaOwnership v2 · 权威登记簿(四审 P0-1)", () => {
  beforeEach(() => __resetCanvasMediaOwnershipCacheForTests());

  it("核心:把他人对象伪造写进自己草稿的 outputUrl,依然拒绝——草稿引用不构成所有权", async () => {
    const store = memStore();
    // 受害者 user 8 的对象由服务端交付时登记
    await registerCanvasMediaOwner({ objectPath: OBJ_VICTIM, ownerUserId: 8, store });
    // 攻击者 user 7 的"草稿"随便怎么写都与判定无关:verify 只看登记簿
    expect(await verifyCanvasMediaOwnership(7, OBJ_VICTIM, { store, skipCache: true })).toBe(false);
    // 真正的主人放行
    expect(await verifyCanvasMediaOwnership(8, OBJ_VICTIM, { store, skipCache: true })).toBe(true);
  });

  it("真实拥有(交付时登记)即放行——哪怕还没进过任何云草稿", async () => {
    const store = memStore();
    await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 7, source: "canvasgptimage2", store });
    expect(await verifyCanvasMediaOwnership(7, OBJ_A, { store, skipCache: true })).toBe(true);
  });

  it("无登记记录:一律拒绝;登记先到先得,后写冒领无效", async () => {
    const store = memStore();
    expect(await verifyCanvasMediaOwnership(7, OBJ_A, { store, skipCache: true })).toBe(false);
    await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 8, store });
    // user 7 事后试图登记同一对象:不覆盖,返回 false
    expect(await registerCanvasMediaOwner({ objectPath: OBJ_A, ownerUserId: 7, store })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, OBJ_A, { store, skipCache: true })).toBe(false);
    expect(await verifyCanvasMediaOwnership(8, OBJ_A, { store, skipCache: true })).toBe(true);
  });

  it("路径穿越/非法前缀/非图片后缀:拒绝,登记与验证两端都拦", async () => {
    const store = memStore();
    expect(await registerCanvasMediaOwner({ objectPath: "generated/a/../b.png", ownerUserId: 7, store })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, "generated/a/../b.png", { store, skipCache: true })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, "blog-media/x.png", { store, skipCache: true })).toBe(false);
    expect(await verifyCanvasMediaOwnership(7, "generated/a/b.mp4", { store, skipCache: true })).toBe(false);
  });

  it("存量引导:按历史草稿首次登记;他人已登记的对象跳过不覆盖", async () => {
    const store = memStore();
    await registerCanvasMediaOwner({ objectPath: OBJ_VICTIM, ownerUserId: 8, store });
    const draft = JSON.stringify({
      payloadJson: JSON.stringify({
        canvas: {
          blocks: [
            { id: "k1", outputUrl: `/api/canvas-media/${OBJ_A}`, editMaskUrl: `/api/canvas-media/${OBJ_VICTIM}` },
          ],
        },
      }),
    });
    const out = await backfillCanvasMediaOwnersFromDraft(7, { store, loadDraft: async () => draft });
    expect(out.registered).toBe(1); // OBJ_A 首登成功
    expect(out.skipped).toBe(1); // OBJ_VICTIM 他人已登,跳过
    expect(await verifyCanvasMediaOwnership(7, OBJ_A, { store, skipCache: true })).toBe(true);
    expect(await verifyCanvasMediaOwnership(7, OBJ_VICTIM, { store, skipCache: true })).toBe(false);
  });

  it("对象路径提取:签名链/稳定链/裸路径三种形态,穿越拒绝", () => {
    expect(extractCanvasMediaObjectPath(`/api/canvas-media/${OBJ_A}`)).toBe(OBJ_A);
    expect(extractCanvasMediaObjectPath(`https://storage.googleapis.com/bkt/${OBJ_A}?X-Goog=1`)).toBe(OBJ_A);
    expect(extractCanvasMediaObjectPath(OBJ_A)).toBe(OBJ_A);
    expect(extractCanvasMediaObjectPath("/api/canvas-media/generated/a/../b.png")).toBe(null);
  });
});
