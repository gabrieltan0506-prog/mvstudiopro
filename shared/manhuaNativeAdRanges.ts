/** 原生证据广告区间的确定性转换；只生成新视图，不修改原始 JSON。 */
export const NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC = 0.5;

export type NativeDeepReadExcludedAdRange = { startSec: number; endSec: number };

/** 相邻/重叠区间合并（±0.5s 容差与时间轴门禁同口径）。 */
export function mergeAdjacentAdRanges(
  ranges: ReadonlyArray<NativeDeepReadExcludedAdRange>,
): NativeDeepReadExcludedAdRange[] {
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const merged: NativeDeepReadExcludedAdRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.startSec <= last.endSec + NATIVE_DEEP_READ_TIMELINE_TOLERANCE_SEC) {
      last.endSec = Math.max(last.endSec, range.endSec);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * 段卡合并成整集卡时整行剔除 evidenceRole=non_story_ad 的镜头，只留区间账目。
 *
 * - 原始分段卡（Gemini 产物 / raw 证据 / 段门禁）一律不动：完整时间轴是模型
 *   完整性验证与审计需要，本函数只产整集卡视图的新副本。
 * - 被剔除区间合并相邻后写入该行的顶层可选字段 excludedAdRanges；无广告时
 *   行原样返回，字段缺省不出现。
 * - 被剔除镜头行内的画面字幕同属广告内容，一并不入整集卡。
 */
export function stripNonStoryAdShotsForEpisodeCard(
  rows: ReadonlyArray<Record<string, unknown>>,
): { rows: Array<Record<string, unknown>>; excludedAdRanges: NativeDeepReadExcludedAdRange[] } {
  const collected: NativeDeepReadExcludedAdRange[] = [];
  const strippedRows = rows.map((raw) => {
    const shots = Array.isArray(raw.shots) ? raw.shots : [];
    const adRanges: NativeDeepReadExcludedAdRange[] = [];
    const storyShots = shots.filter((shot) => {
      const row = (shot || {}) as Record<string, unknown>;
      if (row.evidenceRole !== "non_story_ad") return true;
      const startSec = Number(row.startSec);
      const endSec = Number(row.endSec);
      if (Number.isFinite(startSec) && Number.isFinite(endSec) && startSec >= 0 && endSec > startSec) {
        adRanges.push({ startSec, endSec });
      }
      return false;
    });
    if (adRanges.length === 0) return raw;
    const rowRanges = mergeAdjacentAdRanges(adRanges);
    collected.push(...rowRanges);
    const copy: Record<string, unknown> = { ...raw, shots: storyShots, excludedAdRanges: rowRanges };
    if (Array.isArray(copy.subtitles)) {
      copy.subtitles = copy.subtitles.filter((subtitle) => {
        const atSec = Number((subtitle as Record<string, unknown> | null)?.atSec);
        return !rowRanges.some((range) => atSec >= range.startSec && atSec < range.endSec);
      });
    }
    return copy;
  });
  return { rows: strippedRows, excludedAdRanges: mergeAdjacentAdRanges(collected) };
}

