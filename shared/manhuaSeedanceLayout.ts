/**
 * 漫剧编剧室开场：先选成片引擎，再按选型铺段数 / 单段秒数。
 * - Seedance 2.0 / 2.0 Fast / Happy Horse 1.1：5–6 段 × 约 15s（默认 6）
 * - Seedance 2.5：4 段 × 约 30s
 * - Minimax H3：7–8 段 × 约 15s（默认 8 · 约 120 秒/集）
 *
 * 文件名仍叫 seedance，语义已是「漫剧段表」——本 PR 不重命名以免牵动 import。
 */

import { CANVAS_VIDEO_MODEL_HAILUO_H3 } from "./hailuoOpenRouterModels.js";
import { CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1 } from "./happyHorseOpenRouterModels.js";
import {
  resolveSeedance25Access,
  type Seedance25AccessInput,
} from "./seedance25Access.js";

export type ManhuaSeedanceLayoutVideoModel =
  | "seedance-2.0-fast"
  | "seedance-2.0"
  | "seedance-2.5"
  | typeof CANVAS_VIDEO_MODEL_HAILUO_H3
  | typeof CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1;

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
  {
    videoModel: CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1,
    labelZh: "Happy Horse 1.1",
    layoutHintZh: "5–6 段 × 约 15 秒（默认 6 段 · 约 90 秒/集）",
    segmentCount: 6,
    segmentMin: 5,
    segmentMax: 6,
    durationSecPerSegment: 15,
    targetSec: 90,
    lengthTierId: "short",
  },
] as const;

/** 产品首选默认档（有 2.5 权限时）——显式取 2.5，不靠数组下标 */
export const MANHUA_SEEDANCE_LAYOUT_PREFERRED_DEFAULT: ManhuaSeedanceLayoutProfile =
  MANHUA_SEEDANCE_LAYOUT_CHOICES.find((c) => c.videoModel === "seedance-2.5")!;

/** 无 2.5 权限时的回落档 */
export const MANHUA_SEEDANCE_LAYOUT_FALLBACK_DEFAULT: ManhuaSeedanceLayoutProfile =
  MANHUA_SEEDANCE_LAYOUT_CHOICES.find((c) => c.videoModel === "seedance-2.0-fast")!;

export function isManhuaSeedanceLayoutVideoModel(
  raw?: string | null,
): raw is ManhuaSeedanceLayoutVideoModel {
  const k = String(raw || "").trim();
  return (
    k === "seedance-2.0-fast" ||
    k === "seedance-2.0" ||
    k === "seedance-2.5" ||
    k === CANVAS_VIDEO_MODEL_HAILUO_H3 ||
    k === CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1
  );
}

/**
 * 工厂默认成片引擎：有 Seedance 2.5 权限 → 2.5；否则 → 2.0-fast。
 * 复用 PR #1098 的 resolveSeedance25Access，不另写判定。
 */
export function resolveManhuaFactoryDefaultVideoModel(
  access: Seedance25AccessInput = {},
): ManhuaSeedanceLayoutVideoModel {
  return resolveSeedance25Access(access).allowed
    ? MANHUA_SEEDANCE_LAYOUT_PREFERRED_DEFAULT.videoModel
    : MANHUA_SEEDANCE_LAYOUT_FALLBACK_DEFAULT.videoModel;
}

export function resolveManhuaSeedanceLayoutProfile(
  videoModel?: string | null,
  lengthTierId?: string | null,
): ManhuaSeedanceLayoutProfile {
  const key = String(videoModel || "").trim();
  const base =
    MANHUA_SEEDANCE_LAYOUT_CHOICES.find((c) => c.videoModel === key) ||
    MANHUA_SEEDANCE_LAYOUT_PREFERRED_DEFAULT;
  // 2.5 / H3 / Happy Horse 固定段表，不受旧「单集时长」长档影响
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
 * 仅 Seedance 2.0 / 2.0-fast 仍吃 lengthTier；2.5 / H3 / Happy Horse 固定。
 */
export function manhuaSeedanceLayoutPinsSegmentTable(
  videoModel?: string | null,
): boolean {
  const key = String(videoModel || "").trim();
  return (
    key === "seedance-2.5" ||
    key === CANVAS_VIDEO_MODEL_HAILUO_H3 ||
    key === CANVAS_VIDEO_MODEL_HAPPYHORSE_1_1
  );
}
