/**
 * 关键静帧进度文案：按「已出成功 / 本集静帧总数」计，不用整条工厂流水线节点序号。
 * （流水线 16/17 会让用户误以为已出 16 张图）
 */

export type ManhuaKeyartProgressCounts = {
  total: number;
  done: number;
  failed: number;
  running: number;
};

export function countManhuaKeyartProgress(
  blocks: Array<{
    id: string;
    status?: string;
    error?: string;
    outputUrl?: string;
    outputUrls?: string[];
    episodeIndex?: number | null;
  }>,
  episodeIndex: number,
  getEpisodeIndex: (b: { id: string; episodeIndex?: number | null }) => number | null | undefined,
  /** 分镜表预期张数；大于节点数时用来避免「1/1 假完成」 */
  expectedTotal?: number,
): ManhuaKeyartProgressCounts {
  const ep = Math.max(1, Math.floor(episodeIndex) || 1);
  const epKeys = blocks.filter(
    (b) => b.id.startsWith("keyart-") && (getEpisodeIndex(b) ?? 1) === ep,
  );
  const nodeTotal = epKeys.length;
  const expect = Math.max(0, Math.floor(expectedTotal || 0));
  const total = Math.max(nodeTotal, expect);
  const done = epKeys.filter((b) => Boolean(b.outputUrl || b.outputUrls?.[0])).length;
  const failed = epKeys.filter(
    (b) => b.status === "error" || (Boolean(b.error) && !b.outputUrl && !b.outputUrls?.[0]),
  ).length;
  const running = epKeys.filter((b) => b.status === "running").length;
  return { total, done, failed, running };
}

export function formatManhuaKeyartProgressZh(
  counts: ManhuaKeyartProgressCounts,
  episodeIndex: number,
): string {
  const ep = Math.max(1, Math.floor(episodeIndex) || 1);
  const total = Math.max(0, counts.total);
  if (!total) return `第${ep}集 · 关键静帧`;
  const parts = [`第${ep}集 · 静帧已出 ${counts.done}/${total}`];
  if (counts.failed > 0) parts.push(`失败 ${counts.failed}`);
  if (counts.running > 0) parts.push("生成中");
  else if (counts.done + counts.failed < total) parts.push("排队中");
  return parts.join(" · ");
}
