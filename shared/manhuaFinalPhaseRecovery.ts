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
 * 从画布节点解析当前集的成片地址。
 *
 * 原实现把地址只放在 React state 里，刷新后恒为 null。
 * 成片节点本来就落在画布上（`final-eXX`），照真实产物读才是可信口径：
 * 先找当前集，找不到再回落到最近一条已完成的整集成片。
 */
export function resolveFinalVideoUrlFromBlocks(
  blocks: readonly FinalBlockLike[],
  focusEpisode: number,
): string | null {
  const preferredId = `final-e${String(Math.max(1, Math.floor(focusEpisode) || 1)).padStart(2, "0")}`;
  const usable = (b: FinalBlockLike) =>
    b.status === "done" && Boolean(String(b.outputUrl || "").trim());
  const preferred = blocks.find((b) => b.id === preferredId && usable(b));
  if (preferred) return String(preferred.outputUrl).trim();
  const latest = [...blocks].reverse().find((b) => /^final-e\d+$/i.test(b.id) && usable(b));
  return latest ? String(latest.outputUrl).trim() : null;
}
