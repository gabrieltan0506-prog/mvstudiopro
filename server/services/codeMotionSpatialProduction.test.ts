import { describe, expect, it, vi } from "vitest";
import {
  prepareCodeMotionSpatialProduction,
  submitCodeMotionSpatialProduction,
  getCodeMotionSpatialProduction,
  adoptCodeMotionSpatialProduction,
  type spatialProductionDeps,
} from "./codeMotionSpatialProduction";

const projectId = "11111111-1111-4111-8111-111111111111";
const worldId = "22222222-2222-4222-8222-222222222222";
const actorIds = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const input = {
  projectId,
  expectedGeneration: "3",
  worldImageId: worldId,
  actorImageIds: actorIds,
  worldPrompt: "咖啡店靠窗座位，保留玻璃窗与门口的位置",
};
function setup() {
  const files = new Map<string, Buffer>(),
    tasks = new Map<string, any>();
  let failReceipt = false;
  const project = {
    id: projectId,
    brief: {
      generationTier: "paid",
      images: [worldId, ...actorIds].map((id, i) => ({
        id,
        name: `参考${i}`,
        gcsUri: `gs://test/code-motion/u1/source-${i}.png`,
      })),
    },
    plan: { scenes: [] },
  };
  const storage = {
    read: vi.fn(async (name: string) =>
      files.has(name) ? { body: files.get(name)!, generation: "1" } : null
    ),
    write: vi.fn(async (name: string, body: Buffer, generation: string) => {
      if (failReceipt && name.endsWith("actor-0.json")) {
        failReceipt = false;
        throw Error("回执上传断线");
      }
      if (generation === "0" && files.has(name)) throw Error("CAS冲突");
      files.set(name, body);
      return "1";
    }),
    list: vi.fn(async () => [] as string[]),
  };
  let actorPurchases = 0,
    worldPurchases = 0;
  const deps = {
    storage,
    load: vi.fn(async () => ({ project, generation: "3" })),
    assertImage: vi.fn(),
    resolve: vi.fn(async ({ source }: any) => source),
    sign: (uri: string) => `https://test.invalid/${uri.split("/").at(-1)}`,
    createWorld: vi.fn(async (args: any) => {
      const key = args.sceneRef + args.sourceVersion;
      if (!tasks.has(key)) {
        worldPurchases++;
        tasks.set(key, { taskId: "world-task", status: "running" });
      }
      return tasks.get(key);
    }),
    createActor: vi.fn(async (args: any) => {
      const key = args.assetRef + args.sourceVersion;
      if (!tasks.has(key)) {
        actorPurchases++;
        tasks.set(key, {
          taskId: `actor-${args.assetRef.at(-1)}`,
          status: "running",
        });
      }
      return tasks.get(key);
    }),
    world: vi.fn(async () => ({
      taskId: "world-task",
      status: "succeeded",
      assets: {
        spz500kGcsUri: "gs://test/world.spz",
        metricScaleFactor: 2.25,
        groundPlaneOffset: -0.8,
      },
    })),
    actor: vi.fn(async (id: string) => ({
      taskId: id,
      status: "succeeded",
      glbGcsUri: `gs://test/${id}.glb`,
    })),
    importAsset: vi.fn(async (userId: string, asset: any, d: any) => {
      expect(await d.resolve({ userId, source: asset.gcsUri })).toBe(
        asset.gcsUri
      );
      await expect(
        d.resolve({ userId: "2", source: asset.gcsUri })
      ).rejects.toThrow("归属");
      await expect(
        d.resolve({ userId, source: "gs://test/foreign.glb" })
      ).rejects.toThrow("归属");
      return { id: asset.gcsUri, ...asset };
    }),
    assetDeps: {},
  } as unknown as typeof spatialProductionDeps;
  return {
    deps,
    files,
    project,
    failNextReceipt: () => {
      failReceipt = true;
    },
    purchases: () => ({ actorPurchases, worldPurchases }),
  };
}

