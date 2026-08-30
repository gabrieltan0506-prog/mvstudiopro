/**
 * 资产卡折叠判据。
 *
 * 立此模块的原因：单张资产卡把数据模型的每个字段都摆成了一个控件——
 * 勾选 / ✕ / 改名 / 认领 / 清除认领 / 裁字 / 去字 / 四个分类 / 垫图用途，
 * 13 张卡全部平铺就是一屏一百多个可点的东西。
 * 用户原话：「太复杂跟繁琐，一点都不好用」。
 *
 * 判据写成函数导出，卡片与测试共用一处——展开与否这种事一旦在渲染里
 * 内联判断，下次加条件就会出现「这里展开了那里没展开」。
 */

export type ManhuaAssetCardFoldInput = {
  /**
   * 简洁模式（全局，默认开，写 localStorage 持久化）。
   *
   * 语义修正（0830）：关掉它＝「默认展开」，**不再是「强制展开」**。
   * 旧口径下 `compactUi=false` 让 13 张卡一律展开回 17 控件，
   * 而单卡的收起按钮又恰好门在 `compactUi` 上——用户点过一次「显示说明」
   * 就再没有任何办法把卡片收回去（只能去顶栏切回简洁模式，多数人找不到）。
   * 结果是折叠功能虽然 8/24 就上线了，用户仍能长期停在一屏两百多个控件的状态。
   * 现在改成：非简洁模式只影响**默认值**，用户仍可逐卡收起。
   */
  compactUi: boolean;
  /** 用户手动点开的卡 */
  expandedIds: ReadonlySet<string>;
  /**
   * 用户手动收起的卡（仅非简洁模式下有意义——那时默认是展开的）。
   * 有它才能在「显示说明」模式下把卡收回去。
   */
  collapsedIds?: ReadonlySet<string>;
  id: string;
  /**
   * 这张图需要人工确认（质检不过）。
   *
   * **强制展开**：折叠的前提是「收起来的都是低频操作」，
   * 而待确认是必须处理的事——收起来等于把问题藏了。
   */
  needsReview?: boolean;
};

export function isManhuaAssetCardExpanded(input: ManhuaAssetCardFoldInput): boolean {
  // 待确认永远强制展开：收起来等于把必须处理的问题藏了
  if (input.needsReview) return true;
  // 非简洁模式＝默认展开，但用户手动收起的仍然收起（不再是不可逆的强制展开）
  if (!input.compactUi) return !input.collapsedIds?.has(input.id);
  return input.expandedIds.has(input.id);
}

/**
 * 卡面的收起/展开按钮是否渲染。
 *
 * 旧代码把它门在 `compactUi` 上，于是非简洁模式下按钮消失、卡片又被强制展开，
 * 两件事叠加＝没有退路。现在只要不是「待确认强制展开」，按钮就必须在——
 * 用户永远要有把东西收回去的办法。
 */
export function shouldShowManhuaAssetFoldToggle(input: { needsReview?: boolean }): boolean {
  return !input.needsReview;
}

/**
 * 折叠态下卡面仍要显示分类，否则用户分不清这张是人物还是场景。
 * 展开时由分类按钮组接管，不重复显示。
 */
export function shouldShowManhuaAssetRoleChip(expanded: boolean): boolean {
  return !expanded;
}
