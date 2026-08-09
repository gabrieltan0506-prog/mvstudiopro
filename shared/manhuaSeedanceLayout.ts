/**
 * 漫剧编剧室开场：先选成片引擎，再按选型铺段数 / 单段秒数。默认预选 Mini。
 * - Seedance 2.0 Mini：6 段 × 约 15s（草稿档，钉死段表；39 积分/段、整集 168）
 * - Seedance 2.0 / 2.0 Fast：5–6 段 × 约 15s（默认 6）
 * - Seedance 2.5：4 段 × 约 30s
 * - Minimax H3：7–8 段 × 约 15s（默认 8 · 约 120 秒/集）
 *
 * Happy Horse 1.1 **不进漫剧段表**（用户 2026-08-06 拍板，2026-08-09 复核维持）：
 * 720p 实测 $0.1647/秒，比 Seedance 标准还贵 9%、比 H3 贵 27% 且分辨率更低。
 * 它仍保留在自由画布单节点与首页照片动画，只是不做整集流水线引擎。
 *
 * 文件名仍叫 seedance，语义已是「漫剧段表」——本 PR 不重命名以免牵动 import。
 */

import { CANVAS_VIDEO_MODEL_HAILUO_H3 } from "./hailuoOpenRouterModels.js";
import { type Seedance25AccessInput } from "./seedance25Access.js";

export type ManhuaSeedanceLayoutVideoModel =
  | "seedance-2.0-mini"
  | "seedance-2.0-fast"
  | "seedance-2.0"
  | "seedance-2.5"
  | typeof CANVAS_VIDEO_MODEL_HAILUO_H3;

export type ManhuaSeedanceLayoutProfile = {
  videoModel: ManhuaSeedanceLayoutVideoModel;
  /** 用户可见正式产品名 */
  labelZh: string;
  /** 选型说明：段数 × 秒数 */
  layoutHintZh: string;
  segmentCount: number;
  segmentMin: number;
  segmentMax: number;
  durationSecPerSegment: number;
  targetSec: number;
  /** 兼容旧 lengthTier 入参：2.0 短档 short；2.5 / H3 / HH 钉死段表 */
  lengthTierId: "short" | "long";
};

export const MANHUA_SEEDANCE_LAYOUT_CHOICES: readonly ManhuaSeedanceLayoutProfile[] = [
  {
    videoModel: "seedance-2.0-mini",
    labelZh: "Seedance 2.0 mini（草稿档）",
    layoutHintZh: "6 段 × 约 15 秒（约 90 秒/集 · 便宜试稿）",
    segmentCount: 6,
    segmentMin: 6,
    segmentMax: 6,
    durationSecPerSegment: 15,
    targetSec: 90,
    lengthTierId: "short",
  },
  {
    videoModel: "seedance-2.0",
    labelZh: "Seedance 2.0",
    layoutHintZh: "5–6 段 × 约 15 秒（默认 6 段 · 约 90 秒/集）",
    segmentCount: 6,
    segmentMin: 5,
    segmentMax: 6,
    durationSecPerSegment: 15,
    targetSec: 90,
    lengthTierId: "short",
  },
  {
    videoModel: "seedance-2.0-fast",
    labelZh: "Seedance 2.0 fast",
    layoutHintZh: "5–6 段 × 约 15 秒（默认 6 段 · 约 90 秒/集）",
    segmentCount: 6,
    segmentMin: 5,
    segmentMax: 6,
    durationSecPerSegment: 15,
    targetSec: 90,
    lengthTierId: "short",
  },
  {
    videoModel: "seedance-2.5",
    labelZh: "Seedance 2.5",
    layoutHintZh: "4 段 × 约 30 秒（约 120 秒/集）",
    segmentCount: 4,
    segmentMin: 4,
    segmentMax: 4,
    durationSecPerSegment: 30,
    targetSec: 120,
    lengthTierId: "short",
  },
  {
    videoModel: CANVAS_VIDEO_MODEL_HAILUO_H3,
    labelZh: "Minimax H3",
    layoutHintZh: "7–8 段 × 约 15 秒（约 120 秒/集）",
    segmentCount: 8,
    segmentMin: 7,
    segmentMax: 8,
    durationSecPerSegment: 15,
    targetSec: 120,
    lengthTierId: "short",
  },
] as const;

/**
 * 产品默认档（用户 2026-08-09 拍板）：草稿档 mini，6 段 × 15 秒 / 90 秒。
 *
 * 从 2.5 换到 mini 的理由：mini 没有权限闸门、人人可用，而 2.5 是正式会员专属，
 * 拿它当默认会让无权限用户的预选值根本不在自己的下拉里，只能靠降级逻辑兜。
 * 显式按 videoModel 取，不靠数组下标。
 */
export const MANHUA_SEEDANCE_LAYOUT_DEFAULT: ManhuaSeedanceLayoutProfile =
  MANHUA_SEEDANCE_LAYOUT_CHOICES.find((c) => c.videoModel === "seedance-2.0-mini")!;

/**
 * 已下线引擎 → 等价迁移目标。
 *
 * Happy Horse 1.1 的旧漫剧段表就是 6 段 × 15 秒 / 90 秒，与 2.0-fast 完全一致，
 * 所以迁到 2.0-fast 是等价换名：段表、段价（172/段）、单段零售（118）都不变。
 * **不能让它落到 2.5**——那会把段表改成 4×30、还要过 2.5 权限门，等于悄悄改价改结构。
 */
