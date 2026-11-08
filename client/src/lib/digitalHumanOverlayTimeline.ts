/**
 * 数字人补充画面覆盖轨 · 口播时间轴条与抽屉采用（素材检索 UX 第二期，2026-11-08）。
 *
 * 纯函数，只服务前端：
 * - 把完整口播切成「口播段」（有音频分段清单按清单，没有就按句读按字数比例估算），给抽屉标题与关键词原文；
 * - 在覆盖轨上找空档（与口播段相交切开），时间轴条上每个空档可点「＋找补充画面」；
 * - 抽屉回传的裁点 inSec/outSec 写成覆盖条目：sourceInSec = inSec、durationSec = outSec − inSec（放不下时收缩到空档内）；
 *   照片保持原规则（固定展示时长、无入点）。最终仍由 shared/digitalHumanOverlay 的校验与服务端 loadOwnedStockAsset 把关。
 */
import {
  DIGITAL_HUMAN_OVERLAY_MAX_COUNT,
  DIGITAL_HUMAN_OVERLAY_MIN_SEC,
  DIGITAL_HUMAN_VIDEO_OVERLAY_DEFAULT_SEC,
  digitalHumanOverlayIssues,
  placeDigitalHumanOverlay,
  type DigitalHumanOverlayDraft,
} from "@shared/digitalHumanOverlay";
import { isStockAssetInsertable, stockAttributionText, type StockFootageAssetView } from "@shared/stockFootage";

const EPS = 1 / 1000;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export type DigitalHumanSpeechSegment = { index: number; startSec: number; endSec: number; text: string };
export type DigitalHumanOverlayGap = { startSec: number; endSec: number; segmentIndex: number };
type Span = { startSec: number; durationSec: number };

const SENTENCE_RE = /[^。！？!?；;\n]+[。！？!?；;\n]*/g;

/**
 * 口播段：有分段清单时按清单的时间切，文字按字数比例从完整文案里截取；
 * 没有清单时按句读切句，时长按字数比例分摊。返回的段首尾相接、覆盖 [0, totalSec]。
 */
