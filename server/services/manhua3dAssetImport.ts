/**
 * GLB 导入检验（PR-3 · Lux3D 资产链）。
 *
 * 纯函数：输入字节 → 结构校验（复用 shared/glbValidation 的 GLB 2.0 验证器，不重造第二份）
 * → 解析 JSON chunk → 节点/网格/骨架/材质统计 → 结合显式单位/轴向给出校验结论。
 *
 * 不做的事：不猜单位、不猜轴向、不补骨架、不伪造任何统计；不合格返回 rejected 与原因。
 */
import { createHash } from "node:crypto";
import { assertValidGlb2 } from "../../shared/glbValidation.js";
import {
  evaluatePrevisRigCompatibility,
  type Manhua3dAssetAxis,
  type Manhua3dAssetGeometry,
  type Manhua3dAssetMaterialSummary,
  type Manhua3dAssetSkeleton,
  type Manhua3dAssetUnits,
  type Manhua3dAssetVerification,
} from "../../shared/manhua3dAsset.js";

const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
export const MANHUA_3D_ASSET_MAX_GLB_BYTES = 250 * 1024 * 1024;
const MAX_BONE_NAMES = 512;
const MAX_MATERIAL_NAMES = 64;

export const MANHUA_3D_ASSET_REJECT_REASONS = {
  invalid_glb_magic: "文件不是 GLB（魔数不对）",
  invalid_glb_header: "GLB 头部或版本不是 2.0",
  invalid_glb_chunk: "GLB 分块长度与声明不符（文件可能被截断）",
  invalid_glb_json_chunk: "GLB 第一块不是 JSON",
  invalid_glb_json: "GLB 的 JSON 不是合法 glTF 2.0",
  invalid_glb_json_too_large: "GLB 的 JSON 块超过上限",
  glb_too_large: "GLB 超过 250 MB 上限",
  glb_no_mesh: "模型里没有任何网格，不能当资产用",
  glb_unsupported_required_extension: "模型要求的 glTF 扩展当前链路不支持",
  glb_buffer_view_out_of_range: "GLB 的 bufferView/accessor 越界（引用不存在的 buffer 或超出其长度）",
} as const;
export type Manhua3dAssetRejectCode = keyof typeof MANHUA_3D_ASSET_REJECT_REASONS;

/** 当前白模脚本（previs_*.py 走 Blender 导入）不解 Draco/Meshopt 压缩，直接判拒而不是导入后炸。 */
const UNSUPPORTED_REQUIRED_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "EXT_meshopt_compression",
]);

export type Manhua3dGlbInspection =
  | {
      ok: true;
      bytes: number;
      sha256: string;
      geometry: Manhua3dAssetGeometry;
      skeleton: Manhua3dAssetSkeleton;
      materials: Manhua3dAssetMaterialSummary;
    }
  | { ok: false; reasonCode: Manhua3dAssetRejectCode; reasonZh: string };

function uint32Le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** 结构已由 assertValidGlb2 保证：第一块必是 JSON，长度不越界。 */
export function readGlbJsonDocument(bytes: Uint8Array): Record<string, unknown> {
  assertValidGlb2(bytes);
  const jsonLength = uint32Le(bytes, GLB_HEADER_BYTES);
  const start = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, start + jsonLength)).trim();
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_glb_json");
  return parsed as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanName(value: unknown, max = 128): string {
  return String(value ?? "").trim().slice(0, max);
}

/** 只统计，不解释：从 glTF JSON 读出几何/骨架/材质摘要。 */
export function summarizeGltfDocument(doc: Record<string, unknown>): {
  geometry: Manhua3dAssetGeometry;
  skeleton: Manhua3dAssetSkeleton;
  materials: Manhua3dAssetMaterialSummary;
} {
  const nodes = asArray(doc.nodes);
  const meshes = asArray(doc.meshes);
  const skins = asArray(doc.skins);
  const materials = asArray(doc.materials);
  const asset = asRecord(doc.asset);

  const primitiveCount = meshes.reduce<number>((sum, mesh) => sum + asArray(asRecord(mesh).primitives).length, 0);

  const jointIndexes = new Set<number>();
  for (const skin of skins) {
    for (const joint of asArray(asRecord(skin).joints)) {
      if (Number.isInteger(joint) && (joint as number) >= 0 && (joint as number) < nodes.length) {
        jointIndexes.add(joint as number);
      }
    }
  }
  const boneNames: string[] = [];
  for (const index of Array.from(jointIndexes).sort((a, b) => a - b)) {
    if (boneNames.length >= MAX_BONE_NAMES) break;
    boneNames.push(cleanName(asRecord(nodes[index]).name) || `joint_${index}`);
  }

  const materialNames = materials.slice(0, MAX_MATERIAL_NAMES).map(m => cleanName(asRecord(m).name));
  const pbrMaterialCount = materials.filter(m => asRecord(m).pbrMetallicRoughness !== undefined).length;

  return {
    geometry: {
      nodeCount: nodes.length,
      meshCount: meshes.length,
      primitiveCount,
      animationCount: asArray(doc.animations).length,
      generator: cleanName(asset.generator, 200) || undefined,
      extensionsRequired: asArray(doc.extensionsRequired)
        .map(v => cleanName(v, 120))
        .filter(Boolean)
        .slice(0, 32),
    },
    skeleton: {
      hasArmature: skins.length > 0 && jointIndexes.size > 0,
      skinCount: skins.length,
      boneNames,
      ...evaluatePrevisRigCompatibility(boneNames),
    },
    materials: {
      materialCount: materials.length,
      textureCount: asArray(doc.textures).length,
      imageCount: asArray(doc.images).length,
      pbrMaterialCount,
      materialNames,
    },
  };
}

