/**
 * 布局可控场景（PR-11）：把白模舞台（地面平面 + 若干长方体道具/建筑体）渲成等距柱状 2:1 深度全景，
 * 喂 Marble `pano:depth_to_rgb` 上色，再以 is_pano:true 建世界——空间结构由我们定。
 *
 * 纯 CPU 光线求交（平面 + AABB），不依赖 DOM；≤ 2048×1024。
 * 舞台口径：Z 上、米、+Y 为正前（方位角 0° 在图像中央列）；方位角顺时针（+X 在 90°）。
 * 8bit 量化：近亮远暗（255 = nearM，0 = farM，线性），元数据随文件一起走，Marble 侧口径若不同只改这一处。
 */

export type DepthBox = {
  id?: string;
  labelZh?: string;
  /** 舞台底面中心 [x, y]（米） */
  center: readonly [number, number];
  /** 尺寸 [x 宽, y 深, z 高]（米） */
  size: readonly [number, number, number];
  /** 底面离地高度（米，缺省 0） */
  baseZ?: number;
};

export type DepthPanoScene = {
  /** 视点（舞台坐标，缺省 [0, 0, 1.6]） */
  eye?: readonly [number, number, number];
  /** 地面高度（缺省 0）；null = 无地面 */
  groundZ?: number | null;
  boxes?: readonly DepthBox[];
};

export type DepthPanoMeta = {
  width: number;
  height: number;
  nearM: number;
  farM: number;
  /** 8bit 口径：near_bright = 255 为近 */
  encoding: "near_bright_linear";
  eye: readonly [number, number, number];
};

export type DepthPanoRender = {
  width: number;
  height: number;
  /** 每像素沿视线的距离（米）；未命中 = farM */
  depth: Float32Array;
  meta: DepthPanoMeta;
};

export const DEPTH_PANO_MAX_WIDTH = 2048;
export const DEPTH_PANO_DEFAULT_WIDTH = 1024;
export const DEPTH_PANO_DEFAULT_NEAR_M = 0.3;
export const DEPTH_PANO_DEFAULT_FAR_M = 60;

function clampWidth(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 64) return DEPTH_PANO_DEFAULT_WIDTH;
  return Math.min(DEPTH_PANO_MAX_WIDTH, n - (n % 2));
}

/** 像素中心 → 单位视线方向（舞台 Z 上；u 左→右 = 方位 −180°→180°，v 上→下 = 仰角 +90°→−90°） */
export function depthPanoDirection(u: number, v: number, width: number, height: number): [number, number, number] {
  const azimuth = ((u + 0.5) / width) * 2 * Math.PI - Math.PI;
  const elevation = Math.PI / 2 - ((v + 0.5) / height) * Math.PI;
  const c = Math.cos(elevation);
  return [Math.sin(azimuth) * c, Math.cos(azimuth) * c, Math.sin(elevation)];
}

function intersectAabb(eye: readonly [number, number, number], dir: readonly [number, number, number], min: readonly number[], max: readonly number[]): number {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = dir[axis]!;
    const o = eye[axis]!;
    if (Math.abs(d) < 1e-12) {
      if (o < min[axis]! || o > max[axis]!) return Number.POSITIVE_INFINITY;
      continue;
    }
    let t1 = (min[axis]! - o) / d;
    let t2 = (max[axis]! - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Number.POSITIVE_INFINITY;
  }
  return tMin > 0 ? tMin : Number.POSITIVE_INFINITY;
}

export function renderLayoutDepthPano(scene: DepthPanoScene, options: { width?: number; nearM?: number; farM?: number } = {}): DepthPanoRender {
  const width = clampWidth(options.width);
  const height = width / 2;
  const nearM = Math.max(0.01, Number(options.nearM) || DEPTH_PANO_DEFAULT_NEAR_M);
  const farM = Math.max(nearM + 0.1, Number(options.farM) || DEPTH_PANO_DEFAULT_FAR_M);
  const eye: [number, number, number] = [
    Number(scene.eye?.[0]) || 0,
    Number(scene.eye?.[1]) || 0,
    Number.isFinite(Number(scene.eye?.[2])) ? Number(scene.eye![2]) : 1.6,
  ];
  const groundZ = scene.groundZ === null ? null : Number.isFinite(Number(scene.groundZ)) ? Number(scene.groundZ) : 0;
  const boxes = (scene.boxes || [])
    .filter((b) => b && Number.isFinite(b.center[0]) && Number.isFinite(b.center[1]) && b.size.every((s) => Number.isFinite(s) && s > 0))
    .map((b) => {
      const baseZ = Number(b.baseZ) || 0;
      return {
        min: [b.center[0] - b.size[0] / 2, b.center[1] - b.size[1] / 2, baseZ],
        max: [b.center[0] + b.size[0] / 2, b.center[1] + b.size[1] / 2, baseZ + b.size[2]],
      };
    })
    // 视点落在某个体块里（例如站位中心就是自己）：这个体块不参与，否则整张图都是它的内壁
    .filter((box) => !(eye[0] >= box.min[0]! && eye[0] <= box.max[0]! && eye[1] >= box.min[1]! && eye[1] <= box.max[1]! && eye[2] >= box.min[2]! && eye[2] <= box.max[2]!));
  const depth = new Float32Array(width * height);
  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      const dir = depthPanoDirection(u, v, width, height);
      let best = farM;
      if (groundZ !== null && dir[2] < -1e-9 && eye[2] > groundZ) {
        const t = (groundZ - eye[2]) / dir[2];
        if (t > 0 && t < best) best = t;
      }
      for (const box of boxes) {
        const t = intersectAabb(eye, dir, box.min, box.max);
        if (t > 0 && t < best) best = t;
      }
      depth[v * width + u] = Math.max(nearM, Math.min(farM, best));
    }
  }
  return { width, height, depth, meta: { width, height, nearM, farM, encoding: "near_bright_linear", eye } };
}