export function digitalHumanSpeechSegments(
  script: string,
  totalSec: number,
  manifestSegments?: ReadonlyArray<{ index: number; startSec: number; endSec: number }>,
): DigitalHumanSpeechSegment[] {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return [];
  const text = String(script || "").trim();
  if (manifestSegments?.length) {
    const chars = Array.from(text);
    const at = (sec: number) => Math.round((Math.min(Math.max(sec, 0), totalSec) / totalSec) * chars.length);
    return manifestSegments.map((s, i) => ({
      index: i,
      startSec: round3(s.startSec),
      endSec: round3(i === manifestSegments.length - 1 ? Math.max(s.endSec, totalSec) : s.endSec),
      text: chars.slice(at(s.startSec), at(s.endSec)).join("").trim(),
    }));
  }
  const sentences = (text.match(SENTENCE_RE) ?? []).map(s => s.trim()).filter(Boolean);
  if (sentences.length <= 1) return [{ index: 0, startSec: 0, endSec: round3(totalSec), text }];
  const weights = sentences.map(s => Math.max(1, Array.from(s).length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return sentences.map((s, i) => {
    const startSec = round3((acc / sum) * totalSec);
    acc += weights[i];
    return { index: i, startSec, endSec: i === sentences.length - 1 ? round3(totalSec) : round3((acc / sum) * totalSec), text: s };
  });
}

/** sec 所在的口播段（落在末尾时归最后一段）。 */
export function digitalHumanSegmentAt(segments: ReadonlyArray<DigitalHumanSpeechSegment>, sec: number): DigitalHumanSpeechSegment | undefined {
  if (!segments.length) return undefined;
  return segments.find(s => sec >= s.startSec - EPS && sec < s.endSec - EPS) ?? segments[segments.length - 1];
}

/** 覆盖轨上未被占用的区间（按时间排序，未与口播段相交）。 */
export function digitalHumanOverlayFreeSpans(existing: ReadonlyArray<Span>, totalSec: number): Array<{ startSec: number; endSec: number }> {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return [];
  const busy = existing.map(o => ({ start: o.startSec, end: o.startSec + o.durationSec })).sort((a, b) => a.start - b.start);
  const free: Array<{ startSec: number; endSec: number }> = [];
  let cursor = 0;
  for (const b of busy) {
    if (b.start > cursor + EPS) free.push({ startSec: round3(cursor), endSec: round3(Math.min(b.start, totalSec)) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < totalSec - EPS) free.push({ startSec: round3(cursor), endSec: round3(totalSec) });
  return free.filter(f => f.endSec - f.startSec > EPS);
}

/** 时间轴条上的可点空档：空闲区间再按口播段切开，短于最短覆盖时长的不给入口。 */
export function digitalHumanOverlayGaps(
  existing: ReadonlyArray<Span>,
  segments: ReadonlyArray<DigitalHumanSpeechSegment>,
  totalSec: number,
  minSec = DIGITAL_HUMAN_OVERLAY_MIN_SEC,
): DigitalHumanOverlayGap[] {
  const free = digitalHumanOverlayFreeSpans(existing, totalSec);
  const segs = segments.length ? segments : [{ index: 0, startSec: 0, endSec: totalSec, text: "" }];
  const gaps: DigitalHumanOverlayGap[] = [];
  for (const f of free) {
    for (const s of segs) {
      const startSec = round3(Math.max(f.startSec, s.startSec)), endSec = round3(Math.min(f.endSec, s.endSec));
      if (endSec - startSec + EPS >= minSec) gaps.push({ startSec, endSec, segmentIndex: s.index });
    }
  }
  return gaps;
}

/** 单条补充画面的默认窗口上限（秒）：长空档（如整段 60 秒口播）不能默认整段盖住人物，也会让「至少 N 秒」筛选几乎无候选。 */
export const DIGITAL_HUMAN_OVERLAY_TARGET_MAX_SEC = 8;

/** 抽屉的目标时长：选了空档取 min(空档时长, 8 秒)，否则用默认覆盖时长。 */
export function digitalHumanOverlayTargetSec(gap?: Pick<DigitalHumanOverlayGap, "startSec" | "endSec">): number {
  if (gap && gap.endSec > gap.startSec) return round3(Math.min(gap.endSec - gap.startSec, DIGITAL_HUMAN_OVERLAY_TARGET_MAX_SEC));
  return DIGITAL_HUMAN_VIDEO_OVERLAY_DEFAULT_SEC;
}

/**
 * 抽屉「采用并绑定」后的覆盖条目。
 * 视频：从 preferredStartSec 所在空闲区间开始（不在空闲处则顺延到下一个放得下的区间，最后回绕），
 * sourceInSec = inSec，durationSec = outSec − inSec，空闲不够时收缩（入点不动）。
 * 照片：沿用 placeDigitalHumanOverlay 的原规则。
 * 新条目再过一遍 digitalHumanOverlayIssues（时长、越界、素材长度、与已有条目重叠），不合规直接抛错不写入。
 */
export function digitalHumanOverlayFromPick(
  existing: ReadonlyArray<DigitalHumanOverlayDraft>,
  pick: { asset: Pick<StockFootageAssetView, "assetId" | "kind" | "purpose" | "usage" | "durationSec" | "width" | "height" | "source">; inSec: number; outSec: number },
  totalSec: number,
  preferredStartSec = 0,
): DigitalHumanOverlayDraft {
  const { asset } = pick;
  if (asset.purpose !== "digital_human" || !isStockAssetInsertable(asset)) throw new Error("该素材不是为数字人补充画面采用的可入片素材");
  if (!Number.isFinite(totalSec) || totalSec <= 0) throw new Error("请先试听并批准当前完整配音，再放置补充画面");
  if (existing.length >= DIGITAL_HUMAN_OVERLAY_MAX_COUNT) throw new Error(`补充画面最多${DIGITAL_HUMAN_OVERLAY_MAX_COUNT}条`);
  let placed: { startSec: number; durationSec: number; sourceInSec: number };
  if (asset.kind === "photo") {
    placed = placeDigitalHumanOverlay(existing, { kind: "photo" }, totalSec, preferredStartSec);
  } else {
    const sourceSec = Number(asset.durationSec);
    if (!(sourceSec > 0)) throw new Error("视频素材缺少时长，不能放置");
    const inSec = round3(Math.max(0, Number(pick.inSec) || 0));
    const outSec = round3(Math.min(Number(pick.outSec) || 0, sourceSec));
    const trimSec = round3(outSec - inSec);
    if (!(trimSec + EPS >= DIGITAL_HUMAN_OVERLAY_MIN_SEC)) throw new Error(`所选片段短于${DIGITAL_HUMAN_OVERLAY_MIN_SEC}秒，请在预览里调整入点和出点`);
    const free = digitalHumanOverlayFreeSpans(existing, totalSec);
    const pref = Math.max(0, preferredStartSec);
    const starts = [
      ...free.filter(f => pref >= f.startSec - EPS && pref < f.endSec - EPS).map(f => ({ start: Math.max(pref, f.startSec), end: f.endSec })),
      ...free.filter(f => f.startSec > pref).map(f => ({ start: f.startSec, end: f.endSec })),
      ...free.filter(f => f.endSec <= pref + EPS).map(f => ({ start: f.startSec, end: f.endSec })),
    ];
    const slot = starts.find(s => s.end - s.start + EPS >= DIGITAL_HUMAN_OVERLAY_MIN_SEC);
    if (!slot) throw new Error("口播时间轴上已没有足够空档放置这条补充画面");
    placed = { startSec: round3(slot.start), durationSec: round3(Math.min(trimSec, slot.end - slot.start)), sourceInSec: inSec };
  }
  const row: DigitalHumanOverlayDraft = {
    assetId: asset.assetId,
    ...placed,
    mode: "overlay",
    kind: asset.kind,
    ...(asset.durationSec ? { sourceDurationSec: asset.durationSec } : {}),
    width: asset.width,
    height: asset.height,
    attribution: stockAttributionText(asset.source),
    ...(asset.source.pageUrl ? { pageUrl: asset.source.pageUrl } : {}),
  };
  const facts = (id: string) => (id === row.assetId ? { kind: row.kind, durationSec: row.sourceDurationSec } : undefined);
  const own = digitalHumanOverlayIssues([row], totalSec, facts);
  if (own.length) throw new Error(own.map(i => i.message).join("；"));
  const overlap = existing.some(o => row.startSec < o.startSec + o.durationSec - EPS && o.startSec < row.startSec + row.durationSec - EPS);
  if (overlap) throw new Error("所选位置与已放置的补充画面重叠");
  return row;
}