/**
 * bufferView / accessor 越界只统计不解释会让坏文件进 verified，Blender 导入时才炸（1467 R2）。
 * 只做整数范围核对：buffer 索引存在、byteOffset+byteLength ≤ buffer.byteLength、accessor.bufferView 存在。
 */
export function findGltfBufferViewViolation(doc: Record<string, unknown>): string | null {
  const buffers = asArray(doc.buffers).map(b => Number(asRecord(b).byteLength));
  const views = asArray(doc.bufferViews);
  for (let i = 0; i < views.length; i += 1) {
    const view = asRecord(views[i]);
    const bufferIndex = Number(view.buffer);
    if (!Number.isInteger(bufferIndex) || bufferIndex < 0 || bufferIndex >= buffers.length) return `bufferView[${i}].buffer`;
    const byteOffset = view.byteOffset === undefined ? 0 : Number(view.byteOffset);
    const byteLength = Number(view.byteLength);
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || !Number.isInteger(byteLength) || byteLength < 0) return `bufferView[${i}]`;
    const bufferLength = buffers[bufferIndex]!;
    if (!Number.isFinite(bufferLength) || byteOffset + byteLength > bufferLength) return `bufferView[${i}] 超出 buffer[${bufferIndex}]`;
  }
  const accessors = asArray(doc.accessors);
  for (let i = 0; i < accessors.length; i += 1) {
    const accessor = asRecord(accessors[i]);
    if (accessor.bufferView === undefined) continue;
    const viewIndex = Number(accessor.bufferView);
    if (!Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex >= views.length) return `accessor[${i}].bufferView`;
  }
  return null;
}

function rejectFor(code: Manhua3dAssetRejectCode): Manhua3dGlbInspection {
  return { ok: false, reasonCode: code, reasonZh: MANHUA_3D_ASSET_REJECT_REASONS[code] };
}

/** 字节 → 检验结果。任何结构错误都映射成明确的拒绝码，不抛给调用方猜。 */
export function inspectGlbBytes(
  bytes: Uint8Array,
  maxBytes = MANHUA_3D_ASSET_MAX_GLB_BYTES
): Manhua3dGlbInspection {
  if (bytes.byteLength > maxBytes) return rejectFor("glb_too_large");
  let doc: Record<string, unknown>;
  try {
    doc = readGlbJsonDocument(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message in MANHUA_3D_ASSET_REJECT_REASONS) return rejectFor(message as Manhua3dAssetRejectCode);
    return rejectFor("invalid_glb_json");
  }
  if (findGltfBufferViewViolation(doc)) return rejectFor("glb_buffer_view_out_of_range");
  const summary = summarizeGltfDocument(doc);
  if (summary.geometry.meshCount === 0 || summary.geometry.primitiveCount === 0) return rejectFor("glb_no_mesh");
  if (summary.geometry.extensionsRequired.some(ext => UNSUPPORTED_REQUIRED_EXTENSIONS.has(ext))) {
    return rejectFor("glb_unsupported_required_extension");
  }
  return {
    ok: true,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...summary,
  };
}

/** 可注入读取：由调用方决定字节从哪来（GCS / 本地 / 测试桩），本函数只负责有界与检验。 */
export async function inspectGlbFromReader(
  read: () => Promise<Uint8Array>,
  maxBytes = MANHUA_3D_ASSET_MAX_GLB_BYTES
): Promise<Manhua3dGlbInspection> {
  let bytes: Uint8Array;
  try {
    bytes = await read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "gcs_download_too_large" || message === "glb_too_large") return rejectFor("glb_too_large");
    throw error;
  }
  return inspectGlbBytes(bytes, maxBytes);
}

/**
 * 校验结论：检验失败 → rejected；单位/轴向缺一 → unverified（说明缺什么）；齐 → verified。
 * 骨架是否兼容不作为门槛：道具/船体本来就没骨架。
 */
export function deriveManhua3dAssetVerification(input: {
  inspection: Manhua3dGlbInspection;
  units?: Manhua3dAssetUnits;
  axis?: Manhua3dAssetAxis;
  checkedAt: string;
}): Manhua3dAssetVerification {
  if (!input.inspection.ok) {
    return { status: "rejected", reasonZh: input.inspection.reasonZh, checkedAt: input.checkedAt };
  }
  const missing: string[] = [];
  if (!input.units) missing.push("单位（m/cm）");
  if (!input.axis) missing.push("轴向（y_up/z_up）");
  if (missing.length) {
    return {
      status: "unverified",
      reasonZh: `结构合法，但未显式给出${missing.join("与")}；不猜，请补填后再验`,
      checkedAt: input.checkedAt,
    };
  }
  return { status: "verified", checkedAt: input.checkedAt };
}
