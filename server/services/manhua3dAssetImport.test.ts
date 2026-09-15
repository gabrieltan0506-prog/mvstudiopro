import { describe, expect, it } from "vitest";
import { PREVIS_BODY_BONES } from "../../shared/manhuaPrevisRig.js";
import {
  deriveManhua3dAssetVerification,
  inspectGlbBytes,
  inspectGlbFromReader,
  readGlbJsonDocument,
  summarizeGltfDocument,
} from "./manhua3dAssetImport.js";

/** 自造最小合法 GLB：JSON chunk + 可选 BIN chunk，按 4 字节对齐。 */
export function buildGlb(doc: Record<string, unknown>, payload = Buffer.alloc(0)): Buffer {
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadded = Math.ceil(json.byteLength / 4) * 4;
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const jsonChunk = Buffer.concat([jsonHeader, json, Buffer.alloc(jsonPadded - json.byteLength, 0x20)]);
  let body = jsonChunk;
  if (payload.byteLength) {
    const binPadded = Math.ceil(payload.byteLength / 4) * 4;
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binPadded, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    body = Buffer.concat([jsonChunk, binHeader, payload, Buffer.alloc(binPadded - payload.byteLength)]);
  }
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.byteLength, 8);
  return Buffer.concat([header, body]);
}

const MESH_DOC = {
  asset: { version: "2.0", generator: "test-gen" },
  nodes: [{ name: "root", mesh: 0 }],
  meshes: [{ name: "cube", primitives: [{ attributes: { POSITION: 0 } }] }],
  materials: [{ name: "mat", pbrMetallicRoughness: {} }, { name: "flat" }],
};

