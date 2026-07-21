/**
 * 短剧多段连续：下一段 Seedance 参考上一段成片末几帧（方案 A）。
 * 政策文案 + 从画布块列表解析上一集 clip 输出 URL。
 */

export const MANHUA_CLIP_TAIL_FRAME_COUNT = 3;
export const MANHUA_CLIP_CONTINUITY_HINT_ZH =
  "【镜头连续性】以上一段成片末几帧为视觉锚：同一张脸、同一套服装、同一场景材质与光色；站位与运镜惯性平滑承接。禁止换脸、换装、下一秒跳棚。";

export type ContinuityClipLike = {
  id: string;
  kind?: string;
  episodeIndex?: number | null;
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

/** 取「当前集」之前最近一集已完成的 clip 成片 URL */
export function resolvePreviousEpisodeClipUrl(
  blocks: ContinuityClipLike[],
  episodeIndex: number,
): string | undefined {
  const ep = Math.floor(episodeIndex);
  if (!(ep >= 2)) return undefined;
  let best: { ep: number; url: string } | undefined;
  for (const b of blocks) {
    if (!String(b.id || "").startsWith("clip-")) continue;
    const url = String(b.outputUrl || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (b.status && b.status !== "done") continue;
    const be = episodeOf(b);
    if (be == null || be >= ep || be < 1) continue;
    if (!best || be > best.ep) best = { ep: be, url };
  }
  return best?.url;
}
