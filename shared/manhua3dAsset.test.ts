import { describe, expect, it } from "vitest";
import {
  evaluatePrevisRigCompatibility,
  manhua3dAssetRecordSchema,
  manhua3dLux3dCapabilitySchema,
  normalizeManhua3dAssetRecord,
  type Manhua3dAssetRecord,
} from "./manhua3dAsset.js";
import { PREVIS_BODY_BONES } from "./manhuaPrevisRig.js";

const NOW = "2026-09-15T13:00:00.000Z";

function baseRecord(overrides: Partial<Manhua3dAssetRecord> = {}): Manhua3dAssetRecord {
  return {
    assetId: "m3da_abc123",
    revision: 1,
    source: "upload",
    sourceJobId: "m3d_import_deadbeef",
    glb: { kind: "gcs", gcsUri: "gs://bucket/manhua-3d/u1/model.glb", sha256: "a".repeat(64), bytes: 1234 },
    verification: { status: "unverified", reasonZh: "未给出单位与轴向" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("manhua3dAsset schema", () => {
  it("往返：完整记录解析后与输入一致", () => {
    const record = baseRecord({
      units: "m",
      axis: "y_up",
      geometry: { nodeCount: 3, meshCount: 1, primitiveCount: 1, animationCount: 0, extensionsRequired: [] },
      skeleton: {
        hasArmature: true,
        skinCount: 1,
        boneNames: [...PREVIS_BODY_BONES],
        ...evaluatePrevisRigCompatibility(PREVIS_BODY_BONES),
      },
      materials: { materialCount: 1, textureCount: 0, imageCount: 0, pbrMaterialCount: 1, materialNames: ["skin"] },
      verification: { status: "verified", checkedAt: NOW },
      adoptedAt: NOW,
    });
    const parsed = manhua3dAssetRecordSchema.parse(JSON.parse(JSON.stringify(record)));
    expect(parsed).toEqual(record);
  });

  it("旧草稿没有资产字段时归一化为无资产，而不是造半个资产", () => {
    expect(normalizeManhua3dAssetRecord(undefined)).toBeUndefined();
    expect(normalizeManhua3dAssetRecord({})).toBeUndefined();
    expect(normalizeManhua3dAssetRecord({ assetId: "m3da_x" })).toBeUndefined();
    expect(normalizeManhua3dAssetRecord(baseRecord())).toBeDefined();
  });

  it("被拒必须有原因；已验证必须显式单位/轴向/几何；未验证不能被采用", () => {
    expect(manhua3dAssetRecordSchema.safeParse(baseRecord({ verification: { status: "rejected" } })).success).toBe(false);
    expect(
      manhua3dAssetRecordSchema.safeParse(baseRecord({ verification: { status: "verified" } })).success
    ).toBe(false);
    expect(
      manhua3dAssetRecordSchema.safeParse(
        baseRecord({
          units: "cm",
          axis: "z_up",
          verification: { status: "verified" },
        })
      ).success
    ).toBe(false);
    expect(manhua3dAssetRecordSchema.safeParse(baseRecord({ adoptedAt: NOW })).success).toBe(false);
  });

  it("Lux3D 来源必须带 region 与十进制 taskId；单位与轴向不接受未知值", () => {
    expect(manhua3dAssetRecordSchema.safeParse(baseRecord({ source: "lux3d_local" })).success).toBe(false);
    expect(
      manhua3dAssetRecordSchema.safeParse(
        baseRecord({ source: "lux3d_local", lux3d: { region: "cn", taskId: "123456" } })
      ).success
    ).toBe(true);
    expect(
      manhua3dAssetRecordSchema.safeParse(
        baseRecord({ source: "lux3d_local", lux3d: { region: "cn", taskId: "abc" } })
      ).success
    ).toBe(false);
    expect(manhua3dAssetRecordSchema.safeParse({ ...baseRecord(), units: "inch" }).success).toBe(false);
    expect(manhua3dAssetRecordSchema.safeParse({ ...baseRecord(), axis: "x_up" }).success).toBe(false);
  });

  it("GLB 引用只认 gs:// 或本地导入路径，未知字段被拒", () => {
    expect(
      manhua3dAssetRecordSchema.safeParse(baseRecord({ glb: { kind: "gcs", gcsUri: "https://x/y.glb" } })).success
    ).toBe(false);
    expect(
      manhua3dAssetRecordSchema.safeParse(baseRecord({ glb: { kind: "local_import", path: "/tmp/a.glb" } })).success
    ).toBe(true);
    expect(manhua3dAssetRecordSchema.safeParse({ ...baseRecord(), extra: 1 }).success).toBe(false);
  });

  it("绑骨兼容按 16 根标准骨精确比对，大小写差异算缺失", () => {
    const full = evaluatePrevisRigCompatibility(PREVIS_BODY_BONES);
    expect(full.previsRigCompatible).toBe(true);
    expect(full.missingPrevisBones).toEqual([]);
    const partial = evaluatePrevisRigCompatibility(["Pelvis", "spine", "head", "mixamorig:Hips"]);
    expect(partial.previsRigCompatible).toBe(false);
    expect(partial.matchedPrevisBones).toEqual(["spine", "head"]);
    expect(partial.missingPrevisBones).toContain("pelvis");
    expect(evaluatePrevisRigCompatibility([]).matchedPrevisBones).toEqual([]);
  });

  it("Lux3D 能力：不可用带原因码并保留导入兜底；可用也不表示可提交生成", () => {
    expect(
      manhua3dLux3dCapabilitySchema.safeParse({
        available: false,
        reasonCode: "no_server_credentials",
        reasonZh: "服务端未配置 Lux3D 凭证",
        importFallback: true,
      }).success
    ).toBe(true);
    expect(
      manhua3dLux3dCapabilitySchema.safeParse({
        available: true,
        regions: ["cn"],
        canResumeTasks: true,
        canSubmitGeneration: true,
        importFallback: true,
      }).success
    ).toBe(false);
  });
});
