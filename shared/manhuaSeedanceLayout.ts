/**
 * 漫剧编剧室开场：先选成片引擎，再按选型铺段数 / 单段秒数。
 * - Seedance 2.0 / 2.0 Fast：5–6 段 × 约 15s（默认 6）
 * - Seedance 2.5：4 段 × 约 30s
 */

export type ManhuaSeedanceLayoutVideoModel =
  | "seedance-2.0-fast"
  | "seedance-2.0"
  | "seedance-2.5";

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
  /** 兼容旧 lengthTier 入参：2.0 短档 short；2.5 仍报 short 但段表按本 profile */
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
] as const;

export function isManhuaSeedanceLayoutVideoModel(
  raw?: string | null,
): raw is ManhuaSeedanceLayoutVideoModel {
  const k = String(raw || "").trim();
  return k === "seedance-2.0-fast" || k === "seedance-2.0" || k === "seedance-2.5";
}

export function resolveManhuaSeedanceLayoutProfile(
  videoModel?: string | null,
  lengthTierId?: string | null,
): ManhuaSeedanceLayoutProfile {
  const key = String(videoModel || "").trim();
  const base =
    MANHUA_SEEDANCE_LAYOUT_CHOICES.find((c) => c.videoModel === key) ||
    MANHUA_SEEDANCE_LAYOUT_CHOICES[0]!;
  // 2.5 固定 4×30，不受旧「单集时长」长档影响
  if (base.videoModel === "seedance-2.5") return base;
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
export function hasManhuaSeedanceLayoutChoice(videoModel?: string | null): boolean {
  return isManhuaSeedanceLayoutVideoModel(videoModel);
}
