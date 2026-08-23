/**
 * 「成片」阶段的恢复判据。
 *
 * 立此模块的原因：第五格的面板就是成片坞，而坞的可见性**不持久化**，
 * 工作台内部又只渲染 outline/assets/storyboard/edit 四个面板。
 * 只存 workflowPhase 不存坞开关，刷新后 phase 还是 final、坞却关着 ——
 * **一块空白工作台**，而且已经合成好的成片会被判成「未完成」。
 *
 * 判据写成函数导出，页面与测试共用一处；这类「A 状态必须带着 B 状态一起走」
 * 的约束一旦散在各个 onClick 里，加一个入口就漏一个。
 */

/** 进入 final 时坞必须是开的 */
export function shouldOpenClipDockForPhase(phase: string): boolean {
  return phase === "final";
}

/** 离开坞时 final 要收回 edit；其它阶段原样不动 */
export function phaseAfterLeavingClipDock<T extends string>(current: T): T | "edit" {
  return current === "final" ? "edit" : current;
}

export type FinalBlockLike = {
  id: string;
  status?: string;
  outputUrl?: string | null;
};

/**
 * 解析**当前集**的成片地址。严格按集号，找不到就是 null。
 *
 * ⚠️ 原实现找不到当前集时回落到「最近一条已完成成片」，而这个返回值直接喂给
 * `hasFinalVideo`、第五格 complete、预览与下载按钮 ——
 * 焦点在第 9 集、库里只有 final-e02 时，第 9 集会被标成「已完成」
 * 并播放/下载**第 2 集的视频**。回落在这里等于串集。
 *
 * 成片坞若另需「最近一条成片」，用 `resolveLatestFinalVideoUrlFromBlocks()`，
 * 不要复用当前集状态。
 */
export function resolveFinalVideoUrlFromBlocks(
  blocks: readonly FinalBlockLike[],
  focusEpisode: number,
): string | null {
  const preferredId = `final-e${String(Math.max(1, Math.floor(focusEpisode) || 1)).padStart(2, "0")}`;
  const preferred = blocks.find(
    (b) =>
      b.id === preferredId
      && b.status === "done"
      && Boolean(String(b.outputUrl || "").trim()),
  );
  return preferred ? String(preferred.outputUrl).trim() : null;
}

/**
 * 最近一条已完成整集成片，**与当前集无关**。
 *
 * 单独一个函数，就是为了不让「当前集完成了没」和「库里有没有成片」两件事共用一个值。
 */
export function resolveLatestFinalVideoUrlFromBlocks(
  blocks: readonly FinalBlockLike[],
): string | null {
  const latest = [...blocks]
    .reverse()
    .find(
      (b) =>
        /^final-e\d+$/i.test(b.id)
        && b.status === "done"
        && Boolean(String(b.outputUrl || "").trim()),
    );
  return latest ? String(latest.outputUrl).trim() : null;
}
