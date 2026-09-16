/**
 * 角色进场景（PR-10）：Marble 3DGS 世界 ↔ 白模舞台的纯函数合同。
 *
 * 坐标口径（0916 知识库《3DGS场景层》）：
 *   - Marble SPZ 是 `marble_raw_opencv`：X 右、Y 下、Z 前；网页查看器绕 X 转 180° 变成 three.js 的 Y 上。
 *   - 语义元数据：先乘 metric_scale_factor（变米），再减 ground_plane_offset（只作用于高斯中心）→ 地面到 0。
 *     本文件假设地面偏移沿 OpenCV 的 Y（重力轴）减：y' = s·y − g。
 *   - 我们的白模舞台：Z 向上、米、+Y 为舞台正前（与 shared/manhuaCameraGrammar 的 wide() 同口径）。
 *
 * 合成：raw → three 是 Rx(180°)，three → 舞台是 Rx(90°)，总旋转 R = Rx(−90°)：(x, y, z) ↦ (x, z, −y)。
 * three 物体层级 p' = R·S·p + T，把「减地面偏移」折进平移：T = −R·(0, g, 0) = (0, 0, g)。
 *
 * 落点与相机：PR-2 绑定的 screen 点没有深度，这里绝不冒充 world 点（返回 null 并给中文原因）。
 */
import type { ManhuaSpatialPoint } from "./manhuaActionPlan.js";

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

/** 行主序 4×4 仿射矩阵（m[row*4+col]） */
export type Mat4Rows = readonly number[];

export type MarbleStageTransform = {
  /** 统一尺度（metric_scale_factor，缺省 1） */
  scale: number;
  /** 地面偏移（ground_plane_offset，缺省 0） */
  groundPlaneOffset: number;
  /** 总旋转：绕 X 轴的角度（度）。固定 −90：raw(x,y,z) ↦ stage(x, z, −y) */
  rotationXDeg: -90;
  /** 与 three.js 同口径的四元数 [x, y, z, w]，用于 splat.quaternion.set(...) */
  quaternionXYZW: readonly [number, number, number, number];
  /** three 物体平移（舞台坐标）：把「减地面偏移」折进来 */
  translationStage: Vec3;
  /** 行主序 4×4：stage = M · [raw, 1] */
  matrixRows: Mat4Rows;
  /** 行主序 4×4：raw = M⁻¹ · [stage, 1] */
  inverseRows: Mat4Rows;
  toStage: (p: Vec3) => [number, number, number];
  toWorld: (p: Vec3) => [number, number, number];
};

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function marbleToStageTransform(input: { metricScaleFactor?: number; groundPlaneOffset?: number } = {}): MarbleStageTransform {
  const scaleRaw = finiteOr(input.metricScaleFactor, 1);
  const scale = scaleRaw > 0 ? scaleRaw : 1;
  const g = finiteOr(input.groundPlaneOffset, 0);
  // R = Rx(-90°): (x, y, z) ↦ (x, z, -y)
  const matrixRows: number[] = [
    scale, 0, 0, 0,
    0, 0, scale, 0,
    0, -scale, 0, g,
    0, 0, 0, 1,
  ];
  // 逆：raw = R⁻¹ (stage - T) / s；R⁻¹ = Rx(+90°): (x, y, z) ↦ (x, -z, y)
  const inv = 1 / scale;
  const inverseRows: number[] = [
    inv, 0, 0, 0,
    0, 0, -inv, g * inv,
    0, inv, 0, 0,
    0, 0, 0, 1,
  ];
  const toStage = (p: Vec3): [number, number, number] => [scale * p[0], scale * p[2], -scale * p[1] + g];
  const toWorld = (p: Vec3): [number, number, number] => [p[0] * inv, -(p[2] - g) * inv, p[1] * inv];
  const half = (-90 / 2) * (Math.PI / 180);
  return {
    scale,
    groundPlaneOffset: g,
    rotationXDeg: -90,
    quaternionXYZW: [Math.sin(half), 0, 0, Math.cos(half)],
    translationStage: [0, 0, g],
    matrixRows,
    inverseRows,
    toStage,
    toWorld,
  };
}

export type CharacterPlacement = {
  /** 根节点在舞台的位置（米，Z 上） */
  position: [number, number, number];
  /** 均匀缩放 */
  scale: number;
  /** 绕舞台 Z 轴的偏航（度），0 = 面向 +Y */
  yawDeg: number;
};

/**
 * 把人物 GLB 放到舞台点、脚贴地。
 * modelNativeHeightM / modelFootOffset：GLB 本身的高度与脚底相对根节点的高度（Y 上模型给 minY；缺省当作 1 米高、脚在 0）。
 */