/** Float32 距离 → 8bit 灰度（近亮远暗，线性） */
export function quantizeDepthTo8bit(render: Pick<DepthPanoRender, "depth" | "meta">): Uint8Array {
  const { nearM, farM } = render.meta;
  const span = Math.max(1e-6, farM - nearM);
  const out = new Uint8Array(render.depth.length);
  for (let i = 0; i < render.depth.length; i += 1) {
    const t = (render.depth[i]! - nearM) / span;
    out[i] = Math.round(255 * (1 - Math.max(0, Math.min(1, t))));
  }
  return out;
}

/** 8bit 灰度 → 米（与量化互逆，供回读校验） */
export function depth8bitToMeters(value: number, meta: Pick<DepthPanoMeta, "nearM" | "farM">): number {
  return meta.nearM + (1 - Math.max(0, Math.min(255, value)) / 255) * (meta.farM - meta.nearM);
}

/* ─────────────── 极简 PNG 编码（8bit 灰度，zlib 仅存储块，不依赖 zlib/DOM） ─────────────── */

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

export function encodeGrayPng(width: number, height: number, gray: Uint8Array): Uint8Array {
  if (gray.length !== width * height) throw new Error("gray_png_size_mismatch");
  // 每行前置 filter byte 0
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  // zlib：仅存储块，每块 ≤ 65535
  const blocks: number[] = [0x78, 0x01];
  const BLOCK = 65535;
  for (let offset = 0; offset < raw.length || offset === 0; offset += BLOCK) {
    const len = Math.min(BLOCK, raw.length - offset);
    const final = offset + len >= raw.length ? 1 : 0;
    blocks.push(final, len & 0xff, (len >>> 8) & 0xff, ~len & 0xff, (~len >>> 8) & 0xff);
    for (let i = 0; i < len; i += 1) blocks.push(raw[offset + i]!);
    if (raw.length === 0) break;
  }
  blocks.push(...u32(adler32(raw)));
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 0, 0, 0, 0]);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(blocks)), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 一步到位：场景 → PNG 字节 + 元数据（上传时把 meta 记在任务/文件名旁） */
export function renderLayoutDepthPanoPng(scene: DepthPanoScene, options: { width?: number; nearM?: number; farM?: number } = {}): { png: Uint8Array; meta: DepthPanoMeta } {
  const render = renderLayoutDepthPano(scene, options);
  return { png: encodeGrayPng(render.width, render.height, quantizeDepthTo8bit(render)), meta: render.meta };
}

/**
 * 白模规格 → 深度场景：站位变成 0.5×0.35×1.7 的人形柱（缺省），道具/建筑体由调用方另给。
 * 视点取所有站位的中心、高 1.6。
 */
export function depthPanoSceneFromPrevisActors(
  actors: ReadonlyArray<{ id: string; nameZh?: string; start: readonly [number, number]; shape?: "human" | "horse" }>,
  extraBoxes: readonly DepthBox[] = [],
  eyeHeightM = 1.6,
): DepthPanoScene {
  const valid = actors.filter((a) => Number.isFinite(a.start[0]) && Number.isFinite(a.start[1]));
  const cx = valid.length ? valid.reduce((n, a) => n + a.start[0], 0) / valid.length : 0;
  const cy = valid.length ? valid.reduce((n, a) => n + a.start[1], 0) / valid.length : 0;
  const boxes: DepthBox[] = valid.map((a) => ({
    id: a.id,
    labelZh: a.nameZh,
    center: a.start,
    size: a.shape === "horse" ? [1.0, 2.2, 1.6] : [0.5, 0.35, 1.7],
  }));
  return { eye: [cx, cy, eyeHeightM], groundZ: 0, boxes: [...boxes, ...extraBoxes] };
}