const RIGGED_DOC = {
  asset: { version: "2.0" },
  nodes: [
    { name: "body", mesh: 0, skin: 0 },
    ...PREVIS_BODY_BONES.map(name => ({ name })),
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
  skins: [{ joints: PREVIS_BODY_BONES.map((_, i) => i + 1) }],
  animations: [{ channels: [], samplers: [] }],
};

describe("manhua3dAssetImport · GLB 解析", () => {
  it("最小合法 GLB：读出 JSON、统计网格与材质", () => {
    const glb = buildGlb(MESH_DOC, Buffer.from("payload"));
    expect(readGlbJsonDocument(glb).asset).toEqual({ version: "2.0", generator: "test-gen" });
    const result = inspectGlbBytes(glb);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(glb.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.geometry).toEqual({
      nodeCount: 1,
      meshCount: 1,
      primitiveCount: 1,
      animationCount: 0,
      generator: "test-gen",
      extensionsRequired: [],
    });
    expect(result.skeleton.hasArmature).toBe(false);
    expect(result.skeleton.previsRigCompatible).toBe(false);
    expect(result.materials).toEqual({
      materialCount: 2,
      textureCount: 0,
      imageCount: 0,
      pbrMaterialCount: 1,
      materialNames: ["mat", "flat"],
    });
  });

  it("带骨模型：骨名来自 skin.joints 指向的节点，16 根标准骨齐才算兼容", () => {
    const result = inspectGlbBytes(buildGlb(RIGGED_DOC));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skeleton.hasArmature).toBe(true);
    expect(result.skeleton.skinCount).toBe(1);
    expect(result.skeleton.boneNames).toEqual([...PREVIS_BODY_BONES]);
    expect(result.skeleton.previsRigCompatible).toBe(true);
    expect(result.geometry.animationCount).toBe(1);

    const renamed = structuredClone(RIGGED_DOC);
    renamed.nodes[1] = { name: "Hips" };
    const partial = inspectGlbBytes(buildGlb(renamed));
    expect(partial.ok && partial.skeleton.previsRigCompatible).toBe(false);
    expect(partial.ok && partial.skeleton.missingPrevisBones).toEqual(["pelvis"]);
  });

  it("坏样本一：魔数错 → invalid_glb_magic", () => {
    const glb = buildGlb(MESH_DOC);
    glb.write("FAKE", 0, "ascii");
    expect(inspectGlbBytes(glb)).toEqual({
      ok: false,
      reasonCode: "invalid_glb_magic",
      reasonZh: "文件不是 GLB（魔数不对）",
    });
  });

  it("坏样本二：截断 → invalid_glb_chunk", () => {
    const glb = buildGlb(MESH_DOC, Buffer.alloc(64));
    const result = inspectGlbBytes(glb.subarray(0, glb.byteLength - 10));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasonCode).toBe("invalid_glb_chunk");
  });

  it("坏样本三：结构合法但没有网格 → glb_no_mesh；版本不对 → invalid_glb_json", () => {
    expect(inspectGlbBytes(buildGlb({ asset: { version: "2.0" }, nodes: [{}] }))).toMatchObject({
      ok: false,
      reasonCode: "glb_no_mesh",
    });
    expect(inspectGlbBytes(buildGlb({ asset: { version: "1.0" } }))).toMatchObject({
      ok: false,
      reasonCode: "invalid_glb_json",
    });
  });

  it("要求 Draco 压缩 → 明确拒绝；超限 → glb_too_large；读取器抛超限也归 glb_too_large", async () => {
    expect(
      inspectGlbBytes(buildGlb({ ...MESH_DOC, extensionsRequired: ["KHR_draco_mesh_compression"] }))
    ).toMatchObject({ ok: false, reasonCode: "glb_unsupported_required_extension" });
    const glb = buildGlb(MESH_DOC);
    expect(inspectGlbBytes(glb, glb.byteLength - 1)).toMatchObject({ ok: false, reasonCode: "glb_too_large" });
    await expect(
      inspectGlbFromReader(async () => {
        throw new Error("gcs_download_too_large");
      })
    ).resolves.toMatchObject({ ok: false, reasonCode: "glb_too_large" });
    await expect(inspectGlbFromReader(async () => glb)).resolves.toMatchObject({ ok: true });
    await expect(
      inspectGlbFromReader(async () => {
        throw new Error("network_down");
      })
    ).rejects.toThrow("network_down");
  });

  it("summarize 对缺字段/坏索引文档稳健，不伪造骨名", () => {
    const summary = summarizeGltfDocument({ skins: [{ joints: [99, -1, "x"] }], nodes: [{}] });
    expect(summary.skeleton).toMatchObject({ hasArmature: false, skinCount: 1, boneNames: [] });
    expect(summary.geometry.meshCount).toBe(0);
  });
});

describe("manhua3dAssetImport · 校验结论", () => {
  const ok = inspectGlbBytes(buildGlb(MESH_DOC));
  const at = "2026-09-15T13:00:00.000Z";

  it("检验失败 → rejected 带原因", () => {
    const bad = inspectGlbBytes(Buffer.from("nope"));
    expect(deriveManhua3dAssetVerification({ inspection: bad, units: "m", axis: "y_up", checkedAt: at })).toEqual({
      status: "rejected",
      reasonZh: "文件不是 GLB（魔数不对）",
      checkedAt: at,
    });
  });

  it("单位或轴向缺一 → unverified 并点名缺什么；不猜", () => {
    const noUnits = deriveManhua3dAssetVerification({ inspection: ok, axis: "y_up", checkedAt: at });
    expect(noUnits.status).toBe("unverified");
    expect(noUnits.reasonZh).toContain("单位");
    expect(noUnits.reasonZh).not.toContain("轴向");
    const none = deriveManhua3dAssetVerification({ inspection: ok, checkedAt: at });
    expect(none.reasonZh).toContain("单位");
    expect(none.reasonZh).toContain("轴向");
  });

  it("显式单位与轴向齐全 → verified；无骨架不影响", () => {
    expect(deriveManhua3dAssetVerification({ inspection: ok, units: "cm", axis: "z_up", checkedAt: at })).toEqual({
      status: "verified",
      checkedAt: at,
    });
  });
});
