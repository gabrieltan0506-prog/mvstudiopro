import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PREVIS_BODY_BONES } from "../../shared/manhuaPrevisRig.js";
import { buildGlb } from "./manhua3dAssetGlbFixture.js";
import {
  adoptManhua3dAsset,
  getManhua3dAsset,
  getManhua3dLux3dCapability,
  importManhua3dAsset,
  listManhua3dAssetsForJob,
  resetManhua3dAssetDependenciesForTests,
  setManhua3dAssetDependenciesForTests,
} from "./manhua3dAssetTask.js";

const GOOD_GLB = buildGlb({
  asset: { version: "2.0" },
  nodes: [{ name: "body", mesh: 0, skin: 0 }, ...PREVIS_BODY_BONES.map(name => ({ name }))],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  skins: [{ joints: PREVIS_BODY_BONES.map((_, i) => i + 1) }],
});
const SOURCE = {
  taskId: "m3d_import_abc",
  assetRef: "ref-1",
  gcsUri: "gs://bucket/manhua-3d/u7/model.glb",
  sha256: "b".repeat(64),
  bytes: GOOD_GLB.byteLength,
};

describe("manhua3dAssetTask", () => {
  let dir = "";
  let download: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "manhua3d-asset-test-"));
    vi.stubEnv("MANHUA_3D_ASSET_DIR", dir);
    download = vi.fn(async () => GOOD_GLB);
    setManhua3dAssetDependenciesForTests({
      resolveSourceGlb: vi.fn(async (taskId, userId, assetRef) => {
        if (taskId !== SOURCE.taskId || userId !== 7 || assetRef !== SOURCE.assetRef) throw new Error("not yours");
        return SOURCE;
      }),
      downloadGlb: download as unknown as (gcsUri: string) => Promise<Uint8Array>,
      hasLux3dCredential: () => false,
      now: () => new Date("2026-09-15T13:00:00.000Z"),
    });
  });

  afterEach(async () => {
    resetManhua3dAssetDependenciesForTests();
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("状态机：无单位 → unverified；补单位轴向 → 新资产 verified → 采用 revision 推进且幂等", async () => {
    const draft = await importManhua3dAsset({ userId: 7, sourceJobId: SOURCE.taskId, assetRef: "ref-1" });
    expect(draft.verification.status).toBe("unverified");
    expect(draft.verification.reasonZh).toContain("单位");
    expect(draft.skeleton?.previsRigCompatible).toBe(true);
    expect(draft.glb).toEqual({ kind: "gcs", gcsUri: SOURCE.gcsUri, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: GOOD_GLB.byteLength });
    await expect(adoptManhua3dAsset(draft.assetId, 7)).rejects.toThrow("manhua3d_asset_not_verified");

    const verified = await importManhua3dAsset({
      userId: 7,
      sourceJobId: SOURCE.taskId,
      assetRef: "ref-1",
      units: "m",
      axis: "y_up",
    });
    expect(verified.assetId).not.toBe(draft.assetId);
    expect(verified.verification.status).toBe("verified");
    expect(verified.units).toBe("m");
    expect(verified.axis).toBe("y_up");

    const adopted = await adoptManhua3dAsset(verified.assetId, 7);
    expect(adopted.adoptedAt).toBe("2026-09-15T13:00:00.000Z");
    expect(adopted.revision).toBe(2);
    expect(await adoptManhua3dAsset(verified.assetId, 7)).toEqual(adopted);
    expect(await getManhua3dAsset(verified.assetId, 7)).toEqual(adopted);

    const listed = await listManhua3dAssetsForJob(SOURCE.taskId, 7);
    expect(listed.map(a => a.assetId).sort()).toEqual([draft.assetId, verified.assetId].sort());
  });

  it("坏 GLB → rejected 带原因，记录仍落盘可查，采用被拒", async () => {
    download.mockResolvedValueOnce(Buffer.from("not a glb"));
    const rejected = await importManhua3dAsset({
      userId: 7,
      sourceJobId: SOURCE.taskId,
      assetRef: "ref-1",
      units: "cm",
      axis: "z_up",
    });
    expect(rejected.verification).toMatchObject({ status: "rejected", reasonZh: "文件不是 GLB（魔数不对）" });
    expect(rejected.geometry).toBeUndefined();
    expect(rejected.glb).toMatchObject({ sha256: SOURCE.sha256, bytes: SOURCE.bytes });
    expect((await getManhua3dAsset(rejected.assetId, 7))?.verification.status).toBe("rejected");
    await expect(adoptManhua3dAsset(rejected.assetId, 7)).rejects.toThrow("manhua3d_asset_not_verified");
  });

  it("幂等：同参数并发只下载一次；来源不属于本人 → source_missing；别人查不到", async () => {
    const [a, b] = await Promise.all([
      importManhua3dAsset({ userId: 7, sourceJobId: SOURCE.taskId, assetRef: "ref-1", units: "m", axis: "y_up" }),
      importManhua3dAsset({ userId: 7, sourceJobId: SOURCE.taskId, assetRef: "ref-1", units: "m", axis: "y_up" }),
    ]);
    expect(a).toEqual(b);
    expect(download).toHaveBeenCalledTimes(1);
    const again = await importManhua3dAsset({ userId: 7, sourceJobId: SOURCE.taskId, assetRef: "ref-1", units: "m", axis: "y_up" });
    expect(again).toEqual(a);
    expect(download).toHaveBeenCalledTimes(1);

    await expect(
      importManhua3dAsset({ userId: 8, sourceJobId: SOURCE.taskId, assetRef: "ref-1" })
    ).rejects.toThrow("manhua3d_asset_source_missing");
    expect(await getManhua3dAsset(a.assetId, 8)).toBeNull();
    await expect(adoptManhua3dAsset(a.assetId, 8)).rejects.toThrow("manhua3d_asset_not_found");
    expect(await listManhua3dAssetsForJob(SOURCE.taskId, 8)).toEqual([]);
    await expect(importManhua3dAsset({ userId: 7, sourceJobId: "bad id", assetRef: "x" })).rejects.toThrow(
      "invalid_manhua_3d_asset_input"
    );
  });

  it("坏记录文件当不存在，不返回半个资产", async () => {
    await fs.writeFile(path.join(dir, "m3da_broken.json"), JSON.stringify({ userId: 7, assetId: "m3da_broken" }));
    expect(await getManhua3dAsset("m3da_broken", 7)).toBeNull();
    expect(await listManhua3dAssetsForJob(SOURCE.taskId, 7)).toEqual([]);
  });

  it("Lux3D 不可用态是真实状态：无凭证 / 有凭证但适配器未接，永不 available:true", () => {
    expect(getManhua3dLux3dCapability()).toEqual({
      available: false,
      reasonCode: "no_server_credentials",
      reasonZh: expect.stringContaining("LUX3D_CN_API_KEY"),
      importFallback: true,
    });
    setManhua3dAssetDependenciesForTests({ hasLux3dCredential: region => region === "cn" });
    expect(getManhua3dLux3dCapability()).toMatchObject({ available: false, reasonCode: "adapter_not_wired", importFallback: true });
  });

  it("生产依赖只看凭证有无，不读值；本测试进程未设 key 时为无凭证", () => {
    resetManhua3dAssetDependenciesForTests();
    vi.stubEnv("LUX3D_CN_API_KEY", "");
    vi.stubEnv("LUX3D_GLOBAL_API_KEY", "");
    expect(getManhua3dLux3dCapability().reasonCode).toBe("no_server_credentials");
  });
});