const RETIRED_MANHUA_LAYOUT_VIDEO_MODELS: Readonly<
  Record<string, ManhuaSeedanceLayoutVideoModel>
> = {
  "happyhorse-1.1": "seedance-2.0-fast",
  happyhorse: "seedance-2.0-fast",
  "happy-horse": "seedance-2.0-fast",
  "alibaba/happyhorse-1.1": "seedance-2.0-fast",
};

/**
 * 存量会话的引擎归一：认得的照原样返回，已下线的迁到等价档，其余返回 ""（=未选）。
 * 会话层与画布恢复路径必须都走这里，否则两边对同一份草稿会得出不同引擎。
 */
export function migrateRetiredManhuaLayoutVideoModel(
  raw?: string | null,
): ManhuaSeedanceLayoutVideoModel | "" {
  const k = String(raw || "").trim();
  if (isManhuaSeedanceLayoutVideoModel(k)) return k;
  return RETIRED_MANHUA_LAYOUT_VIDEO_MODELS[k.toLowerCase()] || "";
}

export function isManhuaSeedanceLayoutVideoModel(
  raw?: string | null,
): raw is ManhuaSeedanceLayoutVideoModel {
  const k = String(raw || "").trim();
  return (
    k === "seedance-2.0-mini" ||
    k === "seedance-2.0-fast" ||
    k === "seedance-2.0" ||
    k === "seedance-2.5" ||
    k === CANVAS_VIDEO_MODEL_HAILUO_H3
  );
}

/**
 * 工厂默认成片引擎：一律草稿档 mini。
 *
 * 以前按 2.5 权限分流（有权限给 2.5、否则给 2.0-fast），现在 mini 不设闸门、人人可选，
 * 分流就没有意义了。2.5 的权限校验没有取消，只是移回它该在的地方——
 * 选项过滤（`writerLayoutChoices`）和服务端扣费闸门；用户想用 2.5 必须自己点。
 * 保留 access 形参是为了不动调用点签名。
 */
export function resolveManhuaFactoryDefaultVideoModel(
  _access: Seedance25AccessInput = {},
): ManhuaSeedanceLayoutVideoModel {
  return MANHUA_SEEDANCE_LAYOUT_DEFAULT.videoModel;
}

export function resolveManhuaSeedanceLayoutProfile(
  videoModel?: string | null,
  lengthTierId?: string | null,
): ManhuaSeedanceLayoutProfile {
  const key = String(videoModel || "").trim();
  const base =
    MANHUA_SEEDANCE_LAYOUT_CHOICES.find((c) => c.videoModel === key) ||
    MANHUA_SEEDANCE_LAYOUT_DEFAULT;
  // Mini / 2.5 / H3 固定段表，不受旧「单集时长」长档影响
  if (manhuaSeedanceLayoutPinsSegmentTable(base.videoModel)) {
    return base;
  }
  const tier = String(lengthTierId || "").trim().toLowerCase();
  if (tier === "long") {
    return {
      ...base,
      layoutHintZh: "10–12 段 × 约 15 秒（约 180 秒/集）",
      segmentCount: 12,
      segmentMin: 10,
      segmentMax: 12,
      durationSecPerSegment: 15,
      targetSec: 180,
      lengthTierId: "long",
    };
  }
  return base;
}

/** 扩写前是否已选成片引擎（空 = 未选，须先选再扩写） */
export function hasManhuaSeedanceLayoutChoice(
  videoModel?: string | null,
): videoModel is ManhuaSeedanceLayoutVideoModel {
  return isManhuaSeedanceLayoutVideoModel(videoModel);
}

/**
 * 成片单段最长秒数：仅 Seedance 2.5 到 30；其余引擎 15。
 */
export function manhuaClipMaxDurationSecForVideoModel(videoModel?: string | null): number {
  return String(videoModel || "").trim() === "seedance-2.5" ? 30 : 15;
}

/** 将请求时长钳到该引擎允许上限（缺省按 15） */
export function clampManhuaClipDurationSecForVideoModel(
  videoModel: string | null | undefined,
  rawDurationSec: unknown,
): number {
  const max = manhuaClipMaxDurationSecForVideoModel(videoModel);
  const n = Number(rawDurationSec);
  if (!Number.isFinite(n) || n <= 0) return Math.min(15, max);
  return Math.max(1, Math.min(max, Math.round(n)));
}

/**
 * 是否钉死段表（不受旧「单集时长」长/短档影响）。
 * 仅 Seedance 2.0 / 2.0-fast 仍吃 lengthTier；Mini / 2.5 / H3 固定。
 *
 * Mini 必须钉死：整集草稿包 168 是按 6 段 × 28 算的，
 * 放开到 long 档（12 段）会让「整集 168」这句话变成假话。
 */
export function manhuaSeedanceLayoutPinsSegmentTable(
  videoModel?: string | null,
): boolean {
  const key = String(videoModel || "").trim();
  return (
    key === "seedance-2.0-mini" ||
    key === "seedance-2.5" ||
    key === CANVAS_VIDEO_MODEL_HAILUO_H3
  );
}