export function placeCharacterOnGround(input: {
  stagePoint: Vec2;
  characterHeightM: number;
  ground?: { offset?: number };
  modelNativeHeightM?: number;
  modelFootOffset?: number;
  yawDeg?: number;
}): CharacterPlacement {
  const targetHeight = finiteOr(input.characterHeightM, 1.7) > 0 ? finiteOr(input.characterHeightM, 1.7) : 1.7;
  const nativeRaw = finiteOr(input.modelNativeHeightM, 1);
  const native = nativeRaw > 1e-6 ? nativeRaw : 1;
  const scale = targetHeight / native;
  const foot = finiteOr(input.modelFootOffset, 0);
  const groundZ = finiteOr(input.ground?.offset, 0);
  return {
    position: [finiteOr(input.stagePoint[0], 0), finiteOr(input.stagePoint[1], 0), groundZ - foot * scale],
    scale,
    yawDeg: finiteOr(input.yawDeg, 0),
  };
}

/** 摆好后脚底的舞台高度（测试与 UI 提示用） */
export function characterFootStageZ(placement: CharacterPlacement, modelFootOffset = 0): number {
  return placement.position[2] + modelFootOffset * placement.scale;
}

export type WorldPointFromBinding = { stage: [number, number, number]; reasonZh?: undefined } | { stage: null; reasonZh: string };

/**
 * PR-2 绑定 → 舞台点。world 点直接用（y_up 显式换轴）；screen/unresolved 一律 null 并说明原因，不猜深度。
 */
export function worldPointFromBinding(binding: { point?: ManhuaSpatialPoint | null } | ManhuaSpatialPoint | null | undefined): WorldPointFromBinding {
  const point = (binding && "space" in (binding as object) ? binding : (binding as { point?: ManhuaSpatialPoint | null } | null)?.point) as
    | ManhuaSpatialPoint
    | null
    | undefined;
  if (!point) return { stage: null, reasonZh: "这个绑定还没有落点" };
  if (point.space === "screen") {
    return { stage: null, reasonZh: "只有画面二维点、没有深度依据，不能冒充 3D 世界落点；请在白模里标世界坐标" };
  }
  if (point.space === "unresolved") {
    return { stage: null, reasonZh: `落点未解析：${point.reasonZh}` };
  }
  if (point.unit !== "m") return { stage: null, reasonZh: "世界点单位不是米" };
  if (point.axis === "y_up") return { stage: [point.x, -point.z, point.y] };
  return { stage: [point.x, point.y, point.z] };
}

export type StageCameraKind = "ots" | "single" | "establish";

export type StageCameraRig = {
  kind: StageCameraKind;
  position: [number, number, number];
  target: [number, number, number];
  lens: number;
  labelZh: string;
};

const HEAD_M = 1.5;

function norm2(v: Vec2): [number, number] {
  const len = Math.hypot(v[0], v[1]);
  return len < 1e-6 ? [0, -1] : [v[0] / len, v[1] / len];
}

/**
 * 与 shared/manhuaCameraGrammar 同一套机位规则：
 *   - 过肩：在「过谁的肩」那人身后 0.9、侧 0.45、高 1.55，看向主体头部
 *   - 单人：主体正前 1.6、高 1.5，平视
 *   - 建立：高位全景（中心 −Y 7 米、高 2.6，看中心 1 米，28mm）
 * subjectStage 为脚底舞台点；facingStage 为主体朝向单位向量（缺省朝 −Y，即朝向默认全景机位）。
 */
export function threeCameraRigForKeyframe(input: {
  subjectStage: Vec3;
  kind: StageCameraKind;
  overStage?: Vec3;
  facingStage?: Vec2;
}): StageCameraRig {
  const s = input.subjectStage;
  const head: [number, number, number] = [s[0], s[1], s[2] + HEAD_M];
  if (input.kind === "establish") {
    return { kind: "establish", position: [s[0], s[1] - 7, s[2] + 2.6], target: [s[0], s[1], s[2] + 1], lens: 28, labelZh: "建立·高位全景" };
  }
  if (input.kind === "ots" && input.overStage) {
    const o = input.overStage;
    // 主体 → 过肩者 的方向：机位再往这人身后退 0.9，侧移 0.45
    const dir = norm2([o[0] - s[0], o[1] - s[1]]);
    const side: [number, number] = [-dir[1], dir[0]];
    return {
      kind: "ots",
      position: [o[0] + dir[0] * 0.9 + side[0] * 0.45, o[1] + dir[1] * 0.9 + side[1] * 0.45, o[2] + 1.55],
      target: head,
      lens: 50,
      labelZh: "过肩",
    };
  }
  const face = norm2(input.facingStage ?? [0, -1]);
  return {
    kind: "single",
    position: [s[0] + face[0] * 1.6, s[1] + face[1] * 1.6, s[2] + HEAD_M],
    target: head,
    lens: 45,
    labelZh: input.kind === "ots" ? "单人（缺过肩对象，退为正面）" : "单人正面",
  };
}

export const STAGE_CAMERA_KINDS: readonly StageCameraKind[] = ["establish", "ots", "single"];
export const STAGE_CAMERA_LABEL_ZH: Record<StageCameraKind, string> = { establish: "建立", ots: "过肩", single: "单人" };