describe("网页三维生产与恢复", () => {
  it("准备只验证当前版本、真实参考归属和费用档位，尚未创建任务", async () => {
    const state = setup();
    const value = await prepareCodeMotionSpatialProduction(
      "1",
      input,
      state.deps
    );
    expect(value.actorPreviews).toHaveLength(2);
    expect(value.worldPrompt).toBe(input.worldPrompt);
    expect(state.deps.assertImage).toHaveBeenCalledTimes(3);
    expect(state.purchases()).toEqual({ actorPurchases: 0, worldPurchases: 0 });
    await expect(
      prepareCodeMotionSpatialProduction(
        "1",
        { ...input, expectedGeneration: "2" },
        state.deps
      )
    ).rejects.toThrow("作品已变化");
    delete (state.project.brief as { generationTier?: string }).generationTier;
    expect(
      (await prepareCodeMotionSpatialProduction("1", input, state.deps))
        .actorPreviews
    ).toHaveLength(2);
    state.project.brief.generationTier = "free";
    await expect(
      prepareCodeMotionSpatialProduction("1", input, state.deps)
    ).rejects.toThrow("免费制作额度");
  });
  it("指纹变化拒绝提交；确认后逐项保存回执，重复提交不创建新任务", async () => {
    const state = setup();
    const prepared = await prepareCodeMotionSpatialProduction(
      "1",
      input,
      state.deps
    );
    await expect(
      submitCodeMotionSpatialProduction(
        "1",
        {
          ...input,
          worldPrompt: "已变化场景",
          confirmedFingerprint: prepared.fingerprint,
        },
        state.deps
      )
    ).rejects.toThrow("已变化");
    expect(state.files.size).toBe(0);
    const submitted = await submitCodeMotionSpatialProduction(
      "1",
      { ...input, confirmedFingerprint: prepared.fingerprint },
      state.deps
    );
    expect(submitted?.ready).toBe(true);
    await submitCodeMotionSpatialProduction(
      "1",
      { ...input, confirmedFingerprint: prepared.fingerprint },
      state.deps
    );
    expect(state.deps.createWorld).toHaveBeenCalledTimes(1);
    expect(state.deps.createActor).toHaveBeenCalledTimes(2);
    expect(state.files.size).toBe(4);
    await expect(
      prepareCodeMotionSpatialProduction(
        "1",
        { ...input, worldPrompt: "重新买另一种场景" },
        state.deps
      )
    ).rejects.toThrow("恢复原任务");
  });
  it("创建成功但回执上传断线，恢复使用同一素材版本与原任务身份，不重购", async () => {
    const state = setup();
    const prepared = await prepareCodeMotionSpatialProduction(
      "1",
      input,
      state.deps
    );
    state.failNextReceipt();
    await expect(
      submitCodeMotionSpatialProduction(
        "1",
        { ...input, confirmedFingerprint: prepared.fingerprint },
        state.deps
      )
    ).rejects.toThrow("回执上传断线");
    const before = state.purchases();
    const status = await getCodeMotionSpatialProduction(
      "1",
      projectId,
      state.deps
    );
    expect(status?.needsResume).toBe(true);
    expect(state.purchases()).toEqual(before);
    await submitCodeMotionSpatialProduction(
      "1",
      { ...input, confirmedFingerprint: prepared.fingerprint },
      state.deps
    );
    expect(state.purchases()).toEqual({ actorPurchases: 2, worldPurchases: 1 });
    const calls = vi.mocked(state.deps.createActor).mock.calls;
    expect(calls[0][0]).toEqual(calls[1][0]);
    expect(
      await getCodeMotionSpatialProduction("2", projectId, state.deps)
    ).toBeNull();
  });
  it("准备后另一请求先登记不同批次，本请求不得绕过批次锁创建任务", async () => {
    const state = setup();
    const prepared = await prepareCodeMotionSpatialProduction(
      "1",
      input,
      state.deps
    );
    let manifestReads = 0;
    vi.mocked(state.deps.storage.read).mockImplementation(async name => {
      if (name.endsWith("manifest.json") && ++manifestReads === 2) {
        const { world, actors, worldPrompt, model, projectId } = prepared;
        return {
          generation: "1",
          body: Buffer.from(
            JSON.stringify({
              version: 1,
              projectId,
              world,
              actors,
              worldPrompt,
              model,
              fingerprint: "b".repeat(64),
              confirmedAt: new Date().toISOString(),
            })
          ),
        };
      }
      return null;
    });
    await expect(
      submitCodeMotionSpatialProduction(
        "1",
        { ...input, confirmedFingerprint: prepared.fingerprint },
        state.deps
      )
    ).rejects.toThrow("另一批");
    expect(state.purchases()).toEqual({ actorPurchases: 0, worldPurchases: 0 });
  });
  it("采用全部人物及真实场景比例，原身份图随资产一起交给视频参考", async () => {
    const state = setup();
    const prepared = await prepareCodeMotionSpatialProduction(
      "1",
      input,
      state.deps
    );
    await submitCodeMotionSpatialProduction(
      "1",
      { ...input, confirmedFingerprint: prepared.fingerprint },
      state.deps
    );
    const result = await adoptCodeMotionSpatialProduction(
      "1",
      projectId,
      state.deps
    );
    expect(result.assets).toHaveLength(3);
    expect(result.actorIds).toHaveLength(2);
    expect(result.referenceImageIds).toEqual(actorIds);
    expect(result.metricScaleFactor).toBe(2.25);
    expect(result.groundPlaneOffset).toBe(-0.8);
    vi.mocked(state.deps.importAsset).mockClear();
    vi.mocked(state.deps.world).mockResolvedValueOnce({
      taskId: "world-task",
      status: "succeeded",
      assets: { spz500kGcsUri: "gs://test/world.spz" },
    } as any);
    await expect(
      adoptCodeMotionSpatialProduction("1", projectId, state.deps)
    ).rejects.toThrow("真实比例");
    expect(state.deps.importAsset).not.toHaveBeenCalled();
  });
});
