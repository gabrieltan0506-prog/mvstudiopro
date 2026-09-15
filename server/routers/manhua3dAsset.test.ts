import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TrpcContext } from "../_core/context";
import { buildGlb } from "../services/manhua3dAssetGlbFixture.js";
import {
  resetManhua3dAssetDependenciesForTests,
  setManhua3dAssetDependenciesForTests,
} from "../services/manhua3dAssetTask.js";
import { manhua3dAssetRouter } from "./manhua3dAsset";

const GLB = buildGlb({
  asset: { version: "2.0" },
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
});
const caller = (id?: number, role: "admin" | "user" = "admin") =>
  manhua3dAssetRouter.createCaller({ user: id ? { id, role } : null } as TrpcContext);

describe("manhua3dAsset router", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "manhua3d-asset-router-"));
    vi.stubEnv("MANHUA_3D_ASSET_DIR", dir);
    setManhua3dAssetDependenciesForTests({
      resolveSourceGlb: async (taskId, userId) => {
        if (userId !== 1) throw new Error("not yours");
        return { taskId, assetRef: "ref", gcsUri: "gs://b/u1/m.glb", sha256: "c".repeat(64), bytes: GLB.byteLength };
      },
      downloadGlb: async () => GLB,
      hasLux3dCredential: () => false,
    });
  });
  afterEach(async () => {
    resetManhua3dAssetDependenciesForTests();
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("路由形状：五个入口，且没有任何提交生成的入口", () => {
    expect(Object.keys(manhua3dAssetRouter._def.procedures).sort()).toEqual(
      ["adopt", "capability", "getStatus", "import", "listByJob"].sort()
    );
  });

  it("鉴权：未登录 / 普通账号一律 FORBIDDEN（adminProcedure 口径）", async () => {
    await expect(caller().capability()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(1, "user").capability()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("capability 返回真实不可用态；import → getStatus → adopt 走通，未验证采用报 CONFLICT", async () => {
    await expect(caller(1).capability()).resolves.toMatchObject({ available: false, reasonCode: "no_server_credentials" });

    const draft = await caller(1).import({ sourceJobId: "m3d_x1", assetRef: "ref" });
    expect(draft.verification.status).toBe("unverified");
    await expect(caller(1).adopt({ assetId: draft.assetId })).rejects.toMatchObject({ code: "CONFLICT" });

    const verified = await caller(1).import({ sourceJobId: "m3d_x1", assetRef: "ref", units: "m", axis: "y_up" });
    expect(verified.verification.status).toBe("verified");
    await expect(caller(1).getStatus({ assetId: verified.assetId })).resolves.toMatchObject({ assetId: verified.assetId });
    await expect(caller(1).adopt({ assetId: verified.assetId })).resolves.toMatchObject({ revision: 2 });
    await expect(caller(1).listByJob({ sourceJobId: "m3d_x1" })).resolves.toHaveLength(2);

    await expect(caller(2).getStatus({ assetId: verified.assetId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(2).import({ sourceJobId: "m3d_x1", assetRef: "ref" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(1).import({ sourceJobId: "bad", assetRef: "ref" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller(1).import({ sourceJobId: "m3d_x1", assetRef: "ref", units: "inch" as "m" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
