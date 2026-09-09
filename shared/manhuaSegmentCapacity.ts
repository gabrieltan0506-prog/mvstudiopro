/**
 * 分镜 → 成片段容量（每集可选）。
 *
 * 引擎段表是固定的（mini 6×15s、2.5 4×30s …），而原稿分镜条数与秒数由剧本决定。
 * 以前原稿超出固定段表时被静默压进去（29 镜／130 秒 → 18 镜／90 秒），镜头无声丢失。
 *
 * 现在按集二选一：
 *   - auto_by_source：段数跟原稿走（总秒数 / 单段引擎上限向上取整），一镜不丢；
 *   - block_when_over：原稿超出固定容量就拒绝生成，红字写清「原稿多少 vs 容量多少」，
 *     绝不静默丢镜。默认取它——宁可拦下，不烧白花钱的段。
 */

import { resolveManhuaSeedanceLayoutProfile } from "./manhuaSeedanceLayout.js";
import {
  MANHUA_FACTORY_DEFAULT_VIDEO_MODEL,
  manhuaKeyartsPerSegmentForVideoModel,
  groupShotsIntoSegments,
  resolveShotDurationSecForSegment,
  type ManhuaWorkbenchSegment,
  type ManhuaWorkbenchShot,
} from "./manhuaScriptWorkbench.js";

export const MANHUA_SEGMENT_CAPACITY_MODES = ["auto_by_source", "block_when_over"] as const;
export type ManhuaSegmentCapacityMode = (typeof MANHUA_SEGMENT_CAPACITY_MODES)[number];

/** 默认阻止：不静默丢镜、不白烧付费段 */
export const MANHUA_SEGMENT_CAPACITY_MODE_DEFAULT: ManhuaSegmentCapacityMode = "block_when_over";

export const MANHUA_SEGMENT_CAPACITY_MODE_LABEL_ZH: Record<ManhuaSegmentCapacityMode, string> = {
  auto_by_source: "按原稿分段（不丢镜，段数随原稿）",
  block_when_over: "超容量阻止（固定段表，超出即拦）",
};

export function normalizeManhuaSegmentCapacityMode(raw: unknown): ManhuaSegmentCapacityMode {
  return MANHUA_SEGMENT_CAPACITY_MODES.includes(raw as ManhuaSegmentCapacityMode)
    ? (raw as ManhuaSegmentCapacityMode)
    : MANHUA_SEGMENT_CAPACITY_MODE_DEFAULT;
}

/** 集号（字符串键）→ 模式；非法集号或非法值一律丢弃 */
export function normalizeManhuaSegmentCapacityModeByEpisode(
  raw: unknown,
): Record<string, ManhuaSegmentCapacityMode> {
  const out: Record<string, ManhuaSegmentCapacityMode> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ep = Math.floor(Number(k));
    if (!Number.isFinite(ep) || ep < 1 || ep > 999) continue;
    if (!MANHUA_SEGMENT_CAPACITY_MODES.includes(v as ManhuaSegmentCapacityMode)) continue;
    out[String(ep)] = v as ManhuaSegmentCapacityMode;
  }
  return out;
}

export function getManhuaSegmentCapacityMode(
  byEpisode: Record<string, ManhuaSegmentCapacityMode> | null | undefined,
  episodeIndex: number | null | undefined,
): ManhuaSegmentCapacityMode {
  const ep = Math.max(1, Math.floor(Number(episodeIndex) || 1));
  return normalizeManhuaSegmentCapacityMode(byEpisode?.[String(ep)]);
}

