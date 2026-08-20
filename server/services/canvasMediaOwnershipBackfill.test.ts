import { beforeEach, describe, expect, it } from "vitest";
import { __resetCanvasMediaOwnershipCacheForTests, type OwnerRecord, type OwnerStore } from "./canvasMediaOwnership";
import {
  backfillCanvasMediaOwnersPage,
  type BackfillEvidenceJob,
} from "./canvasMediaOwnershipBackfill";

function memStore(): OwnerStore & { map: Map<string, OwnerRecord> } {
  const map = new Map<string, OwnerRecord>();
  return {
    map,
    async get(p) {
      return map.get(p) || null;
    },
    async createIfAbsent(p, rec) {
      if (map.has(p)) return "exists";
      map.set(p, rec);
      return "created";
    },
  };
}

const OBJ_A = "generated/canvas-gpt-image2/user7_a.png";
const OBJ_B = "generated/canvas-gpt-image2/user9_b.png";

function job(partial: Partial<BackfillEvidenceJob> & { id: string }): BackfillEvidenceJob {
  return {
    userId: "7",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    input: { action: "canvas_gpt_image2", params: {} },
    output: { imageUrl: `/api/canvas-media/${OBJ_A}` },
    ...partial,
  };
}

describe("canvasMediaOwnershipBackfill · 服务端任务证据引导(五审 P0-4)", () => {
  beforeEach(() => __resetCanvasMediaOwnershipCacheForTests());

  it("成功任务按记录 userId 登记;他人已在册计 conflict 且不覆盖;同主重复计 alreadyOwned", async () => {
    const store = memStore();
    store.map.set(OBJ_B, { ownerUserId: 9 });
    const page = await backfillCanvasMediaOwnersPage({
      store,
      listPage: async () => [
        job({ id: "j1" }),
        job({ id: "j2", output: { imageUrl: `https://storage.googleapis.com/bkt/${OBJ_B}` } }), // user7 抢 user9 的对象
        job({ id: "j3" }), // 与 j1 同对象同主:幂等
      ],
      pageSize: 10,
    });
    expect(page.created).toBe(1);
    expect(page.alreadyOwned).toBe(1);
    expect(page.conflict).toBe(1);
    expect(page.conflicts[0]).toMatchObject({ objectPath: OBJ_B, jobId: "j2", jobUserId: 7 });
    expect(store.map.get(OBJ_A)?.ownerUserId).toBe(7);
    expect(store.map.get(OBJ_B)?.ownerUserId).toBe(9); // 冲突未覆盖
  });

  it("非 canvas_gpt_image2 / 非数字 userId 的任务不构成证据;dry-run 不落任何写", async () => {
    const store = memStore();
    const evidence: BackfillEvidenceJob[] = [
      job({ id: "j1", input: { action: "manhua_template_learn" } }),
      job({ id: "j2", userId: "public" }),
      job({ id: "j3" }),
    ];
    const dry = await backfillCanvasMediaOwnersPage({
      store,
      dryRun: true,
      listPage: async () => evidence,
      pageSize: 10,
    });
    expect(dry.created).toBe(1); // 只有 j3 会被登记(dry-run 口径:将尝试)
    expect(store.map.size).toBe(0); // 未落写

    const wet = await backfillCanvasMediaOwnersPage({
      store,
      listPage: async () => evidence,
      pageSize: 10,
    });
    expect(wet.created).toBe(1);
    expect(store.map.get(OBJ_A)?.ownerUserId).toBe(7);
  });

  it("分页游标:满页给 nextCheckpoint 且未完;欠页判 done", async () => {
    const store = memStore();
    const full = await backfillCanvasMediaOwnersPage({
      store,
      listPage: async () => [job({ id: "j1" }), job({ id: "j2" })],
      pageSize: 2,
    });
    expect(full.done).toBe(false);
    expect(full.nextCheckpoint).toMatchObject({ afterId: "j2" });
    const short = await backfillCanvasMediaOwnersPage({
      store,
      listPage: async () => [job({ id: "j3" })],
      pageSize: 2,
    });
    expect(short.done).toBe(true);
  });

  it("存储故障计入 errors 并留样本,不中断整页、不误登", async () => {
    const store = memStore();
    const boom: OwnerStore = {
      get: store.get,
      createIfAbsent: async () => {
        throw new Error("gcs_conditional_upload_failed:503:boom");
      },
    };
    const page = await backfillCanvasMediaOwnersPage({
      store: boom,
      listPage: async () => [job({ id: "j1" })],
      pageSize: 10,
    });
    expect(page.errors).toBe(1);
    expect(page.errorSamples[0]).toMatch(/503/);
    expect(page.created).toBe(0);
  });
});
