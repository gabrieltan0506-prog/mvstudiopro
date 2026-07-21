/**
 * 短剧多段连续：下一段成片参考上一段成片末几帧 + 本段静帧。
 * 段号按全集连续（第 2 集第 1 段 = g13，参考 g12）。
 */

import {
  manhuaGlobalSegmentIndex,
  manhuaLocalSegmentIndex,
  resolveClipSegmentIndex,
} from "./manhuaScriptWorkbench.js";

export const MANHUA_CLIP_TAIL_FRAME_COUNT = 3;
export const MANHUA_CLIP_CONTINUITY_HINT_ZH =
  "【镜头连续性】以上一段成片末几帧为视觉锚：同一张脸、同一套服装、同一场景材质与光色；站位与运镜惯性平滑承接。禁止换脸、换装、下一秒跳棚。";

/** 跨段/跨集剧情延伸时用短转场遮接缝（脸服仍锁） */
export const MANHUA_CLIP_CROSS_SEGMENT_TRANSITION_HINT_ZH =
  "【跨段转场】若与上一段有剧情延伸或空间跳步，可用短促景别切、焦点虚实、光影渐变或动作甩接遮掩接缝；仍须锁同一脸与服装，禁止整容式换人换装。";

export type ContinuityClipLike = {
  id: string;
  kind?: string;
  episodeIndex?: number | null;
  prompt?: string | null;
  outputUrl?: string | null;
  status?: string;
};

function episodeOf(block: ContinuityClipLike): number | null {
  if (typeof block.episodeIndex === "number" && block.episodeIndex >= 1) {
    return Math.floor(block.episodeIndex);
  }
  const m = String(block.id || "").match(/-e(\d{2})(?:-|$)/i);
  if (m) return Number(m[1]);
  if (String(block.id || "").startsWith("clip-") && !/-e\d{2}/i.test(block.id)) return 1;
  return null;
}

/** 块 → 全集连续段号 */
export function resolveClipGlobalSegmentIndex(block: ContinuityClipLike): number {
  const ep = episodeOf(block) ?? 1;
  const raw = resolveClipSegmentIndex(block.id, block.prompt);
  const local = manhuaLocalSegmentIndex(raw, ep);
  return manhuaGlobalSegmentIndex(ep, local);
}

function httpsDoneUrl(block: ContinuityClipLike): string | undefined {
  const url = String(block.outputUrl || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  if (block.status && block.status !== "done") return undefined;
  return url;
}

/**
 * 取「全局段号 − 1」的已完成成片 URL（同集上一段，或跨集时上一集末段）。
 * 例：生成 g13（第 2 集第 1 段）→ 参考 g12。
 */
export function resolvePreviousSegmentClipUrl(
  blocks: ContinuityClipLike[],
  episodeIndex: number,
  segmentIndex: number,
): string | undefined {
  const ep = Math.max(1, Math.floor(episodeIndex));
  const local = manhuaLocalSegmentIndex(segmentIndex, ep);
  const global = manhuaGlobalSegmentIndex(ep, local);
  if (global <= 1) return undefined;
  const prevGlobal = global - 1;
  let best: { url: string; ep: number } | undefined;
  for (const b of blocks) {
    if (!String(b.id || "").startsWith("clip-")) continue;
    const url = httpsDoneUrl(b);
    if (!url) continue;
    if (resolveClipGlobalSegmentIndex(b) !== prevGlobal) continue;
    const be = episodeOf(b) ?? 1;
    if (!best || be > best.ep) best = { url, ep: be };
  }
  return best?.url;
}

/**
 * 取「当前集」之前最近一集的**末段**已完成 clip URL（跨集回退）。
 * 同集段间接力请用 resolvePreviousSegmentClipUrl。
 */
export function resolvePreviousEpisodeClipUrl(
  blocks: ContinuityClipLike[],
  episodeIndex: number,
): string | undefined {
  const ep = Math.floor(episodeIndex);
  if (!(ep >= 2)) return undefined;
  let best: { ep: number; globalSeg: number; url: string } | undefined;
  for (const b of blocks) {
    if (!String(b.id || "").startsWith("clip-")) continue;
    const url = httpsDoneUrl(b);
    if (!url) continue;
    const be = episodeOf(b);
    if (be == null || be >= ep || be < 1) continue;
    const globalSeg = resolveClipGlobalSegmentIndex(b);
    if (
      !best ||
      be > best.ep ||
      (be === best.ep && globalSeg > best.globalSeg)
    ) {
      best = { ep: be, globalSeg, url };
    }
  }
  return best?.url;
}
