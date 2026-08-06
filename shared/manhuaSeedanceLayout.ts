/**
 * 漫剧编剧室开场：先选成片引擎，再按选型铺段数 / 单段秒数。
 * - Seedance 2.0 / 2.0 Fast：5–6 段 × 约 15s（默认 6）
 * - Seedance 2.5：4 段 × 约 30s
 * - 成片·高清（内部 H3）：7–8 段 × 约 15s（默认 8 · 约 120 秒/集）
 *
 * 文件名仍叫 seedance，语义已是「漫剧段表」——本 PR 不重命名以免牵动 import。
 */

import { CANVAS_VIDEO_MODEL_HAILUO_H3 } from "./hailuoOpenRouterModels.js";
import {
  resolveSeedance25Access,
  type Seedance25AccessInput,
} from "./seedance25Access.js";

export type ManhuaSeedanceLayoutVideoModel =
  | "seedance-2.0-fast"
  | "seedance-2.0"
  | "seedance-2.5"
  | typeof CANVAS_VIDEO_MODEL_HAILUO_H3;

export type ManhuaSeedanceLayoutProfile = {
  videoModel: ManhuaSeedanceLayoutVideoModel;
  /** 用户可见短名（前台零技术泄漏：不写供应商长串） */
  labelZh: string;
  /** 选型说明：段数 × 秒数 */
  layoutHintZh: string;
  segmentCount: number;
  segmentMin: number;
  segmentMax: number;
  durationSecPerSegment: number;
  targetSec: number;
  /** 兼容旧 lengthTier 入参：2.0 短档 short；2.5 / 高清仍报 short 但段表按本 profile */
  lengthTierId: "short" | "long";
};

export const MANHUA_SEEDANCE_LAYOUT_CHOICES: readonly ManhuaSeedanceLayoutProfile[] = [
  {
    videoModel: "seedance-2.0-fast",
    labelZh: "成片·快速",
    layoutHintZh: "5–6 段 × 约 15 秒（默认 6 段 · 约 90 秒/集）",
    segmentCount: 6,
    segmentMin: 5,
    segmentMax: 6,
    durationSecPerSegment: 15,
    targetSec: 90,
    lengthTierId: "short",
  },
  {
    videoModel: "seedance-2.0",
    labelZh: "成片·标准",
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
    labelZh: "成片·加长",
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
    labelZh: "成片·高清",
    layoutHintZh: "7–8 段 × 约 15 秒（约 120 秒/集）",
    segmentCount: 8,
    segmentMin: 7,
    segmentMax: 8,
    durationSecPerSegment: 15,
    targetSec: 120,
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
    k === CANVAS_VIDEO_MODEL_HAILUO_H3
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
  // 2.5 / 高清固定段表，不受旧「单集时长」长档影响
  if (base.videoModel === "seedance-2.5" || base.videoModel === CANVAS_VIDEO_MODEL_HAILUO_H3) {
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