export type ManhuaSegmentCapacityPlan = {
  mode: ManhuaSegmentCapacityMode;
  /** false 只会出现在 block_when_over 且原稿超容量 */
  ok: boolean;
  plannedShotCount: number;
  /** 原稿规划总秒数（0.1 秒精度） */
  plannedSec: number;
  /** 引擎固定段表 */
  capacitySegmentCount: number;
  capacitySec: number;
  capacityShotCount: number;
  durationSecPerSegment: number;
  /** 按 ceil(总秒 / 单段上限) 至少需要几段 */
  requiredSegmentCount: number;
  /** 实际分段（auto 或未超容量时）；超容量被拦时为空 */
  segments: ManhuaWorkbenchSegment[];
  overCapacity: boolean;
  /** 被拦时的中文原因；未拦为空串 */
  errorZh: string;
  /** 顶栏一句话摘要 */
  summaryZh: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 纯函数：给定原稿分镜与模式，算出容量对照与分段。
 *
 * 分段本身沿用 groupShotsIntoSegments（每段 ≤ 引擎单段秒数、≤ 3 张原镜参考、超长单镜
 * 只拆连续窗口）——它从不丢镜，段数由原稿决定。本函数只负责：算容量、给出
 * 「至少几段」、在 block 模式下把超容量拦下并写清数字。
 */
export function planManhuaSegmentCapacity(input: {
  shots: ManhuaWorkbenchShot[];
  mode?: ManhuaSegmentCapacityMode | null;
  videoModel?: string | null;
  lengthTierId?: string | null;
  episodeIndex?: number | null;
}): ManhuaSegmentCapacityPlan {
  const mode = normalizeManhuaSegmentCapacityMode(input.mode);
  const model = String(input.videoModel || "").trim() || MANHUA_FACTORY_DEFAULT_VIDEO_MODEL;
  const layout = resolveManhuaSeedanceLayoutProfile(model, input.lengthTierId);
  const perSeg = Math.max(1, Math.floor(layout.durationSecPerSegment));
  const capacitySegmentCount = Math.max(1, Math.floor(layout.segmentCount));
  const capacitySec = capacitySegmentCount * perSeg;
  const capacityShotCount = capacitySegmentCount * manhuaKeyartsPerSegmentForVideoModel(model);
  const shots = Array.isArray(input.shots) ? input.shots : [];
  const plannedShotCount = shots.length;
  const plannedSec = round1(
    shots.reduce((sum, shot) => sum + resolveShotDurationSecForSegment(shot), 0),
  );
  const requiredSegmentCount = Math.max(1, Math.ceil(plannedSec / perSeg - 1e-9));
  const overCapacity =
    plannedShotCount > capacityShotCount || plannedSec > capacitySec + 1e-6;
  const epLabel = input.episodeIndex ? `第${Math.floor(input.episodeIndex)}集` : "本集";
  const capacityLabel = `${capacitySegmentCount} 段（${capacityShotCount} 镜／${capacitySec} 秒，每段 ${perSeg} 秒）`;

  if (mode === "block_when_over" && overCapacity && plannedShotCount > 0) {
    const errorZh =
      `${epLabel}分镜 ${plannedShotCount} 镜／${plannedSec} 秒，超出当前引擎固定容量 ${capacityLabel}。` +
      `已阻止生成、未扣费，不会静默丢镜。` +
      `请把本集「分镜容量」切到「按原稿分段」（按 ${perSeg} 秒/段自动排成至少 ${requiredSegmentCount} 段，一镜不丢），` +
      `或把分镜删减到 ${capacityShotCount} 镜／${capacitySec} 秒以内再生成。`;
    return {
      mode,
      ok: false,
      plannedShotCount,
      plannedSec,
      capacitySegmentCount,
      capacitySec,
      capacityShotCount,
      durationSecPerSegment: perSeg,
      requiredSegmentCount,
      segments: [],
      overCapacity,
      errorZh,
      summaryZh: `超容量已拦：${plannedShotCount} 镜／${plannedSec}s > ${capacityShotCount} 镜／${capacitySec}s`,
    };
  }

  const segments = plannedShotCount ? groupShotsIntoSegments(shots, { videoModel: model }) : [];
  const summaryZh =
    mode === "auto_by_source"
      ? `按原稿分段：${plannedShotCount} 镜／${plannedSec}s → ${segments.length} 段（每段 ≤ ${perSeg}s，不丢镜）`
      : `固定容量 ${capacityShotCount} 镜／${capacitySec}s：原稿 ${plannedShotCount} 镜／${plannedSec}s，未超`;
  return {
    mode,
    ok: true,
    plannedShotCount,
    plannedSec,
    capacitySegmentCount,
    capacitySec,
    capacityShotCount,
    durationSecPerSegment: perSeg,
    requiredSegmentCount,
    segments,
    overCapacity,
    errorZh: "",
    summaryZh,
  };
}
